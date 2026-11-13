import { describe, expect, it } from 'vitest';
import { DT } from '../config/constants.ts';
import { makeSurfaceMix } from '../config/surfaces.ts';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { getTrack } from '../track/builder.ts';
import { GREEN_VALLEY } from '../track/defs/greenValley.ts';
import { createCar, stepCarDynamics } from './car.ts';
import { neutralInput } from './input.ts';
import { applySlipstream, inWake, SLIPSTREAM, stepSlipstream } from './slipstream.ts';
import { stepWorld } from './step.ts';
import { createWorld } from './world.ts';

/** Leader at the origin going north (-z) at 35 m/s, follower `back` metres behind and `side` across. */
function pair(back: number, side = 0) {
  const lead = createCar(0, 0, 0, 0);
  const follow = createCar(1, side, back, 0);
  lead.vz = follow.vz = -35;
  return [lead, follow];
}

describe('slipstream', () => {
  it('the wake is a narrow zone behind the car, a little wider further back', () => {
    expect(inWake(pair(2)[1], pair(2)[0])).toBe(false);
    expect(inWake(pair(8)[1], pair(8)[0])).toBe(true);
    expect(inWake(pair(22)[1], pair(22)[0])).toBe(true);
    expect(inWake(pair(30)[1], pair(30)[0])).toBe(false);
    let [a, b] = pair(6, 2.5);
    expect(inWake(b, a)).toBe(false);
    [a, b] = pair(20, 2.5);
    expect(inWake(b, a)).toBe(true);
    // Ahead of the other car is no wake.
    [a, b] = pair(-10);
    expect(inWake(b, a)).toBe(false);
  });

  it('needs both cars fast, going the same way, on the same level, and neither wrecked or ghosted', () => {
    const check = (f: (a: ReturnType<typeof createCar>, b: ReturnType<typeof createCar>) => void) => {
      const [a, b] = pair(10);
      f(a, b);
      return inWake(b, a);
    };
    expect(check(() => {})).toBe(true);
    expect(check((a) => (a.vz = -12))).toBe(false);
    expect(check((_, b) => (b.vx = 30))).toBe(false);
    expect(check((_, b) => (b.y = 6))).toBe(false);
    expect(check((a) => (a.wreckTicks = 10))).toBe(false);
    expect(check((a) => (a.ghostTicks = 10))).toBe(false);
  });

  it('builds in about 0.7 s in the wake and fades in about 0.3 s outside it', () => {
    const cars = pair(10);
    for (let i = 0; i < Math.round(0.35 / DT); i++) stepSlipstream(cars);
    expect(cars[1].draft).toBeCloseTo(0.5, 1);
    for (let i = 0; i < Math.round(0.4 / DT); i++) stepSlipstream(cars);
    expect(cars[1].draft).toBe(1);
    expect(cars[0].draft).toBe(0);
    cars[1].x = 10;
    for (let i = 0; i < Math.round(0.15 / DT); i++) stepSlipstream(cars);
    expect(cars[1].draft).toBeCloseTo(0.5, 1);
    for (let i = 0; i < Math.round(0.2 / DT); i++) stepSlipstream(cars);
    expect(cars[1].draft).toBe(0);
  });

  it('raises top speed by the configured share at full strength', () => {
    const top = (draft: number) => {
      const surf = makeSurfaceMix();
      applySlipstream(surf, draft);
      const car = createCar(0, 0, 0, 0);
      const inp = neutralInput();
      inp.throttle = 1;
      for (let i = 0; i < 60 * 30; i++) stepCarDynamics(car, inp, DEFAULT_TUNING, surf, DT);
      return Math.hypot(car.vx, car.vz);
    };
    const gain = top(1) / top(0) - 1;
    expect(gain).toBeGreaterThan(SLIPSTREAM.top * 0.9);
    expect(gain).toBeLessThan(SLIPSTREAM.top * 1.1);
  });

  it('does nothing during the countdown', () => {
    const track = getTrack(GREEN_VALLEY);
    const w = createWorld(track, 2, 1, { laps: 3, countdownTicks: 60 });
    const [a, b] = w.cars;
    a.x = 0; a.z = 0; b.x = 0; b.z = 10;
    a.vz = b.vz = -35;
    for (let i = 0; i < 30; i++) stepWorld(w, track, [], [DEFAULT_TUNING]);
    expect(b.draft).toBe(0);
  });
});
