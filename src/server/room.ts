// A room: up to eight people in a lobby who race together. During a race the
// room runs the authoritative simulation at 60 Hz, consumes each driver's
// inputs for the tick they were meant for, and sends snapshots back.

import type { CarTuning } from '../shared/config/tuning.ts';
import { AI_NAMES, AI_SKILL, CAR_COLORS } from '../shared/game/roster.ts';
import { leagueOf } from '../shared/game/leagues.ts';
import { createRaceWorld } from '../shared/game/raceSetup.ts';
import { makeRng } from '../shared/math/rng.ts';
import {
  AUTO_START_MS, LEAD_WINDOW, MAX_PLAYERS, SNAPSHOT_EVERY,
  type Entrant, type PlayerInfo, type PublicRoom, type RaceSpec, type RoomConfig, type RoomInfo, type ServerMsg,
} from '../shared/net/protocol.ts';
import { encodeSnapshot } from '../shared/net/snapshot.ts';
import {
  aiLoadout, averageLevel, buy, loadoutOf, newProfile, raceResults, settle, type Profile, type ShopItem,
} from '../shared/game/shop.ts';
import { copyInput, neutralInput, type CarInput } from '../shared/sim/input.ts';
import { stepWorld } from '../shared/sim/step.ts';
import { COUNTDOWN_TICKS, RacePhase, type World } from '../shared/sim/world.ts';
import { DEFAULT_TRACK, TRACKS, raceLaps } from '../shared/track/defs/index.ts';
import type { Track } from '../shared/track/types.ts';

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
  config: RoomConfig = { track: DEFAULT_TRACK, laps: 3, ai: 3, difficulty: 1, weapons: true, upgrades: true, public: false, league: 'standard', damageSlows: true };
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
    if (typeof c.track === 'string' && TRACKS[c.track]) cfg.track = c.track;
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
    return { code: this.code, hostId: this.hostId, players, config: { ...this.config }, state: this.state, races: this.races, startsIn };
  }

  /** How the room looks in the public room list. */
  listing(): PublicRoom {
    const c = this.config;
    return {
      code: this.code, host: this.member(this.hostId)?.name ?? '', players: this.connectedCount,
      track: c.track, laps: c.laps, weapons: c.weapons, upgrades: c.upgrades, state: this.state,
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
  start(id: number, seed: number): 'notHost' | 'busy' | 'bad' | null {
    if (id !== this.hostId) return 'notHost';
    if (this.race) return 'busy';
    const racers = this.members.filter((m) => m.peer);
    if (racers.some((m) => !m.ready && m.id !== this.hostId)) return 'bad';
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
      track: this.config.track,
      laps: raceLaps(this.config.track, this.config.laps),
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
    this.races = 0;
    for (const m of this.members) {
      m.profile = newProfile();
      m.lastPlace = 0;
      m.peer?.send({ t: 'profile', profile: m.profile });
    }
    this.broadcastRoom();
    return null;
  }

  /** Late-input statistics for diagnostics. */
  driverStats(): { id: number; late: number; lead: number }[] {
    return (this.race?.drivers ?? []).map((d) => ({ id: d.memberId, late: d.lateInputs, lead: d.lastTick - (this.race?.world.tick ?? 0) }));
  }
}
