import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { getTrack, pointAt } from '../track/builder.ts';
import { MELTDOWN } from '../track/defs/meltdown.ts';
import { Ev } from './events.ts';
import { neutralInput } from './input.ts';
import { resetProgress } from './race.ts';
import { safeRespawnS } from './ramps.ts';
import { stepWorld } from './step.ts';
import { createWorld } from './world.ts';

const track = getTrack(MELTDOWN);
const ramp = track.ramps[0];

/** One car on the centreline `before` metres ahead of the ramp, moving at `speed`. */
function approach(before: number, speed: number) {
  const w = createWorld(track, 1, 1, { laps: 3, countdownTicks: 0 });
  const car = w.cars[0];
  const p = { x: 0, z: 0, heading: 0 };
  pointAt(track, ramp.s0 - before, p);
  Object.assign(car, { x: p.x, z: p.z, heading: p.heading, vx: Math.sin(p.heading) * speed, vz: -Math.cos(p.heading) * speed });
  resetProgress(car, track);
  return w;
}

function fly(speed: number, throttle = 1) {
  const w = approach(30, speed);
  const car = w.cars[0];
  let tookOff = -1;
  let landed = -1;
  let peak = 0;
  const gas = { ...neutralInput(), throttle };
  for (let t = 0; t < 240 && landed < 0; t++) {
    stepWorld(w, track, [gas], [DEFAULT_TUNING]);
    peak = Math.max(peak, car.y);
    if (car.airborne && tookOff < 0) tookOff = car.trackS;
    for (let k = 0; k < w.events.count; k++) if (w.events.list[k].kind === Ev.Land) landed = car.trackS;
  }
  return { tookOff, landed, peak, distance: landed - tookOff };
}

describe('ramps', () => {
  it('builds the Meltdown jump', () => {
    expect(track.ramps).toHaveLength(1);
    expect(ramp.s1 - ramp.s0).toBeCloseTo(11, 5);
  });

  it('launches a fast car clear over the channel', () => {
    const j = fly(40);
    expect(j.tookOff).toBeGreaterThan(ramp.s1 - 2);
    expect(j.peak).toBeGreaterThan(ramp.height + 0.5);
    expect(j.distance).toBeGreaterThan(20);
  });

  it('a slow car only hops, and jumps grow with speed', () => {
    const slow = fly(15, 0);
    const fast = fly(40, 0);
    expect(slow.distance).toBeLessThan(fast.distance / 3);
  });

  it('never puts a car back on a ramp or in its landing zone', () => {
    for (let s = ramp.s0 - 10; s < ramp.s1 + 50; s += 3) {
      const r = safeRespawnS(track, s);
      expect(r < ramp.s0 - 6 || r > ramp.s1 + 45).toBe(true);
    }
  });
});
