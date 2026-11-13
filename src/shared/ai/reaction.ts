// Reaction time of computer drivers. Something new (a slide they did not ask
// for, a car in the way, a target lining up, the lights going green) is
// acted on only some ticks later, like a person would. The pending reactions
// live in the car state, so prediction and replays agree.

import { clamp } from '../math/angle.ts';
import { hash3 } from '../math/rng.ts';
import type { CarState } from '../sim/car.ts';
import type { Persona } from './persona.ts';

/** Things a driver reacts to; each has a bit in `aiAware` and 5 bits of countdown in `aiReact`. */
export const Sense = { Slide: 0, Traffic: 1, Target: 2, Tail: 3, Go: 4 } as const;
/** Extra `aiAware` bit: the current slide was one the driver went for. */
export const PLANNED_SLIDE = 1 << 5;

export const REACTION = {
  /** Mean reaction (s) of a flawless driver (skill 1). */
  base: 0.115,
  /** Extra seconds per unit of skill shortfall (EASY 0.72 -> about 0.3 s). */
  perLack: 0.66,
  /** ± spread (s) from one moment to the next, at skill 1 and per unit of shortfall. */
  spread: 0.035,
  spreadPerLack: 0.05,
  min: 0.05,
};

const MAX_TICKS = 31;

/** Ticks this driver takes to react right now (varies from moment to moment). */
export function reactionTicks(car: CarState, p: Persona, sense: number, tick: number): number {
  const lack = clamp(1 - car.aiSkill, 0, 1);
  const mean = REACTION.base + REACTION.perLack * lack + p.react;
  const spread = REACTION.spread + REACTION.spreadPerLack * lack;
  const sec = Math.max(REACTION.min, mean + (hash3(car.id, tick, 40 + sense) * 2 - 1) * spread);
  return Math.min(MAX_TICKS, Math.max(1, Math.round(sec * 60)));
}

/**
 * Report whether a situation is there now; returns true once the driver has
 * noticed it. Something that goes away is forgotten at once.
 */
export function notice(car: CarState, p: Persona, sense: number, present: boolean, tick: number): boolean {
  const bit = 1 << sense;
  const shift = sense * 5;
  if (!present) {
    car.aiAware &= ~bit;
    car.aiReact &= ~(MAX_TICKS << shift);
    return false;
  }
  if (car.aiAware & bit) return true;
  let n = (car.aiReact >> shift) & MAX_TICKS;
  if (n === 0) n = reactionTicks(car, p, sense, tick);
  n--;
  car.aiReact = (car.aiReact & ~(MAX_TICKS << shift)) | (n << shift);
  if (n > 0) return false;
  car.aiAware |= bit;
  return true;
}

/** Mark a situation as expected (the driver caused it), so there is nothing to react to. */
export function expect(car: CarState, sense: number): void {
  car.aiAware |= 1 << sense;
  car.aiReact &= ~(MAX_TICKS << (sense * 5));
}
