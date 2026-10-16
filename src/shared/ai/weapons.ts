// When computer drivers fire, drop mines and boost. Decisions depend only on
// the world state (and a hash of the tick), so they are predicted exactly.

import { hash3 } from '../math/rng.ts';
import type { Track } from '../track/types.ts';
import type { CarState } from '../sim/car.ts';
import { Btn, type CarInput } from '../sim/input.ts';

/** Share of good chances a driver of this skill takes (checked a few times a second). */
function eagerness(skill: number): number {
  return Math.max(0.1, Math.min(0.35, 0.1 + (skill - 0.72) * 0.9));
}

export function aiWeapons(car: CarState, cars: readonly CarState[], track: Track, tick: number, vTop: number, out: CarInput): void {
  if (car.finished || car.wreckTicks > 0 || car.ghostTicks > 0) return;
  // Re-decide eight times a second; between decisions the buttons are released.
  const slot = tick >> 3;
  if ((tick & 7) !== (car.id & 7)) return;
  const roll = (salt: number) => hash3(car.id, slot, salt) < eagerness(car.aiSkill);
  const fx = Math.sin(car.heading);
  const fz = -Math.cos(car.heading);
  const rx = Math.cos(car.heading);
  const rz = Math.sin(car.heading);
  const fwd = car.vx * fx + car.vz * fz;

  if (car.missiles > 0 && car.fireCool === 0 && car.spinTicks === 0) {
    for (const o of cars) {
      if (o === car || o.ghostTicks > 0 || o.wreckTicks > 0 || o.finished || Math.abs(o.y - car.y) > 1.5) continue;
      const dx = o.x - car.x;
      const dz = o.z - car.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < 6 || ahead > 42) continue;
      if (Math.abs(dx * rx + dz * rz) > 1.4 + ahead * 0.03) continue;
      if (roll(1)) out.buttons |= Btn.FireFront;
      break;
    }
  }
  if (car.mines > 0 && car.mineCool === 0) {
    for (const o of cars) {
      if (o === car || o.ghostTicks > 0 || o.wreckTicks > 0 || o.finished || Math.abs(o.y - car.y) > 1.5) continue;
      const dx = o.x - car.x;
      const dz = o.z - car.z;
      const behind = -(dx * fx + dz * fz);
      if (behind < 4 || behind > 22) continue;
      if (Math.abs(dx * rx + dz * rz) > 2.6) continue;
      if (roll(2)) out.buttons |= Btn.FireRear;
      break;
    }
  }
  if (car.turbos > 0 && car.turboTicks === 0 && car.sliding === 0 && fwd > 22 && fwd < vTop * 0.98) {
    // Only with a long straight ahead.
    let straight = true;
    let k = car.trackIdx;
    for (let d = 0; d < 110; d++) {
      if (Math.abs(track.line.curv[k]) > 0.005) {
        straight = false;
        break;
      }
      k = k + 1 === track.n ? 0 : k + 1;
    }
    if (straight && roll(3)) out.buttons |= Btn.Turbo;
  }
}
