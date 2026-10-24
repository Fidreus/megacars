// The published track list on the server: browse, publish, like, count plays.

export interface PublishedTrack {
  id: string;
  code: string;
  name: string;
  author: string;
  theme: string;
  length: number;
  created: number;
  likes: number;
  plays: number;
}

export type TrackSort = 'new' | 'top' | 'played';

export interface TrackPage {
  tracks: PublishedTrack[];
  total: number;
  page: number;
  pages: number;
}

const LIKED_KEY = 'megacars.liked.v1';

async function call<T>(path: string, init?: RequestInit): Promise<T & { ok: boolean; error?: string }> {
  try {
    const res = await fetch(path, { cache: 'no-store', ...init });
    return (await res.json()) as T & { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: 'offline' } as T & { ok: boolean; error?: string };
  }
}

export function listTracks(sort: TrackSort, page: number): Promise<TrackPage & { ok: boolean; error?: string }> {
  return call<TrackPage>(`/api/tracks?sort=${sort}&page=${page}`);
}

/** Publish a track: the server checks it (an AI test too), which takes a few seconds. */
export function publishTrack(code: string, author: string): Promise<{ ok: boolean; error?: string; existed?: boolean; track?: PublishedTrack }> {
  return call('/api/tracks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, author }) });
}

export async function likeTrack(id: string): Promise<{ ok: boolean; likes: number; error?: string }> {
  const r = await call<{ likes: number }>(`/api/tracks/${encodeURIComponent(id)}/like`, { method: 'POST' });
  if (r.ok || r.error === 'already liked') remember(id);
  return r;
}

/** A race on a published track (the server ignores tracks it doesn't have). */
export function countPlay(id: string): void {
  void call(`/api/tracks/${encodeURIComponent(id)}/play`, { method: 'POST' });
}

export function liked(id: string): boolean {
  return likedIds().includes(id);
}

function likedIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(LIKED_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function remember(id: string): void {
  try {
    const ids = likedIds().filter((x) => x !== id);
    ids.push(id);
    localStorage.setItem(LIKED_KEY, JSON.stringify(ids.slice(-500)));
  } catch {
    // Not remembered: the server still says no to a second like.
  }
}
