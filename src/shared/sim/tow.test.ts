import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { getTrack } from '../track/builder.ts';
import { GREEN_VALLEY } from '../track/defs/greenValley.ts';
import { Ev } from './events.ts';
import { stepWorld } from './step.ts';
import { WEAPON } from './weapons.ts';
import { createWorld } from './world.ts';

describe('towed back after a wreck', () => {
  it('stays untouchable longer than an ordinary respawn, to get clear of the mines', () => {
    const track = getTrack(GREEN_VALLEY);
    const w = createWorld(track, 2, 1, { laps: 3, countdownTicks: 0, weapons: true });
    // Past the start grace, then wreck car 1.
    w.tick = WEAPON.startGrace + 1;
    w.cars[1].damage = 1;
    let back = -1;
    for (let k = 0; k < WEAPON.wreckTicks + 10 && back < 0; k++) {
      stepWorld(w, track, [], [DEFAULT_TUNING]);
      for (let e = 0; e < w.events.count; e++) {
        const ev = w.events.list[e];
        if (ev.kind === Ev.Respawn && ev.car === 1 && ev.value === 2) back = w.cars[1].ghostTicks;
      }
    }
    expect(back).toBeGreaterThan(120);
    expect(w.cars[1].damage).toBe(WEAPON.wreckRepair);
  });
});
