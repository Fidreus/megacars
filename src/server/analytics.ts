// Usage log without personal data: one JSON line per event in
// DATA_DIR/analytics/YYYY-MM-DD.jsonl. The address itself is never stored.
// It is hashed with a secret salt and the date (so a visitor can't be
// followed from one day to the next), next to the country it came from.
// Do Not Track and Global Privacy Control are respected. Old days are deleted.

import { createHash, randomBytes } from 'node:crypto';
import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { join } from 'node:path';
import geoip from 'geoip-country';
import { TRACKS } from '../shared/track/defs/index.ts';

/** Modes a local race can be started in (what the client reports). */
const MODES = ['quick', 'practice', 'cup', 'career'];
const BOT = /bot|crawl|spider|slurp|preview|monitor|uptime|curl|wget|headless|lighthouse/i;
const COUNTRY_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country', 'x-country-code'];

export type Event = Record<string, string | number | boolean>;

/** The address of the browser behind our proxy (the first hop is the one the proxy set). */
export function clientIp(req: IncomingMessage): string {
  const h = req.headers;
  const ip = String(h['cf-connecting-ip'] ?? h['x-real-ip'] ?? h['x-forwarded-for'] ?? req.socket.remoteAddress ?? '')
    .split(',')[0]
    .trim();
  return ip.replace(/^::ffff:/i, '');
}

/** An IPv6 address as its /64 network (people on one connection get new addresses all the time); IPv4 as is. */
export function networkOf(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const [head, tail = ''] = ip.split('%')[0].toLowerCase().split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...a, ...Array<string>(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':');
}

/** The person said no thanks: Do Not Track or Global Privacy Control. */
export function optedOut(req: IncomingMessage): boolean {
  return req.headers.dnt === '1' || req.headers['sec-gpc'] === '1';
}

export interface Who {
  /** Hash of the address, different every day. */
  h: string;
  /** ISO country code, or '??'. */
  c: string;
}

export interface AnalyticsOptions {
  enabled?: boolean;
  /** Secret mixed into the hashes (default: random, kept in the data directory). */
  salt?: string;
  retentionDays?: number;
  now?: () => number;
}

export class Analytics {
  readonly enabled: boolean;
  readonly dir: string;
  private readonly salt: string;
  private readonly retentionDays: number;
  private readonly now: () => number;
  private ready: Promise<unknown> | null = null;

  constructor(dataDir: string, opts: AnalyticsOptions = {}) {
    this.enabled = opts.enabled ?? true;
    this.dir = join(dataDir, 'analytics');
    this.retentionDays = opts.retentionDays ?? 90;
    this.now = opts.now ?? Date.now;
    this.salt = opts.salt ?? (this.enabled ? this.storedSalt() : '');
  }

  private storedSalt(): string {
    const file = join(this.dir, 'salt');
    mkdirSync(this.dir, { recursive: true });
    if (existsSync(file)) return readFileSync(file, 'utf8').trim();
    const salt = randomBytes(24).toString('hex');
    writeFileSync(file, `${salt}\n`, { mode: 0o600 });
    return salt;
  }

  private day(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  /** Who is asking, or null when we may not (or need not) log them. */
  who(req: IncomingMessage): Who | null {
    if (!this.enabled || optedOut(req)) return null;
    const ip = clientIp(req);
    if (!ip) return null;
    const h = createHash('sha256').update(`${this.salt}|${this.day()}|${networkOf(ip)}`).digest('hex').slice(0, 12);
    let c = '';
    for (const name of COUNTRY_HEADERS) {
      const v = String(req.headers[name] ?? '').toUpperCase();
      if (/^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1') {
        c = v;
        break;
      }
    }
    if (!c) c = geoip.lookup(ip)?.country ?? '??';
    return { h, c };
  }

  /** Crawlers and headless browsers. */
  isBot(req: IncomingMessage): boolean {
    return BOT.test(String(req.headers['user-agent'] ?? ''));
  }

  /** What kind of device, browser and system the request came from (from the user agent, which is not stored). */
  describe(req: IncomingMessage, touch: boolean): { d: 'm' | 't' | 'd'; b: string; os: string } {
    const ua = String(req.headers['user-agent'] ?? '');
    // iPadOS calls itself a Mac: a touch screen gives it away.
    const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touch);
    const d = ipad || /Tablet|Android(?!.*Mobile)/.test(ua) ? 't' : /Mobi|iPhone|iPod|Android/.test(ua) ? 'm' : 'd';
    const b = /Edg\//.test(ua) ? 'Edge'
      : /OPR\/|Opera/.test(ua) ? 'Opera'
      : /SamsungBrowser/.test(ua) ? 'Samsung'
      : /Firefox|FxiOS/.test(ua) ? 'Firefox'
      : /Chrome|CriOS/.test(ua) ? 'Chrome'
      : /Safari/.test(ua) ? 'Safari'
      : 'Annan';
    const os = ipad || /iPhone|iPod/.test(ua) ? 'iOS'
      : /Android/.test(ua) ? 'Android'
      : /Windows/.test(ua) ? 'Windows'
      : /CrOS/.test(ua) ? 'ChromeOS'
      : /Macintosh|Mac OS X/.test(ua) ? 'macOS'
      : /Linux|X11/.test(ua) ? 'Linux'
      : 'Annat';
    return { d, b, os };
  }

  /** The open event with what we know about the device added. */
  openEvent(req: IncomingMessage, e: Event): Event {
    const own = String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    const w = Number(e.w);
    const { w: _w, touch, ref, ...rest } = e;
    return {
      ...rest,
      ...this.describe(req, touch === true),
      ...(w >= 0 ? { sz: w < 600 ? 's' : w < 1100 ? 'm' : w < 1700 ? 'l' : 'x' } : {}),
      ...(typeof ref === 'string' && ref && ref !== own ? { ref } : {}),
    };
  }

  /** Add one event line to today's file. Never throws; losing a line is fine. */
  log(who: Who | null, event: Event): void {
    if (!this.enabled) return;
    const line = JSON.stringify({ ts: this.now(), ...(who ? { h: who.h, c: who.c } : {}), ...event });
    this.ready ??= mkdir(this.dir, { recursive: true });
    void this.ready.then(() => appendFile(join(this.dir, `${this.day()}.jsonl`), `${line}\n`)).catch(() => {});
  }

  /** Delete days older than the retention time. */
  async prune(): Promise<number> {
    if (!this.enabled) return 0;
    const cutoff = new Date(this.now() - this.retentionDays * 86_400_000).toISOString().slice(0, 10);
    let removed = 0;
    try {
      for (const f of await readdir(this.dir)) {
        if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < cutoff) {
          await unlink(join(this.dir, f));
          removed++;
        }
      }
    } catch {
      // No directory yet: nothing to delete.
    }
    return removed;
  }
}

const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;

/** What the page may report about itself. Anything else is dropped. */
export function parseBeacon(body: unknown): Event | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const sid = typeof b.sid === 'string' && /^[0-9a-f]{8}$/.test(b.sid) ? b.sid : null;
  if (!sid) return null;
  // The page was opened (counted here, not on the page request: the service worker serves the page from its cache).
  if (b.t === 'open') {
    const w = int(b.w, 0, 20_000);
    const lang = typeof b.lang === 'string' && /^[a-z]{2,3}$/.test(b.lang) ? b.lang : '';
    const ref = typeof b.ref === 'string' && /^[a-z0-9.-]{1,60}$/.test(b.ref) ? b.ref : '';
    return { t: 'open', sid, ...(w === null ? {} : { w }), touch: b.touch === true, ...(lang ? { lang } : {}), ...(ref ? { ref } : {}) };
  }
  if (b.t === 'race') {
    const laps = int(b.laps, 1, 99);
    const opponents = int(b.opponents, 0, 8);
    const players = int(b.players, 1, 4);
    if (typeof b.track !== 'string' || !(b.track in TRACKS) || typeof b.mode !== 'string' || !MODES.includes(b.mode)) return null;
    if (laps === null || opponents === null || players === null) return null;
    return { t: 'race', sid, track: b.track, mode: b.mode, laps, opponents, players };
  }
  if (b.t === 'session') {
    const dur = int(b.dur, 0, 86_400);
    const races = int(b.races, 0, 999);
    if (dur === null || races === null) return null;
    return { t: 'session', sid, dur, races };
  }
  return null;
}
