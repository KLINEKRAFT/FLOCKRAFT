/*
 * FLOCKRAFT service worker — offline shell.
 * ---------------------------------------------------------------------------
 * Strategy per request type:
 *
 *   navigations      network-first, falling back to the cached offline shell.
 *                    Network-first matters here: a stale HTML document pins an
 *                    old JS bundle hash and the app fails to boot after deploy.
 *   static assets    stale-while-revalidate. Build output is content-hashed, so
 *                    a cached response is always correct for its URL.
 *   model weights    cache-first. Several megabytes that never change for a
 *                    given URL — re-downloading them on every session would be
 *                    the single largest waste of a user's data plan.
 *
 * Never cached: API calls, and anything non-GET. Observation data lives in
 * IndexedDB, which is already offline-durable and must not be shadowed by a
 * stale HTTP cache.
 *
 * Bump CACHE_VERSION to invalidate every cache on the next activation.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `flockraft-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `flockraft-assets-${CACHE_VERSION}`;
const MODEL_CACHE = `flockraft-models-${CACHE_VERSION}`;

const SHELL_URLS = ['/', '/timeline', '/entities', '/map', '/settings', '/offline'];

const MODEL_HOSTS = ['storage.googleapis.com', 'tfhub.dev', 'www.kaggle.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Individual failures must not abort the whole install.
      Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.endsWith(CACHE_VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Model weights: cache-first, cross-origin allowed.
  if (MODEL_HOSTS.some((host) => url.hostname.endsWith(host))) {
    event.respondWith(cacheFirst(request, MODEL_CACHE));
    return;
  }

  // Everything else is same-origin only.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
  }
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = (await caches.match(request)) ?? (await caches.match('/'));
    return (
      cached ??
      new Response('<h1>FLOCKRAFT offline</h1><p>No cached shell available.</p>', {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);

  return cached ?? network;
}
