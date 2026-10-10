import { describe, expect, it } from 'vitest';
import { DT } from '../config/constants.ts';
import { makeSurfaceMix, mixSurfaces, Surface } from '../config/surfaces.ts';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { makeRng } from '../math/rng.ts';
import { buildTrack, distanceToCentreline } from '../track/builder.ts';
import { PROVING_GROUND } from '../track/defs/proving.ts';
import { closestOnSegment } from '../math/geom.ts';
import type { Track } from '../track/types.ts';
import { createCar, stepCarDynamics } from './car.ts';
import { neutralInput } from './input.ts';
import { stepWorld } from './step.ts';
import { createWorld } from './world.ts';

const asphalt = makeSurfaceMix();

/** Exact distance from a point to the centreline polyline. */
function exactDistance(track: Track, x: number, z: number): number {
  const c = { x: 0, z: 0, t: 0, d2: 0 };
  let best = Infinity;
  for (let i = 0; i < track.n; i++) {
    const j = (i + 1) % track.n;
    closestOnSegment(x, z, track.px[i], track.pz[i], track.px[j], track.pz[j], c);
    best = Math.min(best, c.d2);
  }
  return Math.sqrt(best);
}

describe('car dynamics', () => {
  it('accelerates 0-100 km/h in 2.4-3.0 s', () => {
    const car = createCar(0, 0, 0, Math.PI / 2);
    const inp = neutralInput();
    inp.throttle = 1;
    let ticks = 0;
    while (Math.hypot(car.vx, car.vz) < 100 / 3.6 && ticks < 600) {
      stepCarDynamics(car, inp, DEFAULT_TUNING, asphalt, DT);
      ticks++;
    }
    const t = ticks * DT;
    expect(t).toBeGreaterThanOrEqual(2.4);
    expect(t).toBeLessThanOrEqual(3.0);
  });

  it('reaches top speed within 2%', () => {
    const car = createCar(0, 0, 0, 0);
    const inp = neutralInput();
    inp.throttle = 1;
    for (let i = 0; i < 60 * 25; i++) stepCarDynamics(car, inp, DEFAULT_TUNING, asphalt, DT);
    const v = Math.hypot(car.vx, car.vz);
    expect(Math.abs(v - DEFAULT_TUNING.vTop) / DEFAULT_TUNING.vTop).toBeLessThan(0.02);
  });

  it('grips at full lock on asphalt at high speed (understeers, no self-slide)', () => {
    for (const speed of [18, 30, 44]) {
      const car = createCar(0, 0, 0, 0);
      car.vz = -speed;
      const inp = neutralInput();
      inp.throttle = 1;
      inp.steer = 1;
      for (let i = 0; i < 120; i++) {
        stepCarDynamics(car, inp, DEFAULT_TUNING, asphalt, DT);
        expect(car.sliding, `speed ${speed} tick ${i}`).toBe(0);
        expect(Math.abs(car.latAccel)).toBeLessThanOrEqual(DEFAULT_TUNING.aGrip * 1.01);
      }
    }
  });

  it('a normal brake before turning in does not start a drift', () => {
    const car = createCar(0, 0, 0, 0);
    car.vz = -35;
    const inp = neutralInput();
    for (let i = 0; i < 90; i++) {
      // 0.4 s of braking, then turn in on the throttle.
      inp.brake = i < 24 ? 1 : 0;
      inp.throttle = inp.brake ? 0 : 1;
      inp.steer = i >= 24 ? 1 : 0;
      stepCarDynamics(car, inp, DEFAULT_TUNING, asphalt, DT);
      expect(car.sliding, `tick ${i}`).toBe(0);
    }
  });

  it('holding the brake while steering only brakes', () => {
    const car = createCar(0, 0, 0, 0);
    car.vz = -35;
    const inp = neutralInput();
    inp.brake = 1;
    inp.steer = 1;
    for (let i = 0; i < 90; i++) {
      stepCarDynamics(car, inp, DEFAULT_TUNING, asphalt, DT);
      expect(car.sliding).toBe(0);
    }
  });

  it('a brake tap while steering starts a drift', () => {
    for (const tapFirst of [false, true]) {
      const car = createCar(0, 0, 0, 0);
      car.vz = -32;
      const inp = neutralInput();
      inp.throttle = 1;
      let started = -1;
      for (let i = 0; i < 60; i++) {
        // Tap = 6 ticks of brake; steering either already held or right after.
        inp.brake = i >= 10 && i < 16 ? 1 : 0;
        inp.throttle = inp.brake ? 0 : 1;
        inp.steer = tapFirst ? (i >= 17 ? 1 : 0) : 1;
        stepCarDynamics(car, inp, DEFAULT_TUNING, asphalt, DT);
        if (car.sliding && started < 0) started = i;
      }
      expect(started, `tapFirst=${tapFirst}`).toBeGreaterThanOrEqual(16);
      expect(started).toBeLessThan(30);
    }
  });

  it('lifting off and back on the gas while steering starts a drift', () => {
    const car = createCar(0, 0, 0, 0);
    car.vz = -32;
    const inp = neutralInput();
    inp.steer = 1;
    let started = -1;
    for (let i = 0; i < 60; i++) {
      inp.throttle = i >= 10 && i < 18 ? 0 : 1;
      stepCarDynamics(car, inp, DEFAULT_TUNING, asphalt, DT);
      if (car.sliding && started < 0) started = i;
    }
    expect(started).toBeGreaterThanOrEqual(18);
    expect(started).toBeLessThan(26);
  });

  it('coasting for a while before getting back on the gas does not drift', () => {
    const car = createCar(0, 0, 0, 0);
    car.vz = -32;
    const inp = neutralInput();
    for (let i = 0; i < 90; i++) {
      inp.throttle = i >= 10 && i < 40 ? 0 : 1;
      inp.steer = i >= 30 ? 1 : 0;
      stepCarDynamics(car, inp, DEFAULT_TUNING, asphalt, DT);
      expect(car.sliding, `tick ${i}`).toBe(0);
    }
  });

  it('slides on its own on ice', () => {
    const ice = makeSurfaceMix();
    mixSurfaces(Surface.Ice, Surface.Ice, ice);
    const car = createCar(0, 0, 0, 0);
    car.vz = -20;
    const inp = neutralInput();
    inp.throttle = 0.5;
    inp.steer = 1;
    let slid = false;
    for (let i = 0; i < 60; i++) {
      stepCarDynamics(car, inp, DEFAULT_TUNING, ice, DT);
      if (car.sliding) slid = true;
    }
    expect(slid).toBe(true);
  });

  it('survives 100k ticks of random input without NaN or leaving the track', () => {
    const track = buildTrack(PROVING_GROUND);
    const world = createWorld(track, 3, 7);
    const rnd = makeRng(1234);
    const inputs = [neutralInput(), neutralInput(), neutralInput()];
    // Grid distances are quantised to 0.5 m cells, hence the extra tolerance.
    const limit = track.def.width / 2 + track.def.runoff - DEFAULT_TUNING.circleR + 0.4;
    let worst = 0;
    for (let tick = 0; tick < 100_000; tick++) {
      if (tick % 20 === 0) {
        for (const inp of inputs) {
          inp.steer = rnd() * 2 - 1;
          inp.throttle = rnd() < 0.7 ? 1 : 0;
          inp.brake = rnd() < 0.15 ? 1 : 0;
          inp.buttons = rnd() < 0.5 ? 128 : 0;
        }
      }
      stepWorld(world, track, inputs, [DEFAULT_TUNING]);
      for (const car of world.cars) {
        for (const v of [car.x, car.z, car.vx, car.vz, car.heading, car.angVel]) {
          if (!Number.isFinite(v)) throw new Error(`non-finite state at tick ${tick}`);
        }
        worst = Math.max(worst, distanceToCentreline(track, car.x, car.z));
      }
    }
    expect(worst).toBeLessThanOrEqual(limit);
  });

  it('never passes through a wall at 55 m/s', () => {
    const track = buildTrack(PROVING_GROUND);
    const limit = track.def.width / 2 + track.def.runoff - DEFAULT_TUNING.circleR + 0.05;
    for (let k = 0; k < 40; k++) {
      const world = createWorld(track, 1, 1);
      const car = world.cars[0];
      const i = Math.floor((k / 40) * track.n);
      car.x = track.px[i];
      car.z = track.pz[i];
      car.trackIdx = i;
      // Aim between 15° and 90° off the tangent, alternating sides.
      const side = k % 2 === 0 ? 1 : -1;
      const ang = Math.atan2(track.tx[i], -track.tz[i]) + side * (0.25 + (k % 7) * 0.2);
      car.heading = ang;
      car.vx = Math.sin(ang) * 55;
      car.vz = -Math.cos(ang) * 55;
      for (let tick = 0; tick < 90; tick++) {
        stepWorld(world, track, [neutralInput()], [DEFAULT_TUNING]);
        expect(exactDistance(track, car.x, car.z)).toBeLessThanOrEqual(limit);
      }
    }
  });
});
