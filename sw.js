// Keeps the app working with no internet.
// When the app files change, bump VERSION here and BUILD in app.js / index.html together.
const VERSION = 'sq7-offer-v8';
const FILES = ['./', 'index.html', 'app.js', 'core.js', 'vendor/qrcode.min.js', 'logo.jpg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];
const NETWORK_WAIT_MS = 4000;

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's HTTP cache, so every saved file is from the same release
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Online: always the latest files, and refresh the offline copy. Offline or very slow: the saved copy.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), NETWORK_WAIT_MS);
      const res = await fetch(req.url, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) await cache.put(req, res.clone());
      return res;
    } catch (err) {
      const saved = await cache.match(req, { ignoreSearch: true })
        || (req.mode === 'navigate' && await cache.match('index.html'));
      return saved || Response.error();
    }
  })());
});
