// When computer drivers fire, drop mines and boost. Decisions depend only on
// the world state (and a hash of the tick), so they are predicted exactly.

import { hash3 } from '../math/rng.ts';
import type { Track } from '../track/types.ts';
import type { CarState } from '../sim/car.ts';
import { Btn, type CarInput } from '../sim/input.ts';
import { MineHabit, TurboHabit, effectiveSkill, personaOf } from './persona.ts';
import { notice, Sense } from './reaction.ts';

/** How much harder a driver goes for its rival (its foe) than for anybody else. */
export const FOE_EAGERNESS = 1.6;

/** Share of good chances a driver of this skill takes (checked a few times a second). */
function eagerness(skill: number): number {
  return Math.max(0.1, Math.min(0.35, 0.1 + (skill - 0.72) * 0.9));
}

/** Turbos are kept until this share of the race is left (turbo hoarders). */
export function lateInRace(lap: number, laps: number): boolean {
  return laps <= 0 || lap > laps - Math.max(1, Math.round(laps * 0.4));
}

export function aiWeapons(car: CarState, cars: readonly CarState[], track: Track, tick: number, vTop: number, out: CarInput, laps = 0): void {
  if (car.finished || car.wreckTicks > 0 || car.ghostTicks > 0) return;
  const p = personaOf(car.aiPersona);
  const fx = Math.sin(car.heading);
  const fz = -Math.cos(car.heading);
  const rx = Math.cos(car.heading);
  const rz = Math.sin(car.heading);
  const fwd = car.vx * fx + car.vz * fz;
  // A mine layer waits until somebody is right on its tail.
  const close = p.mines === MineHabit.Close;

  // Who is lined up ahead and who sits on the tail; looked at every tick, so a
  // new target is acted on only after the driver's reaction time.
  let front = -1;
  let rear = -1;
  for (const o of cars) {
    if (o === car || o.ghostTicks > 0 || o.wreckTicks > 0 || o.finished || Math.abs(o.y - car.y) > 1.5) continue;
    const dx = o.x - car.x;
    const dz = o.z - car.z;
    const ahead = dx * fx + dz * fz;
    const side = Math.abs(dx * rx + dz * rz);
    if (front < 0 && ahead >= 6 && ahead <= 42 && side <= 1.4 + ahead * 0.03) front = o.id;
    if (rear < 0 && -ahead >= 4 && -ahead <= (close ? 12 : 22) && side <= 2.6) rear = o.id;
  }
  const seeFront = notice(car, p, Sense.Target, front >= 0, tick);
  const seeRear = notice(car, p, Sense.Tail, rear >= 0, tick);

  // Re-decide eight times a second; between decisions the buttons are released.
  const slot = tick >> 3;
  if ((tick & 7) !== (car.id & 7)) return;
  const eager = eagerness(effectiveSkill(car, p));
  const roll = (salt: number, k: number) => hash3(car.id, slot, salt) < Math.min(0.7, eager * k);

  if (car.missiles > 0 && car.fireCool === 0 && car.spinTicks === 0 && seeFront) {
    if (roll(1, p.aggro * (front === car.aiFoe ? FOE_EAGERNESS : 1))) out.buttons |= Btn.FireFront;
  }
  if (car.mines > 0 && car.mineCool === 0 && seeRear) {
    if (roll(2, p.aggro * (close ? 2.5 : 1) * (rear === car.aiFoe ? FOE_EAGERNESS : 1))) out.buttons |= Btn.FireRear;
  }
  const hoard = p.turbo === TurboHabit.Late;
  const keen = p.turbo === TurboHabit.Eager || (hoard && lateInRace(car.lap, laps));
  if (car.turbos > 0 && car.turboTicks === 0 && car.sliding === 0 && fwd > 22 && fwd < vTop * 0.98 && !(hoard && !keen)) {
    // Only with a long straight ahead (turbo lovers settle for a shorter one).
    let straight = true;
    let k = car.trackIdx;
    const need = keen ? 70 : 110;
    for (let d = 0; d < need; d++) {
      if (Math.abs(track.line.curv[k]) > 0.005) {
        straight = false;
        break;
      }
      k = k + 1 === track.n ? 0 : k + 1;
    }
    if (straight && roll(3, keen ? 3 : 1)) out.buttons |= Btn.Turbo;
  }
}
