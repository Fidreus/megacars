// Jump ramps: a car on a ramp rides up its slope; driving off the lip keeps
// the climb rate as vertical speed and the car flies until it lands.

import type { Track } from '../track/types.ts';
import type { CarState } from './car.ts';

/** Ramp height under centreline distance `s` (0 = not on a ramp), and its slope. */
export function rampAt(track: Track, s: number, out: { h: number; slope: number }): void {
  out.h = 0;
  out.slope = 0;
  for (const r of track.ramps) {
    if (s >= r.s0 && s <= r.s1) {
      out.slope = r.height / (r.s1 - r.s0);
      out.h = (s - r.s0) * out.slope;
      return;
    }
  }
}

const tmp = { h: 0, slope: 0 };

/**
 * Where to put a car back near distance `s`: never on a ramp or in its
 * landing zone, but far enough before it to get up to jumping speed.
 */
export function safeRespawnS(track: Track, s: number): number {
  for (const r of track.ramps) {
    if (s >= r.s0 - 6 && s <= r.s1 + 45) return r.s0 - 45;
  }
  return s;
}

/** Ride a ramp, or take off from it. Call for cars on the ground after they moved. */
export function stepRamps(car: CarState, track: Track): void {
  if (car.airborne || track.ramps.length === 0) return;
  const i = car.trackIdx;
  const lateral = (car.x - track.px[i]) * track.nx[i] + (car.z - track.pz[i]) * track.nz[i];
  // Where along the centreline the car is now (trackS lags a tick).
  const s = track.s[i] + (car.x - track.px[i]) * track.tx[i] + (car.z - track.pz[i]) * track.tz[i];
  const along = car.vx * track.tx[i] + car.vz * track.tz[i];
  if (Math.abs(lateral) <= track.hw[i]) rampAt(track, s, tmp);
  else tmp.h = 0;
  if (tmp.h > 0) {
    car.y = tmp.h;
    car.vy = Math.max(0, along) * tmp.slope;
    return;
  }
  if (car.y > 0.05) {
    // Off the lip (or the side): fly with the climb rate we had.
    car.airborne = 1;
    if (car.vy <= 0) car.vy = 0.5;
  } else {
    car.y = 0;
    car.vy = 0;
  }
}
