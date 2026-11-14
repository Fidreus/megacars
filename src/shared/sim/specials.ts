// Special items: one held at a time in a single slot, used with their own
// button. A HOMING MISSILE locks onto the nearest car ahead and steers after
// it with a limited turn rate; an OIL SLICK is a puddle dropped behind that
// makes the road under it oil (through the surface system, so the tyres, the
// computer drivers and the drift rules treat it like a painted oil patch); a
// SHIELD stops missile and mine hits for a few seconds and softens knocks.
// Flying missiles and lying slicks are shots (weapons.ts); the held item and
// the running shield are car state. All of it is world state.

import { Surface } from '../config/surfaces.ts';
import type { CarTuning } from '../config/tuning.ts';
import { headingOf, wrapAngle } from '../math/angle.ts';
import { inPitArea, type Pit } from '../track/pit.ts';
import type { CarState } from './car.ts';
import { Ev, pushEvent, type EventBuffer } from './events.ts';
import { Btn, type CarInput } from './input.ts';
import { allocShot, ShotKind, WEAPON, type Shot } from './weapons.ts';
import { DMath } from '../math/dmath.ts';

/** What the special slot holds (also the shop's and the HUD's order). */
export const SpecialItem = { None: 0, Homing: 1, Oil: 2, Shield: 3 } as const;

export const SPECIAL_NAMES: Record<number, string> = {
  [SpecialItem.Homing]: 'HOMING MISSILE',
  [SpecialItem.Oil]: 'OIL SLICK',
  [SpecialItem.Shield]: 'SHIELD',
};

export const SPECIAL = {
  /** Lock: the nearest car ahead within this range (m) and half-angle (rad) of the nose. */
  lockRange: 110,
  lockCone: 0.5,
  /** Ignore cars closer than this ahead (they would be hit straight anyway). */
  lockMin: 4,
  /** Speed of a homing missile (plus some of the car's own, like a missile). */
  homingSpeed: 46,
  /** Turn rate (rad/s): a car in a hard corner or a drift turns faster than this. */
  homingTurn: 1.9,
  /** The lock is lost when the target is further than this (rad) off the missile's nose. */
  seekCone: 1.0,
  homingLife: 190,
  /** Height difference (m) at which the lock is lost: no following a car onto another bridge level. */
  levelGap: 1.2,
  /** Oil slick: life (20 s), radius, how far behind the car it lands, owner's grace. */
  oilLife: 1200,
  oilRadius: 3.3,
  oilDrop: 4.8,
  oilGrace: 75,
  /** Shield: 5 s; knocks against walls and cars do this share of their damage. */
  shieldTicks: 300,
  shieldKnock: 0.35,
  /** Push a blocked shot gives the shielded car (m/s). */
  shieldShove: 1.5,
};

/** True for a car a homing missile may be locked onto. */
function targetable(c: CarState): boolean {
  return c.ghostTicks === 0 && c.wreckTicks === 0 && !c.finished;
}

/** The car a homing missile fired now would lock onto, or -1. */
export function lockTarget(car: CarState, cars: readonly CarState[], pit: Pit | null): number {
  const fx = DMath.sin(car.heading);
  const fz = -DMath.cos(car.heading);
  let best = -1;
  let bestD = SPECIAL.lockRange;
  for (const o of cars) {
    if (o === car || !targetable(o) || Math.abs(o.y - car.y) > SPECIAL.levelGap) continue;
    const dx = o.x - car.x;
    const dz = o.z - car.z;
    const ahead = dx * fx + dz * fz;
    if (ahead < SPECIAL.lockMin) continue;
    const d = DMath.hypot(dx, dz);
    if (d >= bestD) continue;
    const side = Math.abs(dx * fz - dz * fx);
    if (DMath.atan2(side, ahead) > SPECIAL.lockCone) continue;
    if (inPitArea(pit, o.x, o.z)) continue;
    best = o.id;
    bestD = d;
  }
  return best;
}

/**
 * Use the held special on a press of its button. Called with the other
 * weapons (same start grace, nothing in the pit lane), before the car moves.
 */
export function useSpecial(
  car: CarState, inp: CarInput, cars: readonly CarState[], shots: Shot[], pit: Pit | null, ev: EventBuffer, allowed = true,
): void {
  if (car.shieldTicks > 0) car.shieldTicks--;
  if (!allowed || car.special === SpecialItem.None || car.finished || car.wreckTicks > 0 || car.ghostTicks > 0) return;
  if (!(inp.buttons & ~car.prevButtons & Btn.Special)) return;
  const fx = DMath.sin(car.heading);
  const fz = -DMath.cos(car.heading);
  const item = car.special;
  car.special = SpecialItem.None;
  if (item === SpecialItem.Shield) {
    car.shieldTicks = SPECIAL.shieldTicks;
    pushEvent(ev, Ev.ShieldUp, car.id, -1, 0, car.x, car.z);
    return;
  }
  const s = allocShot(shots);
  s.owner = car.id;
  s.y = car.y;
  s.heading = car.heading;
  s.age = 0;
  s.target = -1;
  if (item === SpecialItem.Homing) {
    const fwd = Math.max(0, Math.min(WEAPON.missileInherit, car.vx * fx + car.vz * fz));
    s.kind = ShotKind.Homing;
    s.target = lockTarget(car, cars, pit);
    s.x = car.x + fx * 2.7;
    s.z = car.z + fz * 2.7;
    s.vx = fx * (SPECIAL.homingSpeed + fwd);
    s.vz = fz * (SPECIAL.homingSpeed + fwd);
  } else {
    s.kind = ShotKind.Oil;
    s.x = car.x - fx * SPECIAL.oilDrop;
    s.z = car.z - fz * SPECIAL.oilDrop;
    s.vx = s.vz = 0;
  }
  // value: the locked car + 1 (0 = none).
  pushEvent(ev, Ev.Fire, car.id, s.kind, s.target + 1, s.x, s.z);
}

/** Turn a homing missile toward its target, or drop the lock when it was out-turned or left the level. */
export function steerHoming(s: Shot, cars: readonly CarState[], dt: number): void {
  if (s.target < 0) return;
  const c = cars[s.target];
  if (!c || !targetable(c) || Math.abs(c.y - s.y) > SPECIAL.levelGap) {
    s.target = -1;
    return;
  }
  const err = wrapAngle(headingOf(c.x - s.x, c.z - s.z) - s.heading);
  if (Math.abs(err) > SPECIAL.seekCone) {
    s.target = -1;
    return;
  }
  const turn = SPECIAL.homingTurn * dt;
  s.heading = wrapAngle(s.heading + Math.max(-turn, Math.min(turn, err)));
  const sp = DMath.hypot(s.vx, s.vz);
  s.vx = DMath.sin(s.heading) * sp;
  s.vz = -DMath.cos(s.heading) * sp;
}

/**
 * A missile or mine reaching a shielded car: it bounces off (nothing but a
 * small push). Returns true when the shield took it.
 */
export function shieldBlocks(car: CarState, dx: number, dz: number, ev: EventBuffer, kind: number, owner: number): boolean {
  if (car.shieldTicks <= 0) return false;
  car.vx += dx * SPECIAL.shieldShove;
  car.vz += dz * SPECIAL.shieldShove;
  pushEvent(ev, Ev.ShieldBlock, car.id, owner, kind, car.x, car.z);
  return true;
}

/** Share of knock damage (walls, cars) a car takes: less behind a shield. */
export function knockFactor(car: CarState): number {
  return car.shieldTicks > 0 ? SPECIAL.shieldKnock : 1;
}

/**
 * Oil slicks under the car's two contact patches turn them to oil. Call
 * right after the surface is sampled (step.ts sampleCarSurface). `wasOil`:
 * a patch was on oil last tick (no new OilSlip event then).
 */
export function slickUnder(car: CarState, t: CarTuning, shots: readonly Shot[], ev: EventBuffer, wasOil: boolean): void {
  if (car.airborne) return;
  const fx = DMath.sin(car.heading);
  const fz = -DMath.cos(car.heading);
  const reach = SPECIAL.oilRadius + t.circleOffset;
  const r2 = SPECIAL.oilRadius * SPECIAL.oilRadius;
  for (const s of shots) {
    if (s.kind !== ShotKind.Oil || Math.abs(car.y - s.y) > 0.8) continue;
    if (s.owner === car.id && s.age < SPECIAL.oilGrace) continue;
    const dx = car.x - s.x;
    const dz = car.z - s.z;
    if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
    const off = t.circleOffset;
    let hit = false;
    if (DMath.sq(dx + fx * off) + DMath.sq(dz + fz * off) < r2) {
      car.surfFront = Surface.Oil;
      hit = true;
    }
    if (DMath.sq(dx - fx * off) + DMath.sq(dz - fz * off) < r2) {
      car.surfRear = Surface.Oil;
      hit = true;
    }
    if (hit && !wasOil) {
      pushEvent(ev, Ev.OilSlip, car.id, s.owner, 0, car.x, car.z);
      wasOil = true;
    }
  }
}
