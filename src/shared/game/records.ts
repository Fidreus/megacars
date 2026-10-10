// Lap records that can be checked. The simulation is deterministic, so a
// race is fully described by its spec and the player's inputs: the server
// replays them and measures the laps itself instead of trusting a number.
// Only stock-car races with one person count (quick races and practice).

import type { CarTuning } from '../config/tuning.ts';
import type { RaceSpec } from '../net/protocol.ts';
import { quantizeInput, type CarInput } from '../sim/input.ts';
import { stepWorld } from '../sim/step.ts';
import { TRACKS } from '../track/defs/index.ts';
import { createRaceWorld } from './raceSetup.ts';

/** Longest race a replay may cover (20 minutes at 60 Hz). */
export const MAX_REPLAY_TICKS = 60 * 60 * 20;
/** Entries kept per track on the server. */
export const BOARD_SIZE = 10;

export interface RecordEntry {
  name: string;
  /** Best lap in ticks (1/60 s). */
  ticks: number;
  /** When it was set (ms since 1970). */
  at: number;
}

export type Boards = Record<string, RecordEntry[]>;

export interface RecordSubmission {
  v: number;
  name: string;
  spec: RaceSpec;
  /** encodeReplay() of the player's inputs, one per tick from the start. */
  replay: string;
}

/** Records the player's input every tick (quantised, as the sim saw it). */
export class ReplayRecorder {
  private readonly bytes: number[] = [];
  private last = -1;
  private run = 0;
  ticks = 0;
  /** Something outside the inputs changed the race (debug tools): don't submit. */
  spoiled = false;

  add(i: CarInput): void {
    if (this.ticks >= MAX_REPLAY_TICKS) {
      this.spoiled = true;
      return;
    }
    this.ticks++;
    const key = packInput(i);
    if (key === this.last && this.run < 255) {
      this.run++;
      return;
    }
    this.flush();
    this.last = key;
    this.run = 1;
  }

  private flush(): void {
    if (this.run === 0) return;
    const k = this.last;
    this.bytes.push(this.run, k & 0xff, (k >>> 8) & 0xff, (k >>> 16) & 0xff, (k >>> 24) & 0xff);
    this.run = 0;
  }

  encode(): string {
    this.flush();
    // Recording can go on afterwards: the next input starts a new run.
    return encodeBase64(Uint8Array.from(this.bytes));
  }
}

function packInput(i: CarInput): number {
  const s = Math.round(i.steer * 127) & 0xff;
  const t = Math.round(i.throttle * 255);
  const b = Math.round(i.brake * 255);
  return (s | (t << 8) | (b << 16) | ((i.buttons & 0xff) << 24)) >>> 0;
}

/** Decode a replay into a function giving the input of tick n (null past the end). */
export function decodeReplay(data: string): { ticks: number; at(n: number, out: CarInput): boolean } | null {
  let raw: Uint8Array;
  try {
    raw = decodeBase64(data);
  } catch {
    return null;
  }
  if (raw.length % 5 !== 0) return null;
  const starts: number[] = [];
  const keys: number[] = [];
  let ticks = 0;
  for (let p = 0; p < raw.length; p += 5) {
    const run = raw[p];
    if (run === 0) return null;
    starts.push(ticks);
    keys.push((raw[p + 1] | (raw[p + 2] << 8) | (raw[p + 3] << 16) | (raw[p + 4] << 24)) >>> 0);
    ticks += run;
    if (ticks > MAX_REPLAY_TICKS) return null;
  }
  let idx = 0;
  return {
    ticks,
    at(n, out) {
      if (n >= ticks) return false;
      // Ticks are read in order, so walk forward from the last run.
      if (n < starts[idx]) idx = 0;
      while (idx + 1 < starts.length && starts[idx + 1] <= n) idx++;
      const k = keys[idx];
      out.steer = ((k & 0xff) << 24 >> 24) / 127;
      out.throttle = ((k >>> 8) & 0xff) / 255;
      out.brake = ((k >>> 16) & 0xff) / 255;
      out.buttons = (k >>> 24) & 0xff;
      quantizeInput(out);
      return true;
    },
  };
}

/** Why a spec can't be on the boards, or null if it can. */
export function specProblem(spec: RaceSpec): string | null {
  if (!spec || typeof spec !== 'object') return 'no race';
  if (!TRACKS[spec.track]) return 'unknown track';
  if (!Array.isArray(spec.entrants) || spec.entrants.length < 1 || spec.entrants.length > 8) return 'bad field';
  const people = spec.entrants.filter((e) => e.playerId >= 0);
  if (people.length !== 1 || people[0].playerId !== 0) return 'one player only';
  if (spec.entrants.some((e) => e.loadout)) return 'stock cars only';
  if (!Number.isInteger(spec.laps) || spec.laps < 0 || spec.laps > 9) return 'bad laps';
  if (!Number.isInteger(spec.seed) || !Number.isInteger(spec.countdownTicks) || spec.countdownTicks < 0 || spec.countdownTicks > 600) return 'bad race';
  if (spec.entrants.some((e) => typeof e.skill !== 'number' || !(e.skill >= 0 && e.skill <= 1.5))) return 'bad field';
  return null;
}

/**
 * Replay a race and return the player's completed lap times (ticks), or an
 * error. Runs the full simulation, AI included: a few hundred ms per race.
 */
export function replayLaps(spec: RaceSpec, replay: string, base: CarTuning): { laps: number[] } | { error: string } {
  const problem = specProblem(spec);
  if (problem) return { error: problem };
  const rec = decodeReplay(replay);
  if (!rec) return { error: 'bad replay' };
  const { track, world, tunings } = createRaceWorld(spec, base);
  const me = spec.entrants.findIndex((e) => e.playerId === 0);
  const inputs: CarInput[] = world.cars.map(() => ({ steer: 0, throttle: 0, brake: 0, buttons: 0 }));
  const laps: number[] = [];
  const car = world.cars[me];
  let lap = car.lap;
  for (let n = 0; n < rec.ticks; n++) {
    rec.at(n, inputs[me]);
    stepWorld(world, track, inputs, tunings);
    // Crossing the line from lap k >= 1 completes lap k (lap 0 is the run to the line).
    if (car.lap > lap) {
      if (lap > 0) laps.push(car.lastLapTicks);
      lap = car.lap;
    }
  }
  return { laps };
}

/** Insert an entry (one per name, best first); returns its rank (1-based) or 0. */
export function insertRecord(board: RecordEntry[], e: RecordEntry): number {
  const mine = board.findIndex((x) => x.name === e.name);
  if (mine >= 0) {
    if (board[mine].ticks <= e.ticks) return 0;
    board.splice(mine, 1);
  }
  let i = 0;
  while (i < board.length && board[i].ticks <= e.ticks) i++;
  if (i >= BOARD_SIZE) return 0;
  board.splice(i, 0, e);
  board.length = Math.min(board.length, BOARD_SIZE);
  return i + 1;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeBase64(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < b.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < b.length ? B64[n & 63] : '=';
  }
  return out;
}

function decodeBase64(s: string): Uint8Array {
  if (typeof s !== 'string' || s.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(s)) throw new Error('base64');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) | ((B64.indexOf(s[i + 2]) & 63) << 6) | (B64.indexOf(s[i + 3]) & 63);
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}
