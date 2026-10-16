import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { simulateRace } from '../game/raceSim.ts';
import { getTrack } from '../track/builder.ts';
import { GREEN_VALLEY } from '../track/defs/greenValley.ts';
import { createCar } from './car.ts';
import { Ev, makeEventBuffer } from './events.ts';
import { Btn, neutralInput, type CarInput } from './input.ts';
import { stepWorld } from './step.ts';
import { ShotKind, START_AMMO, stepBoostAndAir, WEAPON } from './weapons.ts';
import { createWorld, type World } from './world.ts';

const track = getTrack(GREEN_VALLEY);
const T = [DEFAULT_TUNING];

/** Two cars on the main straight, car 1 `gap` metres in front of car 0. */
function duel(gap: number, weapons = true): World {
  const w = createWorld(track, 2, 1, { laps: 3, countdownTicks: 0, weapons });
  const [a, b] = w.cars;
  const fx = Math.sin(a.heading);
  const fz = -Math.cos(a.heading);
  b.x = a.x + fx * gap;
  b.z = a.z + fz * gap;
  b.heading = a.heading;
  w.race.startTick = -WEAPON.startGrace;
  return w;
}

function run(w: World, ticks: number, inputs: CarInput[], log: number[] = []): number[] {
  for (let i = 0; i < ticks; i++) {
    stepWorld(w, track, inputs, T);
    for (let k = 0; k < w.events.count; k++) log.push(w.events.list[k].kind);
    for (const inp of inputs) inp.buttons &= ~(Btn.FireFront | Btn.FireRear | Btn.Turbo);
  }
  return log;
}

describe('weapons', () => {
  it('a missile hits the car ahead: damage, spin, one missile used', () => {
    const w = duel(25);
    const fire = { ...neutralInput(), buttons: Btn.FireFront };
    const log = run(w, 40, [fire, neutralInput()]);
    expect(w.cars[0].missiles).toBe(START_AMMO.missiles - 1);
    expect(log).toContain(Ev.Fire);
    expect(log).toContain(Ev.Explosion);
    expect(w.cars[1].damage).toBeCloseTo(WEAPON.missileDamage, 5);
    expect(w.shots.every((s) => s.kind === ShotKind.None)).toBe(true);
  });

  it('nothing fires with weapons off', () => {
    const w = duel(25, false);
    const log = run(w, 40, [{ ...neutralInput(), buttons: Btn.FireFront }, neutralInput()]);
    expect(log).not.toContain(Ev.Fire);
    expect(w.cars[1].damage).toBe(0);
  });

  it('a mine arms, then launches whoever drives over it', () => {
    const w = duel(-12);
    // Car 0 drops a mine; car 1 (behind) drives into it.
    run(w, 1, [{ ...neutralInput(), buttons: Btn.FireRear }, neutralInput()]);
    expect(w.cars[0].mines).toBe(START_AMMO.mines - 1);
    let flew = false;
    const gas = { ...neutralInput(), throttle: 1 };
    for (let i = 0; i < 120 && !flew; i++) {
      run(w, 1, [neutralInput(), gas]);
      flew = w.cars[1].airborne === 1;
    }
    expect(flew).toBe(true);
    expect(w.cars[1].damage).toBeCloseTo(WEAPON.mineDamage, 5);
    run(w, 90, [neutralInput(), gas]);
    expect(w.cars[1].y).toBe(0);
  });

  it('turbo pushes the car past its normal top speed', () => {
    const w = duel(80);
    const gas = { ...neutralInput(), throttle: 1 };
    run(w, 60 * 6, [gas, neutralInput()]);
    const before = Math.hypot(w.cars[0].vx, w.cars[0].vz);
    run(w, 1, [{ ...gas, buttons: Btn.Turbo }, neutralInput()]);
    run(w, 80, [gas, neutralInput()]);
    expect(w.cars[0].turbos).toBe(START_AMMO.turbos - 1);
    expect(Math.hypot(w.cars[0].vx, w.cars[0].vz)).toBeGreaterThan(before + 3);
  });

  it('a fully damaged car is wrecked, then comes back patched up', () => {
    const w = duel(25);
    w.cars[1].damage = 0.95;
    const log = run(w, 40, [{ ...neutralInput(), buttons: Btn.FireFront }, neutralInput()]);
    expect(log).toContain(Ev.Wreck);
    expect(w.cars[1].wreckTicks).toBeGreaterThan(0);
    run(w, WEAPON.wreckTicks, [neutralInput(), neutralInput()]);
    expect(w.cars[1].wreckTicks).toBe(0);
    expect(w.cars[1].damage).toBe(WEAPON.wreckRepair);
    expect(w.cars[1].wrecks).toBe(1);
    expect(w.cars[1].ghostTicks).toBeGreaterThan(0);
  });

  it('every car still finishes an armed AI race', () => {
    for (const seed of [1, 2, 3]) {
      const r = simulateRace(GREEN_VALLEY, seed, { laps: 2, weapons: true });
      expect(r.finished, `seed ${seed}: ${JSON.stringify(r)}`).toBe(r.cars);
      expect(r.shots).toBeGreaterThan(10);
    }
  });
});

describe('landings', () => {
  const land = (headingOff: number) => {
    const car = createCar(0, 0, 0, Math.PI / 2 + headingOff);
    Object.assign(car, { vx: 40, vz: 0, y: 0.1, vy: -16, airborne: 1 });
    const ev = makeEventBuffer();
    stepBoostAndAir(car, DEFAULT_TUNING, 1 / 60, ev, true, 0, 0);
    return car;
  };

  it('a straight landing does no damage and keeps nearly all the speed', () => {
    const car = land(0.1);
    expect(car.airborne).toBe(0);
    expect(car.damage).toBe(0);
    expect(car.vx).toBeGreaterThan(38.5);
  });

  it('a sideways landing hurts and costs speed', () => {
    const car = land(Math.PI / 2);
    expect(car.damage).toBeGreaterThan(0.05);
    expect(car.vx).toBeLessThan(36);
  });
});
