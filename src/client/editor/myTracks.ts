// The player's own tracks, kept in the browser as share codes: made in the
// editor, opened from a shared link or saved from the published list. Every
// one is registered at start-up, so it can be chosen like a game track.

import { canonicalDef, checkTrackDef, decodeTrack, encodeTrack, isCustomId } from '../../shared/track/custom.ts';
import { registerTrack, trackDef } from '../../shared/track/defs/index.ts';
import type { TrackDef } from '../../shared/track/types.ts';

const KEY = 'megacars.mytracks.v1';

export interface SavedTrack {
  /** Stays the same while the track is edited (its id changes with the content). */
  slot: string;
  code: string;
  name: string;
  /** Track id (u-...), for lookups. */
  id: string;
  updated: number;
  /** Made here, opened from a link, or saved from the published list (with its id there). */
  source: 'mine' | 'shared' | 'published';
  pubId?: string;
}

let list: SavedTrack[] | null = null;

export function myTracks(): SavedTrack[] {
  if (list) return list;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedTrack[];
    list = Array.isArray(raw) ? raw.filter((t) => t && typeof t.code === 'string' && decodeTrack(t.code)) : [];
  } catch {
    list = [];
  }
  return list;
}

function store(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(myTracks()));
  } catch {
    // Not remembered (private mode or full).
  }
}

/** Register every saved track (call once before the settings are read). */
export function registerMyTracks(): void {
  for (const t of myTracks()) {
    const def = decodeTrack(t.code);
    if (def) registerTrack(def);
  }
}

/** The saved track's definition (canonical), or null if the code is bad. */
export function savedDef(t: SavedTrack): TrackDef | null {
  return decodeTrack(t.code);
}

/** Save (or update the slot of) a track; returns the entry. */
export function saveTrack(def: TrackDef, slot: string | null, source: SavedTrack['source'] = 'mine', pubId?: string): SavedTrack {
  const c = canonicalDef(def);
  registerTrack(c);
  const tracks = myTracks();
  let t = slot ? tracks.find((x) => x.slot === slot) : undefined;
  if (!t) {
    t = { slot: slot ?? Math.random().toString(36).slice(2, 10), code: '', name: '', id: '', updated: 0, source, pubId };
    tracks.unshift(t);
  }
  t.code = encodeTrack(c);
  t.name = c.name;
  t.id = c.id;
  t.updated = Date.now();
  store();
  return t;
}

/** Add a track from a code unless the same one is already saved; returns its entry. */
export function addFromCode(code: string, source: SavedTrack['source'], pubId?: string): SavedTrack | null {
  const def = decodeTrack(code);
  if (!def) return null;
  const have = myTracks().find((t) => t.id === def.id);
  if (have) {
    registerTrack(def);
    return have;
  }
  return saveTrack(def, null, source, pubId);
}

export function deleteTrack(slot: string): void {
  list = myTracks().filter((t) => t.slot !== slot);
  store();
}

const playableCache = new Map<string, boolean>();

/**
 * Whether a track can be raced: game tracks always, player tracks when they
 * build without errors (an editor draft may be saved half done).
 */
export function playable(id: string): boolean {
  if (!isCustomId(id)) return !!trackDef(id);
  let ok = playableCache.get(id);
  if (ok === undefined) {
    const def = trackDef(id);
    try {
      ok = !!def && checkTrackDef(def).errors.length === 0;
    } catch {
      ok = false;
    }
    playableCache.set(id, ok);
  }
  return ok;
}
