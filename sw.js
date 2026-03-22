/* ─── Anaqueles Pro — Service Worker ────────────────────────── */
const CACHE  = 'anaqueles-pro-v1';
const SHELL  = [
  './',
  './index.html',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@500&display=swap'
];

/* Install: pre-cache the app shell */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

/* Activate: remove old caches */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* Fetch: cache-first for shell, network-first for images */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* Google Drive thumbnail images — network with fallback */
  if (url.hostname === 'drive.google.com' || url.hostname === 'lh3.googleusercontent.com') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then(r => r || new Response('', { status: 408 }))
      )
    );
    return;
  }

  /* Everything else: cache-first */
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
