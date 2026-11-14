// How computer drivers use their special item and steer round oil slicks.
// Like the other weapons, decisions read only the world state (and a hash of
// the tick), and a new chance is taken only after the driver's reaction time.

import { smoothstep } from '../math/angle.ts';
import { hash3 } from '../math/rng.ts';
import { sampleIndexAt } from '../track/builder.ts';
import type { Track } from '../track/types.ts';
import type { CarState } from '../sim/car.ts';
import { Btn, type CarInput } from '../sim/input.ts';
import { lockTarget, SPECIAL, SpecialItem } from '../sim/specials.ts';
import { ShotKind, type Shot } from '../sim/weapons.ts';
import { effectiveSkill, MineHabit, personaOf, type Persona } from './persona.ts';
import { reactionTicks } from './reaction.ts';
import { FOE_EAGERNESS } from './weapons.ts';
import { DMath } from '../math/dmath.ts';

export const AI_SPECIAL = {
  /** A homing missile is kept for cars at least this far ahead (closer ones get a plain missile), and not wasted on far ones. */
  homingMin: 14,
  homingMax: 75,
  /** Oil goes down for a car this close behind (mine layers: further), lined up within `tailSide`. */
  tailRange: 30,
  tailRangeLayer: 40,
  tailSide: 5,
  /** A missile closing in from this far, passing within `missLine` of the car, calls for the shield. */
  threatRange: 42,
  missLine: 3.2,
  /** A homing missile locked onto the car, this close. */
  homingThreat: 85,
  /** A car this close behind with missiles (or a homing missile) to fire. */
  gunnerRange: 30,
  /** Steering round a slick: looked at this far ahead, full shift from `full` in, never more than `maxShift` off the line. */
  avoidAhead: 55,
  avoidFull: 32,
  maxShift: 6,
};

/** Sense number for the reaction-time spread (the others are in reaction.ts). */
const SENSE_ITEM = 6;

/** Reaction to a chance for the special: true once the driver has noticed it. */
function noticed(car: CarState, p: Persona, present: boolean, tick: number): boolean {
  if (!present) {
    car.aiItemReact = 0;
    return false;
  }
  if (car.aiItemReact < 0) return true;
  if (car.aiItemReact === 0) car.aiItemReact = reactionTicks(car, p, SENSE_ITEM, tick) + 1;
  if (--car.aiItemReact > 0) return false;
  car.aiItemReact = -1;
  return true;
}

/** A missile about to hit this car (or a homing missile locked onto it). */
export function missileComing(car: CarState, shots: readonly Shot[]): boolean {
  for (const s of shots) {
    if ((s.kind !== ShotKind.Missile && s.kind !== ShotKind.Homing) || s.owner === car.id || Math.abs(s.y - car.y) > 1.2) continue;
    const dx = car.x - s.x;
    const dz = car.z - s.z;
    const d = DMath.hypot(dx, dz);
    if (s.kind === ShotKind.Homing && s.target === car.id && d < AI_SPECIAL.homingThreat) return true;
    if (d > AI_SPECIAL.threatRange) continue;
    const sp = DMath.hypot(s.vx, s.vz) || 1;
    const along = (dx * s.vx + dz * s.vz) / sp;
    if (along <= 0) continue;
    if (Math.abs(dx * s.vz - dz * s.vx) / sp < AI_SPECIAL.missLine) return true;
  }
  return false;
}

/** Decide whether to use the held special this tick (sets Btn.Special in `out`). */
export function aiSpecial(car: CarState, cars: readonly CarState[], shots: readonly Shot[], track: Track, tick: number, out: CarInput): void {
  if (car.special === SpecialItem.None || car.finished || car.wreckTicks > 0 || car.ghostTicks > 0) {
    car.aiItemReact = 0;
    return;
  }
  const p = personaOf(car.aiPersona);
  const fx = DMath.sin(car.heading);
  const fz = -DMath.cos(car.heading);
  const rx = DMath.cos(car.heading);
  const rz = DMath.sin(car.heading);
  let chance = 0;
  if (car.special === SpecialItem.Homing) {
    const target = car.spinTicks === 0 ? lockTarget(car, cars, track.pit) : -1;
    if (target >= 0) {
      const o = cars[target];
      const d = DMath.hypot(o.x - car.x, o.z - car.z);
      if (d >= AI_SPECIAL.homingMin && d <= AI_SPECIAL.homingMax) chance = 0.3 * p.aggro * (target === car.aiFoe ? FOE_EAGERNESS : 1);
    }
  } else if (car.special === SpecialItem.Oil) {
    // Somebody right behind: mine layers love it, and it is best before a corner.
    const layer = p.mines === MineHabit.Close;
    const range = layer ? AI_SPECIAL.tailRangeLayer : AI_SPECIAL.tailRange;
    for (const o of cars) {
      if (o === car || o.ghostTicks > 0 || o.wreckTicks > 0 || o.finished || Math.abs(o.y - car.y) > 1.5) continue;
      const dx = o.x - car.x;
      const dz = o.z - car.z;
      const behind = -(dx * fx + dz * fz);
      if (behind < 5 || behind > range || Math.abs(dx * rx + dz * rz) > AI_SPECIAL.tailSide) continue;
      chance = 0.22 * p.aggro * (layer ? 3 : 1) * (o.id === car.aiFoe ? FOE_EAGERNESS : 1);
      break;
    }
    if (chance > 0) {
      let k = car.trackIdx;
      for (let d = 0; d < 40; d++) {
        if (Math.abs(track.line.curv[k]) > 1 / 80) {
          chance *= 1.6;
          break;
        }
        k = k + 1 === track.n ? 0 : k + 1;
      }
    }
  } else if (car.special === SpecialItem.Shield) {
    if (missileComing(car, shots)) chance = 0.85;
    else {
      // A car close behind with something to fire.
      for (const o of cars) {
        if (o === car || o.ghostTicks > 0 || o.wreckTicks > 0 || o.finished || Math.abs(o.y - car.y) > 1.5) continue;
        if (o.missiles === 0 && o.special !== SpecialItem.Homing) continue;
        const dx = o.x - car.x;
        const dz = o.z - car.z;
        const behind = -(dx * fx + dz * fz);
        if (behind < 4 || behind > AI_SPECIAL.gunnerRange || Math.abs(dx * rx + dz * rz) > 6) continue;
        chance = 0.15 * (o.special === SpecialItem.Homing ? 2 : 1) * (car.damage > 0.4 ? 2 : 1);
        break;
      }
    }
  }
  if (!noticed(car, p, chance > 0, tick)) return;
  // Decided a few times a second, off the beat of the other weapons, and never with one of them.
  if ((tick & 7) !== ((car.id + 4) & 7)) return;
  if (out.buttons & (Btn.FireFront | Btn.FireRear | Btn.Turbo)) return;
  const skill = Math.max(0.6, Math.min(1.1, 0.75 + (effectiveSkill(car, p) - 0.72) * 1.2));
  if (hash3(car.id, tick >> 3, 77) < Math.min(0.9, chance * skill)) out.buttons |= Btn.Special;
}

/**
 * Sideways shift (m, positive = right) that takes a computer driver round
 * the nearest oil slick on its line ahead, when that costs little (a few
 * metres, room on the road). 0 when there is none, or it would cost more.
 */
export function slickAvoid(car: CarState, track: Track, shots: readonly Shot[]): number {
  if (car.finished) return 0;
  let best = 0;
  let bestAhead = Infinity;
  const fx = DMath.sin(car.heading);
  const fz = -DMath.cos(car.heading);
  for (const s of shots) {
    if (s.kind !== ShotKind.Oil || Math.abs(s.y - car.y) > 0.8 || (s.owner === car.id && s.age < SPECIAL.oilGrace)) continue;
    const dx = s.x - car.x;
    const dz = s.z - car.z;
    const ahead = dx * fx + dz * fz;
    if (ahead < -4 || ahead > AI_SPECIAL.avoidAhead || ahead > bestAhead || Math.abs(dx * fz - dz * fx) > 16) continue;
    const j = sampleIndexAt(track, car.trackS + ahead);
    const lat = (s.x - track.px[j]) * track.nx[j] + (s.z - track.pz[j]) * track.nz[j];
    const line = track.line.off[j];
    const rel = lat - line;
    const need = SPECIAL.oilRadius + 1.3;
    if (Math.abs(rel) >= need) continue;
    // Pass on the side that takes the least shift and stays on the road.
    const room = track.hw[j] - 1.8;
    let shift = 0;
    for (const cand of rel > 0 ? [rel - need, rel + need] : [rel + need, rel - need]) {
      if (Math.abs(cand) <= AI_SPECIAL.maxShift && Math.abs(line + cand) <= room) {
        shift = cand;
        break;
      }
    }
    if (shift === 0) continue;
    bestAhead = ahead;
    best = shift * (1 - smoothstep(AI_SPECIAL.avoidFull, AI_SPECIAL.avoidAhead, ahead));
  }
  return best;
}
