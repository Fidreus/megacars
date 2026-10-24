// A room: up to eight people in a lobby who race together. During a race the
// room runs the authoritative simulation at 60 Hz, consumes each driver's
// inputs for the tick they were meant for, and sends snapshots back.

import type { CarTuning } from '../shared/config/tuning.ts';
import { AI_NAMES, AI_SKILL, CAR_COLORS } from '../shared/game/roster.ts';
import { leagueOf } from '../shared/game/leagues.ts';
import { createRaceWorld } from '../shared/game/raceSetup.ts';
import { makeRng } from '../shared/math/rng.ts';
import {
  AUTO_START_MS, LEAD_WINDOW, MAX_PLAYERS, ROOM_TRACKS_MAX, SNAPSHOT_EVERY, TOUR_MAX,
  type Entrant, type PlayerInfo, type PublicRoom, type RaceSpec, type RoomConfig, type RoomInfo, type ServerMsg,
} from '../shared/net/protocol.ts';
import { encodeSnapshot } from '../shared/net/snapshot.ts';
import {
  aiLoadout, averageLevel, buy, loadoutOf, newProfile, raceResults, settle, type Profile, type ShopItem,
} from '../shared/game/shop.ts';
import { copyInput, neutralInput, type CarInput } from '../shared/sim/input.ts';
import { stepWorld } from '../shared/sim/step.ts';
import { COUNTDOWN_TICKS, RacePhase, type World } from '../shared/sim/world.ts';
import { isTrackBuilt } from '../shared/track/builder.ts';
import { DEFAULT_TRACK, raceLaps, registerTrack, TRACK_LIST, TRACKS, trackDef, trackName } from '../shared/track/defs/index.ts';
import type { Track, TrackDef } from '../shared/track/types.ts';

/** A random tournament of the game's own tracks. */
export function randomTour(n: number, rnd: () => number = Math.random): string[] {
  const ids = TRACK_LIST.map((t) => t.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, Math.max(1, Math.min(n, ids.length)));
}

/** What a room needs from a connection. */
export interface Peer {
  readonly id: number;
  name: string;
  rtt: number;
  send(msg: ServerMsg): void;
  sendBinary(data: Uint8Array): void;
}

interface Member {
  id: number;
  name: string;
  color: number;
  ready: boolean;
  peer: Peer | null;
  /** When the connection dropped (ms), for the reconnect grace period. */
  droppedAt: number;
  /** Season: money, points, upgrades, ammo and damage. */
  profile: Profile;
  lastPlace: number;
}

const INPUT_RING = 128;
/** Inputs this far ahead of the server are rejected. */
const MAX_LEAD = 120;
/** Without fresh input for this long a car coasts instead of repeating the last input. */
const STARVE_NEUTRAL = 12;
/** Lead is reported as the minimum over this many ticks. */
/** The room returns to the lobby this long after a race ends. */
const AFTER_RACE_TICKS = 120;

interface Driver {
  memberId: number;
  car: number;
  ring: CarInput[];
  ringTick: Int32Array;
  lastTick: number;
  starved: number;
  leadSamples: Int16Array;
  lateInputs: number;
}

interface RaceRun {
  spec: RaceSpec;
  world: World;
  track: Track;
  tunings: CarTuning[];
  inputs: CarInput[];
  drivers: Driver[];
}

let raceIds = 1;

export class Room {
  readonly code: string;
  readonly members: Member[] = [];
  hostId = -1;
  config: RoomConfig = { track: DEFAULT_TRACK, tour: [DEFAULT_TRACK], laps: 3, ai: 3, difficulty: 1, weapons: true, upgrades: true, public: false, league: 'standard', damageSlows: true };
  /** Races of the tournament run so far (a one-track tour just repeats). */
  tourIndex = 0;
  /** The host's player tracks (id -> share code and definition), checked by the server. */
  readonly defs = new Map<string, { code: string; def: TrackDef }>();
  /** Player tracks still being checked (they may be in the tour already). */
  readonly pending = new Set<string>();
  /** A player track has to be built before the race can start (the server does it in a worker). */
  needBuild: (def: TrackDef, code: string) => void = () => {};
  /** The host pressed START while a track was still being built: start when it is. */
  startWanted = false;
  /** Public rooms: when the race starts by itself (ms, 0 = not counting down). */
  startsAt = 0;
  private now = 0;
  private shownLeft = 0;
  /** Races finished this season. */
  races = 0;
  race: RaceRun | null = null;
  /** Ticks of the latest race simulated (diagnostics). */
  simTicks = 0;

  constructor(code: string) {
    this.code = code;
  }

  get state(): 'lobby' | 'race' {
    return this.race ? 'race' : 'lobby';
  }

  get connectedCount(): number {
    return this.members.filter((m) => m.peer).length;
  }

  get isEmpty(): boolean {
    return this.members.length === 0;
  }

  member(id: number): Member | undefined {
    return this.members.find((m) => m.id === id);
  }

  // ------------------------------------------------------------- membership

  /** Add a person. Returns an error code, or null on success. */
  join(peer: Peer): 'full' | null {
    if (this.members.length >= MAX_PLAYERS) return 'full';
    const used = new Set(this.members.map((m) => m.color));
    let color = 0;
    while (used.has(color)) color++;
    const profile = newProfile();
    this.members.push({ id: peer.id, name: this.uniqueName(peer.id, peer.name), color, ready: false, peer, droppedAt: 0, profile, lastPlace: 0 });
    if (this.hostId < 0 || !this.member(this.hostId)) this.hostId = peer.id;
    this.sendDefs(peer);
    this.broadcastRoom();
    peer.send({ t: 'profile', profile });
    if (this.race) this.sendRace(peer);
    return null;
  }

  /** The person left on purpose. */
  leave(id: number): void {
    const i = this.members.findIndex((m) => m.id === id);
    if (i < 0) return;
    this.members.splice(i, 1);
    this.releaseCar(id);
    this.pickHost();
    this.broadcastRoom();
  }

  /** The connection dropped; keep the seat for a while. */
  disconnect(id: number, now: number): void {
    const m = this.member(id);
    if (!m) return;
    m.peer = null;
    m.droppedAt = now;
    m.ready = false;
    this.releaseCar(id);
    if (this.hostId === id) this.pickHost();
    this.broadcastRoom();
  }

  /** The same person is back on a new connection. */
  reconnect(peer: Peer): boolean {
    const m = this.member(peer.id);
    if (!m) return false;
    m.peer = peer;
    m.name = this.uniqueName(peer.id, peer.name);
    if (this.hostId < 0 || !this.member(this.hostId)?.peer) this.hostId = peer.id;
    this.sendDefs(peer);
    const d = this.race?.drivers.find((x) => x.memberId === peer.id);
    if (d && this.race) {
      const car = this.race.world.cars[d.car];
      if (!car.finished) {
        car.aiDriven = 0;
        car.human = 1;
      }
      d.lastTick = -1;
      d.ringTick.fill(-1);
      d.leadSamples.fill(-999);
    }
    this.broadcastRoom();
    peer.send({ t: 'profile', profile: m.profile });
    if (this.race) this.sendRace(peer);
    return true;
  }

  /** Drop seats whose connection has been gone longer than `graceMs`. */
  expire(now: number, graceMs: number): void {
    const gone = this.members.filter((m) => !m.peer && now - m.droppedAt > graceMs);
    for (const m of gone) this.leave(m.id);
  }

  private pickHost(): void {
    if (this.member(this.hostId)?.peer) return;
    const next = this.members.find((m) => m.peer) ?? this.members[0];
    this.hostId = next ? next.id : -1;
  }

  /** A driver left mid-race: the computer takes over their car. */
  private releaseCar(id: number): void {
    const d = this.race?.drivers.find((x) => x.memberId === id);
    if (!d || !this.race) return;
    const car = this.race.world.cars[d.car];
    car.human = 0;
    if (!car.finished) car.aiDriven = 1;
  }

  // ------------------------------------------------------------------ lobby

  /** Two people with the same name get a number after one of them. */
  private uniqueName(id: number, name: string): string {
    const taken = new Set(this.members.filter((m) => m.id !== id).map((m) => m.name));
    if (!taken.has(name)) return name;
    for (let k = 2; ; k++) {
      const n = `${name.slice(0, 10)} ${k}`;
      if (!taken.has(n)) return n;
    }
  }

  setName(id: number, name: string): void {
    const m = this.member(id);
    if (!m) return;
    m.name = this.uniqueName(id, name);
    this.broadcastRoom();
  }

  setReady(id: number, ready: boolean): void {
    const m = this.member(id);
    if (!m || this.race) return;
    m.ready = ready;
    this.broadcastRoom();
  }

  setConfig(id: number, c: Partial<RoomConfig>): 'notHost' | 'busy' | null {
    if (id !== this.hostId) return 'notHost';
    if (this.race) return 'busy';
    const cfg = this.config;
    if (Array.isArray(c.tour)) {
      const tour = c.tour.filter((id): id is string => typeof id === 'string' && this.knows(id)).slice(0, TOUR_MAX);
      if (tour.length) this.setTour(tour);
    } else if (typeof c.track === 'string' && this.knows(c.track)) this.setTour([c.track]);
    if (Number.isFinite(c.laps)) cfg.laps = Math.max(1, Math.min(9, Math.round(c.laps!)));
    if (Number.isFinite(c.ai)) cfg.ai = Math.max(0, Math.min(MAX_PLAYERS - 1, Math.round(c.ai!)));
    if (typeof c.weapons === 'boolean') cfg.weapons = c.weapons;
    if (typeof c.upgrades === 'boolean') cfg.upgrades = c.upgrades;
    if (typeof c.damageSlows === 'boolean') cfg.damageSlows = c.damageSlows;
    if (Number.isFinite(c.difficulty)) cfg.difficulty = Math.max(0, Math.min(2, Math.round(c.difficulty!)));
    if (typeof c.public === 'boolean') cfg.public = c.public;
    if (c.league !== undefined) cfg.league = leagueOf(c.league);
    this.broadcastRoom();
    return null;
  }

  /** A track this room can race: the game's own or one of the host's (checked or being checked). */
  knows(id: string): boolean {
    return !!TRACKS[id] || this.defs.has(id) || this.pending.has(id);
  }

  setTour(tour: string[]): void {
    const same = tour.length === this.config.tour.length && tour.every((id, i) => id === this.config.tour[i]);
    this.config.tour = tour;
    if (!same) this.tourIndex = 0;
    this.config.track = tour[Math.min(this.tourIndex, tour.length - 1)];
  }

  /** The tournament has been raced to the end (a single track never ends). */
  get tourOver(): boolean {
    return this.config.tour.length > 1 && this.tourIndex >= this.config.tour.length;
  }

  /** The host sent a player track; it is in the room once the server has checked it. */
  trackPending(id: string): void {
    this.pending.add(id);
  }

  /** A checked player track: everybody gets it before it is used. */
  addTrack(def: TrackDef, code: string): void {
    this.pending.delete(def.id);
    if (!this.defs.has(def.id)) {
      // Full: forget the ones the tournament doesn't use.
      for (const id of [...this.defs.keys()]) {
        if (this.defs.size < ROOM_TRACKS_MAX) break;
        if (!this.config.tour.includes(id)) this.defs.delete(id);
      }
      if (this.defs.size >= ROOM_TRACKS_MAX) return;
      this.defs.set(def.id, { code, def });
    }
    for (const m of this.members) if (m.peer) this.sendDefs(m.peer);
    this.broadcastRoom();
  }

  /** A player track failed its check: out of the tournament again. */
  dropTrack(id: string): void {
    this.pending.delete(id);
    const tour = this.config.tour.filter((t) => t !== id);
    if (tour.length !== this.config.tour.length) this.setTour(tour.length ? tour : [DEFAULT_TRACK]);
    this.startWanted = false;
    this.broadcastRoom();
  }

  private sendDefs(peer: Peer): void {
    if (!this.defs.size) return;
    peer.send({ t: 'trackDefs', defs: Object.fromEntries([...this.defs].map(([id, d]) => [id, d.code])) });
  }

  info(): RoomInfo {
    const players: PlayerInfo[] = this.members.map((m) => ({
      id: m.id,
      name: m.name,
      color: CAR_COLORS[m.color % CAR_COLORS.length],
      // The host of a private room starts the race, so counts as ready; in a
      // public room the race starts by itself, so the host readies up too.
      ready: m.ready || (m.id === this.hostId && !this.config.public),
      connected: m.peer !== null,
      ping: m.peer ? Math.round(m.peer.rtt) : -1,
      points: m.profile.points,
      lastPlace: m.lastPlace,
    }));
    const startsIn = this.startsAt ? Math.max(0, Math.ceil((this.startsAt - this.now) / 1000)) : 0;
    return {
      code: this.code, hostId: this.hostId, players, config: { ...this.config, tour: [...this.config.tour] }, state: this.state, races: this.races, startsIn,
      tourIndex: this.tourIndex, tourNames: this.config.tour.map((id) => trackName(id)),
    };
  }

  /** How the room looks in the public room list. */
  listing(): PublicRoom {
    const c = this.config;
    return {
      code: this.code, host: this.member(this.hostId)?.name ?? '', players: this.connectedCount,
      track: c.track, trackName: trackName(c.track), tour: c.tour.length, tourIndex: Math.min(this.tourIndex, c.tour.length - 1),
      laps: c.laps, weapons: c.weapons, upgrades: c.upgrades, state: this.state,
    };
  }

  /**
   * Public rooms don't wait for the host: once at least two people are in
   * and every one of them is ready, the race starts after AUTO_START_MS.
   * Call often (every server tick); returns true when it started a race.
   */
  autoStart(now: number, seed: number): boolean {
    this.now = now;
    if (!this.config.public || this.race) {
      this.startsAt = 0;
      return false;
    }
    const racers = this.members.filter((m) => m.peer);
    const go = racers.length >= 2 && racers.every((m) => m.ready);
    if (!go) {
      if (this.startsAt) {
        this.startsAt = 0;
        this.broadcastRoom();
      }
      return false;
    }
    if (!this.startsAt) {
      this.startsAt = now + AUTO_START_MS;
      this.broadcastRoom();
      return false;
    }
    if (now < this.startsAt) {
      // Tell everybody each time the shown seconds change.
      const left = Math.ceil((this.startsAt - now) / 1000);
      if (left !== this.shownLeft) {
        this.shownLeft = left;
        this.broadcastRoom();
      }
      return false;
    }
    this.startsAt = 0;
    this.shownLeft = 0;
    return this.start(this.hostId, seed) === null;
  }

  broadcastRoom(): void {
    const msg: ServerMsg = { t: 'room', room: this.info() };
    for (const m of this.members) m.peer?.send(msg);
  }

  // ------------------------------------------------------------------- race

  /** Start a race with everybody connected. Everyone but the host must be ready. */
  start(id: number, seed: number): 'notHost' | 'busy' | 'bad' | 'building' | null {
    if (id !== this.hostId) return 'notHost';
    if (this.race) return 'busy';
    const racers = this.members.filter((m) => m.peer);
    if (racers.some((m) => !m.ready && m.id !== this.hostId)) return 'bad';
    // Tournament over: the next START begins a new one (public rooms get new tracks).
    if (this.tourOver) {
      if (this.config.public) this.setTour(randomTour(this.config.tour.length));
      this.resetSeason();
    }
    // A player track is checked and built in a worker; the race waits for it.
    const trackId = this.config.track;
    if (!TRACKS[trackId]) {
      const own = this.defs.get(trackId);
      if (!own) {
        this.startWanted = this.pending.has(trackId);
        return this.startWanted ? 'building' : 'bad';
      }
      registerTrack(own.def);
      if (!isTrackBuilt(trackId)) {
        this.startWanted = true;
        this.needBuild(own.def, own.code);
        return 'building';
      }
    }
    this.startWanted = false;
    const rnd = makeRng(seed);
    const aiCount = Math.min(this.config.ai, MAX_PLAYERS - racers.length);
    const shop = this.config.upgrades;
    const level = averageLevel(racers.map((m) => m.profile));
    const names = [...AI_NAMES].sort(() => rnd() - 0.5);
    const used = new Set(racers.map((m) => m.color));
    const free = CAR_COLORS.map((_, i) => i).filter((i) => !used.has(i));
    const entrants: Entrant[] = [];
    // Computer cars at the front of the grid, people behind them.
    for (let k = 0; k < aiCount; k++) {
      entrants.push({
        name: names[k % names.length],
        color: CAR_COLORS[free[k % free.length]],
        playerId: -1,
        skill: AI_SKILL[this.config.difficulty] + (rnd() - 0.5) * 0.06,
        loadout: shop ? aiLoadout(level, this.config.difficulty, rnd) : undefined,
      });
    }
    for (const m of racers) {
      entrants.push({
        name: m.name, color: CAR_COLORS[m.color], playerId: m.id, skill: AI_SKILL[1],
        loadout: shop ? loadoutOf(m.profile) : undefined,
      });
    }
    const spec: RaceSpec = {
      id: raceIds++,
      track: trackId,
      laps: raceLaps(trackId, this.config.laps),
      seed: seed & 0x7fffffff,
      countdownTicks: COUNTDOWN_TICKS,
      weapons: this.config.weapons,
      entrants,
      league: this.config.league,
      damageSlows: this.config.damageSlows,
    };
    const { world, track, tunings } = createRaceWorld(spec);
    const drivers: Driver[] = [];
    entrants.forEach((e, car) => {
      if (e.playerId < 0) return;
      drivers.push({
        memberId: e.playerId,
        car,
        ring: Array.from({ length: INPUT_RING }, neutralInput),
        ringTick: new Int32Array(INPUT_RING).fill(-1),
        lastTick: -1,
        starved: 0,
        leadSamples: new Int16Array(LEAD_WINDOW).fill(-999),
        lateInputs: 0,
      });
    });
    this.race = {
      spec, world, track, drivers,
      tunings,
      inputs: world.cars.map(() => neutralInput()),
    };
    this.simTicks = 0;
    for (const m of this.members) m.ready = false;
    this.broadcastRoom();
    for (const m of this.members) if (m.peer) this.sendRace(m.peer);
    return null;
  }

  private sendRace(peer: Peer): void {
    if (!this.race) return;
    peer.send({ t: 'race', spec: this.race.spec, tick: this.race.world.tick });
    // A snapshot straight away so newcomers can show the race at once.
    const d = this.race.drivers.find((x) => x.memberId === peer.id);
    peer.sendBinary(this.snapshotFor(d));
  }

  /** An input from a driver for the given tick. */
  input(id: number, tick: number, inp: CarInput): void {
    const race = this.race;
    if (!race) return;
    const d = race.drivers.find((x) => x.memberId === id);
    if (!d) return;
    const now = race.world.tick;
    if (tick < now) {
      d.lateInputs++;
      d.lastTick = Math.max(d.lastTick, tick);
      return;
    }
    if (tick > now + MAX_LEAD) return;
    const slot = tick % INPUT_RING;
    copyInput(d.ring[slot], inp);
    d.ringTick[slot] = tick;
    if (tick > d.lastTick) d.lastTick = tick;
  }

  /** One server tick. Returns false when the room has nothing running. */
  tick(): boolean {
    const race = this.race;
    if (!race) return false;
    const w = race.world;
    const t = w.tick;
    for (const d of race.drivers) {
      const slot = t % INPUT_RING;
      const target = race.inputs[d.car];
      if (d.ringTick[slot] === t) {
        copyInput(target, d.ring[slot]);
        d.starved = 0;
      } else if (++d.starved > STARVE_NEUTRAL) {
        // Gone quiet: let go of everything rather than drive blind.
        copyInput(target, neutralInput());
      }
      // No input yet (just started, or rejoined): unknown, not "hopelessly late".
      d.leadSamples[t % LEAD_WINDOW] = d.lastTick < 0 ? -999 : Math.max(-998, Math.min(999, d.lastTick - t));
    }
    stepWorld(w, race.track, race.inputs, race.tunings);
    this.simTicks++;
    if (w.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
    if (w.race.phase === RacePhase.Finished && w.tick >= w.race.endTick + AFTER_RACE_TICKS) this.endRace();
    return true;
  }

  private snapshotFor(d: Driver | undefined): Uint8Array {
    const race = this.race!;
    let lead = 0;
    if (d) {
      lead = 999;
      for (const s of d.leadSamples) if (s > -999) lead = Math.min(lead, s);
      if (lead === 999) lead = -999;
    }
    return encodeSnapshot(race.world, race.inputs, { lead, lastInputTick: d ? Math.max(0, d.lastTick) : 0 });
  }

  private broadcastSnapshot(): void {
    const race = this.race!;
    for (const m of this.members) {
      if (!m.peer) continue;
      m.peer.sendBinary(this.snapshotFor(race.drivers.find((x) => x.memberId === m.id)));
    }
  }

  endRace(): void {
    if (!this.race) return;
    this.settleRace(this.race);
    this.race = null;
    // On to the tournament's next track.
    const tour = this.config.tour;
    if (tour.length > 1) {
      this.tourIndex++;
      this.config.track = tour[Math.min(this.tourIndex, tour.length - 1)];
    }
    for (const m of this.members) {
      m.ready = false;
      m.peer?.send({ t: 'raceOver' });
    }
    this.pickHost();
    this.broadcastRoom();
  }

  /** Points always; money, ammo and damage carry over when upgrades are on. */
  private settleRace(race: RaceRun): void {
    this.races++;
    for (const m of this.members) m.lastPlace = 0;
    for (const r of raceResults(race.world)) {
      const e = race.spec.entrants[r.car];
      const m = e.playerId >= 0 ? this.member(e.playerId) : undefined;
      if (!m) continue;
      m.lastPlace = r.place;
      if (this.config.upgrades) {
        settle(m.profile, race.world, r);
      } else {
        m.profile.points += r.points;
        m.profile.races++;
        if (r.place === 1) m.profile.wins++;
      }
      m.peer?.send({ t: 'profile', profile: m.profile });
    }
  }

  /** Spend money in the shop (between races only). */
  buy(id: number, item: ShopItem): string | null {
    const m = this.member(id);
    if (!m) return 'NOT IN THIS ROOM';
    if (this.race) return 'WAIT FOR THE RACE TO END';
    if (!this.config.upgrades) return 'THE SHOP IS CLOSED IN THIS ROOM';
    const err = buy(m.profile, item);
    if (!err) m.peer?.send({ t: 'profile', profile: m.profile });
    return err;
  }

  /** Host: everybody starts over with fresh cars and no points. */
  newSeason(id: number): 'notHost' | 'busy' | null {
    if (id !== this.hostId) return 'notHost';
    if (this.race) return 'busy';
    this.resetSeason();
    this.broadcastRoom();
    return null;
  }

  /** Fresh cars, no points, the tournament from its first track. */
  private resetSeason(): void {
    this.races = 0;
    this.tourIndex = 0;
    this.config.track = this.config.tour[0];
    for (const m of this.members) {
      m.profile = newProfile();
      m.lastPlace = 0;
      m.peer?.send({ t: 'profile', profile: m.profile });
    }
  }

  /** Late-input statistics for diagnostics. */
  driverStats(): { id: number; late: number; lead: number }[] {
    return (this.race?.drivers ?? []).map((d) => ({ id: d.memberId, late: d.lateInputs, lead: d.lastTick - (this.race?.world.tick ?? 0) }));
  }
}
