// Game server: serves the built client from dist/ and hosts the WebSocket
// endpoint on /ws. In development Vite serves the client and proxies /ws here.

import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { MsgType } from '../shared/net/protocol.ts';

// SERVER_PORT wins in development (PORT may be set for the Vite dev server).
const PORT = Number(process.env.SERVER_PORT ?? process.env.PORT ?? 8787);
const DIST = resolve(import.meta.dirname, '../../dist');
const SHOTS = resolve(import.meta.dirname, '../../screenshots');
/** Development helpers (screenshot upload) are only enabled by `npm run dev`. */
const DEV = process.env.MEGACARS_DEV === '1' || (process.env.SERVER_PORT !== undefined && process.env.NODE_ENV !== 'production');
const START = performance.now();

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

interface Conn {
  ws: WebSocket;
  alive: boolean;
}
const conns = new Set<Conn>();

wss.on('connection', (ws: WebSocket) => {
  const conn: Conn = { ws, alive: true };
  conns.add(conn);
  ws.on('pong', () => (conn.alive = true));
  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const buf = data as Buffer;
    if (buf.length >= 9 && buf[0] === MsgType.Ping) {
      // Echo the client's timestamp together with the server clock.
      const out = Buffer.alloc(17);
      out[0] = MsgType.Pong;
      buf.copy(out, 1, 1, 9);
      out.writeDoubleLE(performance.now() - START, 9);
      ws.send(out);
    }
  });
  ws.on('close', () => conns.delete(conn));
});

// Heartbeat: drop dead connections and keep proxies from idling us out.
setInterval(() => {
  for (const c of conns) {
    if (!c.alive) {
      c.ws.terminate();
      conns.delete(c);
      continue;
    }
    c.alive = false;
    c.ws.ping();
  }
}, 10_000).unref();

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
