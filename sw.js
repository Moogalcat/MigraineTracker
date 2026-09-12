/* Service worker: makes the app load and work with no network at all.
   Bump CACHE when you change any of the files below. */
const CACHE = 'migraine-log-v14';

const SHELL = [
  '.',
  'index.html',
  'styles.css',
  'app.js',
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
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: serve the cached shell so the app opens instantly offline,
  // then refresh it in the background so the next launch is up to date even
  // if this cache version somehow holds an old copy.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('index.html').then((hit) => {
        const fromNetwork = fetch(new Request('index.html', { cache: 'reload' }))
          .then((res) => {
            if (res && res.ok) {
              caches.open(CACHE).then((cache) => cache.put('index.html', res.clone()));
            }
            return res;
          })
          .catch(() => hit);

        if (hit) {
          event.waitUntil(fromNetwork.catch(() => {}));
          return hit;
        }
        return fromNetwork;
      })
    );
    return;
  }

  // Everything else: cache-first, refreshing the copy in the background.
  event.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            caches.open(CACHE).then((cache) => cache.put(req, res.clone()));
          }
          return res;
        })
        .catch(() => hit);
      return hit || fresh;
    })
  );
});
