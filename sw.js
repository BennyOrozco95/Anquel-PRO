const APP_VERSION = '1.0.0.4';
const APP_CACHE = `anaqueles-pro-app-${APP_VERSION}`;
const IMAGE_CACHE = 'anaqueles-pro-product-images';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await Promise.allSettled(APP_SHELL.map(url => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys.map(key => {
        const keep = key === APP_CACHE || key === IMAGE_CACHE;
        return keep ? null : caches.delete(key);
      })
    );

    await self.clients.claim();
  })());
});

async function cacheFirstImage(request) {
  const cache = await caches.open(IMAGE_CACHE);

  const cached =
    await cache.match(request, { ignoreVary: true }) ||
    await cache.match(request.url, { ignoreVary: true });

  if (cached) return cached;

  try {
    const response = await fetch(request, {
      cache: 'no-store',
      mode: 'cors',
      credentials: 'omit'
    });

    if (response && response.ok) {
      try {
        await cache.put(request, response.clone());
      } catch (_) {}

      return response;
    }

    return response;
  } catch (err) {
    return Response.error();
  }
}

async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);

  try {
    const response = await fetch(request, {
      cache: 'no-store'
    });

    if (request.method === 'GET' && response && response.ok) {
      try {
        await cache.put(request, response.clone());
      } catch (_) {}
    }

    return response;
  } catch (err) {
    return (
      await cache.match(request, { ignoreVary: true }) ||
      await cache.match('./index.html', { ignoreVary: true }) ||
      Response.error()
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(APP_CACHE);

  const cached = await cache.match(request, { ignoreVary: true });

  const fresh = fetch(request)
    .then(response => {
      if (response && response.ok) {
        try {
          cache.put(request, response.clone());
        } catch (_) {}
      }

      return response;
    })
    .catch(() => cached || Response.error());

  return cached || fresh;
}

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // No cachear llamadas al Apps Script con parámetro anti-cache.
  // Esto evita que la sincronización traiga datos viejos.
  if (
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('googleusercontent.com')
  ) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.destination === 'image') {
    event.respondWith(cacheFirstImage(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
