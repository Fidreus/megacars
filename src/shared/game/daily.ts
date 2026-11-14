// The daily challenge: one track, league and time of day for everybody each
// day (UTC), driven under time trial rules (alone, stock car, no weapons,
// best single lap). The choice is a pure function of the date, so the server
// and an offline client agree. Tracks come round in a shuffled cycle: every
// built-in track once before any repeats, and each time a track comes back
// it is in another league and at another time of day.

import { hash3 } from '../math/rng.ts';
import type { RaceSpec } from '../net/protocol.ts';
import { TRACK_LIST } from '../track/defs/index.ts';
import { LEAGUES, type League } from './leagues.ts';
import { specProblem } from './records.ts';

export const DAY_MS = 86_400_000;
/** Entries on a day's board (best lap per name). */
export const DAILY_BOARD_SIZE = 50;
/** Entries whose race is kept (for their ghost) while the day runs; afterwards only the winner's. */
export const DAILY_REPLAYS = 10;
/** Days whose boards are kept, today included. */
export const DAILY_DAYS_KEPT = 30;
/** A lap started before midnight may still be sent this long after it. */
export const DAILY_GRACE_MS = 10 * 60_000;
/** Times of day (the client's lighting moods). */
export const DAILY_MOODS = ['day', 'sunset', 'night'] as const;
export type DailyMood = (typeof DAILY_MOODS)[number];
/** "2026-11-13" */
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DailyChallenge {
  /** UTC date, "2026-11-13". */
  day: string;
  track: string;
  league: League;
  mood: DailyMood;
}

export interface DailyEntry {
  name: string;
  /** Best lap (ticks). */
  ticks: number;
  /** When it was set (ms since 1970). */
  at: number;
  /** Its kept race (GET /api/records/replay/<id>), while it has one. */
  id?: string;
}

/** A lap for the day's board: a record submission plus the day it is for. */
export interface DailySubmission {
  v: number;
  name: string;
  day: string;
  spec: RaceSpec;
  replay: string;
}

export interface DailyResult {
  ok: boolean;
  error?: string;
  /** The race's best verified lap (ticks). */
  best?: number;
  /** Place of this lap on the day's board (0 = not better than your entry, or off the board). */
  rank?: number;
  /** Where your best entry of the day stands now (0 = not on the board). */
  place?: number;
  /** Place on the world board (0 = not on it). */
  worldRank?: number;
}

/** What GET /api/daily answers. */
export interface DailyView {
  ok: boolean;
  /** The server's clock (ms), for the time left. */
  now: number;
  /** When this day's challenge ends (ms). */
  endsAt: number;
  challenge: DailyChallenge;
  board: DailyEntry[];
  /** Yesterday's challenge and its top three (null if nobody drove it). */
  yesterday: { challenge: DailyChallenge; top: DailyEntry[] } | null;
}

/** The UTC date of a moment, "YYYY-MM-DD". */
export function dayOf(ms: number): string {
  return new Date(Math.floor(ms / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

/** Days since 1970-01-01 of a "YYYY-MM-DD" date (NaN if it isn't one). */
export function dayNumber(day: string): number {
  if (!DAY_RE.test(day)) return NaN;
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) && dayOf(ms) === day ? ms / DAY_MS : NaN;
}

/** The date `n` days after `day`. */
export function addDays(day: string, n: number): string {
  return dayOf((dayNumber(day) + n) * DAY_MS);
}

/** Start of the next UTC day after `ms`. */
export function nextDayStart(ms: number): number {
  return (Math.floor(ms / DAY_MS) + 1) * DAY_MS;
}

/** A small stable hash of a string (track ids). */
function strHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Cycle `c`'s order of n tracks (a seeded shuffle). */
function shuffled(c: number, n: number, salt: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(hash3(c, i, salt) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * The challenge of a day. `tracks` is the list to choose from (the game's
 * built-in tracks); adding one reshuffles days from then on but never breaks.
 */
export function dailyChallenge(day: string, tracks: readonly string[] = TRACK_LIST.map((t) => t.id)): DailyChallenge {
  const d = dayNumber(day);
  if (!Number.isFinite(d) || tracks.length === 0) throw new Error(`no challenge for ${day}`);
  const n = tracks.length;
  const salt = strHash(tracks.join(','));
  const c = Math.floor(d / n);
  const order = shuffled(c, n, salt);
  // No track twice in a row where one cycle ends and the next begins.
  if (n >= 3 && order[0] === shuffled(c - 1, n, salt)[n - 1]) [order[0], order[1]] = [order[1], order[0]];
  const i = order[d - c * n];
  // Each time a track comes round its league and time of day move on, and
  // within a cycle the tracks spread over every league and time of day.
  const league = LEAGUES[(c + i) % LEAGUES.length];
  const mood = DAILY_MOODS[(c + Math.floor(c / 3) + Math.floor(i / 3)) % DAILY_MOODS.length];
  return { day, track: tracks[i], league, mood };
}

/** A lap for `day` may be sent now: it is the day, or it ended moments ago. */
export function dayOpen(day: string, now: number): boolean {
  return day === dayOf(now) || day === dayOf(now - DAILY_GRACE_MS);
}

/** Why a race can't count for the challenge, or null if it can. */
export function dailySpecProblem(spec: RaceSpec, ch: DailyChallenge): string | null {
  const problem = specProblem(spec);
  if (problem) return problem;
  if (spec.track !== ch.track) return 'wrong track';
  if ((spec.league ?? 'standard') !== ch.league) return 'wrong league';
  if (spec.entrants.length !== 1) return 'alone only';
  if (spec.weapons) return 'no weapons';
  return null;
}

/** Insert an entry (one per name, best first, top 50); returns its place (1-based) or 0. */
export function insertDaily(board: DailyEntry[], e: DailyEntry): number {
  const mine = board.findIndex((x) => x.name === e.name);
  if (mine >= 0) {
    if (board[mine].ticks <= e.ticks) return 0;
    board.splice(mine, 1);
  }
  let i = 0;
  while (i < board.length && board[i].ticks <= e.ticks) i++;
  if (i >= DAILY_BOARD_SIZE) return 0;
  board.splice(i, 0, e);
  board.length = Math.min(board.length, DAILY_BOARD_SIZE);
  return i + 1;
}

/** The place a lap would take on the board (a slower entry of the same name doesn't count). */
export function dailyPlace(board: readonly DailyEntry[], name: string, ticks: number): number {
  let ahead = 0;
  for (const e of board) if (e.name !== name ? e.ticks <= ticks : e.ticks < ticks) ahead++;
  return ahead + 1;
}
