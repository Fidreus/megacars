import type { TrackDef } from '../types.ts';
import { GREEN_VALLEY } from './greenValley.ts';

export const TRACKS: Readonly<Record<string, TrackDef>> = {
  [GREEN_VALLEY.id]: GREEN_VALLEY,
};

/** Track list in menu order. */
export const TRACK_LIST: readonly TrackDef[] = [GREEN_VALLEY];

export const DEFAULT_TRACK = GREEN_VALLEY.id;
