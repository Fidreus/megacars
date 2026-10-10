import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { getTrack, pointAt } from '../track/builder.ts';
import { TWIN_BRIDGES } from '../track/defs/twinBridges.ts';
import { validateTrack } from '../track/validate.ts';
import { Ev } from './events.ts';
import { neutralInput } from './input.ts';
import { resetProgress } from './race.ts';
import { stepWorld } from './step.ts';
import { createWorld } from './world.ts';

const track = getTrack(TWIN_BRIDGES);
const [jump, viaduct] = track.bridges;

/** One car on the centreline at distance `s`, moving at `speed`, driven straight along. */
function drive(s: number, speed: number, ticks: number, throttle = 1) {
  const w = createWorld(track, 1, 1, { laps: 3, countdownTicks: 0 });
  const car = w.cars[0];
  const p = { x: 0, z: 0, heading: 0 };
  pointAt(track, s, p);
  Object.assign(car, { x: p.x, z: p.z, heading: p.heading, vx: Math.sin(p.heading) * speed, vz: -Math.cos(p.heading) * speed });
  resetProgress(car, track);
  const gas = { ...neutralInput(), throttle };
  let peak = 0;
  let wallHits = 0;
  let fell = false;
  let minSpeed = Infinity;
  for (let t = 0; t < ticks; t++) {
    stepWorld(w, track, [gas], [DEFAULT_TUNING]);
    peak = Math.max(peak, car.y);
    minSpeed = Math.min(minSpeed, Math.hypot(car.vx, car.vz));
    for (let k = 0; k < w.events.count; k++) {
      const e = w.events.list[k];
      if (e.kind === Ev.WallHit) wallHits++;
      if (e.kind === Ev.Respawn && e.value === 3) fell = true;
    }
  }
  return { car, peak, wallHits, fell, minSpeed };
}

describe('bridges', () => {
  it('builds Twin Bridges with a broken bridge and a viaduct', () => {
    expect(validateTrack(track)).toEqual([]);
    expect(track.bridges).toHaveLength(2);
    expect(jump.gap).toBe(true);
    expect(viaduct.gap).toBe(false);
  });

  it('carries a car over the viaduct at deck height without touching the walls below', () => {
    const r = drive(viaduct.s - viaduct.span - viaduct.ramp - 20, 30, 300);
    expect(r.peak).toBeGreaterThan(viaduct.height - 0.05);
    expect(r.peak).toBeLessThan(viaduct.height + 0.6);
    expect(r.wallHits).toBe(0);
    expect(r.car.y).toBe(0);
    expect(r.car.trackS).toBeGreaterThan(viaduct.s + viaduct.span + viaduct.ramp);
  });

  it('lets a car drive under the viaduct and under the jump', () => {
    for (const b of [viaduct, jump]) {
      const r = drive(b.sLower - 40, 30, 150);
      expect(r.peak).toBe(0);
      expect(r.wallHits).toBe(0);
      expect(r.minSpeed).toBeGreaterThan(25);
    }
  });

  it('a fast car clears the gap; a slow one drops into the hole and goes back to the run-up', () => {
    const start = jump.s - jump.span - jump.ramp - 30;
    const fast = drive(start, 42, 200);
    expect(fast.fell).toBe(false);
    expect(fast.peak).toBeGreaterThan(jump.height);
    expect(fast.car.trackS).toBeGreaterThan(jump.s + jump.span + 20);
    const slow = drive(start, 22, 400, 0);
    expect(slow.fell).toBe(true);
    expect(slow.car.trackS).toBeLessThan(start);
  });
});
