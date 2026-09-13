/* Service worker: makes the app load and work with no network at all.
   Bump CACHE when you change any of the files below. */
const CACHE = 'migraine-log-v36';

const SHELL = [
  '.',
  'index.html',
  'styles.css',
  'app.js',
  'data.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // `cache: 'reload'` forces each request past the HTTP cache, so a new
  // version never precaches a stale copy of the shell it is meant to replace.
  const fresh = SHELL.map((path) => new Request(path, { cache: 'reload' }));
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(fresh))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('migraine-log-') && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: prefer the network so browser launches and tracking redirects
  // cannot become trapped on a stale cached page. Fall back to the cached shell
  // when the device is offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(new Request(req, { cache: 'reload' }));
          if (res && res.ok) {
            const cache = await caches.open(CACHE);
            await cache.put('index.html', res.clone());
          }
          if (!res || !res.ok) return (await caches.match('index.html')) || res;
          return res;
        } catch {
          return (await caches.match('index.html')) || Response.error();
        }
      })()
    );
    return;
  }

  // Keep the refresh alive even when a cached response is returned immediately.
  const fresh = fetch(new Request(req, { cache: 'reload' })).then(async res => {
    if (res && res.ok) await (await caches.open(CACHE)).put(req, res.clone());
    return res;
  });
  event.waitUntil(fresh.catch(() => {}));
  event.respondWith(caches.match(req).then(hit => hit || fresh.catch(() => Response.error())));
});
