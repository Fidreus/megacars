// Service worker: lets the installed game start and race offline (single
// player). Each build registers it as /sw.js?v=<bundle>; installing downloads
// everything in precache.json (page, build, workers, music player, songs) into
// a cache for that build, and activating deletes the caches of older builds.
// Files that didn't change (songs, icons) are copied from the old cache
// instead of downloaded again.
//
// While running, hashed build files and music come from the cache first;
// everything else (the page, workers, libopenmpt) goes to the network first,
// with the cache as the offline fallback. The WebSocket (/ws) is never touched.

const BUILD = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `megacars-${BUILD}`;
/** Paths whose content never changes under the same name. */
const STABLE = /^\/(assets|music|icons)\//;

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('megacars-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function precache() {
  const cache = await caches.open(CACHE);
  let list = [];
  try {
    const res = await fetch('/precache.json', { cache: 'no-store' });
    if (res.ok) list = await res.json();
  } catch {
    // Offline or an old server: runtime caching still covers what gets used.
  }
  await Promise.all(
    list.map(async (path) => {
      try {
        if (await cache.match(path)) return;
        const old = STABLE.test(path) ? await caches.match(path) : undefined;
        if (old) return cache.put(path, old);
        const res = await fetch(path, { cache: 'no-cache' });
        if (res.ok) await cache.put(path, res);
      } catch {
        // One missing file shouldn't stop the rest.
      }
    }),
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname === '/ws' || url.pathname.startsWith('/dev/') || url.pathname === '/healthz') return;
  if (url.pathname.endsWith('.map')) return;
  event.respondWith(STABLE.test(url.pathname) ? cacheFirst(req) : networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const page = await cache.match('/');
      if (page) return page;
    }
    throw err;
  }
}
