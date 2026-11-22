// HopOn service worker: makes the app installable and keeps it opening with weak or no signal.
// - Pages: network first, fall back to the cached app shell.
// - Built files (/assets/*, icons, fonts, map tiles): cache first, refreshed in the background.
// - API calls and live updates are never cached (tickets and seats must be current).
const VERSION = 'hopon-v1';
const SHELL = ['/', '/manifest.webmanifest', '/crew.webmanifest', '/icons/icon-192.png', '/icons/crew-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const MAX_TILES = 400;
async function trimTiles(cache) {
  const keys = await cache.keys();
  const tiles = keys.filter((r) => r.url.includes('tile.openstreetmap.org'));
  for (const r of tiles.slice(0, Math.max(0, tiles.length - MAX_TILES))) await cache.delete(r);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;
  // Vite dev server files: leave alone so live reload keeps working.
  if (url.origin === location.origin && (url.pathname.startsWith('/@') || url.pathname.startsWith('/src/') || url.pathname.startsWith('/node_modules/'))) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('/', copy)); return res; })
        .catch(() => caches.match('/').then((r) => r || new Response('<h1>Offline</h1><p>Open HopOn again when you have signal.</p>', { headers: { 'Content-Type': 'text/html' } }))),
    );
    return;
  }

  const cacheable = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') ||
    url.hostname.endsWith('fonts.gstatic.com') || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('tile.openstreetmap.org');
  if (!cacheable) return;
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(req);
    const net = fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); if (url.hostname.endsWith('tile.openstreetmap.org')) trimTiles(c); }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
