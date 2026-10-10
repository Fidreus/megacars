// Turns simulation state and events into particles: tyre smoke when drifting,
// dust off-road, sparks on impacts and an exhaust backfire when a drift kicks in.

import { DT } from '../../shared/config/constants.ts';
import { SURFACES, Surface } from '../../shared/config/surfaces.ts';
import { surfaceAt } from '../../shared/track/builder.ts';
import type { Track } from '../../shared/track/types.ts';
import { Ev } from '../../shared/sim/events.ts';
import { ShotKind } from '../../shared/sim/weapons.ts';
import type { World } from '../../shared/sim/world.ts';
import type { Particles } from './particles.ts';

const PAVED = new Set<number>([Surface.Asphalt, Surface.Curb, Surface.Wet]);
const R = Math.random;

export class Effects {
  private readonly particles: Particles;
  private readonly track: Track;
  private readonly prevSliding: number[] = [];

  constructor(particles: Particles, track: Track) {
    this.particles = particles;
    this.track = track;
  }

  /** Call once per simulation tick, after stepWorld. */
  tick(world: World): void {
    const p = this.particles;
    p.time.value = world.tick * DT;
    for (const car of world.cars) {
      const s = Math.hypot(car.vx, car.vz);
      const fx = Math.sin(car.heading);
      const fz = -Math.cos(car.heading);
      const rx = Math.cos(car.heading);
      const rz = Math.sin(car.heading);
      const slipDeg = (Math.abs(car.slip) * 180) / Math.PI;
      const sliding = car.sliding === 1 || car.spinTicks > 0;

      for (const side of [-0.97, 0.97]) {
        const wx = car.x + rx * side - fx * 1.42;
        const wz = car.z + rz * side - fz * 1.42;
        const surf = surfaceAt(this.track, wx, wz);
        if (PAVED.has(surf)) {
          const smoke = sliding && slipDeg > 8 && s > 6 ? Math.min(1, 0.25 + (slipDeg - 8) / 25) : car.longAccel < -12 && s > 10 ? 0.25 : 0;
          const puffs = smoke > 0 ? (R() < smoke ? 1 : 0) + (R() < smoke * 0.6 ? 1 : 0) : 0;
          for (let k = 0; k < puffs; k++) {
            const g = 0.72 + R() * 0.16;
            p.spawn(
              wx + (R() - 0.5) * 0.8, 0.35, wz + (R() - 0.5) * 0.8,
              car.vx * 0.15 + (R() - 0.5) * 3, 0.9 + R() * 1.4, car.vz * 0.15 + (R() - 0.5) * 3,
              1.0 + R() * 1.0, 3, 12 + R() * 6, g, g, g * 1.04, 0.5, 1.4,
            );
          }
        } else if (SURFACES[surf].dusty && s > 5 && R() < Math.min(0.9, s / 28)) {
          const c = surf === Surface.Snow ? [0.9, 0.92, 0.95] : surf === Surface.Gravel ? [0.62, 0.52, 0.36] : [0.42, 0.45, 0.28];
          p.spawn(
            wx + (R() - 0.5) * 0.8, 0.3, wz + (R() - 0.5) * 0.8,
            -car.vx * 0.08 + (R() - 0.5) * 2, 0.6 + R(), -car.vz * 0.08 + (R() - 0.5) * 2,
            0.6 + R() * 0.6, 2, 6, c[0], c[1], c[2], 0.2, 1.8,
          );
        }
      }

      // Backfire when a drift kicks in.
      const was = this.prevSliding[car.id] ?? 0;
      if (car.sliding && !was && s > 12) {
        const ex = car.x - fx * 2.35;
        const ez = car.z - fz * 2.35;
        for (let k = 0; k < 7; k++) {
          const hot = R() < 0.5;
          p.spawn(
            ex + rx * (R() - 0.5) * 1.1, 0.4, ez + rz * (R() - 0.5) * 1.1,
            car.vx * 0.6 - fx * (4 + R() * 4) + (R() - 0.5) * 2, 0.5 + R(), car.vz * 0.6 - fz * (4 + R() * 4) + (R() - 0.5) * 2,
            0.14 + R() * 0.16, 3, 1, hot ? 6 : 5, hot ? 3 : 1.4, hot ? 0.8 : 0.2, 0, 3,
          );
        }
        for (let k = 0; k < 3; k++) {
          p.spawn(ex, 0.5, ez, car.vx * 0.4 + (R() - 0.5) * 2, 1 + R(), car.vz * 0.4 + (R() - 0.5) * 2, 0.5 + R() * 0.3, 2, 5, 0.22, 0.22, 0.24, 0.4, 2);
        }
      }
      this.prevSliding[car.id] = car.sliding;

      // Turbo: a blue-white flame out of both pipes.
      if (car.turboTicks > 0 && car.wreckTicks === 0) {
        for (const side of [-0.35, 0.35]) {
          const ex = car.x - fx * 2.4 + rx * side;
          const ez = car.z - fz * 2.4 + rz * side;
          p.spawn(
            ex, 0.42, ez, car.vx * 0.7 - fx * 9 + (R() - 0.5), 0.3, car.vz * 0.7 - fz * 9 + (R() - 0.5),
            0.1 + R() * 0.08, 2.2, 0.6, 2.2, 3.2, 6, 0, 4,
          );
        }
      }
      // A burning wreck, or smoke from a badly damaged engine.
      if (car.wreckTicks > 0) {
        p.spawn(car.x + (R() - 0.5), 1, car.z + (R() - 0.5), (R() - 0.5) * 1.5, 3 + R() * 2, (R() - 0.5) * 1.5,
          1.6 + R(), 3, 16, 0.12, 0.11, 0.12, -0.5, 0.8);
        if (R() < 0.7) {
          p.spawn(car.x + (R() - 0.5) * 1.6, 0.8, car.z + (R() - 0.5) * 2.4, (R() - 0.5) * 2, 2 + R() * 3, (R() - 0.5) * 2,
            0.3 + R() * 0.3, 3, 1, 6, 2.4 + R(), 0.3, 0, 2);
        }
      } else if (car.damage > 0.6 && R() < (car.damage - 0.6) * 1.6) {
        const g = 0.35 + R() * 0.15;
        p.spawn(car.x + fx * 1.6, 1, car.z + fz * 1.6, car.vx * 0.3 + (R() - 0.5), 2 + R(), car.vz * 0.3 + (R() - 0.5),
          0.8 + R() * 0.6, 2, 9, g, g, g, -0.5, 1.2);
      }
    }

    // Missile exhaust trails.
    for (const sh of world.shots) {
      if (sh.kind !== ShotKind.Missile) continue;
      const sp = Math.hypot(sh.vx, sh.vz) || 1;
      const bx = sh.x - (sh.vx / sp) * 0.9;
      const bz = sh.z - (sh.vz / sp) * 0.9;
      for (let k = 0; k < 2; k++) {
        const t = R();
        const x = bx - sh.vx * DT * t;
        const z = bz - sh.vz * DT * t;
        const g = 0.8 + R() * 0.15;
        p.spawn(x, 0.75, z, (R() - 0.5) * 1.2, 0.4 + R() * 0.6, (R() - 0.5) * 1.2, 0.5 + R() * 0.5, 1.5, 6, g, g, g, 0, 1.5);
      }
      p.spawn(bx, 0.75, bz, -sh.vx * 0.05, 0, -sh.vz * 0.05, 0.07, 2.5, 1, 6, 3, 0.6, 0, 0);
    }

    const ev = world.events;
    for (let k = 0; k < ev.count; k++) {
      const e = ev.list[k];
      if (e.kind === Ev.Explosion || e.kind === Ev.Wreck) {
        this.explosion(e.x, e.z, e.kind === Ev.Wreck ? 1.6 : e.value === 3 ? 0.7 : 1);
        continue;
      }
      if ((e.kind === Ev.WallHit || e.kind === Ev.CarHit) && e.value > 2.5) {
        const car = world.cars[e.car];
        const n = Math.min(26, Math.round(e.value * 2));
        for (let i = 0; i < n; i++) {
          const a = R() * Math.PI * 2;
          const sp = 3 + R() * 7;
          p.spawn(
            e.x, 0.5 + R() * 0.4, e.z,
            Math.cos(a) * sp + car.vx * 0.3, 2 + R() * 6, Math.sin(a) * sp + car.vz * 0.3,
            0.25 + R() * 0.35, 1.5, 1, 5, 3.2, 1, -22, 0.4,
          );
        }
      }
    }
  }

  /** Fireball, smoke and debris; `size` 1 = a missile hit. */
  explosion(x: number, z: number, size: number): void {
    const p = this.particles;
    const n = Math.round(26 * size);
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2;
      const sp = (2 + R() * 7) * size;
      const hot = R();
      p.spawn(
        x + (R() - 0.5), 0.6 + R(), z + (R() - 0.5),
        Math.cos(a) * sp, 2 + R() * 6 * size, Math.sin(a) * sp,
        0.25 + R() * 0.35, 4 * size, 7 * size, 6, 1.6 + hot * 2.5, 0.2 + hot * 0.6, -2, 3,
      );
    }
    for (let i = 0; i < n * 0.6; i++) {
      const a = R() * Math.PI * 2;
      const sp = (1 + R() * 3) * size;
      const g = 0.1 + R() * 0.12;
      p.spawn(x, 1, z, Math.cos(a) * sp, 2 + R() * 3, Math.sin(a) * sp, 1.2 + R() * 1.2, 4 * size, 14 * size, g, g, g * 1.1, -0.4, 1);
    }
    for (let i = 0; i < 14 * size; i++) {
      const a = R() * Math.PI * 2;
      const sp = 6 + R() * 10;
      p.spawn(x, 0.8, z, Math.cos(a) * sp, 5 + R() * 8, Math.sin(a) * sp, 0.6 + R() * 0.5, 1.4, 1, 5, 3, 1, -22, 0.3);
    }
  }
}
