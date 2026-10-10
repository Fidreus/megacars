// Service worker: lets the installed game start offline (single player).
// Hashed build files and music are cached on first use and served from the
// cache; everything else (the page, workers, libopenmpt) goes to the network
// first, so a new deploy is picked up on the next load, with the cached copy
// as the offline fallback. The WebSocket (/ws) is never touched.

const CACHE = 'megacars-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname === '/ws' || url.pathname.startsWith('/dev/') || url.pathname === '/healthz') return;
  if (url.pathname.endsWith('.map')) return;
  const stable = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/music/') || url.pathname.startsWith('/icons/');
  event.respondWith(stable ? cacheFirst(req) : networkFirst(req));
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
