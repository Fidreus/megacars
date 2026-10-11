// Leagues: the same cars and tracks in a different class. Standard is the
// game as tuned; Supercars are much faster, grip and brake harder and swing
// round quicker, so everything happens sooner. A race's league is part of its
// spec, so the server, every client and the record checker agree.

import { cloneTuning, type CarTuning } from '../config/tuning.ts';

export type League = 'standard' | 'super';

export const LEAGUES: readonly League[] = ['standard', 'super'];

export const LEAGUE_NAMES: Record<League, string> = { standard: 'STANDARD', super: 'SUPERCARS' };

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

export function leagueOf(v: unknown): League {
  return v === 'super' ? 'super' : 'standard';
}

/** The handling of a league's stock car, built from the standard one. */
export function leagueTuning(base: CarTuning, league: League | undefined): CarTuning {
  if (leagueOf(league) === 'standard') return base;
  const t = cloneTuning(base);
  for (const [k, m] of Object.entries(SUPER)) (t as unknown as Record<string, number>)[k] *= m as number;
  return t;
}

/** Where a track's records for a league are kept ("greenvalley", "greenvalley@super"). */
export function boardKey(track: string, league: League | undefined): string {
  return leagueOf(league) === 'standard' ? track : `${track}@super`;
}
