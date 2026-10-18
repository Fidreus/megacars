// Leagues: the same cars and tracks in a different class. Standard is the
// game as tuned; Supercars are much faster, grip and brake harder and swing
// round quicker, so everything happens sooner. Megacars are Supercars turned
// up once more: a little quicker again, with their own wilder look. A race's
// league is part of its spec, so the server, every client and the record
// checker agree.

import { cloneTuning, type CarTuning } from '../config/tuning.ts';

export type League = 'standard' | 'super' | 'mega';

export const LEAGUES: readonly League[] = ['standard', 'super', 'mega'];

export const LEAGUE_NAMES: Record<League, string> = { standard: 'STANDARD', super: 'SUPERCARS', mega: 'MEGACARS' };

/** Supercars: multipliers on the standard car. */
const SUPER: Partial<Record<keyof CarTuning, number>> = {
  accel0: 1.6,
  vTop: 1.4,
  brakeDecel: 1.45,
  aGrip: 1.28,
  aSlide: 1.28,
  aSteerSlide: 1.28,
  omegaPeak: 1.15,
  kYawGrip: 1.2,
  kYawSlide: 1.2,
  driftMinSpeed: 1.3,
  reverseAccel: 1.25,
};

/** Megacars: Supercars, plus a little more of everything. */
const MEGA_ON_SUPER: Partial<Record<keyof CarTuning, number>> = {
  accel0: 1.1,
  vTop: 1.08,
  brakeDecel: 1.08,
  aGrip: 1.07,
  aSlide: 1.07,
  aSteerSlide: 1.07,
  omegaPeak: 1.08,
  kYawGrip: 1.08,
  kYawSlide: 1.08,
  driftMinSpeed: 1.05,
  reverseAccel: 1.08,
};

export function leagueOf(v: unknown): League {
  return v === 'super' || v === 'mega' ? v : 'standard';
}

function multiply(t: CarTuning, mults: Partial<Record<keyof CarTuning, number>>): void {
  for (const [k, m] of Object.entries(mults)) (t as unknown as Record<string, number>)[k] *= m as number;
}

/** The handling of a league's stock car, built from the standard one. */
export function leagueTuning(base: CarTuning, league: League | undefined): CarTuning {
  const lg = leagueOf(league);
  if (lg === 'standard') return base;
  const t = cloneTuning(base);
  multiply(t, SUPER);
  if (lg === 'mega') multiply(t, MEGA_ON_SUPER);
  return t;
}

/** Where a track's records for a league are kept ("greenvalley", "greenvalley@super"). */
export function boardKey(track: string, league: League | undefined): string {
  const lg = leagueOf(league);
  return lg === 'standard' ? track : `${track}@${lg}`;
}
