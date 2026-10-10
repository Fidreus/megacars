// The complete simulation state. Everything that affects the future lives
// here, so a world can be copied, sent over the network and re-simulated.

import type { Track } from '../track/types.ts';
import { createCar, type CarState } from './car.ts';
import { makeEventBuffer, type EventBuffer } from './events.ts';
import { resetProgress } from './race.ts';

export interface World {
  tick: number;
  rng: number;
  cars: CarState[];
  events: EventBuffer;
}

export function createWorld(track: Track, carCount: number, seed: number): World {
  const cars: CarState[] = [];
  for (let i = 0; i < carCount; i++) {
    const slot = track.grid[i % track.grid.length];
    const car = createCar(i, slot.x, slot.z, slot.heading);
    resetProgress(car, track);
    cars.push(car);
  }
  return { tick: 0, rng: seed | 0, cars, events: makeEventBuffer() };
}

/** Put a car back on the centreline near its current progress, stopped. */
export function respawnCar(car: CarState, track: Track, s: number): void {
  const i = Math.max(0, Math.min(track.n - 1, Math.round(sampleNear(track, s))));
  car.x = track.px[i];
  car.z = track.pz[i];
  car.y = 0;
  car.vx = car.vz = car.vy = 0;
  car.heading = Math.atan2(track.tx[i], -track.tz[i]);
  car.angVel = 0;
  car.steer = 0;
  car.sliding = 0;
  car.modeTicks = 0;
  car.spinTicks = 0;
  car.slip = 0;
  car.trackIdx = i;
  car.trackS = track.s[i];
}

function sampleNear(track: Track, s: number): number {
  const L = track.length;
  s = ((s % L) + L) % L;
  return (s / L) * track.n;
}
