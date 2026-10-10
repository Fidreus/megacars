// Handling benchmark helper: run the AI through a stretch of track from a
// given speed and report the time and how it got there.

import { DEFAULT_TUNING, type CarTuning } from '../config/tuning.ts';
import { DT } from '../config/constants.ts';
import { headingOf } from '../math/angle.ts';
import { buildTrack, sampleIndexAt } from '../track/builder.ts';
import type { TrackDef } from '../track/types.ts';
import { Ev } from '../sim/events.ts';
import { stepWorld } from '../sim/step.ts';
import { createWorld } from '../sim/world.ts';

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
