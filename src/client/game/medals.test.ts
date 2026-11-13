import { describe, expect, it } from 'vitest';
import { medalTimes } from '../../shared/game/medals.ts';
import { TRACK_LIST } from '../../shared/track/defs/index.ts';
import { medalTotals, noteMedalLap, type MedalBook } from './medals.ts';

const T = medalTimes('greenvalley', 'standard')!;

describe('medal book', () => {
  it('awards a medal only for a personal best that beats the time', () => {
    const book: MedalBook = {};
    expect(noteMedalLap(book, 'greenvalley', 'standard', T.bronze + 50, false)).toEqual({ medal: 0, won: false });
    expect(noteMedalLap(book, 'greenvalley', 'standard', T.bronze, false)).toEqual({ medal: 1, won: true });
    // Not a personal best: nothing.
    expect(noteMedalLap(book, 'greenvalley', 'standard', T.bronze, false).won).toBe(false);
    expect(noteMedalLap(book, 'greenvalley', 'standard', T.silver, false)).toEqual({ medal: 2, won: true });
    expect(noteMedalLap(book, 'greenvalley', 'standard', T.gold, false)).toEqual({ medal: 3, won: true });
    expect(book.greenvalley).toEqual({ best: T.gold, medal: 3 });
  });

  it('keeps leagues apart', () => {
    const book: MedalBook = {};
    noteMedalLap(book, 'greenvalley', 'standard', T.gold, false);
    expect(book['greenvalley@super']).toBeUndefined();
    expect(noteMedalLap(book, 'greenvalley', 'super', T.gold, false).medal).toBe(0);
  });

  it('counts medals', () => {
    const book: MedalBook = {};
    for (const d of TRACK_LIST) noteMedalLap(book, d.id, 'mega', medalTimes(d.id, 'mega')!.gold, false);
    noteMedalLap(book, 'greenvalley', 'standard', T.silver, false);
    const t = medalTotals(book);
    expect(t.gold.mega).toBe(TRACK_LIST.length);
    expect(t.atLeast[1]).toBe(TRACK_LIST.length + 1);
    expect(t.atLeast[3]).toBe(TRACK_LIST.length);
    expect(t.exact[2]).toBe(1);
  });
});
