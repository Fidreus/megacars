// Jump ramps and bridges: a car on the ground rides the road's height (ramps
// across the road, bridge slopes and decks). Where the road drops away faster
// than the car can follow (a ramp's lip, the edge of a broken bridge) it keeps
// its climb rate as vertical speed and flies until it lands.

import { elevationAt } from '../track/builder.ts';
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

/** What is under a car: road height, its slope along the track, and a broken bridge's hole. */
export interface Ground {
  h: number;
  slope: number;
  gap: number;
  /** The bridge's share of h. */
  deck: number;
}

export function makeGround(): Ground {
  return { h: 0, slope: 0, gap: 0, deck: 0 };
}

const tmp = { h: 0, slope: 0 };
const elev = { h: 0, slope: 0, gap: 0 };

/** The ground under a car on its own stretch of road (bridges keep the levels apart). */
export function groundUnder(car: CarState, track: Track, out: Ground): void {
  const i = car.trackIdx;
  // Where along the centreline the car is now (trackS lags a tick).
  const s = track.s[i] + (car.x - track.px[i]) * track.tx[i] + (car.z - track.pz[i]) * track.tz[i];
  out.h = 0;
  out.slope = 0;
  out.gap = 0;
  out.deck = 0;
  if (track.bridges.length) {
    elevationAt(track, s, elev);
    out.h = out.deck = elev.h;
    out.slope = elev.slope;
    out.gap = elev.gap;
  }
  if (track.ramps.length) {
    const lateral = (car.x - track.px[i]) * track.nx[i] + (car.z - track.pz[i]) * track.nz[i];
    if (Math.abs(lateral) <= track.hw[i]) {
      rampAt(track, s, tmp);
      out.h += tmp.h;
      out.slope += tmp.slope;
    }
  }
}

/**
 * Where to put a car back near distance `s`: never on a ramp or in its
 * landing zone, but far enough before it to get up to jumping speed. Same
 * for a broken bridge, with a longer run-up.
 */
export function safeRespawnS(track: Track, s: number): number {
  for (const r of track.ramps) {
    if (s >= r.s0 - 6 && s <= r.s1 + 45) return r.s0 - 45;
  }
  for (const b of track.bridges) {
    if (!b.gap) continue;
    const start = b.s - b.span - b.ramp;
    if (s >= start - 6 && s <= b.s + b.span + b.ramp) return start - 70;
  }
  return s;
}

/** Height the road drops per tick before a car leaves the ground. */
const TAKEOFF_DROP = 0.3;

/** Ride the road's height, or take off. Call for cars on the ground after they moved. */
export function stepRamps(car: CarState, track: Track, g: Ground): void {
  if (car.airborne) return;
  if (g.h > 0 && !g.gap && car.y - g.h < TAKEOFF_DROP) {
    const i = car.trackIdx;
    const along = car.vx * track.tx[i] + car.vz * track.tz[i];
    car.y = g.h;
    car.vy = along * g.slope;
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

/** A flying car that dropped into a broken bridge's hole or hit its far edge. */
export function fellOff(car: CarState, g: Ground): boolean {
  if (!car.airborne) return false;
  if (g.gap) return car.y < 1;
  return g.deck > car.y + 0.8;
}
