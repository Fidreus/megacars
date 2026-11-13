// Computer drivers' characters on the championship screens, and the career
// rival: one computer driver per season to beat in particular.

import { personaIndex, personaOf } from '../../shared/ai/persona.ts';
import type { Championship, CupDriver } from './championship.ts';

/** The one-line description and short tag of a computer driver (nothing for people). */
export function driverNotes(d: CupDriver): { blurb?: string; tag?: string } {
  if (d.player >= 0) return {};
  const i = personaIndex(d.name);
  if (i < 0) return {};
  const p = personaOf(i);
  return { blurb: p.blurb, tag: p.tag };
}

/** Head-to-head of the season: races the player finished ahead of / behind the rival. */
export interface Duel {
  ahead: number;
  behind: number;
}

/** How the rival duel of a finished season went. */
export interface DuelResult {
  name: string;
  won: boolean;
  ahead: number;
  behind: number;
  /** Player's points minus the rival's. */
  gap: number;
  bonus: number;
}

/** Bonus for beating the rival over a season, times the division factor. */
export const RIVAL_BONUS = 1000;

const me = (c: Championship) => c.drivers.find((d) => d.player === 0);

export function rivalOf(c: Championship): CupDriver | null {
  return c.rival === undefined ? null : (c.drivers[c.rival] ?? null);
}

/** Season standings, best first (ties: more wins). */
function ranked(c: Championship): CupDriver[] {
  return [...c.drivers].sort((a, b) => b.profile.points - a.profile.points || b.profile.wins - a.profile.wins);
}

/**
 * The rival for a new season. In the same division it is whoever finished just
 * ahead of the player last season (or just behind, for the winner); in a new
 * division one of its strongest drivers.
 */
export function pickRival(c: Championship, last: Championship | null, avoid?: string): string {
  if (last) {
    const order = ranked(last);
    const i = order.findIndex((d) => d.player === 0);
    const pick = order[i > 0 ? i - 1 : i + 1];
    if (pick && pick.player < 0) return pick.name;
  }
  // The quickest three by character; which one depends on the season's seed.
  const pool = c.drivers
    .filter((d) => d.player < 0 && d.name !== avoid)
    .sort((a, b) => personaOf(personaIndex(b.name)).pace - personaOf(personaIndex(a.name)).pace || (a.name < b.name ? -1 : 1));
  return pool[Math.abs(c.seed) % Math.min(3, pool.length)].name;
}

/** Make `name` the season's rival, bringing that driver into the field if needed. */
export function setRival(c: Championship, name: string): void {
  let i = c.drivers.findIndex((d) => d.player < 0 && d.name === name);
  if (i < 0) {
    // Takes the seat of the last computer driver (same car colour and points).
    i = c.drivers.map((d) => d.player).lastIndexOf(-1);
    if (i < 0) return;
    c.drivers[i].name = name;
  }
  c.rival = i;
  c.duel = { ahead: 0, behind: 0 };
}

/** After a race: who finished ahead. */
export function recordDuel(c: Championship): void {
  const r = rivalOf(c);
  const m = me(c);
  if (!r || !m || !r.lastPlace || !m.lastPlace) return;
  c.duel ??= { ahead: 0, behind: 0 };
  if (m.lastPlace < r.lastPlace) c.duel.ahead++;
  else c.duel.behind++;
}

/** The duel at the end of a season (null without a rival). */
export function duelResult(c: Championship, divisionFactor: number): DuelResult | null {
  const r = rivalOf(c);
  const m = me(c);
  if (!r || !m) return null;
  const duel = c.duel ?? { ahead: 0, behind: 0 };
  const gap = m.profile.points - r.profile.points;
  const won = gap > 0 || (gap === 0 && (m.profile.wins > r.profile.wins || (m.profile.wins === r.profile.wins && duel.ahead > duel.behind)));
  return { name: r.name, won, ahead: duel.ahead, behind: duel.behind, gap, bonus: won ? Math.round(RIVAL_BONUS * divisionFactor) : 0 };
}

/** "3-2 IN RACES, 4 PTS AHEAD" (from the player's side). */
export function duelText(c: Championship): string {
  const r = rivalOf(c);
  const m = me(c);
  if (!r || !m) return '';
  const d = c.duel ?? { ahead: 0, behind: 0 };
  const gap = m.profile.points - r.profile.points;
  const pts = gap === 0 ? 'LEVEL ON POINTS' : `${Math.abs(gap)} PTS ${gap > 0 ? 'AHEAD' : 'BEHIND'}`;
  return `${d.ahead}-${d.behind} IN RACES, ${pts}`;
}

/** The rival's car in a race spec (-1: none). */
export function rivalCar(entrants: readonly { rival?: number }[]): number {
  return entrants.findIndex((e) => e.rival !== undefined);
}

/** "RIVAL ACE: 2-1 IN RACES, 4 PTS AHEAD" (with `who`: how they race instead). */
export function rivalLine(c: Championship, who = false): string {
  const r = rivalOf(c);
  if (!r) return '';
  if (who) return `RIVAL ${r.name} - ${driverNotes(r).blurb ?? ''}`;
  return `RIVAL ${r.name}: ${duelText(c)}`;
}
