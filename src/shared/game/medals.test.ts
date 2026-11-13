import { describe, expect, it } from 'vitest';
import { LEAGUES } from './leagues.ts';
import { medalFor, medalTimes } from './medals.ts';
import { MEDAL_TICKS } from './medalTimes.ts';
import { TRACK_LIST } from '../track/defs/index.ts';

describe('medal table', () => {
  it('has an entry for every built-in track and league, bronze slower than silver slower than gold', () => {
    for (const def of TRACK_LIST) {
      for (const league of LEAGUES) {
        const t = medalTimes(def.id, league);
        expect(t, `${def.id} ${league}`).toBeDefined();
        expect(t!.gold).toBeGreaterThan(0);
        expect(t!.bronze).toBeGreaterThan(t!.silver);
        expect(t!.silver).toBeGreaterThan(t!.gold);
      }
    }
  });

  it('has no entries for tracks that do not exist', () => {
    const ids = new Set(TRACK_LIST.map((t) => t.id));
    for (const id of Object.keys(MEDAL_TICKS)) expect(ids.has(id), id).toBe(true);
  });

  it('gives the medal for a lap time', () => {
    const t = medalTimes('greenvalley', 'standard')!;
    expect(medalFor('greenvalley', 'standard', t.gold)).toBe(3);
    expect(medalFor('greenvalley', 'standard', t.gold + 1)).toBe(2);
    expect(medalFor('greenvalley', 'standard', t.silver)).toBe(2);
    expect(medalFor('greenvalley', 'standard', t.silver + 1)).toBe(1);
    expect(medalFor('greenvalley', 'standard', t.bronze)).toBe(1);
    expect(medalFor('greenvalley', 'standard', t.bronze + 1)).toBe(0);
    expect(medalFor('greenvalley', 'standard', 0)).toBe(0);
    expect(medalFor('p-custom', 'standard', 100)).toBe(0);
  });
});
