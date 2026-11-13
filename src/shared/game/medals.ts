// Medals: a lap faster than a track's BRONZE, SILVER or GOLD time (per league)
// earns that medal. The times are in medalTimes.ts (made by `npm run medals`).

import { leagueOf, type League } from './leagues.ts';
import { MEDAL_TICKS } from './medalTimes.ts';

/** 0 = none, 1 = bronze, 2 = silver, 3 = gold. */
export type Medal = 0 | 1 | 2 | 3;

export const MEDAL_NAMES = ['', 'BRONZE', 'SILVER', 'GOLD'] as const;
export const MEDAL_COLORS = ['#6a7488', '#cf8a4c', '#d3dae6', '#ffd84a'] as const;

export interface MedalTimes {
  gold: number;
  silver: number;
  bronze: number;
}

/** The medal times (ticks) of a game track in a league; undefined for player tracks. */
export function medalTimes(track: string, league: League | undefined): MedalTimes | undefined {
  const t = MEDAL_TICKS[track]?.[leagueOf(league)];
  return t ? { gold: t[0], silver: t[1], bronze: t[2] } : undefined;
}

/** The medal a lap time (ticks) earns; 0 for no lap, no medal or a track without medals. */
export function medalFor(track: string, league: League | undefined, ticks: number): Medal {
  const t = medalTimes(track, league);
  if (!t || !(ticks > 0)) return 0;
  return ticks <= t.gold ? 3 : ticks <= t.silver ? 2 : ticks <= t.bronze ? 1 : 0;
}
