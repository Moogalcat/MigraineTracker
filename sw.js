/* Service worker: makes the app load and work with no network at all.
   Bump CACHE when you change any of the files below. */
const CACHE = 'migraine-log-v46';
const FIREBASE_VERSION = '12.18.0';

const SHELL = [
  '.',
  'index.html',
  'styles.css?v=45',
  'app.js?v=45',
  'data.js?v=45',
  'sync-data.js?v=45',
  'sync.js?v=45',
  'firebase-config.js?v=45',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

const OPTIONAL = [
  `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`,
  `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`,
  `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`,
];

self.addEventListener('install', (event) => {
  // `cache: 'reload'` forces each request past the HTTP cache, so a new
  // version never precaches a stale copy of the shell it is meant to replace.
  const fresh = SHELL.map((path) => new Request(path, { cache: 'reload' }));
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(fresh))
      .then(async () => {
        const cache = await caches.open(CACHE);
        await Promise.allSettled(OPTIONAL.map(async (path) => {
          const response = await fetch(new Request(path, { cache: 'reload', mode: 'cors' }));
          if (response.ok) await cache.put(path, response);
        }));
      })
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
  const firebaseModule = url.origin === 'https://www.gstatic.com'
    && url.pathname.startsWith(`/firebasejs/${FIREBASE_VERSION}/`);
  if (url.origin !== self.location.origin && !firebaseModule) return;

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
