import type { TrackDef } from '../types.ts';
import { BREWERY_BASH } from './breweryBash.ts';
import { CIGAR_CIRCUIT } from './cigarCircuit.ts';
import { DUST_BOWL } from './dustBowl.ts';
import { FROST_RING } from './frostRing.ts';
import { GREEN_VALLEY } from './greenValley.ts';
import { MANHATTAN_SPRINT } from './manhattanSprint.ts';
import { MELTDOWN } from './meltdown.ts';
import { TIVOLI_TWIST } from './tivoliTwist.ts';
import { TWIN_BRIDGES } from './twinBridges.ts';

/** Track list in menu order. */
export const TRACK_LIST: readonly TrackDef[] = [GREEN_VALLEY, DUST_BOWL, FROST_RING, MELTDOWN, TWIN_BRIDGES, BREWERY_BASH, TIVOLI_TWIST, CIGAR_CIRCUIT, MANHATTAN_SPRINT];

export const TRACKS: Readonly<Record<string, TrackDef>> = Object.fromEntries(TRACK_LIST.map((t) => [t.id, t]));

export const DEFAULT_TRACK = GREEN_VALLEY.id;

/** Player tracks known here (made, downloaded or sent by a room's host), most recent last. */
const custom = new Map<string, TrackDef>();
const CUSTOM_KEEP = 64;

/** Make a player track available by its id (to race, show or send). */
export function registerTrack(def: TrackDef): void {
  if (TRACKS[def.id]) return;
  // Already known (the same id is the same content): keep that one, so its build stays cached.
  const had = custom.get(def.id);
  custom.delete(def.id);
  custom.set(def.id, had ?? def);
  while (custom.size > CUSTOM_KEEP) custom.delete(custom.keys().next().value!);
}

/** A track by id: one of the game's own, or a registered player track. */
export function trackDef(id: string): TrackDef | undefined {
  return TRACKS[id] ?? custom.get(id);
}

/** A track's name (its id if unknown). */
export function trackName(id: string): string {
  return trackDef(id)?.name ?? id;
}

/** Laps actually raced: the chosen count, times the track's lap scale (short tracks run more). */
export function raceLaps(track: string, laps: number): number {
  return laps * (trackDef(track)?.lapScale ?? 1);
}
