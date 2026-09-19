const APP_VERSION = '1.0.0.8';
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

    await Promise.all(keys.map(key => {
      if (key.startsWith('anaqueles-pro-app-') && key !== APP_CACHE) {
        return caches.delete(key);
      }
      return null;
    }));

    await self.clients.claim();
  })());
});

async function cacheFirstImage(request) {
  const cache = await caches.open(IMAGE_CACHE);

  const cached =
    await cache.match(request, { ignoreVary: true }) ||
    await cache.match(request.url, { ignoreVary: true });

  if (cached) return cached;

  const response = await fetch(request);

  try {
    await cache.put(request, response.clone());
  } catch (_) {}

  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);

  try {
    const response = await fetch(request);

    if (request.method === 'GET') {
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
    .then(async response => {
      try {
        await cache.put(request, response.clone());
      } catch (_) {}

      return response;
    })
    .catch(() => cached || Response.error());

  return cached || fresh;
}

function isDynamicAppsScriptRequest(request) {
  const hostname = new URL(request.url).hostname;
  return hostname === 'script.google.com' || hostname === 'script.googleusercontent.com';
}

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  // Las respuestas del Web App siempre deben venir de la red y nunca del caché de la PWA.
  if (isDynamicAppsScriptRequest(request)) {
    event.respondWith(fetch(request));
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
