// Builds the judge's `Frame` for one tick from the car, the buttons it was
// driven with and the tick's simulation events.

import type { CarState } from '../../../shared/sim/car.ts';
import { driftLevel } from '../../../shared/sim/driftBoost.ts';
import { Ev, type EventBuffer } from '../../../shared/sim/events.ts';
import { Btn, type CarInput } from '../../../shared/sim/input.ts';
import { emptyFrame, type Frame } from './lessons.ts';

const RAD = 180 / Math.PI;

/** Fill `out` (reused every tick) for this car; `dist0` is its raceDist when the attempt began. */
export function buildFrame(out: Frame, car: CarState, inp: CarInput, ev: EventBuffer, tick: number, dist0: number): Frame {
  out.tick = tick;
  out.s = car.trackS;
  out.dist = car.raceDist - dist0;
  out.speed = Math.hypot(car.vx, car.vz);
  out.gas = inp.throttle > 0.5;
  out.brake = inp.brake > 0.5;
  out.drift = (inp.buttons & Btn.Drift) !== 0;
  out.sliding = car.sliding === 1;
  out.slipDeg = Math.abs(car.slip) * RAD;
  out.charge = car.driftCharge;
  out.level = driftLevel(car.driftCharge);
  out.wall = 0;
  out.levelUp = out.boost = out.lost = 0;
  for (let k = 0; k < ev.count; k++) {
    const e = ev.list[k];
    if (e.car !== car.id) continue;
    if (e.kind === Ev.WallHit) out.wall = Math.max(out.wall, e.value);
    else if (e.kind === Ev.DriftLevel) out.levelUp = e.value;
    else if (e.kind === Ev.DriftBoost) out.boost = e.value;
    else if (e.kind === Ev.DriftLost) out.lost = e.value;
  }
  return out;
}

export { emptyFrame };
