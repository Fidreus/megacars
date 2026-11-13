// Ghost laps: where a car was on every tick of one lap, from the moment it
// crossed the line. Only the pose and the distance driven are kept, so a
// ghost doesn't depend on the physics that made it and is small (about
// 20 bytes a tick). The world record's ghost comes from re-running its
// verified race; your own is taped while you drive.

import type { CarTuning } from '../config/tuning.ts';
import type { RaceSpec } from '../net/protocol.ts';
import type { CarState } from '../sim/car.ts';
import type { CarInput } from '../sim/input.ts';
import { stepWorld } from '../sim/step.ts';
import { createRaceWorld } from './raceSetup.ts';
import { decodeReplay, specProblem } from './records.ts';

/** Numbers per tick: x, y, z, heading, distance along the lap. */
export const GHOST_STRIDE = 5;

export interface GhostLap {
  /** Lap time (ticks); there are ticks + 1 poses (0 = on the line). */
  ticks: number;
  data: Float32Array;
}

/** Tapes a car's poses lap by lap; call sample() after every simulation step. */
export class LapTape {
  /** The lap finished most recently (null until one is). */
  last: GhostLap | null = null;
  private buf = new Float32Array(GHOST_STRIDE * 60 * 90);
  private n = 0;
  private start = -1;
  /** raceDist where the current lap began. */
  startDist = 0;
  private px = 0;
  private py = 0;
  private pz = 0;
  private ph = 0;
  private pd = 0;

  sample(car: CarState, tick: number): void {
    if (car.lap >= 1 && car.lapStartTick !== this.start) {
      // A lap began: the one before it (if any) is complete.
      if (this.start >= 0 && this.n > 1) this.last = { ticks: this.n - 1, data: this.buf.slice(0, this.n * GHOST_STRIDE) };
      this.start = car.lapStartTick;
      this.n = 0;
      // Pose 0 is the one before the step that crossed the line.
      this.startDist = this.pd;
      this.push(this.px, this.py, this.pz, this.ph, 0);
    }
    if (this.start >= 0) {
      const idx = tick - this.start;
      while (this.n <= idx) this.push(car.x, car.y, car.z, car.heading, car.raceDist - this.startDist);
    }
    this.px = car.x;
    this.py = car.y;
    this.pz = car.z;
    this.ph = car.heading;
    this.pd = car.raceDist;
  }

  private push(x: number, y: number, z: number, h: number, d: number): void {
    if ((this.n + 1) * GHOST_STRIDE > this.buf.length) {
      const bigger = new Float32Array(this.buf.length * 2);
      bigger.set(this.buf);
      this.buf = bigger;
    }
    const o = this.n * GHOST_STRIDE;
    this.buf[o] = x;
    this.buf[o + 1] = y;
    this.buf[o + 2] = z;
    this.buf[o + 3] = h;
    this.buf[o + 4] = d;
    this.n++;
  }
}

/**
 * Re-run a verified race (see replayLaps) and tape the player's fastest lap
 * (the first of equal ones, as the board counts it).
 */
export function extractBestLap(spec: RaceSpec, replay: string, base: CarTuning): { lap: GhostLap; laps: number[] } | { error: string } {
  const problem = specProblem(spec);
  if (problem) return { error: problem };
  const rec = decodeReplay(replay);
  if (!rec) return { error: 'bad replay' };
  const { track, world, tunings } = createRaceWorld(spec, base);
  const me = spec.entrants.findIndex((e) => e.playerId === 0);
  const inputs: CarInput[] = world.cars.map(() => ({ steer: 0, throttle: 0, brake: 0, buttons: 0 }));
  const car = world.cars[me];
  const tape = new LapTape();
  const laps: number[] = [];
  let best: GhostLap | null = null;
  let lap = car.lap;
  for (let n = 0; n < rec.ticks; n++) {
    rec.at(n, inputs[me]);
    stepWorld(world, track, inputs, tunings);
    tape.sample(car, world.tick);
    if (car.lap > lap) {
      if (lap > 0) {
        laps.push(car.lastLapTicks);
        if (tape.last && (!best || tape.last.ticks < best.ticks)) best = tape.last;
      }
      lap = car.lap;
    }
  }
  return best ? { lap: best, laps } : { error: 'no complete lap' };
}

/** Running maximum of the distance column, for ghostTicksAt(). */
export function ghostReach(g: GhostLap): Float32Array {
  const n = g.ticks + 1;
  const out = new Float32Array(n);
  let m = -Infinity;
  for (let i = 0; i < n; i++) {
    m = Math.max(m, g.data[i * GHOST_STRIDE + 4]);
    out[i] = m;
  }
  return out;
}

/** When (ticks into its lap, fractional) the ghost had first driven `dist` metres; -1 if it never did. */
export function ghostTicksAt(reach: Float32Array, dist: number): number {
  const n = reach.length;
  if (n === 0 || dist > reach[n - 1]) return -1;
  if (dist <= reach[0]) return 0;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (reach[mid] >= dist) hi = mid;
    else lo = mid;
  }
  const span = reach[hi] - reach[lo];
  return lo + (span > 0 ? (dist - reach[lo]) / span : 0);
}

/** The ghost's pose `t` ticks (fractional) into its lap, or false past either end. */
export function ghostPose(g: GhostLap, t: number, out: { x: number; y: number; z: number; heading: number }): boolean {
  if (!(t >= 0) || t > g.ticks) return false;
  const i = Math.min(Math.floor(t), g.ticks - 1);
  const f = t - i;
  const a = i * GHOST_STRIDE;
  const b = a + GHOST_STRIDE;
  const d = g.data;
  out.x = d[a] + (d[b] - d[a]) * f;
  out.y = d[a + 1] + (d[b + 1] - d[a + 1]) * f;
  out.z = d[a + 2] + (d[b + 2] - d[a + 2]) * f;
  let dh = d[b + 3] - d[a + 3];
  if (dh > Math.PI) dh -= Math.PI * 2;
  else if (dh < -Math.PI) dh += Math.PI * 2;
  out.heading = d[a + 3] + dh * f;
  return true;
}

/** A ghost read back from storage or a message, or null if it doesn't hold together. */
export function checkGhost(v: unknown): GhostLap | null {
  const g = v as GhostLap | null;
  if (!g || !Number.isInteger(g.ticks) || g.ticks < 1 || !(g.data instanceof Float32Array)) return null;
  return g.data.length === (g.ticks + 1) * GHOST_STRIDE ? g : null;
}
