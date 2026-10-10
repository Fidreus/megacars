import { describe, expect, it } from 'vitest';
import { GREEN_VALLEY } from '../track/defs/greenValley.ts';
import { simulateRace } from './raceSim.ts';

describe('full AI races', () => {
  it('every car finishes a 2-lap race on Green Valley', () => {
    for (const seed of [1, 2, 3]) {
      const r = simulateRace(GREEN_VALLEY, seed, { laps: 2 });
      expect(r.finished, `seed ${seed}: ${JSON.stringify(r)}`).toBe(r.cars);
      expect(r.respawns, `seed ${seed}`).toBeLessThanOrEqual(2);
    }
  });
});
