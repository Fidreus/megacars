import { describe, expect, it } from 'vitest';
import { makeSurfaceMix, mixSurfaces, Surface, SURFACES, type SurfaceId } from '../config/surfaces.ts';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { makeWeatherPlan, plannedWetness, rainAt, roadBrakeScale, roadGripScale, wetnessAt, wetSurfaces } from './weather.ts';
import { createCar, stepCarDynamics } from './car.ts';
import { DT } from '../config/constants.ts';

const RACE = 60 * 150;
const START = 210;

describe('wetness', () => {
  it('is 0 without a plan and 1 all race in the rain', () => {
    expect(wetnessAt(undefined, 500)).toBe(0);
    expect(makeWeatherPlan('dry', 1, START, RACE)).toBeUndefined();
    const rain = makeWeatherPlan('rain', 1, START, RACE);
    for (const t of [0, START, 5000, 20000]) {
      expect(wetnessAt(rain, t)).toBe(1);
      expect(rainAt(rain, t)).toBe(1);
    }
  });

  it('changes during the race in a changing one, smoothly, the same every time', () => {
    const kinds = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const plan = makeWeatherPlan('changing', seed, START, RACE)!;
      const again = makeWeatherPlan('changing', seed, START, RACE)!;
      expect(again).toEqual(plan);
      let lo = 1;
      let hi = 0;
      let prev = wetnessAt(plan, START);
      let maxStep = 0;
      let ahead = true;
      for (let t = START; t <= START + RACE; t += 2) {
        const w = wetnessAt(plan, t);
        maxStep = Math.max(maxStep, Math.abs(w - prev));
        prev = w;
        lo = Math.min(lo, w);
        hi = Math.max(hi, w);
        if (plannedWetness(plan, t) < w) ahead = false;
      }
      expect(ahead).toBe(true);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
      // Fully dry and fully wet both happen while racing (not before the start or after the finish).
      expect(lo, `seed ${seed}`).toBeLessThan(0.02);
      expect(hi, `seed ${seed}`).toBeGreaterThan(0.98);
      // No sudden jumps: the road takes several seconds to change.
      expect(maxStep).toBeLessThan(2 / (60 * 8));
      const startWet = wetnessAt(plan, START) > 0.5;
      const endWet = wetnessAt(plan, START + RACE) > 0.5;
      kinds.add(`${startWet}-${endWet}`);
    }
    // Rain arriving, a passing shower, and a wet start drying out.
    expect(kinds).toEqual(new Set(['false-true', 'false-false', 'true-false']));
  });

  it('scales to the race: a short race changes sooner', () => {
    for (let seed = 0; seed < 50; seed++) {
      const short = makeWeatherPlan('changing', seed, START, 60 * 60)!;
      const long = makeWeatherPlan('changing', seed, START, 60 * 300)!;
      const first = (p: typeof short) => (p.rainOn > 0 ? p.rainOn : p.rainOff);
      expect(first(short)).toBeLessThan(first(long));
      expect(first(short)).toBeLessThan(START + 60 * 60 * 0.6);
    }
  });

  it('shows rain falling before the road is soaked', () => {
    for (let seed = 0; seed < 50; seed++) {
      const plan = makeWeatherPlan('changing', seed, START, RACE)!;
      if (plan.rainOn < 0) continue;
      const t = plan.rainOn + 60 * 5;
      expect(rainAt(plan, t)).toBe(1);
      expect(wetnessAt(plan, t)).toBeLessThan(0.5);
    }
  });
});

describe('wet grip', () => {
  const all = Object.values(Surface) as SurfaceId[];

  it('is the dry mix at wetness 0 and the wet surface on a soaked road', () => {
    const dry = makeSurfaceMix();
    const out = makeSurfaceMix();
    for (const a of all) {
      for (const b of all) {
        mixSurfaces(a, b, dry);
        mixSurfaces(a, b, out);
        wetSurfaces(a, b, 0, 0, out);
        expect(out).toEqual(dry);
      }
    }
    mixSurfaces(Surface.Asphalt, Surface.Asphalt, out);
    wetSurfaces(Surface.Asphalt, Surface.Asphalt, 1, 1, out);
    expect(out.grip).toBeCloseTo(SURFACES[Surface.Wet].grip);
    expect(out.slide).toBeCloseTo(SURFACES[Surface.Wet].slide);
    expect(out.brake).toBeLessThan(0.85);
    expect(out.steerAsk).toBeGreaterThan(1.1);
    expect(out.wet).toBe(1);
  });

  it('blends continuously on sealed road and leaves ice, oil, snow and water alone', () => {
    const out = makeSurfaceMix();
    let prev = 2;
    for (let k = 0; k <= 20; k++) {
      mixSurfaces(Surface.Asphalt, Surface.Curb, out);
      wetSurfaces(Surface.Asphalt, Surface.Curb, k / 20, k / 20, out);
      expect(out.grip).toBeLessThan(prev);
      if (k > 0) expect(prev - out.grip).toBeLessThan(0.02);
      prev = out.grip;
    }
    const ref = makeSurfaceMix();
    for (const s of [Surface.Ice, Surface.Oil, Surface.Snow, Surface.ShallowWater, Surface.DeepWater] as SurfaceId[]) {
      mixSurfaces(s, s, ref);
      mixSurfaces(s, s, out);
      wetSurfaces(s, s, 1, 1, out);
      expect({ ...out, wet: 0 }).toEqual(ref);
    }
    // Gravel and grass lose a little at most.
    mixSurfaces(Surface.Gravel, Surface.Grass, ref);
    mixSurfaces(Surface.Gravel, Surface.Grass, out);
    wetSurfaces(Surface.Gravel, Surface.Grass, 1, 1, out);
    expect(out.grip).toBeGreaterThan(ref.grip * 0.9);
  });

  it('the AI planner scales match the asphalt blend', () => {
    expect(roadGripScale(0)).toBe(1);
    expect(roadBrakeScale(0)).toBe(1);
    expect(roadGripScale(1)).toBeCloseTo(SURFACES[Surface.Wet].grip);
    expect(roadBrakeScale(0.5)).toBeGreaterThan(roadBrakeScale(1));
  });

  it('a soaked road takes longer to stop on and lets the tail step out at full lock', () => {
    const stop = (wet: number) => {
      const surf = makeSurfaceMix();
      mixSurfaces(Surface.Asphalt, Surface.Asphalt, surf);
      wetSurfaces(Surface.Asphalt, Surface.Asphalt, wet, wet, surf);
      const car = createCar(0, 0, 0, 0);
      car.vz = -40;
      let d = 0;
      for (let n = 0; n < 600 && Math.hypot(car.vx, car.vz) > 0.6; n++) {
        stepCarDynamics(car, { steer: 0, throttle: 0, brake: 1, buttons: 0 }, DEFAULT_TUNING, surf, DT);
        d += Math.hypot(car.vx, car.vz) * DT;
      }
      return d;
    };
    expect(stop(1)).toBeGreaterThan(stop(0) * 1.15);
    const slides = (wet: number) => {
      const surf = makeSurfaceMix();
      mixSurfaces(Surface.Asphalt, Surface.Asphalt, surf);
      wetSurfaces(Surface.Asphalt, Surface.Asphalt, wet, wet, surf);
      const car = createCar(0, 0, 0, 0);
      car.vz = -30;
      for (let n = 0; n < 240; n++) {
        stepCarDynamics(car, { steer: 1, throttle: 1, brake: 0, buttons: 0 }, DEFAULT_TUNING, surf, DT);
        if (car.sliding) return true;
      }
      return false;
    };
    expect(slides(0)).toBe(false);
    expect(slides(1)).toBe(true);
  });
});
