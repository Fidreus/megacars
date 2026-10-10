import type { TrackDef } from '../types.ts';
import { PROVING_GROUND } from './proving.ts';

export const TRACKS: Readonly<Record<string, TrackDef>> = {
  [PROVING_GROUND.id]: PROVING_GROUND,
};

export const DEFAULT_TRACK = PROVING_GROUND.id;
