// Slipstream: a car tucked in behind another, both fast and going the same
// way, is pulled along: a little more top speed and acceleration. The wake is
// a narrow zone behind the leading car along its direction of travel, a bit
// wider further back. The effect builds while in the wake and fades outside.

import { DT } from '../config/constants.ts';
import type { SurfaceMix } from '../config/surfaces.ts';
import type { CarState } from './car.ts';

export const SLIPSTREAM = {
  /** Wake from this far behind the other car's centre to this far (m). */
  near: 4,
  far: 24,
  /** Half width of the wake at its near and far end (m). */
  halfNear: 1.4,
  halfFar: 3.2,
  /** Both cars faster than this (m/s). */
  minSpeed: 20,
  /** Directions of travel within this angle. */
  maxAngleDeg: 25,
  /** Seconds to full strength in the wake, and to nothing outside it. */
  build: 0.7,
  fade: 0.3,
  /** At full strength: top speed and acceleration gained (shares). */
  top: 0.06,
  accel: 0.08,
};

const COS_MAX = Math.cos((SLIPSTREAM.maxAngleDeg * Math.PI) / 180);

function usable(c: CarState): boolean {
  return c.wreckTicks === 0 && c.ghostTicks === 0 && c.airborne === 0;
}

/** True when `car` is in the wake of `o`. */
export function inWake(car: CarState, o: CarState): boolean {
  if (!usable(o) || Math.abs(o.y - car.y) > 1.5) return false;
  const so = Math.hypot(o.vx, o.vz);
  if (so < SLIPSTREAM.minSpeed) return false;
  const ux = o.vx / so;
  const uz = o.vz / so;
  const sc = Math.hypot(car.vx, car.vz);
  if ((car.vx * ux + car.vz * uz) / sc < COS_MAX) return false;
  const dx = car.x - o.x;
  const dz = car.z - o.z;
  const behind = -(dx * ux + dz * uz);
  if (behind < SLIPSTREAM.near || behind > SLIPSTREAM.far) return false;
  const side = Math.abs(dx * uz - dz * ux);
  const f = (behind - SLIPSTREAM.near) / (SLIPSTREAM.far - SLIPSTREAM.near);
  return side <= SLIPSTREAM.halfNear + (SLIPSTREAM.halfFar - SLIPSTREAM.halfNear) * f;
}

/** Update every car's slipstream strength (`draft`, 0-1). Call once per racing tick, before the cars move. */
export function stepSlipstream(cars: readonly CarState[]): void {
  for (const car of cars) {
    let wake = false;
    if (usable(car) && Math.hypot(car.vx, car.vz) >= SLIPSTREAM.minSpeed) {
      for (const o of cars) {
        if (o !== car && inWake(car, o)) {
          wake = true;
          break;
        }
      }
    }
    car.draft = wake ? Math.min(1, car.draft + DT / SLIPSTREAM.build) : Math.max(0, car.draft - DT / SLIPSTREAM.fade);
    if (car.wreckTicks > 0) car.draft = 0;
  }
}

/** Fold the slipstream into the surface the car drives on. */
export function applySlipstream(surf: SurfaceMix, draft: number): void {
  if (draft <= 0) return;
  surf.vTop *= 1 + SLIPSTREAM.top * draft;
  surf.accel *= 1 + SLIPSTREAM.accel * draft;
}
