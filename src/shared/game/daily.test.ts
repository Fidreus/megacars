import { describe, expect, it } from 'vitest';
import type { RaceSpec } from '../net/protocol.ts';
import { TRACK_LIST } from '../track/defs/index.ts';
import {
  addDays, DAILY_BOARD_SIZE, DAILY_GRACE_MS, dailyChallenge, dailyPlace, dailySpecProblem, DAY_MS, dayNumber, dayOf, dayOpen, insertDaily, type DailyEntry,
} from './daily.ts';

const IDS = TRACK_LIST.map((t) => t.id);

describe('daily challenge choice', () => {
  it('is the same for the same date, every time', () => {
    expect(dailyChallenge('2026-11-13')).toEqual(dailyChallenge('2026-11-13'));
    expect(dailyChallenge('2026-11-13').day).toBe('2026-11-13');
  });

  it('changes at UTC midnight and not before', () => {
    const midnight = Date.parse('2026-11-14T00:00:00Z');
    expect(dayOf(midnight - 1)).toBe('2026-11-13');
    expect(dayOf(midnight)).toBe('2026-11-14');
    // Over a whole cycle no two days in a row are the same challenge.
    for (let k = 0; k < 60; k++) {
      const a = dailyChallenge(dayOf(midnight + (k - 1) * DAY_MS));
      const b = dailyChallenge(dayOf(midnight + k * DAY_MS));
      expect(b.track).not.toBe(a.track);
    }
  });

  it('goes through every track once per cycle, never twice in a row', () => {
    const n = IDS.length;
    const start = Math.ceil(dayNumber('2026-01-01') / n) * n;
    for (let c = 0; c < 20; c++) {
      const seen = new Set<string>();
      for (let k = 0; k < n; k++) seen.add(dailyChallenge(dayOf((start + c * n + k) * DAY_MS)).track);
      expect(seen.size).toBe(n);
    }
    for (let d = start; d < start + 20 * n; d++) {
      expect(dailyChallenge(dayOf(d * DAY_MS)).track).not.toBe(dailyChallenge(dayOf((d + 1) * DAY_MS)).track);
    }
  });

  it('brings a track back in another league and at another time of day', () => {
    const n = IDS.length;
    const start = Math.ceil(dayNumber('2026-01-01') / n) * n;
    const last = new Map<string, { league: string; mood: string }>();
    const leagues = new Set<string>();
    const moods = new Set<string>();
    for (let d = start; d < start + 30 * n; d++) {
      const ch = dailyChallenge(dayOf(d * DAY_MS));
      const before = last.get(ch.track);
      if (before) {
        expect(ch.league).not.toBe(before.league);
        expect(ch.mood).not.toBe(before.mood);
      }
      last.set(ch.track, ch);
      leagues.add(ch.league);
      moods.add(ch.mood);
    }
    expect(leagues.size).toBe(3);
    expect(moods.size).toBe(3);
  });

  it('works with more tracks (or very few) without breaking', () => {
    for (const list of [[...IDS, 'newtrack1', 'newtrack2'], IDS.slice(0, 2), IDS.slice(0, 1)]) {
      const n = list.length;
      const start = Math.ceil(dayNumber('2027-03-01') / n) * n;
      const seen = new Set<string>();
      for (let k = 0; k < n; k++) {
        const ch = dailyChallenge(dayOf((start + k) * DAY_MS), list);
        expect(list).toContain(ch.track);
        seen.add(ch.track);
      }
      expect(seen.size).toBe(n);
    }
    expect(() => dailyChallenge('not a day')).toThrow();
  });

  it('counts dates in UTC', () => {
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(dayNumber('2026-02-30')).toBeNaN();
  });

  it('takes laps for today, and for yesterday only just after midnight', () => {
    const midnight = Date.parse('2026-11-14T00:00:00Z');
    expect(dayOpen('2026-11-13', midnight - 5)).toBe(true);
    expect(dayOpen('2026-11-14', midnight - 5)).toBe(false);
    expect(dayOpen('2026-11-13', midnight + DAILY_GRACE_MS - 1)).toBe(true);
    expect(dayOpen('2026-11-13', midnight + DAILY_GRACE_MS + 1)).toBe(false);
    expect(dayOpen('2026-11-12', midnight)).toBe(false);
  });
});

describe('daily rules', () => {
  const ch = dailyChallenge('2026-11-13');
  const spec: RaceSpec = {
    id: 0, track: ch.track, laps: 0, seed: 5, countdownTicks: 0, weapons: false, league: ch.league,
    entrants: [{ name: 'YOU', color: '#f00', playerId: 0, skill: 0.9 }],
  };

  it('takes a time trial on the day track and league only', () => {
    expect(dailySpecProblem(spec, ch)).toBeNull();
    const other = IDS.find((t) => t !== ch.track)!;
    expect(dailySpecProblem({ ...spec, track: other }, ch)).toBe('wrong track');
    expect(dailySpecProblem({ ...spec, league: ch.league === 'mega' ? 'super' : 'mega' }, ch)).toBe('wrong league');
    expect(dailySpecProblem({ ...spec, weapons: true }, ch)).toBe('no weapons');
    const ai = { name: 'AI', color: '#fff', playerId: -1, skill: 0.9 };
    expect(dailySpecProblem({ ...spec, entrants: [ai, ...spec.entrants] }, ch)).toBe('alone only');
    expect(dailySpecProblem({ ...spec, entrants: [{ ...spec.entrants[0], loadout: {} as never }] }, ch)).toBe('stock cars only');
  });
});

describe('daily board', () => {
  const e = (name: string, ticks: number): DailyEntry => ({ name, ticks, at: 0 });

  it('keeps the best lap per name, fastest first', () => {
    const b: DailyEntry[] = [];
    expect(insertDaily(b, e('A', 3000))).toBe(1);
    expect(insertDaily(b, e('B', 2900))).toBe(1);
    expect(insertDaily(b, e('A', 3100))).toBe(0);
    expect(insertDaily(b, e('A', 2800))).toBe(1);
    expect(b.map((x) => x.name)).toEqual(['A', 'B']);
    // A tie goes behind the one who set it first.
    expect(insertDaily(b, e('C', 2900))).toBe(3);
  });

  it('holds the top 50', () => {
    const b: DailyEntry[] = [];
    for (let k = 0; k < 60; k++) insertDaily(b, e(`P${k}`, 3000 + k));
    expect(b.length).toBe(DAILY_BOARD_SIZE);
    expect(insertDaily(b, e('SLOW', 9999))).toBe(0);
    expect(insertDaily(b, e('FAST', 100))).toBe(1);
    expect(b.length).toBe(DAILY_BOARD_SIZE);
    expect(b.at(-1)!.name).toBe('P48');
  });

  it('works out the place a lap would take', () => {
    const b = [e('A', 2800), e('B', 2900), e('C', 3000)];
    expect(dailyPlace(b, 'ME', 2700)).toBe(1);
    expect(dailyPlace(b, 'ME', 2900)).toBe(3);
    expect(dailyPlace(b, 'B', 2900)).toBe(2);
    expect(dailyPlace(b, 'C', 2850)).toBe(2);
    expect(dailyPlace([], 'ME', 5000)).toBe(1);
  });
});
