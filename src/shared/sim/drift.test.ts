import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { getTrack } from '../track/builder.ts';
import { GREEN_VALLEY } from '../track/defs/greenValley.ts';
import { Btn, neutralInput } from './input.ts';
import { stepWorld } from './step.ts';
import { createWorld } from './world.ts';

const track = getTrack(GREEN_VALLEY);

describe('drift button', () => {
  it('a press while steering starts a slide, holding keeps it, letting go ends it', () => {
    const w = createWorld(track, 1, 1, { laps: 3, countdownTicks: 0 });
    const car = w.cars[0];
    const step = (n: number, steer: number, buttons = 0) => {
      for (let i = 0; i < n; i++) stepWorld(w, track, [{ ...neutralInput(), throttle: 1, steer, buttons }], [DEFAULT_TUNING]);
    };
    step(150, 0);
    expect(car.sliding).toBe(0);
    // Gentle steering alone stays in grip.
    step(4, 0.6);
    expect(car.sliding).toBe(0);
    step(1, 0.6, Btn.Drift);
    step(3, 0.6, Btn.Drift);
    expect(car.sliding).toBe(1);
    // Straighten the wheel but keep the button down: still sideways.
    step(25, -0.2, Btn.Drift);
    expect(car.sliding).toBe(1);
    // (Not much longer: the car is now angled toward the barrier.)
    step(40, 0);
    expect(car.sliding).toBe(0);
  });
});
