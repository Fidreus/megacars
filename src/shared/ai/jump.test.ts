import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { leagueTuning } from '../game/leagues.ts';
import { getTrack } from '../track/builder.ts';
import { BREWERY_BASH } from '../track/defs/breweryBash.ts';
import { GREEN_VALLEY } from '../track/defs/greenValley.ts';
import { Ev } from '../sim/events.ts';
import { stepWorld } from '../sim/step.ts';
import { createWorld, RacePhase } from '../sim/world.ts';
import { jumpTakeoff } from './driver.ts';

describe('computer drivers at jumps', () => {
  it('know where the run-up to a broken bridge is', () => {
    const track = getTrack(BREWERY_BASH);
    const b = track.bridges[1];
    expect(jumpTakeoff(track, b.s - b.span - b.ramp - 10)).toBeCloseTo(b.s - b.span);
    expect(jumpTakeoff(track, b.s + b.span + b.ramp + 20)).toBe(-1);
    expect(jumpTakeoff(getTrack(GREEN_VALLEY), 100)).toBe(-1);
  });

  it('take off straight: Megacars hardly ever hit a wall in the air on Brewery Bash', () => {
    // Before they held their lane up to the jumps, a race like this had several hundred.
    const track = getTrack(BREWERY_BASH);
    const w = createWorld(track, 8, 1, { laps: 3, countdownTicks: 1 });
    for (const c of w.cars) {
      c.aiDriven = 1;
      c.aiSkill = 0.9 + 0.03 * (c.id % 4);
    }
    const t = leagueTuning(DEFAULT_TUNING, 'mega');
    let inAir = 0;
    while (w.race.phase !== RacePhase.Finished && w.tick < 60 * 60 * 4) {
      stepWorld(w, track, [], [t]);
      for (let k = 0; k < w.events.count; k++) {
        const e = w.events.list[k];
        if (e.kind === Ev.WallHit && w.cars[e.car].airborne) inAir++;
      }
    }
    expect(w.race.finishOrder.length).toBe(8);
    expect(inAir).toBeLessThan(10);
  });
});
