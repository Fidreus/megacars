// Game server: serves the built client from dist/ and hosts the WebSocket
// endpoint on /ws. In development Vite serves the client and proxies /ws here.

import { timingSafeEqual, createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { brotliCompress, constants as zlibConstants, gzipSync } from 'node:zlib';
import { WebSocketServer, type WebSocket } from 'ws';
import { TICK_RATE } from '../shared/config/constants.ts';
import { Analytics, clientIp, networkOf, parseBeacon } from './analytics.ts';
import { renderHtml } from './analyticsHtml.ts';
import { formatSummary, readLog, summarize } from './analyticsStats.ts';
import { Client, GameServer } from './gameServer.ts';
import { RecordStore } from './records.ts';
import { TrackStore, type TrackSort } from './trackStore.ts';
import type { RecordSubmission } from '../shared/game/records.ts';

// SERVER_PORT wins in development (PORT may be set for the Vite dev server).
const PORT = Number(process.env.SERVER_PORT ?? process.env.PORT ?? 8787);
const DIST = resolve(import.meta.dirname, '../../dist');
const SHOTS = resolve(import.meta.dirname, '../../screenshots');
/** Lap record boards live here (a persistent volume in production). */
const DATA_DIR = process.env.DATA_DIR ?? resolve(import.meta.dirname, '../../data');
const records = new RecordStore(DATA_DIR);
/** Record submissions per address per minute. */
const SUBMIT_LIMIT = 6;
const submits = new Map<string, number[]>();
/** Board replays fetched per address per minute. */
const REPLAY_LIMIT = 30;
const replayCalls = new Map<string, number[]>();
/**
 * Usage log: hashed address, country, page loads, time on the page, tracks
 * raced. Off with ANALYTICS=0; not written by `npm run dev` unless ANALYTICS=1.
 */
const analytics = new Analytics(DATA_DIR, {
  enabled: process.env.ANALYTICS !== '0' && (process.env.ANALYTICS === '1' || process.env.MEGACARS_DEV !== '1'),
  salt: process.env.ANALYTICS_SALT || undefined,
  retentionDays: Number(process.env.ANALYTICS_RETENTION_DAYS) || 90,
});
void analytics.prune();
setInterval(() => void analytics.prune(), 6 * 3_600_000).unref();
/** Reads /api/stats; without it the page is not there. */
const STATS_TOKEN = process.env.STATS_TOKEN ?? '';
/** Deletes published tracks (DELETE /api/tracks/<id>); the stats token if not set. */
const TRACKS_TOKEN = process.env.TRACKS_TOKEN || STATS_TOKEN;
/** Track list requests (likes, plays) per address per minute. */
const TRACK_API_LIMIT = 60;
const trackCalls = new Map<string, number[]>();
/** Page reports per address per minute. */
const BEACON_LIMIT = 60;
const beacons = new Map<string, number[]>();
/** Development helpers (screenshot upload) are only enabled by `npm run dev`. */
const DEV = process.env.MEGACARS_DEV === '1' || (process.env.SERVER_PORT !== undefined && process.env.NODE_ENV !== 'production');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Worth compressing (text and tracker modules; not Ogg/MP3/PNG). */
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.map', '.svg', '.md', '.webmanifest', '.xm', '.mod', '.s3m', '.it']);

interface Packed {
  tag: string;
  gzip: Buffer;
  br: Buffer | null;
}

/** Compressed copies of served files, made on first request (gzip now, brotli in the background). */
const packed = new Map<string, Packed>();

function pack(file: string, tag: string): Packed {
  const hit = packed.get(file);
  if (hit && hit.tag === tag) return hit;
  const raw = readFileSync(file);
  const p: Packed = { tag, gzip: gzipSync(raw, { level: 6 }), br: null };
  packed.set(file, p);
  brotliCompress(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length } }, (err, out) => {
    if (!err && packed.get(file) === p) p.br = out;
  });
  return p;
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (url.pathname === '/api/version') {
    json(res, 200, { version: VERSION, build: currentBuild() });
    return;
  }
  if (url.pathname === '/api/records') {
    handleRecords(req, res);
    return;
  }
  if (url.pathname.startsWith('/api/records/replay/')) {
    handleReplay(req, res, url.pathname.slice('/api/records/replay/'.length));
    return;
  }
  if (url.pathname === '/api/tracks' || url.pathname.startsWith('/api/tracks/')) {
    handleTracks(req, res, url);
    return;
  }
  if (url.pathname === '/api/event') {
    handleEvent(req, res);
    return;
  }
  if (url.pathname === '/api/stats') {
    handleStats(req, res, url);
    return;
  }
  if (DEV && url.pathname === '/dev/snap' && req.method === 'POST') {
    saveScreenshot(req, res, url);
    return;
  }
  if (!existsSync(DIST)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Client not built. Run `npm run build`, or use `npm run dev` for development.');
    return;
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = join(DIST, path);
  if (!file.startsWith(DIST)) {
    res.writeHead(400);
    res.end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    path = 'index.html';
    file = join(DIST, path);
  }
  const ext = extname(file);
  const st = statSync(file);
  const tag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  // Hashed build output never changes; music is never replaced under the
  // same name; everything else is revalidated (a cheap 304 with the ETag).
  const cache = path.startsWith('assets/')
    ? 'public, max-age=31536000, immutable'
    : path.startsWith('music/')
      ? 'public, max-age=604800'
      : 'no-cache';
  const headers: Record<string, string> = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': cache,
    etag: tag,
  };
  if (req.headers['if-none-match'] === tag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  if (COMPRESSIBLE.has(ext) && st.size > 1024) {
    headers.vary = 'accept-encoding';
    const accept = String(req.headers['accept-encoding'] ?? '');
    const p = pack(file, tag);
    const body = p.br && /\bbr\b/.test(accept) ? p.br : /\bgzip\b/.test(accept) ? p.gzip : null;
    if (body) {
      headers['content-encoding'] = body === p.br ? 'br' : 'gzip';
      headers['content-length'] = String(body.length);
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
  }
  headers['content-length'] = String(st.size);
  res.writeHead(200, headers);
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

const VERSION = (JSON.parse(readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8')) as { version: string }).version;
let build = { mtime: -1, name: '' };

/** The built client's main bundle file name (it has a content hash), or ''. */
function currentBuild(): string {
  const file = join(DIST, 'index.html');
  try {
    const mtime = statSync(file).mtimeMs;
    if (mtime !== build.mtime) {
      const m = /\/assets\/(index-[\w-]+\.js)/.exec(readFileSync(file, 'utf8'));
      build = { mtime, name: m ? m[1] : '' };
    }
  } catch {
    return '';
  }
  return build.name;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** GET: all boards. POST: a race to check (spec + the player's inputs). */
function handleRecords(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'GET') {
    json(res, 200, records.served());
    return;
  }
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'method' });
    return;
  }
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
  const now = Date.now();
  const recent = (submits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= SUBMIT_LIMIT) {
    json(res, 429, { ok: false, error: 'slow down' });
    return;
  }
  recent.push(now);
  submits.set(ip, recent);
  if (submits.size > 10_000) submits.clear();
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > 400_000) req.destroy();
    else chunks.push(c);
  });
  req.on('end', () => {
    let sub: RecordSubmission;
    try {
      sub = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RecordSubmission;
    } catch {
      json(res, 400, { ok: false, error: 'bad request' });
      return;
    }
    void records.submit(sub).then((r) => json(res, r.ok ? 200 : 400, r));
  });
}

/**
 * GET /api/records/replay/<id>: the race of a board entry (spec and inputs),
 * for racing its ghost. An id's race never changes, so it may be cached for good.
 */
function handleReplay(req: IncomingMessage, res: ServerResponse, id: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, { ok: false, error: 'method' });
    return;
  }
  const ip = networkOf(clientIp(req));
  const now = Date.now();
  const recent = (replayCalls.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  replayCalls.set(ip, recent);
  if (replayCalls.size > 10_000) replayCalls.clear();
  if (recent.length > REPLAY_LIMIT) {
    json(res, 429, { ok: false, error: 'slow down' });
    return;
  }
  const tag = `"${id}"`;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'public, max-age=31536000, immutable', etag: tag, vary: 'accept-encoding' };
  const text = records.replayText(id);
  if (text === null) {
    json(res, 404, { ok: false, error: 'no such replay' });
    return;
  }
  if (req.headers['if-none-match'] === tag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  let body = Buffer.from(text, 'utf8');
  if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    body = gzipSync(body, { level: 6 });
    headers['content-encoding'] = 'gzip';
  }
  headers['content-length'] = String(body.length);
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** A token from `Authorization: Bearer ...` matches `secret` (never when there is none). */
function tokenOk(req: IncomingMessage, url: URL, secret: string): boolean {
  if (!secret) return false;
  const given = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? url.searchParams.get('token') ?? '';
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(given), digest(secret));
}

/** A small JSON body (at most `max` bytes), or null. */
function readJson(req: IncomingMessage, max: number, done: (body: unknown) => void): void {
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > max) req.destroy();
    else chunks.push(c);
  });
  req.on('end', () => {
    try {
      done(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      done(null);
    }
  });
}

/**
 * Published tracks. GET /api/tracks?sort=new|top|played&page=0 lists them;
 * POST /api/tracks {code, author} publishes; POST /api/tracks/<id>/like and
 * /play count; DELETE /api/tracks/<id> (admin token) removes one.
 */
function handleTracks(req: IncomingMessage, res: ServerResponse, url: URL): void {
  const ip = networkOf(clientIp(req));
  const who = trackStore.who(ip);
  const now = Date.now();
  const recent = (trackCalls.get(who) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  trackCalls.set(who, recent);
  if (trackCalls.size > 10_000) trackCalls.clear();
  if (recent.length > TRACK_API_LIMIT) {
    json(res, 429, { ok: false, error: 'slow down' });
    return;
  }
  const [, , , id, action] = url.pathname.split('/');
  if (!id) {
    if (req.method === 'GET') {
      const sort = (['new', 'top', 'played'].includes(url.searchParams.get('sort') ?? '') ? url.searchParams.get('sort') : 'new') as TrackSort;
      json(res, 200, { ok: true, ...trackStore.list(sort, Number(url.searchParams.get('page')) || 0) });
    } else if (req.method === 'POST') {
      readJson(req, 4096, (body) => {
        const b = (body ?? {}) as { code?: unknown; author?: unknown };
        void trackStore.publish(b.code, b.author, who).then((r) => {
          if (r.ok) console.log(`tracks: ${r.existed ? 'already had' : 'published'} ${r.track.name} (${r.track.id}) by ${r.track.author}`);
          json(res, r.ok ? 200 : r.status, r);
        });
      });
    } else json(res, 405, { ok: false, error: 'method' });
    return;
  }
  if (req.method === 'DELETE' && !action) {
    if (!tokenOk(req, url, TRACKS_TOKEN)) {
      json(res, 401, { ok: false, error: 'token' });
      return;
    }
    const ok = trackStore.remove(id);
    if (ok) console.log(`tracks: deleted ${id}`);
    json(res, ok ? 200 : 404, { ok });
    return;
  }
  if (req.method === 'GET' && !action) {
    const t = trackStore.get(id);
    json(res, t ? 200 : 404, t ? { ok: true, track: t } : { ok: false, error: 'no such track' });
    return;
  }
  if (req.method === 'POST' && action === 'like') {
    const r = trackStore.like(id, who);
    json(res, r.ok ? 200 : r.error === 'no such track' ? 404 : 409, r);
    return;
  }
  if (req.method === 'POST' && action === 'play') {
    const ok = trackStore.play(id, who);
    json(res, ok ? 200 : 404, { ok });
    return;
  }
  json(res, 404, { ok: false, error: 'not found' });
}

/** POST: a small report from the page (a race started, how long it was open). Always answers 204. */
function handleEvent(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'method' });
    return;
  }
  const done = () => {
    res.writeHead(204);
    res.end();
  };
  const who = analytics.isBot(req) ? null : analytics.who(req);
  if (!who) {
    done();
    return;
  }
  const now = Date.now();
  const recent = (beacons.get(who.h) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  beacons.set(who.h, recent);
  if (beacons.size > 10_000) beacons.clear();
  if (recent.length > BEACON_LIMIT) {
    done();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > 1024) req.destroy();
    else chunks.push(c);
  });
  req.on('end', () => {
    try {
      const event = parseBeacon(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (event) analytics.log(who, event.t === 'open' ? analytics.openEvent(req, event) : event);
    } catch {
      // Not ours: drop it.
    }
    done();
  });
}

/**
 * GET /api/stats?days=7&tz=Europe/Stockholm&format=html|text|json. A browser gets the page,
 * anything else JSON. The token goes in `Authorization: Bearer ...` or `?token=`.
 */
function handleStats(req: IncomingMessage, res: ServerResponse, url: URL): void {
  if (!STATS_TOKEN) {
    res.writeHead(404);
    res.end();
    return;
  }
  const given = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? url.searchParams.get('token') ?? '';
  const digest = (v: string) => createHash('sha256').update(v).digest();
  if (!timingSafeEqual(digest(given), digest(STATS_TOKEN))) {
    json(res, 401, { ok: false, error: 'token' });
    return;
  }
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 7));
  const summary = summarize(readLog(analytics.dir, days), days, Date.now(), url.searchParams.get('tz') ?? undefined);
  const format = url.searchParams.get('format') ?? (String(req.headers.accept ?? '').includes('text/html') ? 'html' : 'json');
  const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' };
  if (format === 'html') {
    const keep = new URLSearchParams();
    if (url.searchParams.has('token')) keep.set('token', url.searchParams.get('token')!);
    res.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' });
    res.end(renderHtml(summary, { keep: keep.toString() }));
  } else if (format === 'text') {
    res.writeHead(200, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
    res.end(formatSummary(summary));
  } else json(res, 200, summary);
}

function saveScreenshot(req: IncomingMessage, res: ServerResponse, url: URL): void {
  const name = (url.searchParams.get('name') ?? 'shot').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > 20_000_000) req.destroy();
    else chunks.push(c);
  });
  req.on('end', () => {
    mkdirSync(SHOTS, { recursive: true });
    const file = join(SHOTS, `${name}.png`);
    writeFileSync(file, Buffer.concat(chunks));
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(file);
  });
}

const server = createServer(serveStatic);
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 4096 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

const game = new GameServer();
const trackStore = new TrackStore(DATA_DIR, game.tracks, process.env.ANALYTICS_SALT || 'megacars-tracks');
game.log = (msg) => console.log(msg);
game.event = (e) => analytics.log(null, e);

interface Conn {
  ws: WebSocket;
  client: Client;
  /** Heartbeats without an answer. */
  missed: number;
}
const conns = new Set<Conn>();

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const who = analytics.who(req);
  const opened = Date.now();
  const client = game.open({
    sendText: (s) => ws.readyState === ws.OPEN && ws.send(s),
    sendBinary: (d) => ws.readyState === ws.OPEN && ws.send(d),
    close: (code, reason) => ws.close(code, reason),
  });
  const conn: Conn = { ws, client, missed: 0 };
  conns.add(conn);
  ws.on('pong', (data: Buffer) => {
    conn.missed = 0;
    if (data.length === 8) {
      const rtt = performance.now() - data.readDoubleLE(0);
      client.rtt = client.rtt < 0 ? rtt : client.rtt * 0.7 + rtt * 0.3;
    }
  });
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const buf = data as Buffer;
      game.binary(client, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    } else {
      game.text(client, data.toString());
    }
  });
  ws.on('close', () => {
    if (who) analytics.log(who, { t: 'ws', dur: Math.round((Date.now() - opened) / 1000) });
    conns.delete(conn);
    game.closed(client);
  });
  ping(conn);
});

function ping(c: Conn): void {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(performance.now(), 0);
  c.ws.ping(b);
}

// Heartbeat: drop dead connections, measure round trips, keep proxies awake.
setInterval(() => {
  for (const c of conns) {
    if (++c.missed > 5) {
      c.ws.terminate();
      conns.delete(c);
      game.closed(c.client);
      continue;
    }
    ping(c);
  }
  game.refreshLobbies();
  game.sweep();
}, 2_000).unref();

// The race clock: 60 ticks per second for every room with a race running.
const TICK_MS = 1000 / TICK_RATE;
let nextTick = performance.now();
function loop(): void {
  const now = performance.now();
  let steps = 0;
  while (now >= nextTick && steps < 10) {
    game.tick();
    nextTick += TICK_MS;
    steps++;
  }
  if (now - nextTick > 250) nextTick = now;
  setTimeout(loop, Math.max(0, nextTick - performance.now()));
}
loop();

server.listen(PORT, () => {
  console.log(`megacars server on http://localhost:${PORT} (static: ${existsSync(DIST) ? DIST : 'not built'})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    for (const c of conns) c.ws.close(1012, 'server restarting');
    trackStore.flush();
    records.flush();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
