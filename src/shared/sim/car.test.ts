import { describe, expect, it } from 'vitest';
import { DT } from '../config/constants.ts';
import { makeSurfaceMix } from '../config/surfaces.ts';
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

  it('breaks traction with full lock at high speed but not at medium speed', () => {
    for (const [speed, expectSlide] of [[40, true], [18, false]] as const) {
      const car = createCar(0, 0, 0, 0);
      car.vz = -speed;
      const inp = neutralInput();
      inp.throttle = 0.6;
      inp.steer = 1;
      let slid = false;
      for (let i = 0; i < 45; i++) {
        stepCarDynamics(car, inp, DEFAULT_TUNING, asphalt, DT);
        if (car.sliding) slid = true;
      }
      expect(slid, `speed ${speed}`).toBe(expectSlide);
    }
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
