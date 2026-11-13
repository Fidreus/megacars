// Drift boost: holding a deliberate slide builds a charge in three levels;
// when grip returns cleanly the charge is paid out as a short burst of speed.
// A hard knock or a spin loses the charge. Slides the ground causes by itself
// (ice, oil, snow) build next to nothing, and so does sliding down a
// straight: a slide only pays (charge and drift repair) while cornering.

import { DT } from '../config/constants.ts';
import type { SurfaceMix } from '../config/surfaces.ts';
import type { CarTuning } from '../config/tuning.ts';
import { DEG } from '../math/angle.ts';
import type { Track } from '../track/types.ts';
import type { CarState } from './car.ts';
import { Ev, pushEvent, type EventBuffer } from './events.ts';

export const DRIFT_BOOST = {
  /** Charge only builds above this speed (m/s) and slip angle. */
  minSpeed: 12,
  minSlipDeg: 8,
  /** Seconds of drifting to reach level 1, 2 and 3. */
  levels: [0.6, 1.3, 2.2],
  /** Per level (index 1-3): boost length in ticks, thrust (m/s²) and top speed factor. */
  ticks: [0, 36, 54, 90],
  accel: [0, 10, 13, 15],
  top: [1, 1.12, 1.2, 1.28],
  /** A wall or car hit harder than this (m/s) during the drift loses the charge. */
  hardHit: 5,
};

/** What counts as cornering: near a bend of the road, with the car's path turning. */
export const CORNERING = {
  /** Road curvature (1/m) that makes a bend: radius under 500 m. */
  minCurv: 1 / 500,
  /** The zone starts this far before a bend and ends this far after it (the exit). */
  before: 15,
  after: 35,
  /** The car's path must turn at least this hard, m/s². */
  minLatAccel: 2,
};

/** Per track: 1 for samples in a corner zone. Built once, from the track alone. */
const zones = new WeakMap<Track, Uint8Array>();

export function cornerZone(track: Track): Uint8Array {
  let z = zones.get(track);
  if (z) return z;
  const n = track.n;
  z = new Uint8Array(n);
  const ds = track.length / n;
  const before = Math.ceil(CORNERING.before / ds);
  const after = Math.ceil(CORNERING.after / ds);
  for (let i = 0; i < n; i++) {
    if (Math.abs(track.curv[i]) < CORNERING.minCurv) continue;
    for (let d = -before; d <= after; d++) z[(i + d + n) % n] = 1;
  }
  zones.set(track, z);
  return z;
}

/** True while the car is really cornering: in a corner zone, its path turning. */
export function isCornering(car: CarState, track: Track): boolean {
  return cornerZone(track)[car.trackIdx] === 1 && Math.abs(car.latAccel) >= CORNERING.minLatAccel;
}

/** Charge level 0-3 for a charge in seconds. */
export function driftLevel(charge: number): number {
  const l = DRIFT_BOOST.levels;
  return charge >= l[2] ? 3 : charge >= l[1] ? 2 : charge >= l[0] ? 1 : 0;
}

function loseCharge(car: CarState, ev: EventBuffer): void {
  const lv = driftLevel(car.driftCharge);
  car.driftCharge = 0;
  if (lv > 0) pushEvent(ev, Ev.DriftLost, car.id, -1, lv, car.x, car.z);
}

/**
 * Build the charge while sliding, pay it out when grip returns. Call each
 * tick after the car's dynamics, with the surface it drove on.
 */
export function stepDriftCharge(car: CarState, surf: SurfaceMix, speed: number, cornering: boolean, ev: EventBuffer): void {
  if (car.spinTicks > 0) {
    if (car.driftCharge > 0) loseCharge(car, ev);
    return;
  }
  if (car.airborne) return;
  if (car.sliding) {
    // Only while cornering, not while recovering from a spin; slippery ground counts for its share only.
    if (!cornering || car.spinCool > 0 || speed < DRIFT_BOOST.minSpeed || Math.abs(car.slip) < DRIFT_BOOST.minSlipDeg * DEG) return;
    const max = DRIFT_BOOST.levels[2];
    if (car.driftCharge >= max) return;
    const before = driftLevel(car.driftCharge);
    car.driftCharge = Math.min(max, car.driftCharge + DT * (1 - surf.slippery));
    const after = driftLevel(car.driftCharge);
    if (after > before) pushEvent(ev, Ev.DriftLevel, car.id, -1, after, car.x, car.z);
    return;
  }
  if (car.driftCharge <= 0) return;
  const lv = driftLevel(car.driftCharge);
  car.driftCharge = 0;
  const fwd = car.vx * Math.sin(car.heading) - car.vz * Math.cos(car.heading);
  if (lv === 0 || fwd < DRIFT_BOOST.minSpeed) return;
  // A stronger boost replaces a weaker one still running.
  if (car.driftBoostTicks === 0 || lv >= car.driftBoostLevel) {
    car.driftBoostTicks = DRIFT_BOOST.ticks[lv];
    car.driftBoostLevel = lv;
  }
  pushEvent(ev, Ev.DriftBoost, car.id, -1, lv, car.x, car.z);
}

/** Hard wall and car hits in this tick's events (from index `from`) lose the charge. */
export function breakDriftCharge(cars: CarState[], ev: EventBuffer, from: number): void {
  const end = ev.count;
  for (let k = from; k < end; k++) {
    const e = ev.list[k];
    if ((e.kind !== Ev.WallHit && e.kind !== Ev.CarHit) || e.value <= DRIFT_BOOST.hardHit) continue;
    const a = cars[e.car];
    if (a && a.driftCharge > 0) loseCharge(a, ev);
    if (e.kind === Ev.CarHit) {
      const b = cars[e.other];
      if (b && b.driftCharge > 0) loseCharge(b, ev);
    }
  }
}

/** Thrust of a running drift boost (the turbo's curve, weaker). Called with the turbo each tick. */
export function stepDriftBoost(car: CarState, t: CarTuning, dt: number): void {
  if (car.driftBoostTicks <= 0) return;
  if (car.spinTicks > 0 || car.wreckTicks > 0) {
    car.driftBoostTicks = 0;
    return;
  }
  car.driftBoostTicks--;
  // A turbo burning at the same time is stronger: no stacking. Braking
  // (longAccel < 0) holds the boost back, so it never pushes into a corner.
  if (car.turboTicks > 0 || car.longAccel < 0) return;
  const lv = car.driftBoostLevel;
  const fx = Math.sin(car.heading);
  const fz = -Math.cos(car.heading);
  const fwd = car.vx * fx + car.vz * fz;
  const top = t.vTop * DRIFT_BOOST.top[lv];
  if (fwd < top) {
    const a = DRIFT_BOOST.accel[lv] * Math.max(0, 1 - (fwd / top) ** 2);
    car.vx += fx * a * dt;
    car.vz += fz * a * dt;
  }
}

/** Forget charge and boost (respawn, tow). */
export function clearDriftBoost(car: CarState): void {
  car.driftCharge = 0;
  car.driftBoostTicks = 0;
  car.driftBoostLevel = 0;
}
