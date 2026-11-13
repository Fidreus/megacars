// Particles for the drift boost and slipstream: sparks off the rear wheels in
// the colour of the drift charge level, a coloured flame while the boost
// burns (and a burst when it fires), and speed streaks around a car in a wake.

import type { CarState } from '../../shared/sim/car.ts';
import { driftLevel } from '../../shared/sim/driftBoost.ts';
import type { Particles } from './particles.ts';

const R = Math.random;

/** HDR spark colours per level (index 1-3): blue, orange, purple. */
const LEVEL_RGB: readonly (readonly [number, number, number])[] = [
  [3, 3, 3], [1.2, 2.8, 6], [6, 2.6, 0.5], [4.6, 1.2, 6],
];

/** Per-car effects; call once per tick for each car. `fx/fz` nose, `rx/rz` right. */
export function driveFx(p: Particles, car: CarState, s: number, fx: number, fz: number, rx: number, rz: number): void {
  if (car.wreckTicks > 0) return;
  // Sparks from the rear wheels while a charged drift holds.
  const level = driftLevel(car.driftCharge);
  if (level > 0 && car.sliding && s > 10 && !car.airborne) {
    const c = LEVEL_RGB[level];
    for (const side of [-0.97, 0.97]) {
      const wx = car.x + rx * side - fx * 1.45;
      const wz = car.z + rz * side - fz * 1.45;
      const n = 1 + (R() < level * 0.3 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        p.spawn(
          wx + (R() - 0.5) * 0.6, car.y + 0.25, wz + (R() - 0.5) * 0.6,
          car.vx * 0.5 + (R() - 0.5) * 6, 2 + R() * 3, car.vz * 0.5 + (R() - 0.5) * 6,
          0.25 + R() * 0.2, 2.4, 1, c[0], c[1], c[2], -16, 1.2,
        );
      }
    }
  }
  // Drift boost: a flame in the level colour out of both pipes.
  if (car.driftBoostTicks > 0 && car.turboTicks === 0) {
    const c = LEVEL_RGB[car.driftBoostLevel] ?? LEVEL_RGB[1];
    for (const side of [-0.35, 0.35]) {
      const ex = car.x - fx * 2.4 + rx * side;
      const ez = car.z - fz * 2.4 + rz * side;
      p.spawn(
        ex, car.y + 0.42, ez, car.vx * 0.7 - fx * 8 + (R() - 0.5), 0.3, car.vz * 0.7 - fz * 8 + (R() - 0.5),
        0.08 + R() * 0.07, 2, 0.6, c[0], c[1], c[2], 0, 4,
      );
    }
  }
  // Slipstream: thin streaks of air rushing past.
  if (car.draft > 0.2 && s > 15 && R() < car.draft * 0.9) {
    const side = (R() < 0.5 ? -1 : 1) * (1.4 + R() * 1.4);
    const ahead = -1 + R() * 5;
    const x = car.x + rx * side + fx * ahead;
    const z = car.z + rz * side + fz * ahead;
    const y = car.y + 0.4 + R() * 1.2;
    // A short dotted line along the direction of travel, left in the air as the car passes.
    for (let k = 0; k < 3; k++) {
      p.spawn(x - fx * k * 0.7, y, z - fz * k * 0.7, 0, 0, 0, 0.12 + R() * 0.06, 1.2, 1, 0.92, 0.96, 1, 0, 0);
    }
  }
}

/** A burst of coloured sparks behind the car when a drift boost fires. */
export function driftBoostBurst(p: Particles, car: CarState, level: number): void {
  const c = LEVEL_RGB[level] ?? LEVEL_RGB[1];
  const fx = Math.sin(car.heading);
  const fz = -Math.cos(car.heading);
  const ex = car.x - fx * 2.4;
  const ez = car.z - fz * 2.4;
  for (let k = 0; k < 8 + level * 6; k++) {
    const a = R() * Math.PI * 2;
    const sp = 2 + R() * 5;
    p.spawn(
      ex, car.y + 0.5, ez, car.vx * 0.5 - fx * 6 + Math.cos(a) * sp, 1 + R() * 3, car.vz * 0.5 - fz * 6 + Math.sin(a) * sp,
      0.25 + R() * 0.25, 2.2, 0.8, c[0], c[1], c[2], -10, 2.5,
    );
  }
}
