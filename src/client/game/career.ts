// Career: work your way up from Division 3 to Division 1 and win it. Every
// season is a championship over all tracks against tougher, better-equipped
// drivers; finishing in the top three moves you up. Money, upgrades, car and
// damage carry over from season to season. Saved in localStorage.

import { newProfile, type Profile } from '../../shared/game/shop.ts';
import { humanDrivers, newChampionship, type Championship } from './championship.ts';
import type { RaceSettings } from './settings.ts';

const KEY = 'megacars.career.v1';

export const DIVISIONS = 3;
/** Season-end bonus by final place, times the division factor. */
const SEASON_BONUS = [3000, 2000, 1500, 1000, 700, 500, 300, 200];
const DIVISION_FACTOR = [0, 2, 1.5, 1]; // index = division (1 pays most)
/** Places that move you up a division. */
export const PROMOTION_PLACES = 3;

export type SeasonOutcome = 'promoted' | 'stayed' | 'champion' | 'defended' | 'lost';

export interface SeasonResult {
  division: number;
  place: number;
  bonus: number;
  outcome: SeasonOutcome;
}

export interface Career {
  version: 1;
  /** 3 (lowest) .. 1 (top). */
  division: number;
  season: number;
  titles: number;
  /** Between seasons; during a season the profile lives in the cup. */
  profile: Profile;
  cup: Championship;
  last: SeasonResult | null;
}

function seasonSettings(division: number): RaceSettings {
  return {
    track: '',
    players: 1,
    opponents: 7,
    laps: 3,
    // Division 3 is EASY, 2 NORMAL, 1 HARD.
    difficulty: DIVISIONS - division,
    mood: 'day',
    practice: false,
    weapons: true,
    musicMode: 0,
    musicVolume: 0,
    soundVolume: 0,
    graphics: 0,
    touchGas: 'thumb',
    touchSteer: 'slide',
  };
}

function startSeason(c: Career): void {
  c.cup = newChampionship(seasonSettings(c.division));
  const me = humanDrivers(c.cup)[0];
  me.profile = { ...c.profile, points: 0, lastEarned: 0 };
}

export function newCareer(): Career {
  const c = { version: 1, division: DIVISIONS, season: 1, titles: 0, profile: newProfile(), last: null } as unknown as Career;
  startSeason(c);
  return c;
}

/** Final place of the player in the season that just ended. */
export function seasonPlace(c: Career): number {
  const ranked = [...c.cup.drivers].sort((a, b) => b.profile.points - a.profile.points || b.profile.wins - a.profile.wins);
  return ranked.findIndex((d) => d.player === 0) + 1;
}

/** Close a finished season: bonus, promotion, title; then set up the next one. */
export function endSeason(c: Career): SeasonResult {
  const me = humanDrivers(c.cup)[0];
  const place = seasonPlace(c);
  const bonus = Math.round((SEASON_BONUS[place - 1] ?? 0) * DIVISION_FACTOR[c.division]);
  c.profile = { ...me.profile, money: me.profile.money + bonus, points: 0, lastEarned: 0 };
  let outcome: SeasonOutcome;
  if (c.division === 1) {
    if (place === 1) {
      outcome = c.titles > 0 ? 'defended' : 'champion';
      c.titles++;
    } else {
      outcome = place <= PROMOTION_PLACES ? 'stayed' : 'lost';
    }
  } else if (place <= PROMOTION_PLACES) {
    outcome = 'promoted';
    c.division--;
  } else {
    outcome = 'stayed';
  }
  c.last = { division: outcome === 'promoted' ? c.division + 1 : c.division, place, bonus, outcome };
  c.season++;
  startSeason(c);
  return c.last;
}

export function saveCareer(c: Career | null): void {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    // Not saved; the career still works this session.
  }
}

export function loadCareer(): Career | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Career;
    if (c.version !== 1 || !c.cup || !c.profile) return null;
    return c;
  } catch {
    return null;
  }
}
