// The driving school's lessons, as plain data and pure judges. A lesson is a
// list of stages; each stage has a place on the school circuit to start from
// (with a rolling start, so no time is lost on a run-up) and a judge that is
// fed one `Frame` per simulation tick: what the car and the buttons are doing
// and what happened (wall hits, drift charge levels, boosts). The judge says
// when the attempt is won or lost, and why. Nothing here touches the DOM or
// the world, so every rule can be tested with made-up frames.

import { DRIFT_BOOST } from '../../../shared/sim/driftBoost.ts';

export const HZ = 60;

/** A wall hit harder than this (m/s) is a crash; lighter scrapes are forgiven. */
export const WALL_CRASH = 2.5;
/** Seconds of drifting that count as one held drift in lessons 2 and 3. */
export const DRIFT_HOLD_S = 1;
/** Slip angle (degrees) that makes a slide a drift, as in the drift boost. */
export const DRIFT_SLIP_DEG = DRIFT_BOOST.minSlipDeg;

/** What the judge sees of one tick. */
export interface Frame {
  /** Ticks since the attempt began. */
  tick: number;
  /** Metres along the road (0 at the start line). */
  s: number;
  /** Metres driven since the attempt began. */
  dist: number;
  speed: number;
  /** The buttons held this tick. */
  gas: boolean;
  brake: boolean;
  drift: boolean;
  sliding: boolean;
  /** Slip angle, degrees (absolute). */
  slipDeg: number;
  /** Drift charge level 0-3 now. */
  level: number;
  /** Seconds of charge. */
  charge: number;
  /** Hardest wall hit this tick (m/s), 0 = none. */
  wall: number;
  /** Events this tick: a charge level reached, a boost paid out, a charge lost (the level, else 0). */
  levelUp: number;
  boost: number;
  lost: number;
}

export function emptyFrame(): Frame {
  return { tick: 0, s: 0, dist: 0, speed: 0, gas: false, brake: false, drift: false, sliding: false, slipDeg: 0, level: 0, charge: 0, wall: 0, levelUp: 0, boost: 0, lost: 0 };
}

export type Outcome =
  | { ok: true; text: string }
  /** `code` picks the hint; `text` is the few words shown ("HIT THE WALL"). */
  | { ok: false; code: string; text: string };

/** What the screen shows besides the prompt: a bar (0-1) with a label. */
export interface Meter {
  label: string;
  value: number;
  /** Where the goal is on the bar (0-1), drawn as a tick. */
  mark?: number;
}

export interface Judge {
  /** Feed one tick; returns the result once the attempt is decided. */
  step(f: Frame): Outcome | null;
  /** Which prompt to show ("corner", "release"...), see prompts.ts. */
  phase(): string;
  meter(): Meter | null;
  /** The score line next to "2 OF 3" while an attempt is running, if any. */
  note(): string;
}

export interface Stage {
  /** Where the attempt starts (metres along the road) and how fast the car rolls. */
  s: number;
  speed: number;
  /** Wins needed in this stage. */
  goal: number;
  judge(): Judge;
}

export interface Lesson {
  id: string;
  name: string;
  /** One line for the lesson list. */
  blurb: string;
  stages: Stage[];
}

// ---------------------------------------------------------------- the circuit

/** Places on the school circuit (metres along the road, from `school.ts`). */
export const AT = {
  corner1: { from: 283, exit: 435 },
  hairpin: { from: 575, to: 655 },
  left: { from: 750, to: 840 },
  sweeper: { from: 1205, exit: 1420 },
};

// -------------------------------------------------------------------- judges

/** Lesson 1: one stretch to drive without a crash; `end` is where it is won. */
function stretchJudge(end: number, phases: (f: Frame) => string): Judge {
  let phase = 'go';
  let tooSlow = 0;
  return {
    step(f) {
      phase = phases(f);
      if (f.wall > WALL_CRASH) return { ok: false, code: 'wall', text: 'HIT THE WALL' };
      if (f.s >= end) return { ok: true, text: 'CLEAN' };
      // Sitting still: say so, once.
      tooSlow = f.speed < 2 && f.tick > 4 * HZ ? tooSlow + 1 : 0;
      if (tooSlow > 2 * HZ) return { ok: false, code: 'idle', text: 'NOT MOVING' };
      return null;
    },
    phase: () => phase,
    meter: () => null,
    note: () => '',
  };
}

/**
 * Lessons 2 and 3: drift through one corner and hold it. `button`: the drift
 * button must be held; otherwise the slide must start without it (lift-off or
 * brake dab).
 */
export function cornerJudge(kind: 'button' | 'lift', from = AT.corner1.from, exit = AT.corner1.exit): Judge {
  const need = DRIFT_HOLD_S * HZ;
  /** Consecutive ticks of a counted drift (short gaps are bridged), and the best so far. */
  let held = 0;
  let best = 0;
  let gap = 0;
  let won = false;
  let entrySpeed = -1;
  let pressedDrift = false;
  let usedButton = false;
  let slidingBefore = false;
  /** This slide began with the drift button held (lessons that forbid it). */
  let buttonSlide = false;
  let phase = 'approach';
  return {
    step(f) {
      if (f.wall > WALL_CRASH) return { ok: false, code: 'wall', text: 'HIT THE WALL' };
      if (f.s >= from && entrySpeed < 0) entrySpeed = f.speed;
      if (f.drift && f.s >= from - 60) pressedDrift = true;
      const slide = f.sliding && f.slipDeg >= DRIFT_SLIP_DEG && f.s >= from - 30 && f.s <= exit + 20;
      if (f.sliding && !slidingBefore) buttonSlide = f.drift;
      if (!f.sliding) buttonSlide = false;
      slidingBefore = f.sliding;
      if (slide && buttonSlide && kind === 'lift') usedButton = true;
      const counts = slide && (kind === 'button' ? f.drift : !buttonSlide);
      if (counts) {
        held++;
        gap = 0;
        best = Math.max(best, held);
        if (held >= need) won = true;
      } else if (held > 0 && ++gap > 6) {
        held = 0;
        gap = 0;
      }
      phase = won ? 'done' : f.s < from - 60 ? 'approach' : f.s <= exit - 40 ? (held > 0 ? 'holding' : 'corner') : 'late';
      if (f.s >= exit) {
        if (won) return { ok: true, text: 'NICE DRIFT' };
        return fail();
      }
      if (f.tick > 25 * HZ) return { ok: false, code: 'slow', text: 'TOO SLOW' };
      return null;
    },
    phase: () => phase,
    meter: () => ({ label: 'DRIFT', value: Math.min(1, Math.max(held, won ? need : 0) / need), mark: 1 }),
    note: () => '',
  };
  function fail(): Outcome {
    if (best > 0) return kind === 'button' ? { ok: false, code: 'early', text: 'LET GO TOO EARLY' } : { ok: false, code: 'died', text: 'THE DRIFT DIED TOO SOON' };
    if (entrySpeed < 18) return { ok: false, code: 'slow', text: 'TOO SLOW INTO THE CORNER' };
    if (kind === 'button') return pressedDrift ? { ok: false, code: 'nosteer', text: 'NO DRIFT - STEER WHILE YOU HOLD IT' } : { ok: false, code: 'nobutton', text: 'YOU DID NOT USE THE DRIFT BUTTON' };
    return usedButton ? { ok: false, code: 'usedButton', text: 'THAT WAS THE DRIFT BUTTON' } : { ok: false, code: 'nodrift', text: 'NO DRIFT' };
  }
}

/**
 * Lesson 4: hold a drift until the meter reaches `want`, then straighten up
 * for the boost. Won by a boost of that level or more.
 */
export function boostJudge(want: number, from: number, exit: number): Judge {
  const target = DRIFT_BOOST.levels[want - 1];
  let top = 0;
  let small = 0;
  let sawLoss = false;
  let lastWall = -999;
  let phase = 'approach';
  let level = 0;
  let charge = 0;
  let sliding = false;
  return {
    step(f) {
      level = f.level;
      charge = f.charge;
      sliding = f.sliding;
      if (f.wall > 0) lastWall = f.tick;
      if (f.wall > WALL_CRASH) return { ok: false, code: 'wall', text: 'HIT THE WALL' };
      top = Math.max(top, f.levelUp, f.level);
      if (f.boost >= want) return { ok: true, text: `LEVEL ${f.boost} BOOST` };
      if (f.boost > 0) small = f.boost;
      if (f.lost > 0) {
        sawLoss = true;
        return f.tick - lastWall < 6 ? { ok: false, code: 'wall', text: 'HIT THE WALL - CHARGE LOST' } : { ok: false, code: 'spin', text: 'SPUN OUT - CHARGE LOST' };
      }
      phase = f.s < from - 40 ? 'approach' : f.level >= want ? 'release' : f.sliding ? 'charge' : 'corner';
      if (f.s >= exit && !f.sliding && f.boost === 0 || f.s >= exit + 60) {
        if (small > 0) return { ok: false, code: 'early', text: 'LET GO TOO EARLY' };
        if (top > 0 && !sawLoss) return { ok: false, code: 'early', text: 'LET GO TOO EARLY' };
        return { ok: false, code: 'nodrift', text: 'NO CHARGE BUILT UP' };
      }
      if (f.tick > 30 * HZ) return { ok: false, code: 'slow', text: 'TOO SLOW' };
      return null;
    },
    phase: () => phase,
    meter: () => ({ label: 'CHARGE', value: Math.min(1, sliding ? charge / target : level >= want ? 1 : 0), mark: 1 }),
    note: () => '',
  };
}

/** Lesson 5: a whole lap with boosts out of corners, inside a target time. */
export function lapJudge(length: number, boosts: number, target: number): Judge {
  let n = 0;
  let walls = 0;
  let lastWall = -999;
  let time = 0;
  return {
    step(f) {
      time = f.tick / HZ;
      if (f.boost > 0) n++;
      if (f.wall > WALL_CRASH && f.tick - lastWall > 30) {
        walls++;
        lastWall = f.tick;
      }
      if (f.dist < length) return null;
      const t = f.tick / HZ;
      const clock = `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
      if (n < boosts && t > target) return { ok: false, code: 'both', text: `${clock} AND ${n} BOOST${n === 1 ? '' : 'S'}` };
      if (n < boosts) return { ok: false, code: 'boosts', text: `ONLY ${n} BOOST${n === 1 ? '' : 'S'} - NEED ${boosts}` };
      if (t > target) return { ok: false, code: 'time', text: `TOO SLOW - ${clock}` };
      return { ok: true, text: `${clock} WITH ${n} BOOSTS` };
    },
    phase: () => 'lap',
    meter: () => null,
    note: () => `BOOSTS ${n}/${boosts}   ${time.toFixed(1)} S${walls ? `   WALLS ${walls}` : ''}`,
  };
}

/** The target for lesson 5, seconds. */
export const LAP_TARGET_S = 58;
export const LAP_BOOSTS = 3;

// ------------------------------------------------------------------- lessons

export function makeLessons(trackLength: number): Lesson[] {
  const stretch = (end: number, phases: (f: Frame) => string): (() => Judge) => () => stretchJudge(end, phases);
  return [
    {
      id: 'basics',
      name: 'THE BASICS',
      blurb: 'STEER, ACCELERATE AND BRAKE',
      stages: [
        { s: 100, speed: 0, goal: 1, judge: stretch(415, (f) => (f.s < 210 && f.speed < 14 ? 'gas' : f.s < 295 ? 'brake' : f.s < 395 ? 'corner' : 'straight')) },
        { s: 450, speed: 34, goal: 1, judge: stretch(690, (f) => (f.s < AT.hairpin.from ? 'brake' : f.s < AT.hairpin.to ? 'hairpin' : 'straight')) },
        { s: 665, speed: 26, goal: 1, judge: stretch(900, (f) => (f.s < AT.left.to ? 'left' : 'straight')) },
      ],
    },
    {
      id: 'drift',
      name: 'THE DRIFT BUTTON',
      blurb: 'HOLD IT WHILE YOU TURN IN',
      stages: [{ s: 215, speed: 24, goal: 3, judge: () => cornerJudge('button') }],
    },
    {
      id: 'lift',
      name: 'DRIFT WITHOUT THE BUTTON',
      blurb: 'LIFT OFF OR TAP THE BRAKE',
      stages: [{ s: 215, speed: 24, goal: 3, judge: () => cornerJudge('lift') }],
    },
    {
      id: 'boost',
      name: 'THE DRIFT BOOST',
      blurb: 'HOLD, STRAIGHTEN UP, FLY',
      stages: [
        { s: 215, speed: 24, goal: 1, judge: () => boostJudge(2, AT.corner1.from, AT.corner1.exit) },
        { s: 1130, speed: 24, goal: 1, judge: () => boostJudge(3, AT.sweeper.from, AT.sweeper.exit) },
      ],
    },
    {
      id: 'lap',
      name: 'PUT IT TOGETHER',
      blurb: 'A LAP WITH BOOSTS OUT OF CORNERS',
      stages: [{ s: trackLength - 60, speed: 22, goal: 1, judge: () => lapJudge(trackLength, LAP_BOOSTS, LAP_TARGET_S) }],
    },
  ];
}
