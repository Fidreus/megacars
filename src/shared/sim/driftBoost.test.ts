import { describe, expect, it } from 'vitest';
import { DT } from '../config/constants.ts';
import { makeSurfaceMix } from '../config/surfaces.ts';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { getTrack, sampleIndexAt } from '../track/builder.ts';
import { CIGAR_CIRCUIT } from '../track/defs/cigarCircuit.ts';
import { GREEN_VALLEY } from '../track/defs/greenValley.ts';
import { createCar, stepCarDynamics } from './car.ts';
import { applyDriftCharge, breakDriftCharge, cornerZone, DRIFT_BOOST, driftLevel, stepDriftCharge } from './driftBoost.ts';
import { Ev, makeEventBuffer, pushEvent } from './events.ts';
import { Btn, neutralInput } from './input.ts';
import { stepWorld } from './step.ts';
import { stepBoostAndAir, WEAPON } from './weapons.ts';
import { createWorld } from './world.ts';

const asphalt = makeSurfaceMix();

/** A car sliding hard at speed, as after a drift flick in a corner. */
function slidingCar() {
  const car = createCar(0, 0, 0, 0);
  car.vz = -30;
  car.sliding = 1;
  car.slip = 0.4;
  return car;
}

/** Metres gained over 5 s at full throttle from 30 m/s by a boost set up by `arm`. */
function boostGain(arm: (c: ReturnType<typeof createCar>) => void): number {
  const run = (boost: boolean) => {
    const c = createCar(0, 0, 0, 0);
    c.vz = -30;
    if (boost) arm(c);
    const inp = neutralInput();
    inp.throttle = 1;
    const ev = makeEventBuffer();
    for (let i = 0; i < 300; i++) {
      stepCarDynamics(c, inp, DEFAULT_TUNING, asphalt, DT);
      stepBoostAndAir(c, DEFAULT_TUNING, DT, ev, false);
    }
    return -c.z;
  };
  return run(true) - run(false);
}

describe('drift boost', () => {
  it('has three levels at 0.6, 1.3 and 2.2 s of drifting', () => {
    expect(driftLevel(0.5)).toBe(0);
    expect(driftLevel(0.6)).toBe(1);
    expect(driftLevel(1.29)).toBe(1);
    expect(driftLevel(1.3)).toBe(2);
    expect(driftLevel(2.2)).toBe(3);
  });

  it('charges while cornering, announces each level and pays out when grip returns', () => {
    const car = slidingCar();
    const ev = makeEventBuffer();
    const levels: number[] = [];
    for (let i = 0; i < 90; i++) {
      ev.count = 0;
      stepDriftCharge(car, asphalt, 30, true, ev);
      for (let k = 0; k < ev.count; k++) if (ev.list[k].kind === Ev.DriftLevel) levels.push(ev.list[k].value);
    }
    expect(levels).toEqual([1, 2]);
    car.sliding = 0;
    ev.count = 0;
    stepDriftCharge(car, asphalt, 30, true, ev);
    expect(car.driftCharge).toBe(0);
    expect(car.driftBoostLevel).toBe(2);
    expect(car.driftBoostTicks).toBe(DRIFT_BOOST.ticks[2]);
    expect(ev.list[0].kind).toBe(Ev.DriftBoost);
  });

  it('builds nothing on a straight, on ice, or at a small slip angle', () => {
    const ice = { ...asphalt, slippery: 1 };
    const cases: [boolean, typeof asphalt, number][] = [[false, asphalt, 0.4], [true, ice, 0.4], [true, asphalt, 0.05]];
    for (const [cornering, surf, slip] of cases) {
      const car = slidingCar();
      car.slip = slip;
      for (let i = 0; i < 120; i++) stepDriftCharge(car, surf, 30, cornering, makeEventBuffer());
      expect(car.driftCharge).toBe(0);
    }
  });

  it('a hard knock or a spin loses the charge, a light touch does not', () => {
    const cars = [slidingCar(), slidingCar()];
    cars[1].id = 1;
    const ev = makeEventBuffer();
    cars[0].driftCharge = cars[1].driftCharge = 1;
    pushEvent(ev, Ev.CarHit, 0, 1, 2, 0, 0);
    breakDriftCharge(cars, ev, 0);
    expect(cars[0].driftCharge).toBe(1);
    pushEvent(ev, Ev.WallHit, 1, -1, 8, 0, 0);
    breakDriftCharge(cars, ev, 1);
    expect(cars[0].driftCharge).toBe(1);
    expect(cars[1].driftCharge).toBe(0);
    expect(ev.list[ev.count - 1].kind).toBe(Ev.DriftLost);
    cars[0].spinTicks = 10;
    stepDriftCharge(cars[0], asphalt, 30, true, ev);
    expect(cars[0].driftCharge).toBe(0);
  });

  it('level 1 is clearly weaker than a turbo, level 3 a bit better (a long clean drift pays)', () => {
    const turbo = boostGain((c) => (c.turboTicks = WEAPON.turboTicks));
    const level = (lv: number) => boostGain((c) => {
      c.driftBoostTicks = DRIFT_BOOST.ticks[lv];
      c.driftBoostLevel = lv;
    });
    expect(level(1)).toBeGreaterThan(0);
    expect(level(1)).toBeLessThan(turbo * 0.4);
    expect(level(2)).toBeGreaterThan(level(1));
    expect(level(3)).toBeGreaterThan(turbo);
    expect(level(3)).toBeLessThan(turbo * 2);
  });
});

describe('a long drift held with the button', () => {
  it('scrubs less speed once it has a charge, and only while the button is held', () => {
    const car = slidingCar();
    const surf = makeSurfaceMix();
    applyDriftCharge(surf, car, true);
    expect(surf.scrub).toBe(asphalt.scrub);
    car.driftCharge = 0.5;
    applyDriftCharge(surf, car, false);
    expect(surf.scrub).toBe(asphalt.scrub);
    applyDriftCharge(surf, car, true);
    expect(surf.scrub).toBeCloseTo(asphalt.scrub * DRIFT_BOOST.heldScrub);
  });

  it('pays more for each level: level 3 lasts longest and pushes hardest', () => {
    for (let lv = 2; lv <= 3; lv++) {
      expect(DRIFT_BOOST.ticks[lv]).toBeGreaterThan(DRIFT_BOOST.ticks[lv - 1]);
      expect(DRIFT_BOOST.accel[lv]).toBeGreaterThan(DRIFT_BOOST.accel[lv - 1]);
      expect(DRIFT_BOOST.top[lv]).toBeGreaterThan(DRIFT_BOOST.top[lv - 1]);
    }
  });
});

describe('a slide only pays while cornering', () => {
  it('sliding and weaving down a straight earns no repair and no charge', () => {
    const track = getTrack(GREEN_VALLEY);
    const w = createWorld(track, 1, 1, { laps: 3 });
    const car = w.cars[0];
    // Green Valley's back straight: 500 m with no bend near it.
    const i = sampleIndexAt(track, 1900);
    expect(cornerZone(track)[i]).toBe(0);
    car.x = track.px[i];
    car.z = track.pz[i];
    car.heading = Math.atan2(track.tx[i], -track.tz[i]);
    car.vx = track.tx[i] * 35;
    car.vz = track.tz[i] * 35;
    car.trackIdx = i;
    car.trackS = track.s[i];
    car.damage = 0.5;
    let slid = 0;
    for (let k = 0; k < 150; k++) {
      // Flick into a slide and swing it from side to side, drift button held.
      const steer = Math.floor(k / 30) % 2 === 0 ? 0.8 : -0.8;
      stepWorld(w, track, [{ ...neutralInput(), throttle: 1, steer, buttons: k % 30 === 0 ? 0 : Btn.Drift }], [DEFAULT_TUNING]);
      slid += car.sliding;
      expect(cornerZone(track)[car.trackIdx]).toBe(0);
    }
    expect(slid).toBeGreaterThan(60);
    expect(car.damage).toBe(0.5);
    expect(car.driftCharge).toBe(0);
    expect(car.driftBoostTicks).toBe(0);
  });

  it('a drift through a hairpin, exit included, earns repair and a full charge', () => {
    const track = getTrack(CIGAR_CIRCUIT);
    const w = createWorld(track, 1, 1, { laps: 3 });
    const car = w.cars[0];
    car.aiDriven = 1;
    car.damage = 0.5;
    let boost = 0;
    for (let k = 0; k < 60 * 20 && !boost; k++) {
      stepWorld(w, track, [], [DEFAULT_TUNING]);
      for (let e = 0; e < w.events.count; e++) if (w.events.list[e].kind === Ev.DriftBoost) boost = w.events.list[e].value;
    }
    expect(boost).toBe(3);
    expect(car.damage).toBeLessThan(0.5 - WEAPON.driftRepair * 1.5);
  });
});
