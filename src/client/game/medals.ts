// Medals you have earned (saved in the browser). Kept apart from the lap
// records: a medal never goes away, whatever happens to the records.

import { boardKey, LEAGUES, type League } from '../../shared/game/leagues.ts';
import { medalFor, type Medal } from '../../shared/game/medals.ts';
import { TRACK_LIST } from '../../shared/track/defs/index.ts';

const KEY = 'megacars.medals.v1';

export interface MedalEntry {
  /** Best lap (ticks) that counted for medals. */
  best: number;
  /** The highest medal earned. */
  medal: Medal;
}

/** By board key: "greenvalley", "greenvalley@super". */
export type MedalBook = Record<string, MedalEntry>;

export function loadMedals(): MedalBook {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : {};
    return v && typeof v === 'object' ? (v as MedalBook) : {};
  } catch {
    return {};
  }
}

function save(book: MedalBook): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(book));
  } catch {
    // Not remembered.
  }
}

export interface MedalNote {
  /** The medal this lap is worth. */
  medal: Medal;
  /** A better medal than any before on this track and league. */
  won: boolean;
}

/**
 * A clean lap (the kind that counts for personal records). Only a personal
 * best counts; returns what it is worth and whether it is a new medal.
 */
export function noteMedalLap(book: MedalBook, track: string, league: League | undefined, ticks: number, persist = true): MedalNote {
  const key = boardKey(track, league);
  const medal = medalFor(track, league, ticks);
  const old = book[key];
  if (old && old.best > 0 && old.best <= ticks) return { medal, won: false };
  const e = (book[key] = { best: ticks, medal: Math.max(old?.medal ?? 0, medal) as Medal });
  const won = medal > (old?.medal ?? 0);
  if (won) e.medal = medal;
  if (persist) save(book);
  return { medal, won };
}

export function medalOf(book: MedalBook, track: string, league: League | undefined): Medal {
  return book[boardKey(track, league)]?.medal ?? 0;
}

export interface MedalTotals {
  /** Medals of at least this colour, over all game tracks and leagues (index 1..3). */
  atLeast: [number, number, number, number];
  /** Gold medals per league. */
  gold: Record<League, number>;
  /** Medals of exactly each colour, over everything. */
  exact: [number, number, number, number];
}

export function medalTotals(book: MedalBook): MedalTotals {
  const t: MedalTotals = { atLeast: [0, 0, 0, 0], gold: { standard: 0, super: 0, mega: 0 }, exact: [0, 0, 0, 0] };
  for (const def of TRACK_LIST) {
    for (const league of LEAGUES) {
      const m = medalOf(book, def.id, league);
      t.exact[m]++;
      for (let k = 1; k <= m; k++) t.atLeast[k]++;
      if (m === 3) t.gold[league]++;
    }
  }
  return t;
}
