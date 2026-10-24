/* Rewritten by scripts/finalize-pwa.mjs after Vite build. Dev mode does not register this file. */
const CACHE_VERSION = '__NEON_PONG_CACHE_VERSION__';
const CACHE_NAME = `neon-pong-shell-${CACHE_VERSION}`;
const PRECACHE_URLS = "__NEON_PONG_PRECACHE_LIST__";

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Installation fails instead of caching an incomplete release.
    await cache.addAll(PRECACHE_URLS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('neon-pong-shell-') && key !== CACHE_NAME) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Signaling, health and diagnostics are *always* network-only.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws') ||
      url.pathname.startsWith('/diagnostic')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (!response.ok) throw new Error(`Navigation returned HTTP ${response.status}`);
        return response;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match('/index.html')) || (await cache.match('/offline.html')) ||
          Response.error();
      }
    })());
    return;
  }

  // Prefer precached, content-hashed JS/CSS and icons. Never store API responses.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic' &&
        (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))) {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
