// Personalities of the named computer drivers. Each one is a fixed set of
// small offsets on the shared AI knobs, chosen by the driver's name in the
// race spec, so every machine drives them the same way.

import { hash3 } from '../math/rng.ts';
import { AI_NAMES } from '../game/roster.ts';
import type { CarState } from '../sim/car.ts';

/** When a driver uses turbos. */
export const TurboHabit = { Normal: 0, Eager: 1, Late: 2 } as const;
/** When a driver drops mines. */
export const MineHabit = { Normal: 0, Close: 1 } as const;

export interface Persona {
  /** Short label for tables. */
  tag: string;
  /** One line about how they race. */
  blurb: string;
  /** Added to the skill of the difficulty (the field averages to zero). */
  pace: number;
  /** Grips through corners wider than this radius, slides only tighter ones (0 = slides them all). */
  gripR: number;
  /** Factor on how readily missiles and mines are used. */
  aggro: number;
  /** Factor on how far they move over for slower cars ahead (low = holds the line and bumps). */
  give: number;
  /** Metres they move across toward a faster car close behind (hard to pass). */
  block: number;
  /** Metres of extra drift off the racing line (untidy). */
  wander: number;
  /** Factor on the braking the speed planner counts on (low = brakes early). */
  brake: number;
  /** Added to the damage that sends them into the pits (AI_PIT.damage). */
  pitShift: number;
  /** Throttle cap while getting going on the first lap (1 = none). */
  launch: number;
  /** Pace swing from lap to lap (±skill). */
  erratic: number;
  turbo: number;
  mines: number;
  /** Seconds added to their reaction time. */
  react: number;
  /** Turbos carried on top of the normal ammo. */
  extraTurbos: number;
}

/** A driver with no personality: people's cars when the computer takes over. */
export const NEUTRAL: Persona = {
  tag: '', blurb: '', pace: 0, gripR: 0, aggro: 1, give: 1, block: 0, wander: 0, brake: 1, pitShift: 0,
  launch: 1, erratic: 0, react: 0, turbo: TurboHabit.Normal, mines: MineHabit.Normal, extraTurbos: 0,
};

const P = (p: Partial<Persona> & Pick<Persona, 'tag' | 'blurb'>): Persona => ({ ...NEUTRAL, ...p });

/** One per name in AI_NAMES, in the same order. */
export const PERSONAS: readonly Persona[] = [
  // BLITZ
  P({ tag: 'HOTHEAD', blurb: 'BRAKES LATE, SHOOTS FIRST', pace: 0.022, brake: 1.04, aggro: 1.7, give: 0.6, pitShift: 0.12, react: -0.01 }),
  // NITRO NINA
  P({ tag: 'TURBO ADDICT', blurb: 'BURNS EVERY TURBO AT ONCE', pace: -0.004, turbo: TurboHabit.Eager, extraTurbos: 1 }),
  // TURBO TOM
  P({ tag: 'TURBO HOARDER', blurb: 'SAVES HIS TURBOS FOR THE END', pace: -0.006, turbo: TurboHabit.Late, extraTurbos: 1 }),
  // VIXEN
  P({ tag: 'MINE LAYER', blurb: 'DROPS MINES ON TAILGATERS', pace: 0.006, mines: MineHabit.Close, aggro: 1.3 }),
  // DIESEL DAN
  P({ tag: 'ROADBLOCK', blurb: 'SLOW OFF THE LINE, HARD TO PASS', pace: 0.009, launch: 0.5, block: 1.6, give: 0.7, pitShift: 0.2, react: 0.03 }),
  // ROXY
  P({ tag: 'CLEAN RACER', blurb: 'TIDY GRIP DRIVER, RARELY FIRES', pace: 0.022, gripR: 80, aggro: 0.5, give: 1.3, pitShift: -0.1, react: -0.01 }),
  // MAX POWER
  P({ tag: 'GUNSLINGER', blurb: 'ALL GAS AND LOTS OF MISSILES', pace: 0, brake: 1.02, aggro: 2, give: 0.8 }),
  // ACE
  P({ tag: 'THE PRO', blurb: 'FAST, PRECISE AND COOL-HEADED', pace: 0.033, aggro: 0.8, react: -0.02 }),
  // SPARKY
  P({ tag: 'NERVOUS ROOKIE', blurb: 'BRAKES EARLY, PITS AT A SCRATCH', pace: -0.037, brake: 0.95, give: 1.5, pitShift: -0.2, aggro: 0.7, react: 0.04 }),
  // LUCKY LOU
  P({ tag: 'WILD CARD', blurb: 'ALL OVER THE ROAD, SOMETIMES FAST', pace: 0.007, wander: 1.5, erratic: 0.03, react: 0.02 }),
];

/** Persona index for a computer driver's name (-1: none). */
export function personaIndex(name: string): number {
  return AI_NAMES.indexOf(name);
}

export function personaOf(index: number): Persona {
  return PERSONAS[index] ?? NEUTRAL;
}

/** Skill the car actually drives with: difficulty, personality and (for some) the lap's mood. */
export function effectiveSkill(car: CarState, p: Persona): number {
  let s = car.aiSkill + p.pace;
  if (p.erratic > 0) s += (hash3(car.id, car.lap, 91) * 2 - 1) * p.erratic;
  return s;
}
