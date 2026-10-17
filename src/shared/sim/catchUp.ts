// Catch-up boost pads: arrows painted across the road on the straights. They
// only work for a car that has fallen far behind the leader, and give it a
// short turbo, so a driver left behind (a wreck, a spin, a fall) can get
// back into the fight. Everything here is deterministic world state.

import type { Track } from '../track/types.ts';
import { sampleU } from '../track/pit.ts';
import type { CarState } from './car.ts';
import { Ev, pushEvent, type EventBuffer } from './events.ts';

export const CATCH_UP = {
  /** Behind the leader by at least this share of a lap (and this many metres) to use the pads. */
  lapShare: 0.2,
  minGap: 120,
  /** Turbo ticks a pad gives. */
  ticks: 60,
  /** Pad length along the road. */
  length: 5,
  /** At most this many pads a lap, at least this far apart. */
  maxPads: 4,
  spacing: 160,
  /** Straights shorter than this get no pad. */
  minStraight: 24,
};

/** How far behind the leader (metres of race distance) a car must be to use the pads. */
export function catchUpGap(track: Track): number {
  return Math.max(CATCH_UP.minGap, track.length * CATCH_UP.lapShare);
}

/** The race distance of the car furthest ahead. */
export function leaderDistance(cars: readonly CarState[]): number {
  let best = -Infinity;
  for (const c of cars) best = Math.max(best, c.raceDist);
  return best;
}

/** True when this car is far enough behind to use the pads. */
export function farBehind(track: Track, car: CarState, leader: number): boolean {
  return !car.finished && leader - car.raceDist >= catchUpGap(track);
}

/**
 * Where the pads go (start of each, along s): a little way into the
 * straights, on the ground, not on the start straight (grid and pit) and
 * spread round the lap.
 */
export function placeBoostPads(track: Track): number[] {
  const { n, curv, deck, s } = track;
  const straight = (i: number) => Math.abs(curv[i]) < 1e-6 && deck[i] === 0;
  // Runs of straight samples, as [first, length] (walking from a corner so no run wraps).
  let start = 0;
  while (start < n && straight(start)) start++;
  const runs: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (!straight(i)) continue;
    const prev = (i - 1 + n) % n;
    if (straight(prev) && k > 0) continue;
    let len = 0;
    while (len < n && straight((i + len) % n)) len++;
    runs.push([i, len]);
  }
  const candidates: number[] = [];
  for (const [i, len] of runs) {
    if (len < CATCH_UP.minStraight) continue;
    // A third of the way in (out of the corner, before the next braking point).
    const at = s[(i + Math.min(Math.floor(len / 3), 40)) % n];
    const u = sampleU(track, (i + Math.floor(len / 3)) % n);
    if (u > -80 && u < 80) continue;
    if (track.ramps.some((r) => at > r.s0 - 30 && at < r.s1 + 30)) continue;
    candidates.push(at);
  }
  // Spread them round the lap: each next pad as far as possible from the
  // others (and from the start line), until none is far enough away.
  const gap = (a: number, b: number) => {
    const d = Math.abs(a - b);
    return Math.min(d, track.length - d);
  };
  const pads: number[] = [];
  while (pads.length < CATCH_UP.maxPads) {
    let best = -1;
    let bestGap = CATCH_UP.spacing;
    for (const c of candidates) {
      const g = Math.min(gap(c, 0), ...pads.map((p) => gap(c, p)));
      if (g >= bestGap) {
        bestGap = g;
        best = c;
      }
    }
    if (best < 0) break;
    pads.push(best);
  }
  return pads.sort((a, b) => a - b);
}

/** Boost a far-behind car that is driving over a pad. Call each tick for cars on the ground. */
export function stepBoostPads(track: Track, car: CarState, leader: number, ev: EventBuffer): void {
  if (car.airborne || car.wreckTicks > 0 || !farBehind(track, car, leader)) return;
  for (const p of track.boosts) {
    let d = car.trackS - p;
    if (d < 0) d += track.length;
    if (d > CATCH_UP.length) continue;
    // Only the first tick on the pad makes the sound; the boost lasts from the last.
    if (car.turboTicks < CATCH_UP.ticks - 1) pushEvent(ev, Ev.Turbo, car.id, -1, 1, car.x, car.z);
    car.turboTicks = Math.max(car.turboTicks, CATCH_UP.ticks);
    return;
  }
}
