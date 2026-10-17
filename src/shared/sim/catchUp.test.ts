import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { getTrack, pointAt } from '../track/builder.ts';
import { TRACK_LIST } from '../track/defs/index.ts';
import { GREEN_VALLEY } from '../track/defs/greenValley.ts';
import { catchUpGap } from './catchUp.ts';
import { Ev } from './events.ts';
import { neutralInput } from './input.ts';
import { resetProgress } from './race.ts';
import { stepWorld } from './step.ts';
import { createWorld } from './world.ts';

describe('catch-up boost pads', () => {
  it('every track has a few, spread out and off the start straight', () => {
    for (const def of TRACK_LIST) {
      const t = getTrack(def);
      expect(t.boosts.length, def.id).toBeGreaterThanOrEqual(2);
      for (const s of t.boosts) expect(Math.min(s, t.length - s), def.id).toBeGreaterThan(80);
    }
  });

  /** Car 1 drives over the first pad; the leader (car 0) is `ahead` metres of race distance in front. */
  function overPad(ahead: number) {
    const track = getTrack(GREEN_VALLEY);
    const w = createWorld(track, 2, 1, { laps: 9, countdownTicks: 0 });
    stepWorld(w, track, [], [DEFAULT_TUNING]);
    const [leader, car] = w.cars;
    const p = { x: 0, z: 0, heading: 0 };
    pointAt(track, track.boosts[0] - 20, p);
    Object.assign(car, { x: p.x, z: p.z, heading: p.heading, vx: Math.sin(p.heading) * 20, vz: -Math.cos(p.heading) * 20 });
    resetProgress(car, track);
    // Park the leader far up the road.
    pointAt(track, track.boosts[0] + 300, p);
    Object.assign(leader, { x: p.x, z: p.z, heading: p.heading });
    resetProgress(leader, track);
    leader.raceDist = car.raceDist + ahead;
    let boosts = 0;
    let maxTurbo = 0;
    for (let k = 0; k < 90; k++) {
      leader.raceDist = car.raceDist + ahead;
      stepWorld(w, track, [neutralInput(), { ...neutralInput(), throttle: 1 }], [DEFAULT_TUNING]);
      for (let e = 0; e < w.events.count; e++) if (w.events.list[e].kind === Ev.Turbo && w.events.list[e].car === 1) boosts++;
      maxTurbo = Math.max(maxTurbo, car.turboTicks);
    }
    return { boosts, maxTurbo, gap: catchUpGap(track) };
  }

  it('boost a car far behind the leader, once per pad', () => {
    const r = overPad(1000);
    expect(r.boosts).toBe(1);
    expect(r.maxTurbo).toBeGreaterThan(50);
  });

  it('do nothing for a car close to the leader', () => {
    const r = overPad(50);
    expect(r.boosts).toBe(0);
    expect(r.maxTurbo).toBe(0);
  });
});
