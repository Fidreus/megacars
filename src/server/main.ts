// Game server: serves the built client from dist/ and hosts the WebSocket
// endpoint on /ws. In development Vite serves the client and proxies /ws here.

import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { TICK_RATE } from '../shared/config/constants.ts';
import { Client, GameServer } from './gameServer.ts';

// SERVER_PORT wins in development (PORT may be set for the Vite dev server).
const PORT = Number(process.env.SERVER_PORT ?? process.env.PORT ?? 8787);
const DIST = resolve(import.meta.dirname, '../../dist');
const SHOTS = resolve(import.meta.dirname, '../../screenshots');
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
};

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
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
  const immutable = path.startsWith('assets/');
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
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
game.log = (msg) => console.log(msg);

interface Conn {
  ws: WebSocket;
  client: Client;
  /** Heartbeats without an answer. */
  missed: number;
}
const conns = new Set<Conn>();

wss.on('connection', (ws: WebSocket) => {
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
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
