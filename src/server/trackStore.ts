// Published player tracks, kept in DATA_DIR/tracks.json. Anyone may publish
// (a few an hour per address); every track is checked in a worker thread,
// AI test included, before it is listed. Likes are one per address; an
// admin token deletes.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanName } from '../shared/net/protocol.ts';
import { decodeTrack, encodeTrack, MAX_CODE } from '../shared/track/custom.ts';
import type { TrackChecker } from './trackChecker.ts';

/** How a published track is listed. */
export interface PublishedTrack {
  id: string;
  code: string;
  name: string;
  author: string;
  theme: string;
  /** Lap length in metres. */
  length: number;
  created: number;
  likes: number;
  plays: number;
}

interface Stored extends PublishedTrack {
  /** Hashed addresses that liked it. */
  likedBy: string[];
}

export type TrackSort = 'new' | 'top' | 'played';

export const PAGE_SIZE = 20;
const MAX_TRACKS = 2000;
/** Tracks published per address per hour. */
const PUBLISH_LIMIT = 5;
const HOUR = 3_600_000;

export class TrackStore {
  private tracks: Stored[] = [];
  private readonly file: string;
  private readonly checker: TrackChecker;
  private readonly salt: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly published = new Map<string, number[]>();
  private readonly played = new Map<string, number>();
  /** Clock (ms), replaceable in tests. */
  now: () => number = () => Date.now();

  constructor(dir: string, checker: TrackChecker, salt = 'megacars') {
    this.checker = checker;
    this.salt = salt;
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'tracks.json');
    try {
      if (existsSync(this.file)) this.tracks = (JSON.parse(readFileSync(this.file, 'utf8')) as Stored[]).filter((t) => decodeTrack(t.code)?.id === t.id);
    } catch (e) {
      console.warn('tracks: could not read', this.file, e);
    }
    console.log(`tracks: ${this.tracks.length} published in ${this.file}`);
  }

  /** An address, hashed (only used to tell people apart). */
  who(ip: string): string {
    return createHash('sha256').update(`${this.salt}|${ip}`).digest('hex').slice(0, 16);
  }

  get count(): number {
    return this.tracks.length;
  }

  list(sort: TrackSort, page: number): { tracks: PublishedTrack[]; total: number; page: number; pages: number } {
    const by: Record<TrackSort, (a: Stored, b: Stored) => number> = {
      new: (a, b) => b.created - a.created,
      top: (a, b) => b.likes - a.likes || b.plays - a.plays || b.created - a.created,
      played: (a, b) => b.plays - a.plays || b.likes - a.likes || b.created - a.created,
    };
    const all = [...this.tracks].sort(by[sort] ?? by.new);
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    const p = Math.max(0, Math.min(pages - 1, Math.floor(page) || 0));
    return { tracks: all.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE).map(listed), total: all.length, page: p, pages };
  }

  get(id: string): PublishedTrack | null {
    const t = this.tracks.find((x) => x.id === id);
    return t ? listed(t) : null;
  }

  /** Check a track (in the worker, with an AI test) and list it. */
  async publish(code: unknown, author: unknown, who: string): Promise<{ ok: true; track: PublishedTrack; existed?: boolean } | { ok: false; error: string; status: number }> {
    if (typeof code !== 'string' || code.length > MAX_CODE) return { ok: false, error: 'not a track', status: 400 };
    const def = decodeTrack(code);
    if (!def) return { ok: false, error: 'not a track', status: 400 };
    const have = this.tracks.find((t) => t.id === def.id);
    if (have) return { ok: true, track: listed(have), existed: true };
    const now = this.now();
    const recent = (this.published.get(who) ?? []).filter((t) => now - t < HOUR);
    if (recent.length >= PUBLISH_LIMIT) return { ok: false, error: 'that is enough tracks for an hour - try again later', status: 429 };
    if (this.tracks.length >= MAX_TRACKS) return { ok: false, error: 'the track list is full', status: 507 };
    if (this.checker.busy) return { ok: false, error: 'the server is busy, try again', status: 503 };
    const r = await this.checker.forPublishing(code);
    if (!r.ok) return { ok: false, error: r.error, status: 422 };
    // Checked meanwhile by someone else?
    const again = this.tracks.find((t) => t.id === def.id);
    if (again) return { ok: true, track: listed(again), existed: true };
    recent.push(now);
    this.published.set(who, recent);
    if (this.published.size > 10_000) this.published.clear();
    const t: Stored = {
      id: def.id, code: encodeTrack(r.def), name: r.def.name, author: cleanName(author), theme: r.def.theme,
      length: Math.round(r.length), created: now, likes: 0, plays: 0, likedBy: [],
    };
    this.tracks.push(t);
    this.scheduleSave();
    return { ok: true, track: listed(t) };
  }

  /** One like per address. */
  like(id: string, who: string): { ok: boolean; likes: number; error?: string } {
    const t = this.tracks.find((x) => x.id === id);
    if (!t) return { ok: false, likes: 0, error: 'no such track' };
    if (t.likedBy.includes(who)) return { ok: false, likes: t.likes, error: 'already liked' };
    t.likedBy.push(who);
    if (t.likedBy.length > 20_000) t.likedBy.shift();
    t.likes++;
    this.scheduleSave();
    return { ok: true, likes: t.likes };
  }

  /** A race on the track (counted once an hour per address). */
  play(id: string, who: string): boolean {
    const t = this.tracks.find((x) => x.id === id);
    if (!t) return false;
    const key = `${id}|${who}`;
    const now = this.now();
    if (now - (this.played.get(key) ?? -HOUR) < HOUR) return true;
    this.played.set(key, now);
    if (this.played.size > 50_000) this.played.clear();
    t.plays++;
    this.scheduleSave();
    return true;
  }

  remove(id: string): boolean {
    const n = this.tracks.length;
    this.tracks = this.tracks.filter((t) => t.id !== id);
    if (this.tracks.length === n) return false;
    this.scheduleSave();
    return true;
  }

  /** Write now (tests, shutdown). */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.tracks));
      renameSync(tmp, this.file);
    } catch (e) {
      console.warn('tracks: could not save', e);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 2000);
    this.saveTimer.unref?.();
  }
}

function listed(t: Stored): PublishedTrack {
  return { id: t.id, code: t.code, name: t.name, author: t.author, theme: t.theme, length: t.length, created: t.created, likes: t.likes, plays: t.plays };
}
