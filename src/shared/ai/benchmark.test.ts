// The handling contract: a controlled drift must beat brake-and-grip through
// a tight 90° corner from top speed, while grip stays at least as fast on a
// fast sweeper. Re-run after every tuning change.

import { describe, expect, it } from 'vitest';
import { DT } from '../config/constants.ts';
import { DEFAULT_TUNING, type CarTuning } from '../config/tuning.ts';
import { headingOf } from '../math/angle.ts';
import { buildTrack, sampleIndexAt } from '../track/builder.ts';
import { BENCH_SWEEPER, BENCH_TIGHT } from '../track/defs/bench.ts';
import type { TrackDef } from '../track/types.ts';
import { Ev } from '../sim/events.ts';
import { stepWorld } from '../sim/step.ts';
import { createWorld } from '../sim/world.ts';
import { AiMode } from './driver.ts';

export interface SegmentResult {
  time: number;
  minSpeed: number;
  exitSpeed: number;
  maxSlipDeg: number;
  wallHits: number;
}

export function runSegment(def: TrackDef, mode: number, s0: number, s1: number, v0: number, tuning: CarTuning = DEFAULT_TUNING): SegmentResult {
  const track = buildTrack(def);
  const world = createWorld(track, 1, 1);
  const car = world.cars[0];
  const i = sampleIndexAt(track, s0);
  const j = (i + 1) % track.n;
  const h = headingOf(track.line.x[j] - track.line.x[i], track.line.z[j] - track.line.z[i]);
  car.x = track.line.x[i];
  car.z = track.line.z[i];
  car.heading = h;
  car.vx = Math.sin(h) * v0;
  car.vz = -Math.cos(h) * v0;
  car.trackIdx = i;
  car.trackS = track.s[i];
  car.aiDriven = 1;
  car.aiMode = mode;
  let ticks = 0;
  let minSpeed = Infinity;
  let maxSlip = 0;
  let wallHits = 0;
  let travelled = 0;
  const need = s1 - s0;
  let lastS = car.trackS;
  while (travelled < need && ticks < 60 * 60) {
    stepWorld(world, track, [], [tuning]);
    ticks++;
    let ds = car.trackS - lastS;
    if (ds < -track.length / 2) ds += track.length;
    travelled += ds;
    lastS = car.trackS;
    const v = Math.hypot(car.vx, car.vz);
    minSpeed = Math.min(minSpeed, v);
    maxSlip = Math.max(maxSlip, Math.abs(car.slip));
    for (let e = 0; e < world.events.count; e++) if (world.events.list[e].kind === Ev.WallHit) wallHits++;
  }
  return {
    time: ticks * DT,
    minSpeed,
    exitSpeed: Math.hypot(car.vx, car.vz),
    maxSlipDeg: (maxSlip * 180) / Math.PI,
    wallHits,
  };
}

// Corner 0 of BENCH_TIGHT starts 236 m after the start line and is 22 m long.
const TIGHT = { def: BENCH_TIGHT, s0: 136, s1: 236 + 22 + 100 };
// Corner 0 of BENCH_SWEEPER starts 150 m after the start line and is 314 m long.
const SWEEP = { def: BENCH_SWEEPER, s0: 50, s1: 150 + 314 + 100 };

describe('handling benchmark', () => {
  it('drift beats grip by at least 8% through a tight 90° corner', () => {
    const grip = runSegment(TIGHT.def, AiMode.Grip, TIGHT.s0, TIGHT.s1, 45);
    const drift = runSegment(TIGHT.def, AiMode.Drift, TIGHT.s0, TIGHT.s1, 45);
    console.log('tight 90°  grip', fmt(grip), '\n           drift', fmt(drift), `\n           gain ${((1 - drift.time / grip.time) * 100).toFixed(1)}%`);
    expect(drift.wallHits).toBe(0);
    expect(grip.wallHits).toBe(0);
    expect(drift.time).toBeLessThanOrEqual(grip.time * 0.92);
  });

  it('grip is at least as fast as drifting on a fast sweeper', () => {
    const grip = runSegment(SWEEP.def, AiMode.Grip, SWEEP.s0, SWEEP.s1, 45);
    const drift = runSegment(SWEEP.def, AiMode.Drift, SWEEP.s0, SWEEP.s1, 45);
    console.log('sweeper    grip', fmt(grip), '\n           drift', fmt(drift));
    expect(grip.wallHits).toBe(0);
    expect(grip.time).toBeLessThanOrEqual(drift.time * 1.005);
  });
});

function fmt(r: SegmentResult): string {
  return `t=${r.time.toFixed(2)}s min=${r.minSpeed.toFixed(1)} exit=${r.exitSpeed.toFixed(1)} slip=${r.maxSlipDeg.toFixed(1)}° walls=${r.wallHits}`;
}
