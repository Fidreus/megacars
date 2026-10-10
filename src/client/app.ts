// The game shell: renderer, track scene, lighting moods, sound, input and the
// screen flow (title menu → race → results), plus debug hooks.

import * as THREE from 'three';
import { DT } from '../shared/config/constants.ts';
import { SURFACES, Surface } from '../shared/config/surfaces.ts';
import { cloneTuning, DEFAULT_TUNING, type CarTuning } from '../shared/config/tuning.ts';
import { TRACKS, TRACK_LIST } from '../shared/track/defs/index.ts';
import type { Track } from '../shared/track/types.ts';
import { Ev } from '../shared/sim/events.ts';
import { copyInput, NEUTRAL_INPUT, type CarInput } from '../shared/sim/input.ts';
import { resetProgress } from '../shared/sim/race.ts';
import { RacePhase, respawnCar, standings } from '../shared/sim/world.ts';
import { AudioSystem } from './audio/audio.ts';
import { EngineSound } from './audio/engine.ts';
import {
  playExplosion, playFanfare, playImpact, playLaunch, playMineDrop, playTone, playTurbo, SkidSound,
} from './audio/sfx.ts';
import { ShotKind } from '../shared/sim/weapons.ts';
import { installDebugApi } from './debug/debugApi.ts';
import { buildTrackDebugView } from './debug/trackDebugView.ts';
import { loadSavedTuning, openTuningPanel } from './debug/tuningPanel.ts';
import { Online, OnlineSession } from './game/online.ts';
import { attractSession, RaceSession } from './game/raceSession.ts';
import type { GameSession } from './game/session.ts';
import { lightsOn, RaceView } from './game/raceView.ts';
import { DIFFICULTIES, loadSettings, saveSettings, type RaceSettings } from './game/settings.ts';
import { P1_KEYS, P2_KEYS, SOLO_KEYS } from './input/bindings.ts';
import { InputManager, type LocalPlayerInput } from './input/inputManager.ts';
import { Nav, type NavState } from './input/nav.ts';
import type { Params } from './params.ts';
import { animTime } from './render/materials.ts';
import { MOODS, moodById, type Mood } from './render/mood.ts';
import { PALETTE_MODE_NAMES, PaletteMode, type PaletteModeId } from './render/palette.ts';
import { buildProps } from './render/props.ts';
import { RetroRenderer } from './render/renderer.ts';
import { buildScenery } from './render/scenery.ts';
import { buildTown } from './render/town.ts';
import { buildIndustry, type SteamSource } from './render/industry.ts';
import { themeOf } from './render/theme.ts';
import { buildTrackView } from './render/trackMesh.ts';
import { drawText, LINE_H } from './ui/font.ts';
import { Menu } from './ui/menu.ts';
import { drawCountdown, drawPlayerHud, Minimap } from './ui/screens/hud.ts';
import { drawResults } from './ui/screens/results.ts';
import { connText, drawLobby, inviteLink, pingColor } from './ui/screens/lobby.ts';
import { drawLogo } from './ui/screens/title.ts';
import { drawStandings, ShopScreen, type ShopContext } from './ui/screens/shop.ts';
import {
  humanDrivers, isOver, leader, loadCup, newChampionship, nextRaceSpec, saveCup, settleRace, standingsRows, type Championship,
} from './game/championship.ts';
import { buy, CAR_MODELS } from '../shared/game/shop.ts';
import { DIVISIONS, endSeason, loadCareer, newCareer, saveCareer, type Career } from './game/career.ts';
import { drawSeasonEnd } from './ui/screens/season.ts';
import type { RaceSpec } from '../shared/net/protocol.ts';

const SHADOW_HALF = 62;
const SHADOW_MAP = 2048;
const PAVED = new Set<number>([Surface.Asphalt, Surface.Curb, Surface.Wet]);
/** Visible height of a full-screen view, metres. Split screen zooms out a little. */
const VIEW_HEIGHT = 51.3;

/** title: main menu; online: connect/join; lobby: in a room; race: a race on screen. */
type Mode = 'title' | 'online' | 'lobby' | 'race' | 'cup' | 'shop' | 'standings' | 'career' | 'seasonEnd';

export class App {
  readonly renderer: RetroRenderer;
  readonly scene = new THREE.Scene();
  readonly tuning: CarTuning;
  readonly input = new InputManager();
  readonly lookAhead = { value: 0.3 };
  readonly settings: RaceSettings;
  mode: Mode = 'title';
  session!: GameSession;
  /** Online play (connection, room, races). */
  readonly online: Online;
  view!: RaceView;
  track!: Track;
  mood: Mood = MOODS[0];
  fps = 0;
  /** Freeze the simulation (pause menu, debug, screenshots); rendering continues. */
  paused = false;
  /** Which car each viewport follows. */
  readonly viewCar = [0, 1];
  private readonly params: Params;
  private readonly nav: Nav;
  private readonly sun = new THREE.DirectionalLight('#fff0d4', 2.4);
  private readonly hemi = new THREE.HemisphereLight('#ffffff', '#000000', 1);
  private readonly sunRight = new THREE.Vector3();
  private readonly sunUp = new THREE.Vector3();
  private readonly sunDir = new THREE.Vector3(0, 1, 0);
  private readonly audio = new AudioSystem();
  private readonly minimap = new Minimap();
  private trackGroup: THREE.Group | null = null;
  private debugView: THREE.Group | null = null;
  private nightLights: THREE.Object3D[] = [];
  private lampBulbs: THREE.MeshBasicMaterial | null = null;
  private lampPools: THREE.MeshBasicMaterial | null = null;
  private engines: EngineSound[] = [];
  private skidSound: SkidSound | null = null;
  private tuningPanel: { toggle(): void } | null = null;
  private readonly titleMenu: Menu;
  private readonly pauseMenu: Menu;
  private readonly onlineMenu: Menu;
  private readonly lobbyMenu: Menu;
  private readonly cupMenu: Menu;
  /** The shop being shown (mode 'shop'). */
  private shop: ShopScreen | null = null;
  /** Offline championship in progress, and whether the current race belongs to it. */
  private cup: Championship | null = null;
  /** Career in progress (its current season is `cup`). */
  private career: Career | null = null;
  private readonly careerMenu: Menu;
  private cupRace = false;
  private readonly camTargets = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly camInit = [false, false];
  private readonly tagPos = new THREE.Vector3();
  private steam: SteamSource[] = [];
  /** Building window materials, lit at night. */
  private windowMats: THREE.MeshToonMaterial[] = [];
  /** Camera shake strength 0..1 (decays). */
  private shake = 0;
  /** Seconds of victory fireworks left. */
  private fireworks = 0;
  private acc = 0;
  private last = -1;
  private time = 0;
  private fpsTime = 0;
  private fpsFrames = 0;
  private flash = '';
  private flashTime = 0;
  private showTelemetry = false;
  private padIndex = -1;
  private lastLights = 0;
  private firstRace = true;

  constructor(canvas: HTMLCanvasElement, params: Params) {
    this.params = params;
    this.renderer = new RetroRenderer(canvas, params.scale);
    this.renderer.crt = params.scanlines ? 1 : 0;
    this.tuning = cloneTuning(DEFAULT_TUNING);
    loadSavedTuning(this.tuning);
    this.settings = loadSettings();
    if (params.mood) this.settings.mood = params.mood;
    if (TRACKS[params.track]) this.settings.track = params.track;
    if (params.laps) this.settings.laps = params.laps;
    if (params.p2) this.settings.players = 2;
    if (params.aiSet) this.settings.opponents = Math.min(8 - this.settings.players, params.ai);
    if (params.difficulty !== null) this.settings.difficulty = params.difficulty;
    this.nav = new Nav(this.input.keyboard, canvas);
    this.nav.toUi = (cx, cy) => {
      const rect = canvas.getBoundingClientRect();
      const sx = (cx - rect.left) * (this.renderer.deviceW / rect.width);
      const sy = (cy - rect.top) * (this.renderer.deviceH / rect.height);
      return [Math.floor(sx / this.renderer.scale), Math.floor(sy / this.renderer.scale)];
    };

    this.scene.add(this.hemi);
    const sun = this.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const sc = sun.shadow.camera;
    sc.left = -SHADOW_HALF;
    sc.right = SHADOW_HALF;
    sc.top = SHADOW_HALF;
    sc.bottom = -SHADOW_HALF;
    sc.near = 1;
    sc.far = 500;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun, sun.target);

    const beep = () => playTone(this.audio, 660, 0.04, 'square', 0.05);
    this.titleMenu = new Menu(this.buildTitleItems(), { onMove: beep, onChange: beep });
    this.pauseMenu = new Menu([
      { label: () => 'RESUME', select: () => (this.paused = false) },
      {
        label: () => 'RESTART RACE',
        disabled: () => !(this.session instanceof RaceSession),
        select: () => this.restartRace(),
      },
      {
        label: () => (this.netRace ? 'LEAVE ROOM' : 'QUIT TO MENU'),
        select: () => (this.netRace ? this.leaveRoom() : this.toTitle()),
      },
    ], { onMove: beep });
    this.online = new Online({
      race: (s) => this.startOnlineRace(s),
      room: (room) => {
        if (room && this.mode === 'online') this.toLobby();
        else if (!room && this.mode === 'lobby') this.mode = 'online';
      },
      notice: (text) => this.flashMessage(text, 2.5),
    });
    this.onlineMenu = new Menu(this.buildOnlineItems(), { onMove: beep, onChange: beep });
    this.lobbyMenu = new Menu(this.buildLobbyItems(), { onMove: beep, onChange: beep });
    this.cupMenu = new Menu([
      {
        label: () => {
          const c = loadCup();
          return c ? `CONTINUE  RACE ${c.race + 1} OF ${c.tracks.length}` : 'CONTINUE';
        },
        disabled: () => !loadCup(),
        select: () => {
          this.cup = loadCup();
          if (this.cup) this.openCupShop(0);
        },
      },
      {
        label: () => 'NEW CHAMPIONSHIP',
        select: () => {
          this.cup = newChampionship(this.settings);
          saveCup(this.cup);
          this.openCupShop(0);
        },
      },
      { label: () => 'BACK', select: () => this.toTitle() },
    ], { onMove: beep });
    this.careerMenu = new Menu([
      {
        label: () => {
          const c = this.career ?? loadCareer();
          return c ? `CONTINUE - DIVISION ${c.division}, RACE ${c.cup.race + 1} OF ${c.cup.tracks.length}` : 'CONTINUE';
        },
        disabled: () => !(this.career ?? loadCareer()),
        select: () => {
          this.career = this.career ?? loadCareer();
          if (!this.career) return;
          this.cup = this.career.cup;
          this.openCupShop(0);
        },
      },
      {
        label: () => ((this.career ?? loadCareer()) ? 'NEW CAREER (DELETES THE OLD ONE)' : 'NEW CAREER'),
        select: () => {
          this.career = newCareer();
          this.cup = this.career.cup;
          saveCareer(this.career);
          this.openCupShop(0);
        },
      },
      { label: () => 'BACK', select: () => this.toTitle() },
    ], { onMove: beep });

    this.setMood(moodById(this.settings.mood));
    if (params.room) {
      this.toTitle();
      this.mode = 'online';
      this.online.code = params.room;
      this.online.join(params.room);
    } else if (params.mode === 'quick') this.startRace(this.settings);
    else if (params.mode === 'practice') this.startRace({ ...this.settings, practice: true, opponents: params.aiSet ? params.ai : 0 });
    else this.toTitle();
    if (params.debug) {
      this.showTelemetry = true;
      if (this.debugView) this.debugView.visible = true;
      void this.openTuning();
    }
    installDebugApi(this);

    const unlock = () => {
      if (this.params.mute) return;
      this.audio.unlock();
      if (!this.skidSound && this.audio.ctx) {
        this.engines = [new EngineSound(this.audio), new EngineSound(this.audio)];
        this.skidSound = new SkidSound(this.audio);
      }
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    canvas.focus();
  }

  // ---------------------------------------------------------------- menus

  private buildTitleItems() {
    const s = this.settings;
    const changed = () => saveSettings(s);
    const cycle = (v: number, n: number, d: number) => (v + d + n) % n;
    return [
      { label: () => 'START RACE', select: () => this.startRace(s) },
      { label: () => 'CAREER', select: () => this.toCareer() },
      { label: () => 'CHAMPIONSHIP', select: () => { this.career = null; this.mode = 'cup'; this.cupMenu.index = loadCup() ? 0 : 1; } },
      { label: () => 'PLAY ONLINE', select: () => this.toOnline() },
      {
        label: () => (s.players === 1 ? 'PLAYERS: 1' : 'PLAYERS: 2 SPLIT SCREEN'),
        change: () => {
          s.players = s.players === 1 ? 2 : 1;
          s.opponents = Math.min(s.opponents, 8 - s.players);
          changed();
        },
      },
      {
        label: () => `TRACK: ${TRACKS[s.track].name.toUpperCase()}`,
        change: (d: number) => {
          const i = TRACK_LIST.findIndex((t) => t.id === s.track);
          s.track = TRACK_LIST[cycle(i, TRACK_LIST.length, d)].id;
          changed();
          this.toTitle();
        },
      },
      { label: () => `LAPS: ${s.laps}`, change: (d: number) => { s.laps = 1 + cycle(s.laps - 1, 9, d); changed(); } },
      {
        label: () => `OPPONENTS: ${s.opponents}`,
        change: (d: number) => { s.opponents = cycle(s.opponents, 9 - s.players, d); changed(); },
      },
      { label: () => `DIFFICULTY: ${DIFFICULTIES[s.difficulty]}`, change: (d: number) => { s.difficulty = cycle(s.difficulty, 3, d); changed(); } },
      { label: () => `WEAPONS: ${s.weapons ? 'ON' : 'OFF'}`, change: () => { s.weapons = !s.weapons; changed(); } },
      {
        label: () => `TIME: ${moodById(s.mood).name}`,
        change: (d: number) => {
          const i = MOODS.findIndex((m) => m.id === s.mood);
          s.mood = MOODS[cycle(i, MOODS.length, d)].id;
          this.setMood(moodById(s.mood));
          changed();
        },
      },
      { label: () => 'FREE PRACTICE', select: () => this.startRace({ ...s, practice: true, players: 1, opponents: 0 }) },
    ];
  }

  private buildOnlineItems() {
    const o = () => this.online;
    const joinable = () => o().code.length === 4;
    return [
      {
        label: () => `NAME: ${o().name}`,
        text: { get: () => o().name, set: (v: string) => (o().name = v), max: 12, allowed: /[A-Z0-9 ._-]/ },
        select: () => o().commitName(),
      },
      { label: () => 'CREATE ROOM', select: () => { o().commitName(); o().create(); } },
      {
        label: () => `JOIN ROOM: ${o().code || '----'}`,
        text: { get: () => o().code, set: (v: string) => (o().code = v), max: 4, allowed: /[A-Z]/ },
        select: () => {
          if (!joinable()) {
            this.flashMessage('TYPE THE 4-LETTER ROOM CODE');
            return;
          }
          o().commitName();
          o().join(o().code);
        },
      },
      { label: () => 'BACK', select: () => this.toTitle() },
    ];
  }

  private buildLobbyItems() {
    const o = () => this.online;
    const cfg = () => o().room?.config;
    const notHost = () => !o().isHost;
    const busy = () => o().room?.state === 'race';
    const cycle = (v: number, n: number, d: number) => (v + d + n) % n;
    const everyoneReady = () => !!o().room?.players.every((p) => p.ready || !p.connected);
    return [
      {
        label: () => {
          if (busy()) return 'RACE IN PROGRESS';
          if (o().isHost) return everyoneReady() ? 'START RACE' : 'START RACE (WAITING)';
          return o().myInfo?.ready ? 'READY: YES' : 'READY: NO';
        },
        disabled: () => busy() || (o().isHost && !everyoneReady()),
        select: () => (o().isHost ? o().start() : o().setReady(!o().myInfo?.ready)),
      },
      {
        label: () => `TRACK: ${TRACKS[cfg()?.track ?? '']?.name.toUpperCase() ?? '?'}`,
        disabled: notHost,
        change: (d: number) => {
          const i = TRACK_LIST.findIndex((t) => t.id === cfg()?.track);
          o().configure({ track: TRACK_LIST[cycle(i, TRACK_LIST.length, d)].id });
        },
      },
      { label: () => `LAPS: ${cfg()?.laps ?? 3}`, disabled: notHost, change: (d: number) => o().configure({ laps: 1 + cycle((cfg()?.laps ?? 3) - 1, 9, d) }) },
      { label: () => `COMPUTER CARS: ${cfg()?.ai ?? 0}`, disabled: notHost, change: (d: number) => o().configure({ ai: cycle(cfg()?.ai ?? 0, 8, d) }) },
      {
        label: () => `DIFFICULTY: ${DIFFICULTIES[cfg()?.difficulty ?? 1]}`,
        disabled: notHost,
        change: (d: number) => o().configure({ difficulty: cycle(cfg()?.difficulty ?? 1, 3, d) }),
      },
      { label: () => `WEAPONS: ${cfg()?.weapons === false ? 'OFF' : 'ON'}`, disabled: notHost, change: () => o().configure({ weapons: cfg()?.weapons === false }) },
      {
        label: () => (cfg()?.upgrades === false ? 'SHOP: CLOSED' : `SHOP  $${o().profile?.money ?? '...'}`),
        disabled: () => busy() || cfg()?.upgrades === false,
        select: () => this.openOnlineShop(),
      },
      { label: () => `UPGRADES: ${cfg()?.upgrades === false ? 'OFF' : 'ON'}`, disabled: notHost, change: () => o().configure({ upgrades: cfg()?.upgrades === false }) },
      { label: () => 'NEW SEASON', disabled: () => notHost() || busy() || !o().room?.races, select: () => o().newSeason() },
      { label: () => 'COPY INVITE LINK', select: () => this.copyInvite() },
      { label: () => 'LEAVE ROOM', select: () => this.leaveRoom() },
    ];
  }

  private openOnlineShop(): void {
    const o = this.online;
    this.mode = 'shop';
    this.shop = this.makeShop({
      title: () => `SHOP - ROOM ${o.room?.code ?? ''}`,
      profile: () => o.profile,
      buy: (item) => o.buy(item),
      doneLabel: () => 'BACK TO LOBBY',
      done: () => this.toLobby(),
      weapons: () => o.room?.config.weapons !== false,
    });
  }

  private copyInvite(): void {
    const code = this.online.room?.code;
    if (!code) return;
    const link = inviteLink(code);
    navigator.clipboard?.writeText(link).then(
      () => this.flashMessage('INVITE LINK COPIED'),
      () => this.flashMessage(link, 4),
    ) ?? this.flashMessage(link, 4);
  }

  /** The current race if it is an online one. */
  get netRace(): OnlineSession | null {
    return this.session instanceof OnlineSession ? this.session : null;
  }

  toOnline(): void {
    if (this.mode === 'race') this.toTitle();
    this.mode = this.online.room ? 'lobby' : 'online';
    this.online.connect();
  }

  private toLobby(): void {
    this.showAttract('lobby');
    this.lobbyMenu.index = 0;
  }

  leaveRoom(): void {
    this.online.leave();
    this.showAttract('online');
  }

  private startOnlineRace(s: OnlineSession): void {
    this.mode = 'race';
    this.paused = false;
    this.lastLights = 0;
    this.setSession(s);
  }

  /** Back to the title screen with an all-AI race running behind the menu. */
  toTitle(): void {
    this.showAttract('title');
  }

  /** A menu screen over the attract-mode race. */
  private showAttract(mode: Mode): void {
    this.mode = mode;
    this.paused = false;
    this.setSession(attractSession(this.settings, this.tuning));
  }

  startRace(settings: RaceSettings, spec?: RaceSpec): void {
    this.mode = 'race';
    this.paused = false;
    this.lastLights = 0;
    this.cupRace = !!spec;
    this.setSession(new RaceSession({ ...settings }, this.tuning, spec?.seed, spec));
  }

  private restartRace(): void {
    const s = this.session;
    if (!(s instanceof RaceSession)) return;
    this.startRace(s.settings, this.cupRace ? s.spec : undefined);
  }

  // --------------------------------------------------------- championship

  /** The shop for local player p before the next championship race. */
  private openCupShop(p: number): void {
    const cup = this.cup!;
    const humans = humanDrivers(cup);
    const d = humans[p];
    this.showAttract('shop');
    this.shop = this.makeShop({
      title: () => `${this.career ? `DIV ${this.career.division} - ` : ''}${humans.length > 1 ? `${d.name} - ` : ''}RACE ${cup.race + 1} OF ${cup.tracks.length}: ${TRACKS[cup.tracks[cup.race]].name.toUpperCase()}`,
      profile: () => d.profile,
      buy: (item) => {
        const err = buy(d.profile, item);
        if (!err) this.saveProgress();
        return err;
      },
      doneLabel: () => (p + 1 < humans.length ? `DONE - ${humans[p + 1].name} SHOPS` : 'START RACE'),
      done: () => (p + 1 < humans.length ? this.openCupShop(p + 1) : this.startCupRace()),
      weapons: () => cup.weapons,
    });
  }

  private startCupRace(): void {
    const cup = this.cup!;
    const spec = nextRaceSpec(cup);
    this.saveProgress();
    const players = humanDrivers(cup).length as 1 | 2;
    this.startRace({ ...this.settings, track: spec.track, laps: spec.laps, weapons: spec.weapons, players, practice: false }, spec);
  }

  /** Results confirmed: score the race and show the table. */
  private finishCupRace(): void {
    const cup = this.cup!;
    settleRace(cup, this.world);
    this.saveProgress();
    this.cupRace = false;
    this.showAttract('standings');
  }

  /** Save the championship, or the whole career when in one. */
  private saveProgress(): void {
    if (this.career) saveCareer(this.career);
    else saveCup(this.cup);
  }

  private toCareer(): void {
    this.cup = null;
    this.career = loadCareer();
    this.showAttract('career');
    this.careerMenu.index = this.career ? 0 : 1;
  }

  private makeShop(ctx: ShopContext): ShopScreen {
    return new ShopScreen(ctx, {
      onMove: () => playTone(this.audio, 660, 0.04, 'square', 0.05),
      onBuy: () => playTone(this.audio, 1046, 0.12, 'square', 0.08, 1568),
      onDeny: () => playTone(this.audio, 160, 0.18, 'square', 0.08),
    });
  }

  private setSession(session: GameSession): void {
    if (this.view) this.view.dispose();
    if (this.track !== session.track) this.setTrack(session.track);
    this.session = session;
    this.view = new RaceView(this.scene, session, this.mood.lights, this.mood.headlight);
    this.view.effects.steam = this.steam;
    this.fireworks = 0;
    this.shake = 0;
    const split = this.mode === 'race' && session.playerCars.length === 2;
    this.renderer.setSplit(split);
    for (const vp of this.renderer.viewports) vp.cam.viewHeight = split ? VIEW_HEIGHT * 1.25 : VIEW_HEIGHT;
    this.viewCar[0] = session.playerCars[0] ?? 0;
    this.viewCar[1] = session.playerCars[1] ?? 1;
    this.camInit[0] = this.camInit[1] = false;
    this.acc = 0;
  }

  private setTrack(track: Track): void {
    if (this.trackGroup) this.scene.remove(this.trackGroup);
    this.track = track;
    const g = new THREE.Group();
    g.add(buildTrackView(track));
    const props = buildProps(track);
    g.add(props.group);
    const keepOut = [...props.keepOut];
    this.steam = [];
    if (themeOf(track.def.theme).industry) {
      const plant = buildIndustry(track, keepOut);
      g.add(plant.group);
      keepOut.push(...plant.keepOut);
      this.steam = plant.steam;
    }
    const town = buildTown(track, track.def.theme, keepOut);
    g.add(town.group);
    keepOut.push(...town.keepOut);
    this.windowMats = town.windows;
    g.add(buildScenery(track, keepOut));
    this.debugView = buildTrackDebugView(track, this.tuning);
    g.add(this.debugView);
    this.nightLights = props.nightLights;
    this.lampBulbs = props.bulbs;
    this.lampPools = props.pools;
    this.trackGroup = g;
    this.scene.add(g);
    this.setMood(this.mood);
  }

  setMood(mood: Mood): void {
    this.mood = mood;
    this.scene.background = new THREE.Color(mood.background);
    this.hemi.color.set(mood.skyColor);
    this.hemi.groundColor.set(mood.groundColor);
    this.hemi.intensity = mood.hemiIntensity;
    this.sun.color.set(mood.sunColor);
    this.sun.intensity = mood.sunIntensity;
    this.sunDir.copy(mood.sunDir);
    // Light-space basis matching the shadow camera's lookAt (world up = +y).
    this.sunRight.crossVectors(new THREE.Vector3(0, 1, 0), this.sunDir).normalize();
    this.sunUp.crossVectors(this.sunDir, this.sunRight).normalize();
    const g = this.renderer.grade;
    g.tint.copy(mood.tint);
    g.lift.copy(mood.lift);
    g.exposure = mood.exposure;
    g.saturation = mood.saturation;
    g.bloom = mood.bloom;
    g.bloomThreshold = mood.bloomThreshold;
    if (this.view) this.view.particles.light.value = mood.particleLight;
    this.lampBulbs?.color.setRGB(mood.lights ? 5 : 0.55, mood.lights ? 4.4 : 0.55, mood.lights ? 3.2 : 0.5);
    this.lampPools?.color.setRGB(0.95 * mood.lampLight, 0.8 * mood.lampLight, 0.56 * mood.lampLight);
    for (const o of this.nightLights) o.visible = mood.lights;
    for (const m of this.windowMats) m.emissiveIntensity = mood.lights ? (mood.id === 'night' ? 2.2 : 1.1) : 0;
    this.view?.setLights(mood.lights, mood.headlight);
  }

  async openTuning(): Promise<void> {
    if (this.tuningPanel) {
      this.tuningPanel.toggle();
      return;
    }
    this.tuningPanel = await openTuningPanel(this.tuning, { cam: this.renderer.viewports[0].cam, lookAhead: this.lookAhead });
  }

  get world() {
    return this.session.world;
  }

  /** The results table shows a moment after the race has ended. */
  get showingResults(): boolean {
    const race = this.session.world.race;
    return this.mode === 'race' && race.phase === RacePhase.Finished && this.session.world.tick >= race.endTick + 72;
  }

  /** The first local player's car (or the followed car on the title screen). */
  get player() {
    return this.session.world.cars[this.viewCar[0]];
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------- main loop

  private readonly frame = (nowMs: number): void => {
    requestAnimationFrame(this.frame);
    const now = nowMs / 1000;
    if (this.last < 0) this.last = now;
    const dt = Math.min(0.1, now - this.last);
    this.last = now;
    this.time += dt;
    this.handleKeys(dt);
    const net = this.netRace;
    let alpha: number;
    if (net) {
      // Online the race never pauses; the server's clock rules.
      this.online.update();
      net.net.update(dt, this.netHooks);
      alpha = net.net.alpha;
    } else {
      this.acc = this.paused ? 0 : this.acc + dt;
      let steps = 0;
      while (this.acc >= DT && steps < 6) {
        this.fixedStep();
        this.acc -= DT;
        steps++;
      }
      if (steps === 6) this.acc = 0;
      alpha = this.acc / DT;
    }
    this.renderFrame(alpha, dt);
    this.input.keyboard.endFrame();
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  };

  private readonly netHooks = {
    sample: (p: number, out: CarInput) => {
      if (this.paused) return copyInput(out, NEUTRAL_INPUT);
      return this.input.sample(this.playerInputs()[p], out, p === 0);
    },
    before: () => this.view.beforeStep(),
    after: () => {
      this.view.afterStep();
      this.handleEvents();
    },
    corrected: (drift: { dx: number; dz: number; dh: number }[]) => this.view.correct(drift),
  };

  /** The menu that has the keyboard on the current screen. */
  private get activeMenu(): Menu | null {
    if (this.mode === 'title') return this.titleMenu;
    if (this.mode === 'online') return this.onlineMenu;
    if (this.mode === 'lobby') return this.lobbyMenu;
    if (this.mode === 'cup') return this.cupMenu;
    if (this.mode === 'career') return this.careerMenu;
    if (this.mode === 'shop') return this.shop?.menu ?? null;
    return this.paused ? this.pauseMenu : null;
  }

  private handleKeys(dt: number): void {
    const kb = this.input.keyboard;
    this.nav.textMode = this.activeMenu?.typing ?? false;
    const nav = this.nav.poll(dt);
    if (this.nav.textMode) {
      // Letters and digits go into the text field.
      this.handleMenus(nav);
      return;
    }
    if (kb.wasPressed('Digit1') && this.debugView) this.debugView.visible = !this.debugView.visible;
    if (kb.wasPressed('Digit2')) this.showTelemetry = !this.showTelemetry;
    if (kb.wasPressed('Digit3')) {
      this.renderer.crt = (this.renderer.crt + 1) % 3;
      this.flashMessage(['CRT OFF', 'CRT SCANLINES', 'CRT FULL'][this.renderer.crt]);
    }
    if (kb.wasPressed('Digit4')) {
      this.renderer.paletteMode = ((this.renderer.paletteMode + 1) % 3) as PaletteModeId;
      this.flashMessage(PALETTE_MODE_NAMES[this.renderer.paletteMode]);
    }
    if (kb.wasPressed('KeyM')) {
      this.setMood(MOODS[(MOODS.indexOf(this.mood) + 1) % MOODS.length]);
      this.flashMessage(this.mood.name);
    }
    if (kb.wasPressed('Digit0')) void this.openTuning();
    const pad = this.input.firstActivePad();
    if (pad >= 0) this.padIndex = pad;

    this.handleMenus(nav);
  }

  private handleMenus(nav: NavState): void {
    const kb = this.input.keyboard;
    if (this.mode === 'title') {
      this.titleMenu.handle(nav);
      return;
    }
    if (this.mode === 'online') {
      if (nav.back) this.toTitle();
      else this.onlineMenu.handle(nav);
      return;
    }
    if (this.mode === 'lobby') {
      this.lobbyMenu.handle(nav);
      return;
    }
    if (this.mode === 'cup') {
      if (nav.back) this.toTitle();
      else this.cupMenu.handle(nav);
      return;
    }
    if (this.mode === 'shop') {
      if (nav.back && this.netRace === null && this.online.room && !this.cup) this.toLobby();
      else this.shop?.handle(nav);
      return;
    }
    if (this.mode === 'career') {
      if (nav.back) this.toTitle();
      else this.careerMenu.handle(nav);
      return;
    }
    if (this.mode === 'seasonEnd') {
      if (nav.confirm || nav.click) this.toCareer();
      return;
    }
    if (this.mode === 'standings') {
      if (nav.confirm || nav.click) {
        const cup = this.cup!;
        if (isOver(cup) && this.career) {
          // Season over: bonus, promotion, and the next season set up.
          endSeason(this.career);
          this.cup = this.career.cup;
          saveCareer(this.career);
          this.mode = 'seasonEnd';
          this.fireworks = 0;
        } else if (isOver(cup)) {
          saveCup(null);
          this.cup = null;
          this.toTitle();
        } else {
          this.openCupShop(0);
        }
      }
      return;
    }
    if (this.showingResults) {
      if (nav.confirm || nav.click || nav.back) {
        if (this.cupRace && this.cup) this.finishCupRace();
        else if (this.netRace && this.online.room) this.toLobby();
        else if (this.netRace) this.showAttract('online');
        else this.toTitle();
      }
      return;
    }
    if (this.paused) {
      if (nav.back) this.paused = false;
      else this.pauseMenu.handle(nav);
      return;
    }
    if (nav.pause) {
      this.paused = true;
      this.pauseMenu.index = 0;
    }
  }

  /** Put a local player's car back on the track. */
  resetCar(id: number | undefined): void {
    if (id === undefined || this.world.race.phase === RacePhase.Countdown) return;
    const car = this.world.cars[id];
    respawnCar(car, this.track, car.trackS);
    resetProgress(car, this.track);
    this.view.snap(id);
    this.flashMessage('RESET');
  }

  private flashMessage(text: string, seconds = 1.6): void {
    this.flash = text;
    this.flashTime = seconds;
  }

  private playerInputs(): LocalPlayerInput[] {
    const n = this.session.playerCars.length;
    if (n === 2) return [{ keys: P1_KEYS, pad: 0 }, { keys: P2_KEYS, pad: 1 }];
    return [{ keys: SOLO_KEYS, pad: this.padIndex }];
  }

  private fixedStep(): void {
    const s = this.session;
    // Online races are stepped by their own clock (see frame()).
    if (!(s instanceof RaceSession)) return;
    const players = this.playerInputs();
    s.playerCars.forEach((id, p) => this.input.sample(players[p], s.inputs[id], p === 0));
    this.view.beforeStep();
    s.step();
    this.view.afterStep();
    this.handleEvents();
  }

  private handleEvents(): void {
    const w = this.world;
    const ev = w.events;
    const players = this.session.playerCars;
    const me = this.player;
    for (let k = 0; k < ev.count; k++) {
      const e = ev.list[k];
      if ((e.kind === Ev.WallHit || e.kind === Ev.CarHit) && this.audio.ready) {
        const dx = e.x - me.x;
        const dist = Math.hypot(dx, e.z - me.z);
        if (dist < 60) playImpact(this.audio, e.value * (1 - dist / 60), dx / 30);
      } else if (e.kind === Ev.Fire || e.kind === Ev.Explosion || e.kind === Ev.Wreck || e.kind === Ev.Turbo) {
        this.weaponEvent(e.kind, e.car, e.other, e.value, e.x, e.z);
      } else if (e.kind === Ev.Respawn) {
        this.view.snap(e.car);
        if (e.value === 1 && players.includes(e.car)) this.flashMessage('RESET');
      } else if (e.kind === Ev.Lap && players.includes(e.car) && this.mode === 'race') {
        const car = w.cars[e.car];
        const best = car.bestLapTicks === e.value;
        if (w.race.laps === 0 || car.lap <= w.race.laps) {
          this.flashMessage(`${best ? 'BEST LAP ' : 'LAP '}${(e.value * DT).toFixed(2)}`, 2.2);
          playTone(this.audio, best ? 1046 : 784, 0.12, 'square', 0.1);
        }
      } else if (e.kind === Ev.Finish && players.includes(e.car)) {
        playFanfare(this.audio, e.other <= 3);
        if (e.other === 1 && this.mode === 'race') this.fireworks = 6;
      } else if (e.kind === Ev.Land) {
        this.view.effects.landing(e.x, e.z, e.value, w.cars[e.car]);
        const d = Math.hypot(e.x - me.x, e.z - me.z);
        if (d < 50) {
          this.shake = Math.max(this.shake, Math.min(1, e.value / 14) * (1 - d / 50));
          if (this.audio.ready) playImpact(this.audio, e.value * 0.8 * (1 - d / 50), (e.x - me.x) / 30);
        }
      } else if (e.kind === Ev.RaceStart && this.mode === 'race') {
        playTone(this.audio, 880, 0.45, 'square', 0.14);
      }
    }
    // Countdown beeps as the start lights come on.
    if (this.mode === 'race' && w.race.phase === RacePhase.Countdown) {
      const lit = lightsOn(w.tick, w.race.startTick);
      if (lit > this.lastLights) playTone(this.audio, 440, 0.12, 'square', 0.12);
      this.lastLights = lit;
    }
  }

  /** Sounds and messages for weapons, louder close to the (first) player. */
  private weaponEvent(kind: number, car: number, other: number, value: number, x: number, z: number): void {
    const me = this.player;
    const players = this.session.playerCars;
    const dx = x - me.x;
    const dist = Math.hypot(dx, z - me.z);
    const vol = Math.max(0, 1 - dist / 90);
    const pan = dx / 40;
    const mine = players.includes(car);
    if (kind === Ev.Explosion || kind === Ev.Wreck) {
      const k = kind === Ev.Wreck ? 1.2 : value === 3 ? 0.4 : 0.8;
      this.shake = Math.max(this.shake, k * Math.max(0, 1 - dist / 45));
    }
    if (this.audio.ready && vol > 0) {
      if (kind === Ev.Fire) {
        if (other === ShotKind.Missile) playLaunch(this.audio, vol, pan);
        else playMineDrop(this.audio, vol);
      } else if (kind === Ev.Explosion) {
        playExplosion(this.audio, vol, pan, value === 3 ? 0.6 : 1);
      } else if (kind === Ev.Wreck) {
        playExplosion(this.audio, vol, pan, 1.6);
      } else if (kind === Ev.Turbo && mine) {
        playTurbo(this.audio, 1);
      }
    }
    if (this.mode !== 'race') return;
    if (kind === Ev.Wreck && mine) this.flashMessage('WRECKED!', 2);
    else if (kind === Ev.Explosion && value !== 3 && players.includes(other) && !mine) this.flashMessage(value === 2 ? 'MINED!' : 'DIRECT HIT!', 1.2);
  }

  // ------------------------------------------------------------- rendering

  private renderFrame(alpha: number, dt: number): void {
    if (this.mode !== 'race' || this.session.playerCars.length === 0) {
      // Attract mode and spectators: follow the leaders, switching cars now and then.
      const order = standings(this.world);
      this.viewCar[0] = order[Math.floor(this.time / 9) % Math.min(3, order.length)];
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    if (this.fireworks > 0 && this.mode === 'race') {
      this.fireworks -= dt;
      const t = this.camTargets[0];
      if (Math.random() < dt * 5) this.view.effects.firework(t.x + (Math.random() - 0.5) * 70, t.z - 8 - Math.random() * 25);
    }
    const views = this.renderer.viewCount;
    for (let v = 0; v < views; v++) this.updateCamera(v, dt);
    const cam0 = this.renderer.viewports[0].cam;
    this.view.update(alpha, dt, 0.19 / cam0.metersPerPixel, this.renderer.paletteMode !== PaletteMode.Off);
    this.view.particles.light.value = this.mood.particleLight;
    animTime.value = performance.now() / 1000;
    this.updateAudio();
    this.drawUi(dt);
    for (let v = 0; v < views; v++) {
      this.updateSun(this.camTargets[v]);
      this.view.particles.pxScale.value = 0.19 / this.renderer.viewports[v].cam.metersPerPixel;
      this.renderer.renderView(this.scene, v);
    }
    this.renderer.present();
  }

  /** Follow a car with look-ahead in its direction of travel. */
  private updateCamera(v: number, dt: number): void {
    const vp = this.renderer.viewports[v];
    const cam = vp.cam;
    const idx = Math.min(this.viewCar[v], this.world.cars.length - 1);
    const car = this.world.cars[idx];
    const view = this.view.cars[idx].root.position;
    const half = cam.footprint(vp.w, vp.h);
    const maxLead = Math.min(half.width, half.depth) * 0.3;
    let lx = car.vx * this.lookAhead.value;
    let lz = car.vz * this.lookAhead.value;
    const ll = Math.hypot(lx, lz);
    if (ll > maxLead) {
      lx *= maxLead / ll;
      lz *= maxLead / ll;
    }
    const tx = view.x + lx;
    const tz = view.z + lz;
    const target = this.camTargets[v];
    if (!this.camInit[v]) {
      target.set(tx, 0, tz);
      this.camInit[v] = true;
    } else {
      const k = 1 - Math.exp(-(this.mode === 'title' ? 3 : 7) * dt);
      target.x += (tx - target.x) * k;
      target.z += (tz - target.z) * k;
    }
    // Explosions and hard landings shake the view (a few pixels, decaying).
    let sx = 0;
    let sz = 0;
    if (this.shake > 0.01) {
      const a = this.shake * this.shake * 0.9;
      sx = Math.sin(this.time * 61) * a;
      sz = Math.cos(this.time * 47) * a;
    }
    cam.update(target.x + sx, 0, target.z + sz, vp.w, vp.h);
  }

  /** Keep the shadow map centred on the view, snapped to whole shadow texels. */
  private updateSun(target: THREE.Vector3): void {
    const texel = (SHADOW_HALF * 2) / SHADOW_MAP;
    const r = Math.round(target.dot(this.sunRight) / texel) * texel;
    const u = Math.round(target.dot(this.sunUp) / texel) * texel;
    const f = target.dot(this.sunDir);
    const t = this.sun.target.position;
    t.copy(this.sunRight).multiplyScalar(r).addScaledVector(this.sunUp, u).addScaledVector(this.sunDir, f);
    this.sun.position.copy(t).addScaledVector(this.sunDir, 200);
    this.sun.target.updateMatrixWorld();
  }

  private updateAudio(): void {
    const ctx = this.audio.ctx;
    if (!ctx || !this.skidSound) return;
    const now = ctx.currentTime;
    const players = this.mode === 'race' ? this.session.playerCars : [];
    this.engines.forEach((engine, p) => {
      const id = players[p];
      if (id === undefined || this.paused) {
        engine.silence(now);
        return;
      }
      const car = this.world.cars[id];
      const pan = players.length === 2 ? (p === 0 ? -0.6 : 0.6) : 0;
      const throttle = this.session.inputs[id].throttle;
      const speed = Math.hypot(car.vx, car.vz);
      // On the grid the engine revs with the throttle.
      const rev = this.world.race.phase === RacePhase.Countdown ? throttle * 0.6 : speed / this.tuning.vTop;
      engine.update(rev, throttle, 1, pan, now);
    });
    const car = players.length ? this.world.cars[players[0]] : null;
    let amount = 0;
    if (car && !this.paused) {
      const speed = Math.hypot(car.vx, car.vz);
      const slipDeg = (Math.abs(car.slip) * 180) / Math.PI;
      if ((car.sliding || car.spinTicks > 0) && speed > 5) amount = Math.min(1, (slipDeg - 3) / 22) * Math.min(1, speed / 18);
      if (car.longAccel < -12 && speed > 8) amount = Math.max(amount, 0.55);
      if (!PAVED.has(car.surfRear)) amount = 0;
    }
    this.skidSound.update(Math.max(0, amount), 0.5, now);
  }

  private drawUi(dt: number): void {
    const ui = this.renderer.ui;
    const ctx = ui.begin();
    const W = ui.w;
    const H = ui.h;
    if (this.mode === 'title') {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 0, W, H);
      const top = drawLogo(ctx, W / 2, Math.round(H * 0.08), Math.min(W - 40, 420), this.time);
      this.titleMenu.draw(ctx, W / 2, top + 14, fitScale(this.titleMenu, top + 14, H - 30), dt);
      const help = this.settings.players === 2
        ? 'P1: WASD + Q DRIFT + G/F/H   P2: ARROWS + L DRIFT + . , -   OR GAMEPADS'
        : 'ARROWS/WASD DRIVE   Z DRIFT   SPACE MISSILE   X MINE   C TURBO   R RESET';
      drawText(ctx, help, W / 2, H - 22, { align: 'center', color: '#c8d0dc' });
      drawText(ctx, 'ENTER SELECT   ←→ CHANGE   M TIME OF DAY   3 CRT   4 COLOURS', W / 2, H - 11, { align: 'center', color: '#8090a8' });
    } else if (this.mode === 'online') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, W, H);
      const top = drawLogo(ctx, W / 2, Math.round(H * 0.08), Math.min(W - 40, 420), this.time);
      drawText(ctx, 'PLAY ONLINE', W / 2, top, { scale: 2, color: '#ffffff', align: 'center' });
      this.onlineMenu.draw(ctx, W / 2, top + 30, fitScale(this.onlineMenu, top + 30, H - 40), dt);
      const st = connText(this.online.state, this.online.conn.rtt);
      drawText(ctx, st.text, W / 2, H - 34, { align: 'center', color: st.color });
      drawText(ctx, 'CREATE A ROOM AND SEND THE CODE TO YOUR FRIENDS, OR TYPE THEIR CODE', W / 2, H - 22, { align: 'center', color: '#c8d0dc' });
      drawText(ctx, 'ENTER SELECT   TYPE TO EDIT   ESC BACK', W / 2, H - 11, { align: 'center', color: '#8090a8' });
    } else if (this.mode === 'cup') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, W, H);
      const top = drawLogo(ctx, W / 2, Math.round(H * 0.08), Math.min(W - 40, 420), this.time);
      drawText(ctx, 'CHAMPIONSHIP', W / 2, top, { scale: 2, color: '#ffffff', align: 'center' });
      const names = TRACK_LIST.map((t) => t.name.toUpperCase()).join(', ');
      drawText(ctx, `${TRACK_LIST.length} RACES: ${names}`, W / 2, top + 22, { color: '#9fd8ff', align: 'center' });
      drawText(ctx, 'WIN PRIZE MONEY AND POINTS - UPGRADE YOUR CAR BETWEEN RACES', W / 2, top + 34, { color: '#c8d0dc', align: 'center' });
      this.cupMenu.draw(ctx, W / 2, top + 56, fitScale(this.cupMenu, top + 56, H - 30), dt);
      const s = this.settings;
      drawText(ctx, `PLAYERS ${s.players}   OPPONENTS ${s.opponents}   ${DIFFICULTIES[s.difficulty]}   LAPS ${s.laps}   WEAPONS ${s.weapons ? 'ON' : 'OFF'}`, W / 2, H - 22, { color: '#8090a8', align: 'center' });
      drawText(ctx, 'NEW CHAMPIONSHIPS USE THE SETTINGS FROM THE MAIN MENU', W / 2, H - 11, { color: '#8090a8', align: 'center' });
    } else if (this.mode === 'career') {
      this.drawCareer(ctx, W, H, dt);
    } else if (this.mode === 'seasonEnd' && this.career?.last) {
      drawSeasonEnd(ctx, W, H, this.career, this.time);
      if (Math.random() < dt * 4 && (this.career.last.outcome === 'champion' || this.career.last.outcome === 'defended' || this.career.last.outcome === 'promoted')) {
        const t = this.camTargets[0];
        this.view.effects.firework(t.x + (Math.random() - 0.5) * 70, t.z - 8 - Math.random() * 25);
      }
    } else if (this.mode === 'shop' && this.shop) {
      this.shop.draw(ctx, W, H, dt);
    } else if (this.mode === 'standings' && this.cup) {
      const cup = this.cup;
      const over = isOver(cup);
      const head = this.career ? `DIVISION ${this.career.division}` : 'CHAMPIONSHIP';
      const title = over ? `${leader(cup).name === 'YOU' ? 'YOU WIN' : `${leader(cup).name} WINS`} ${head}!` : head;
      const sub = over ? 'FINAL STANDINGS' : `AFTER RACE ${cup.race} OF ${cup.tracks.length}${this.career ? ` - SEASON ${this.career.season}` : ''}`;
      drawStandings(ctx, W, H, title, sub, standingsRows(cup), this.time, over ? 'PRESS ENTER' : 'PRESS ENTER FOR THE SHOP');
    } else if (this.mode === 'lobby' && this.online.room) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, W, H);
      const top = drawLobby(ctx, W, H, this.online.room, this.online.me, this.time);
      this.lobbyMenu.draw(ctx, W / 2, top, fitScale(this.lobbyMenu, top, H - 26), dt);
      const st = connText(this.online.state, this.online.conn.rtt);
      drawText(ctx, st.text, 6, H - 11, { color: st.color });
      const hint = this.online.isHost ? 'YOU ARE THE HOST: PICK THE RACE AND START WHEN EVERYONE IS READY' : 'MARK YOURSELF READY - THE HOST STARTS THE RACE';
      drawText(ctx, hint, W / 2, H - 22, { align: 'center', color: '#c8d0dc' });
    } else if (this.mode === 'race') {
      this.drawRaceUi(ctx, W, H);
    }
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      drawText(ctx, this.flash, W / 2, Math.round(H * 0.18), { scale: 2, color: '#ffd84a', align: 'center' });
    }
    if (this.params.debug) {
      const c = this.online.conn;
      const n = this.netRace?.net;
      const sync = n ? ` LEAD ${n.predictor.lead} RESIM ${n.predictor.lastResim} RATE ${n.rate.toFixed(2)}` : '';
      const rtt = (c.rtt >= 0 ? ` RTT ${c.rtt.toFixed(0)}MS` : '') + sync;
      drawText(ctx, `${this.fps.toFixed(0)} FPS ${this.renderer.lowW}X${this.renderer.lowH} X${this.renderer.scale}${rtt}`, W - 4, H - 10, {
        color: '#9cff9c', align: 'right',
      });
    }
    ui.end();
  }

  private drawRaceUi(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const s = this.session;
    const w = s.world;
    const split = this.renderer.isSplit;
    for (let p = 0; p < s.playerCars.length; p++) {
      const vp = this.renderer.viewports[split ? p : 0];
      drawPlayerHud(ctx, { x: vp.x, w: vp.w, h: H }, w, s.playerCars[p], split ? `P${p + 1}` : null);
    }
    if (split) {
      ctx.fillStyle = '#000';
      ctx.fillRect(this.renderer.viewports[1].x - 2, 0, 2, H);
    }
    const mw = Math.round(Math.min(110, W * 0.2));
    const mh = Math.round(mw * 0.75);
    const mx = split ? Math.round(W / 2 - mw / 2) : W - mw - 8;
    const my = split ? H - mh - 8 : 8;
    this.minimap.draw(ctx, s.track, w, s.colors, s.playerCars, mx, my, mw, mh);
    drawCountdown(ctx, W, w);
    if (this.firstRace && w.tick < w.race.startTick + 60 * 15) {
      const hintY = split ? my - 14 : H - 36;
      const drift = split ? 'P1 Q / P2 L' : 'Z';
      drawText(ctx, `DRIFT: HOLD ${drift} WHILE TURNING (OR LIFT OFF + GAS AGAIN)`, W / 2, hintY, { color: '#ffd84a', align: 'center' });
      if (w.race.weapons) {
        const keys = split ? 'P1 G/F/H   P2 . , -' : 'SPACE MISSILE   X MINE   C TURBO';
        drawText(ctx, `WEAPONS: ${keys}`, W / 2, hintY - 11, { color: '#ffd84a', align: 'center' });
      }
    }
    if (this.showTelemetry && s.playerCars.length) this.drawTelemetry(ctx, 8, 92);
    if (this.netRace) this.drawOnlineRaceUi(ctx, W, H);
    if (this.showingResults) {
      this.firstRace = false;
      drawResults(ctx, W, H, w, s.names, s.colors, s.playerCars, this.time);
    } else if (this.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);
      drawText(ctx, 'PAUSED', W / 2, Math.round(H * 0.3), { scale: 4, color: '#ffd84a', align: 'center' });
      this.pauseMenu.draw(ctx, W / 2, Math.round(H * 0.3) + 44, 2);
    }
  }

  /** Career hub: where you stand, what you drive, continue or start over. */
  private drawCareer(ctx: CanvasRenderingContext2D, W: number, H: number, dt: number): void {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);
    const top = drawLogo(ctx, W / 2, Math.round(H * 0.06), Math.min(W - 40, 380), this.time);
    drawText(ctx, 'CAREER', W / 2, top, { scale: 2, color: '#ffffff', align: 'center' });
    let y = top + 24;
    const c = this.career ?? loadCareer();
    if (c) {
      const p = humanDrivers(c.cup)[0].profile;
      const stars = '■'.repeat(DIVISIONS - c.division + 1) + '□'.repeat(c.division - 1);
      drawText(ctx, `DIVISION ${c.division} ${stars}   SEASON ${c.season}   TITLES ${c.titles}`, W / 2, y, { color: '#ffd84a', align: 'center' });
      y += 12;
      drawText(ctx, `$${p.money}   ${CAR_MODELS[p.car ?? 0].name}   ENGINE ${p.engine} TYRES ${p.tyres} ARMOUR ${p.armour}   ${p.points} PTS`, W / 2, y, { color: '#9cff9c', align: 'center' });
    } else {
      drawText(ctx, 'START IN DIVISION 3 - TOP 3 OF A SEASON MOVES YOU UP', W / 2, y, { color: '#9fd8ff', align: 'center' });
      y += 12;
      drawText(ctx, 'WIN DIVISION 1 TO BECOME MEGACARS CHAMPION', W / 2, y, { color: '#9fd8ff', align: 'center' });
    }
    y += 22;
    this.careerMenu.draw(ctx, W / 2, y, fitScale(this.careerMenu, y, H - 24), dt);
    drawText(ctx, 'MONEY, UPGRADES AND YOUR CAR STAY WITH YOU FROM SEASON TO SEASON', W / 2, H - 14, { color: '#8090a8', align: 'center' });
  }

  /** Name tags over other people's cars, ping, connection trouble. */
  private drawOnlineRaceUi(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const net = this.netRace!.net;
    const vp = this.renderer.viewports[0];
    const p = this.tagPos;
    net.spec.entrants.forEach((e, i) => {
      if (e.playerId < 0 || e.playerId === this.online.me) return;
      p.copy(this.view.cars[i].root.position);
      p.y += 2.4;
      p.project(vp.cam.camera);
      if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1) return;
      const x = vp.x + ((p.x + 1) / 2) * vp.w;
      const y = ((1 - p.y) / 2) * vp.h - 10;
      drawText(ctx, e.name, x, y, { align: 'center', color: e.color });
    });
    const conn = this.online.conn;
    if (conn.state !== 'open') {
      const st = connText(conn.state, conn.rtt);
      drawText(ctx, st.text, W / 2, Math.round(H * 0.4), { scale: 2, color: st.color, align: 'center' });
    } else if (conn.rtt >= 0) {
      // Under the minimap (same layout as drawRaceUi).
      const mh = Math.round(Math.round(Math.min(110, W * 0.2)) * 0.75);
      drawText(ctx, `PING ${Math.round(conn.rtt)}`, W - 8, 8 + mh + 4, { color: pingColor(conn.rtt), align: 'right' });
    }
    if (net.spectating && !this.showingResults) {
      drawText(ctx, 'WATCHING - YOU JOIN THE NEXT RACE', W / 2, H - 24, { color: '#ffd84a', align: 'center' });
    }
  }

  private drawTelemetry(ctx: CanvasRenderingContext2D, x: number, top: number): void {
    const car = this.player;
    let y = top;
    const slipDeg = (car.slip * 180) / Math.PI;
    const inp = this.session.inputs[car.id];
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - 4, y - 3, 118, 84);
    const row = (label: string, value: string, color = '#ffffff') => {
      drawText(ctx, label, x, y, { color: '#9aa4b8' });
      drawText(ctx, value, x + 110, y, { color, align: 'right' });
      y += 9;
    };
    const state = car.spinTicks > 0 ? 'SPIN' : car.sliding ? 'SLIDE' : 'GRIP';
    row('STATE', state, car.spinTicks > 0 ? '#ff4a3a' : car.sliding ? '#ffd84a' : '#9cff9c');
    row('SLIP', `${slipDeg.toFixed(1)}°`);
    row('LAT G', (car.latAccel / 9.81).toFixed(2));
    row('YAW', `${car.angVel.toFixed(2)}`);
    row('SURFACE', SURFACES[car.surfRear]?.name.toUpperCase() ?? '?');
    row('DIST', `${car.raceDist.toFixed(0)} M`);
    const bar = (label: string, v: number, color: string, centered = false) => {
      drawText(ctx, label, x, y, { color: '#9aa4b8' });
      const bx = x + 36;
      const bw = 74;
      ctx.fillStyle = '#222';
      ctx.fillRect(bx, y, bw, 6);
      ctx.fillStyle = color;
      if (centered) {
        const mid = bx + bw / 2;
        const len = Math.round((v * bw) / 2);
        ctx.fillRect(Math.min(mid, mid + len), y, Math.abs(len) || 1, 6);
      } else {
        ctx.fillRect(bx, y, Math.round(v * bw), 6);
      }
      y += 9;
    };
    bar('STEER', car.steer, '#5ac8fa', true);
    bar('GAS', inp.throttle, '#9cff9c');
    bar('BRAKE', inp.brake, '#ff6b5e');
  }

  // ------------------------------------------------------------ debug/test

  /** Run `ticks` simulation steps immediately and render one frame (testing). */
  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.fixedStep();
    this.renderFrame(0, ticks * DT);
  }

  /**
   * Pixel-crawl test: render, move the camera exactly k low-res pixels right
   * (then up), render again and compare the overlapping static image. Cars,
   * particles and animation are frozen/hidden. Returns the share of identical pixels.
   */
  crawlTest(k = 8): { horizontal: number; vertical: number } {
    const wasPaused = this.paused;
    this.paused = true;
    const hidden: THREE.Object3D[] = [...this.view.cars.map((c) => c.root), this.view.particles.points];
    for (const o of hidden) o.visible = false;
    const frozen = animTime.value;
    const vp = this.renderer.viewports[0];
    const cam = vp.cam;
    const base = this.camTargets[0].clone();
    const p = cam.metersPerPixel;
    const shot = (tx: number, tz: number) => {
      cam.update(tx, 0, tz, vp.w, vp.h);
      this.updateSun(new THREE.Vector3(tx, 0, tz));
      animTime.value = frozen;
      this.renderer.renderView(this.scene, 0);
      const out = vp.post.out;
      const buf = new Uint8Array(out.width * out.height * 4);
      this.renderer.gl.readRenderTargetPixels(out, 0, 0, out.width, out.height, buf);
      return { buf, w: out.width, h: out.height };
    };
    const a = shot(base.x, base.z);
    const b = shot(base.x + k * p, base.z);
    const c = shot(base.x, base.z - (k * p) / Math.sin(cam.tilt));
    const compare = (A: typeof a, B: typeof a, dx: number, dy: number) => {
      let same = 0;
      let total = 0;
      for (let y = k + 2; y < A.h - k - 2; y++) {
        for (let x = k + 2; x < A.w - k - 2; x++) {
          const ia = ((y + dy) * A.w + (x + dx)) * 4;
          const ib = (y * B.w + x) * 4;
          total++;
          if (A.buf[ia] === B.buf[ib] && A.buf[ia + 1] === B.buf[ib + 1] && A.buf[ia + 2] === B.buf[ib + 2]) same++;
        }
      }
      return same / total;
    };
    const result = { horizontal: compare(a, b, k, 0), vertical: compare(a, c, 0, k) };
    for (const o of hidden) o.visible = true;
    this.paused = wasPaused;
    return result;
  }

  /** Average milliseconds to simulate + render a frame (synchronised with the GPU). */
  bench(frames = 120): { msPerFrame: number; lowRes: [number, number]; views: number } {
    const gl = this.renderer.gl;
    const px = new Uint8Array(4);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      this.fixedStep();
      this.renderFrame(0, DT);
    }
    gl.readRenderTargetPixels(this.renderer.viewports[0].post.out, 0, 0, 1, 1, px);
    return {
      msPerFrame: +((performance.now() - t0) / frames).toFixed(2),
      lowRes: [this.renderer.lowW, this.renderer.lowH],
      views: this.renderer.viewCount,
    };
  }

  /** Debug split screen: toggles a second view following car 1. */
  toggleSplit(): void {
    const r = this.renderer;
    r.setSplit(!r.isSplit);
    for (const vp of r.viewports) vp.cam.viewHeight = r.isSplit ? VIEW_HEIGHT * 1.25 : VIEW_HEIGHT;
    this.camInit[1] = false;
  }
}

/** Largest text scale (2 or 1) at which the menu fits between top and bottom. */
function fitScale(menu: Menu, top: number, bottom: number): number {
  return top + menu.items.length * (LINE_H * 2 + 4) <= bottom ? 2 : 1;
}
