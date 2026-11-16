const VERSION = 'rpe-next-v1';
const CACHE = `rpe-static-${VERSION}`;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './assets/pwa/icon-192.png',
  './assets/pwa/icon-512.png',
  './assets/pwa/icon-maskable-512.png',
  './assets/pwa/apple-touch-icon.png',
  './assets/rpe/icons/rpelogo.png',
  './assets/rpe/Texture/Tap2.png',
  './assets/rpe/Texture/Drag2.png',
  './assets/rpe/Texture/Flick2.png',
  './assets/rpe/Texture/HoldHead.png',
  './assets/rpe/Texture/icon/mute.png',
];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const precache = await fetch('./pwa-precache.json').then(response => response.json());
    const files = [...new Set(['./pwa-precache.json', ...SHELL, ...(precache.files ?? [])])];
    const cache = await caches.open(CACHE);
    // Keep each addAll batch small; the full editor bundle is ~27 MB.
    for (let index = 0; index < files.length; index += 64) await cache.addAll(files.slice(index, index + 64));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('rpe-static-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

const sizeAllowed = response => {
  const length = Number(response.headers.get('content-length'));
  return !Number.isFinite(length) || length <= MAX_CACHE_BYTES;
};

const cacheable = request => {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET' || request.headers.has('range')) return false;
  if (url.pathname.endsWith('/sw.js')) return false;
  if (url.pathname.endsWith('/assets/agent-source.json')) return false;
  if (request.destination === 'audio' || request.destination === 'video') return false;
  return true;
};

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          cache.put('./index.html', response.clone()).catch(() => {});
        }
        return response;
      } catch {
        return (await caches.match(request, { ignoreSearch: true }))
          ?? (await caches.match('./index.html'))
          ?? (await caches.match('./'))
          ?? Response.error();
      }
    })());
    return;
  }

  if (!cacheable(request)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic' && sizeAllowed(response)) cache.put(request, response.clone()).catch(() => {});
      return response;
    } catch (error) {
      const fallback = await cache.match(request, { ignoreSearch: true });
      if (fallback) return fallback;
      throw error;
    }
  })());
});
