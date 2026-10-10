// One fixed simulation tick for the whole world.

import { DT } from '../config/constants.ts';
import { makeSurfaceMix, mixSurfaces, type SurfaceId } from '../config/surfaces.ts';
import type { CarTuning } from '../config/tuning.ts';
import { aiDrive } from '../ai/driver.ts';
import { surfaceAt } from '../track/builder.ts';
import type { Track } from '../track/types.ts';
import { stepCarDynamics, type CarState } from './car.ts';
import { clampSpeed, collideCarWithWalls, collideCars } from './collision.ts';
import { NEUTRAL_INPUT, neutralInput, type CarInput } from './input.ts';
import { updateProgress } from './race.ts';
import type { World } from './world.ts';

const aiInput = neutralInput();
const surfMix = makeSurfaceMix();

export function sampleCarSurface(car: CarState, track: Track, t: CarTuning): void {
  const fx = Math.sin(car.heading);
  const fz = -Math.cos(car.heading);
  car.surfFront = surfaceAt(track, car.x + fx * t.circleOffset, car.z + fz * t.circleOffset);
  car.surfRear = surfaceAt(track, car.x - fx * t.circleOffset, car.z - fz * t.circleOffset);
}

/**
 * Advance the world by one tick. `inputs[i]` drives car i unless the car is
 * AI-driven; `tunings[i]` (or tunings[0]) holds its effective handling.
 */
export function stepWorld(w: World, track: Track, inputs: readonly (CarInput | undefined)[], tunings: readonly CarTuning[]): void {
  w.events.count = 0;
  const cars = w.cars;
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    const t = tunings[i] ?? tunings[0];
    let inp: CarInput = inputs[i] ?? NEUTRAL_INPUT;
    sampleCarSurface(car, track, t);
    mixSurfaces(car.surfFront as SurfaceId, car.surfRear as SurfaceId, surfMix);
    if (car.aiDriven) {
      aiDrive(car, track, t, surfMix, aiInput);
      inp = aiInput;
    }
    stepCarDynamics(car, inp, t, surfMix, DT);
    car.prevButtons = inp.buttons;
  }
  for (let i = 0; i < cars.length; i++) {
    collideCarWithWalls(cars[i], tunings[i] ?? tunings[0], track.walls, w.events);
  }
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      collideCars(cars[i], cars[j], tunings[i] ?? tunings[0], tunings[j] ?? tunings[0], w.events);
    }
  }
  for (let i = 0; i < cars.length; i++) {
    clampSpeed(cars[i]);
    updateProgress(cars[i], track, w.tick, w.events);
  }
  w.tick++;
}
