// Determinism workload, run the same way in Node and in a browser (loaded
// through Vite by scripts/detCheck.ts): long races hashed every so often, a
// recorded lap replay, and the track geometry. Every result is a string or an
// integer, so the two sides can be compared exactly.

import { DEFAULT_TUNING } from '../src/shared/config/tuning.ts';
import { createRaceWorld } from '../src/shared/game/raceSetup.ts';
import { ReplayRecorder, replayLaps } from '../src/shared/game/records.ts';
import type { League } from '../src/shared/game/leagues.ts';
import type { RaceSpec } from '../src/shared/net/protocol.ts';
import { encodeSnapshot } from '../src/shared/net/snapshot.ts';
import { neutralInput, quantizeInput, type CarInput } from '../src/shared/sim/input.ts';
import { stepWorld } from '../src/shared/sim/step.ts';
import type { Weather } from '../src/shared/sim/weather.ts';
import type { CarState } from '../src/shared/sim/car.ts';
import type { Track } from '../src/shared/track/types.ts';
import { getTrack } from '../src/shared/track/builder.ts';
import { TRACK_LIST } from '../src/shared/track/defs/index.ts';
import { dmathTable } from '../src/shared/math/dmathTable.ts';

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** FNV-1a over bytes, continued from `h`. */
function hashBytes(h: number, b: Uint8Array): number {
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193);
  return h >>> 0;
}

function hashNumber(h: number, x: number): number {
  f64[0] = x;
  h = Math.imul(h ^ u32[0], 0x01000193);
  return Math.imul(h ^ u32[1], 0x01000193) >>> 0;
}

/** Hash any plain value: numbers by their float64 bits, keys in their own order. */
function hashValue(h: number, v: unknown): number {
  if (typeof v === 'number') return hashNumber(h, v);
  if (typeof v === 'string') { for (let i = 0; i < v.length; i++) h = Math.imul(h ^ v.charCodeAt(i), 0x01000193); return h >>> 0; }
  if (typeof v === 'boolean') return hashNumber(h, v ? 1 : 0);
  if (v === null || v === undefined || typeof v === 'function') return hashNumber(h, -7);
  if (ArrayBuffer.isView(v)) {
    const a = v as unknown as ArrayLike<number>;
    for (let i = 0; i < a.length; i++) h = hashNumber(h, a[i]);
    return h;
  }
  if (Array.isArray(v)) { for (const x of v) h = hashValue(h, x); return h; }
  if (v instanceof Map) { for (const [k, x] of v) h = hashValue(hashValue(h, k), x); return h; }
  for (const k of Object.keys(v as object)) h = hashValue(hashValue(h, k), (v as Record<string, unknown>)[k]);
  return h;
}

const hex = (h: number) => (h >>> 0).toString(16).padStart(8, '0');

/** Hash of every built track (geometry, walls, surfaces: everything the sim reads). */
export function trackHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of TRACK_LIST) out[def.id] = hex(hashValue(0x811c9dc5, getTrack(def)));
  return out;
}

/** Steer the car at a point ahead, using only + - * / and sqrt (so the inputs never differ). */
function follow(car: CarState, t: Track, out: CarInput): void {
  const j = (car.trackIdx + 14) % t.n;
  const dx = t.px[j] - car.x;
  const dz = t.pz[j] - car.z;
  const speed = Math.sqrt(car.vx * car.vx + car.vz * car.vz);
  let fx = car.vx, fz = car.vz;
  if (speed < 2) { fx = t.tx[car.trackIdx]; fz = t.tz[car.trackIdx]; }
  const n = Math.sqrt((fx * fx + fz * fz) * (dx * dx + dz * dz)) || 1;
  const sin = (fx * dz - fz * dx) / n;
  const cos = (fx * dx + fz * dz) / n;
  out.steer = cos < 0 ? (sin < 0 ? -1 : 1) : sin * 2.5;
  out.throttle = cos < 0.88 ? 0.5 : 1;
  out.brake = 0;
  out.buttons = 0;
  quantizeInput(out);
}

export interface RaceCase {
  name: string;
  track: string;
  league: League;
  weather: Weather;
  weapons: boolean;
  laps: number;
  seed: number;
  /** Ticks to run at most. */
  ticks: number;
}

function caseSpec(c: RaceCase, cars = 8): RaceSpec {
  return {
    id: 1, track: c.track, laps: c.laps, seed: c.seed, countdownTicks: 0, weapons: c.weapons,
    league: c.league, weather: c.weather,
    entrants: Array.from({ length: cars }, (_, i) => ({
      name: `C${i}`, color: '#fff', playerId: i === 0 ? 0 : -1, skill: 0.55 + 0.06 * i,
    })),
  };
}

/** A long race with eight cars (car 0 driven by the line follower): world hashes every `every` ticks. */
export function raceHashes(c: RaceCase, every = 300): { hashes: string[]; end: string } {
  const spec = caseSpec(c);
  const { track, world, tunings } = createRaceWorld(spec, DEFAULT_TUNING);
  const inputs: CarInput[] = world.cars.map(() => neutralInput());
  const meta = { lead: 0, lastInputTick: 0 };
  const hashes: string[] = [];
  let n = 0;
  for (; n < c.ticks && !world.race.endTick; n++) {
    follow(world.cars[0], track, inputs[0]);
    stepWorld(world, track, inputs, tunings);
    if ((n + 1) % every === 0) hashes.push(hex(hashBytes(0x811c9dc5, encodeSnapshot(world, inputs, meta))));
  }
  const cars = world.cars.map((car) => `${car.id}:${car.lap}/${car.bestLapTicks}/${car.finishTick}/${car.hits}/${car.wrecks}`).join(' ');
  return { hashes, end: `tick ${world.tick} order ${world.race.finishOrder.join(',')} ${cars}` };
}

/** Drive a record-board race (dry, stock cars) and record the player's inputs, as the game does. */
export function recordRun(track: string, league: League, seconds: number, seed: number): { spec: RaceSpec; replay: string; laps: number[] } {
  const spec = caseSpec({ name: '', track, league, weather: 'dry', weapons: false, laps: 0, seed, ticks: 0 });
  const { track: t, world, tunings } = createRaceWorld(spec, DEFAULT_TUNING);
  const inputs: CarInput[] = world.cars.map(() => neutralInput());
  const rec = new ReplayRecorder();
  const car = world.cars[0];
  const laps: number[] = [];
  let lap = car.lap;
  for (let n = 0; n < seconds * 60; n++) {
    follow(car, t, inputs[0]);
    rec.add(inputs[0]);
    stepWorld(world, t, inputs, tunings);
    if (car.lap > lap) {
      if (lap > 0) laps.push(car.lastLapTicks);
      lap = car.lap;
    }
  }
  return { spec, replay: rec.encode(), laps };
}

/** What the server measures from a recorded race. */
export function measure(spec: RaceSpec, replay: string): string {
  return JSON.stringify(replayLaps(spec, replay, DEFAULT_TUNING));
}

/** The long races of the acceptance check: every league, weapons, crates, rain. */
export const RACES: RaceCase[] = [
  { name: 'standard frostring rain weapons', track: 'frostring', league: 'standard', weather: 'rain', weapons: true, laps: 5, seed: 11, ticks: 60 * 60 * 6 },
  { name: 'super twinbridges changing weapons', track: 'twinbridges', league: 'super', weather: 'changing', weapons: true, laps: 5, seed: 22, ticks: 60 * 60 * 6 },
  { name: 'mega manhattan rain weapons', track: 'manhattan', league: 'mega', weather: 'rain', weapons: true, laps: 5, seed: 33, ticks: 60 * 60 * 6 },
  { name: 'standard tivoli dry', track: 'tivoli', league: 'standard', weather: 'dry', weapons: false, laps: 4, seed: 44, ticks: 60 * 60 * 5 },
];

/** Record-board runs: the browser records, the server replays. */
export const RECORDS: { track: string; league: League; seconds: number; seed: number }[] = [
  { track: 'frostring', league: 'standard', seconds: 180, seed: 4242 },
  { track: 'greenvalley', league: 'super', seconds: 180, seed: 77 },
  { track: 'meltdown', league: 'mega', seconds: 180, seed: 5 },
];

/** Everything at once, for one engine. */
export function runAll(): unknown {
  return {
    tracks: trackHashes(),
    races: RACES.map((c) => ({ name: c.name, ...raceHashes(c) })),
    records: RECORDS.map((r) => recordRun(r.track, r.league, r.seconds, r.seed)),
    table: dmathTable(),
  };
}
