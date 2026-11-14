// The kind of race a spec asks for: a normal race (first across the line
// after the laps) or an elimination (last car out at every leader's lap; see
// sim/elimination.ts).

import type { RaceSpec } from '../net/protocol.ts';

export type RaceMode = 'race' | 'elimination';

export const RACE_MODES: readonly RaceMode[] = ['race', 'elimination'];

/** A spec's or a setting's mode (absent or unknown = a normal race). */
export function raceModeOf(v: unknown): RaceMode {
  return v === 'elimination' ? 'elimination' : 'race';
}

export function isElimination(spec: Pick<RaceSpec, 'mode'> | null | undefined): boolean {
  return raceModeOf(spec?.mode) === 'elimination';
}

/** The spec field: absent for a normal race, so those specs stay as they were. */
export function modeField(m: unknown): { mode?: RaceMode } {
  return raceModeOf(m) === 'elimination' ? { mode: 'elimination' } : {};
}
