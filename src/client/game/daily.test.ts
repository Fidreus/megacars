import { describe, expect, it } from 'vitest';
import { dayName, noteDailyLap, streakOf, type DailyLog } from './daily.ts';

describe('daily streak', () => {
  it('counts days in a row with a lap, and waits for today until midnight', () => {
    const log: DailyLog = {};
    expect(streakOf(log, '2026-11-13')).toEqual({ days: 0, today: false });
    noteDailyLap(log, '2026-11-11', 3000);
    noteDailyLap(log, '2026-11-12', 3000);
    // No lap today yet: the streak of two still stands, waiting.
    expect(streakOf(log, '2026-11-13')).toEqual({ days: 2, today: false });
    noteDailyLap(log, '2026-11-13', 3100);
    expect(streakOf(log, '2026-11-13')).toEqual({ days: 3, today: true });
    // A day missed: it starts again.
    expect(streakOf(log, '2026-11-15')).toEqual({ days: 0, today: false });
    noteDailyLap(log, '2026-11-15', 3100);
    expect(streakOf(log, '2026-11-15')).toEqual({ days: 1, today: true });
    // Across a month end.
    const m: DailyLog = { '2026-10-31': 1, '2026-11-01': 1 };
    expect(streakOf(m, '2026-11-01')).toEqual({ days: 2, today: true });
  });

  it('keeps the best lap of each day', () => {
    const log: DailyLog = {};
    expect(noteDailyLap(log, '2026-11-13', 3000)).toBe(true);
    expect(noteDailyLap(log, '2026-11-13', 3100)).toBe(false);
    expect(noteDailyLap(log, '2026-11-13', 2900)).toBe(true);
    expect(log['2026-11-13']).toBe(2900);
  });

  it('names a day', () => {
    expect(dayName('2026-11-13')).toBe('FRI 13 NOV');
  });
});
