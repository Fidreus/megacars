import type { TrackDef } from '../types.ts';
import { DUST_BOWL } from './dustBowl.ts';
import { FROST_RING } from './frostRing.ts';
import { GREEN_VALLEY } from './greenValley.ts';

/** Track list in menu order. */
export const TRACK_LIST: readonly TrackDef[] = [GREEN_VALLEY, DUST_BOWL, FROST_RING];

export const TRACKS: Readonly<Record<string, TrackDef>> = Object.fromEntries(TRACK_LIST.map((t) => [t.id, t]));

export const DEFAULT_TRACK = GREEN_VALLEY.id;
