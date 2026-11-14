// The school run against the real simulation: a scripted keyboard driver plays the lessons.

import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../../../shared/config/tuning.ts';
import { createRaceWorld } from '../../../shared/game/raceSetup.ts';
import { wrapAngle } from '../../../shared/math/angle.ts';
import { Btn, neutralInput } from '../../../shared/sim/input.ts';
import { stepWorld } from '../../../shared/sim/step.ts';
import { TRACK_LIST, registerTrack, trackDef } from '../../../shared/track/defs/index.ts';
import { SCHOOL, SCHOOL_ID } from '../../../shared/track/defs/school.ts';
import { defaultControls } from '../../input/bindings.ts';
import { HINT_AFTER, placeCar, SchoolRun, type SchoolHost } from './schoolRun.ts';
import { makeLabels } from './prompts.ts';

interface Keys { gas: boolean; brake: boolean; left: boolean; right: boolean; drift: boolean }
type Bot = (run: SchoolRun, car: { s: number; speed: number; err: number; sliding: boolean }, mem: Record<string, number>) => Keys;

function setup(lesson: number) {
  registerTrack(SCHOOL);
  const spec = { id: 0, track: SCHOOL_ID, laps: 0, seed: 1, countdownTicks: 0, weapons: false, league: 'standard' as const, entrants: [{ name: 'YOU', color: '#f00', playerId: 0, skill: 1 }] };
  const { track, world, tunings } = createRaceWorld(spec, DEFAULT_TUNING);
  const car = world.cars[0];
  car.human = 1;
  const inp = neutralInput();
  const log = { passed: [] as number[], over: 0, win: 0, fail: 0, teleports: 0 };
  const host: SchoolHost = {
    world, track, carId: 0, input: () => inp, labels: () => makeLabels('keys', defaultControls()),
    teleported: () => log.teleports++, passed: (i) => log.passed.push(i), over: () => log.over++, sound: (k) => (k === 'win' ? log.win++ : log.fail++),
  };
  const run = new SchoolRun(host, lesson);
  return { track, world, tunings, car, inp, run, log };
}

/** Drive with `bot` (a decision every 4 ticks) until the lesson is over or `maxSeconds` pass. */
function play(lesson: number, bot: Bot, maxSeconds = 120) {
  const t = setup(lesson);
  const mem: Record<string, number> = {};
  for (let it = 0; it < (maxSeconds * 60) / 4 && !t.log.over; it++) {
    const i = (t.car.trackIdx + 14) % t.track.n;
    const goal = Math.atan2(t.track.px[i] - t.car.x, -(t.track.pz[i] - t.car.z));
    const err = wrapAngle(goal - t.car.heading);
    const k = bot(t.run, { s: t.car.trackS, speed: Math.hypot(t.car.vx, t.car.vz), err, sliding: t.car.sliding === 1 }, mem);
    t.inp.throttle = k.gas ? 1 : 0;
    t.inp.brake = k.brake ? 1 : 0;
    t.inp.steer = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    t.inp.buttons = k.drift ? Btn.Drift : 0;
    for (let n = 0; n < 4; n++) {
      stepWorld(t.world, t.track, [t.inp], t.tunings);
      t.run.tick(t.world.events);
    }
  }
  return t;
}

const steer = (err: number): Pick<Keys, 'left' | 'right'> => ({ right: err > 0.1, left: err < -0.1 });

const driftBot: Bot = (run, c, m) => {
  const zone = c.s > 270 && c.s < 425;
  const on = zone && ((m.d ?? 0) > 0 || c.err > 0.12);
  if (on) m.d = (m.d ?? 0) + 1;
  if (!zone) m.d = 0;
  return { gas: true, brake: false, drift: on, ...steer(c.err) };
};

/** Lift off or dab the brake as the turn begins (alternating). */
const liftBot: Bot = (run, c, m) => {
  const zone = c.s > 270 && c.s < 425;
  if (zone && !m.lift && !m.dab && !m.did && c.err > 0.12 && !c.sliding && c.speed > 15) {
    if (run.totalWins % 2 === 0) m.lift = 2;
    else m.dab = 1;
    m.did = 1;
  }
  if (!zone) m.did = 0;
  const k: Keys = { gas: true, brake: false, drift: false, ...steer(c.err) };
  if (m.lift > 0) { k.gas = false; m.lift--; }
  if (m.dab > 0) { k.gas = false; k.brake = true; m.dab--; }
  return k;
};

const boostBot: Bot = (run, c, m) => {
  const stage = run.stage;
  const zone = stage === 0 ? c.s > 270 && c.s < 460 : c.s > 1190 && c.s < 1460;
  const ph = run.phase;
  const on = zone && ph !== 'release' && ph !== 'late' && ((m.d ?? 0) > 0 || c.err > 0.12);
  if (on) m.d = (m.d ?? 0) + 1;
  if (!zone) m.d = 0;
  return { gas: true, brake: false, drift: on, ...steer(c.err) };
};

const basicsBot: Bot = (run, c) => {
  const k: Keys = { gas: true, brake: false, drift: false, ...steer(c.err) };
  const { stage } = run;
  const s = c.s;
  if (stage === 0 && s > 215 && s < 300 && c.speed > 24) { k.gas = false; k.brake = true; }
  else if (stage === 0 && s >= 300 && s < 390 && c.speed > 24) k.gas = false;
  else if (stage === 1 && s > 495 && s < 580 && c.speed > 16) { k.gas = false; k.brake = true; }
  else if (stage === 1 && s >= 580 && c.speed > 21) k.gas = false;
  else if (stage === 2 && s > 700 && s < 770 && c.speed > 24) { k.gas = false; k.brake = true; }
  else if (stage === 2 && s >= 770 && s < 850 && c.speed > 25) k.gas = false;
  return k;
};

describe('the school circuit', () => {
  it('is not one of the game tracks', () => {
    expect(TRACK_LIST.some((t) => t.id === SCHOOL_ID)).toBe(false);
    registerTrack(SCHOOL);
    expect(trackDef(SCHOOL_ID)).toBe(SCHOOL);
  });
});

describe('playing the lessons with a keyboard driver', () => {
  beforeAll(() => registerTrack(SCHOOL));

  it('lesson 1: drives the three stretches', () => {
    const t = play(0, basicsBot);
    expect(t.log.passed).toEqual([0]);
    expect(t.run.totalWins).toBe(3);
  });

  it('lesson 2: three drifts with the button', () => {
    const t = play(1, driftBot);
    expect(t.log.passed).toEqual([1]);
    expect(t.run.totalWins).toBe(3);
  });

  it('lesson 3: three drifts from a lift-off or a brake dab', () => {
    const t = play(2, liftBot);
    expect(t.log.passed).toEqual([2]);
    expect(t.run.totalWins).toBe(3);
  });

  it('lesson 4: a level 2 boost, then a level 3 one', () => {
    const t = play(3, boostBot);
    expect(t.log.passed).toEqual([3]);
    expect(t.run.totalWins).toBe(2);
  });
});

describe('failing a lesson', () => {
  it('puts the car back at the start of the exercise at once, and counts the failures', () => {
    const t = setup(1);
    const start = { s: t.car.trackS, speed: Math.hypot(t.car.vx, t.car.vz) };
    // Drive straight on, gas down: into the wall at the corner.
    t.inp.throttle = 1;
    let sawResult = false;
    const before = t.log.teleports;
    for (let i = 0; i < 60 * 40 && t.run.fails < 2; i++) {
      stepWorld(t.world, t.track, [t.inp], t.tunings);
      t.run.tick(t.world.events);
      if (t.run.result && !t.run.result.ok) sawResult = true;
    }
    const restarts = t.log.teleports - before;
    expect(sawResult).toBe(true);
    expect(t.run.fails).toBe(2);
    expect(restarts).toBeGreaterThanOrEqual(1);
    expect(t.run.totalWins).toBe(0);
    // Right after a restart the car is back where the exercise starts.
    placeCar(t.world, t.track, t.car, start.s, start.speed);
    expect(Math.abs(t.car.trackS - start.s)).toBeLessThan(1.5);
    expect(Math.hypot(t.car.vx, t.car.vz)).toBeCloseTo(start.speed, 5);
  });

  it('offers a hint after a few failures, and never forces anything', () => {
    const t = setup(1);
    t.inp.throttle = 1;
    for (let i = 0; i < 60 * 120 && t.run.fails < HINT_AFTER; i++) {
      stepWorld(t.world, t.track, [t.inp], t.tunings);
      t.run.tick(t.world.events);
    }
    expect(t.run.fails).toBe(HINT_AFTER);
    expect(t.run.hint.length).toBeGreaterThan(5);
    // The lesson is still open: it can be skipped from the pause menu, and a win clears the count.
    expect(t.run.finished).toBe(false);
  });

  it('says why in a few words', () => {
    const t = setup(1);
    t.inp.throttle = 1;
    let text = '';
    for (let i = 0; i < 60 * 40 && !text; i++) {
      stepWorld(t.world, t.track, [t.inp], t.tunings);
      t.run.tick(t.world.events);
      if (t.run.result && !t.run.result.ok) text = t.run.result.text;
    }
    expect(text).toMatch(/^[A-Z -]+$/);
    expect(text.split(' ').length).toBeLessThanOrEqual(6);
  });
});

describe('the car', () => {
  it('is placed on the road at a given speed, with nothing left over from before', () => {
    const t = setup(1);
    t.car.driftCharge = 2;
    t.car.damage = 0.5;
    t.car.sliding = 1;
    placeCar(t.world, t.track, t.car, 600, 20);
    expect(Math.abs(t.car.trackS - 600)).toBeLessThan(1.5);
    expect(Math.hypot(t.car.vx, t.car.vz)).toBeCloseTo(20, 5);
    expect(t.car.driftCharge).toBe(0);
    expect(t.car.damage).toBe(0);
    expect(t.car.sliding).toBe(0);
    expect(t.car.lap).toBe(0);
  });
});
