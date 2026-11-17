/* Naav Bins service worker.
   - Pages: network first, falling back to the cached app shell when offline.
   - Built JS/CSS (/assets/*, content-hashed) and icons: cache first.
   - Everything else (our API, Supabase, the AI model, map tiles) is never cached here,
     so balances, rewards and bin status are always live. */
// __BUILD_ID__ is replaced with a per-deploy id at build time (see vite.config.js).
const VERSION = 'naav-__BUILD_ID__';
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const SHELL_URLS = ['/', '/manifest.webmanifest', '/logo.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // App navigation (any client-side route): try the network, fall back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/logo.svg') {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(STATIC).then((c) => c.put(request, copy));
        }
        return res;
      })),
    );
  }
});
