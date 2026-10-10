import { describe, expect, it } from 'vitest';
import { GREEN_VALLEY } from '../track/defs/greenValley.ts';
import { DUST_BOWL } from '../track/defs/dustBowl.ts';
import { FROST_RING } from '../track/defs/frostRing.ts';
import { MELTDOWN } from '../track/defs/meltdown.ts';
import { simulateRace } from './raceSim.ts';

describe('full AI races', () => {
  it('every car finishes a 2-lap race on Green Valley', () => {
    for (const seed of [1, 2, 3]) {
      const r = simulateRace(GREEN_VALLEY, seed, { laps: 2 });
      expect(r.finished, `seed ${seed}: ${JSON.stringify(r)}`).toBe(r.cars);
      expect(r.respawns, `seed ${seed}`).toBeLessThanOrEqual(2);
    }
  });

  for (const def of [DUST_BOWL, FROST_RING, MELTDOWN]) {
    it(`every car finishes on ${def.name}, with and without weapons`, () => {
      for (const weapons of [false, true]) {
        const r = simulateRace(def, 4, { laps: 2, weapons });
        expect(r.finished, `${def.id} weapons=${weapons}: ${JSON.stringify(r)}`).toBe(r.cars);
      }
    });
  }
});
