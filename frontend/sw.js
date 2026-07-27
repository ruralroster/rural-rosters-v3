/**
 * Rural Rosters — Service Worker (Phase 3, Crystal Cascades)
 *
 * Caching strategy:
 *  - Navigations / index.html: NETWORK FIRST, cache fallback.
 *    This is deliberate — the app is iterated on frequently and a
 *    cache-first shell would serve stale versions indefinitely.
 *  - Static assets (icons, manifest, images): cache first, background refresh.
 *  - Backend calls (cross-origin POST to Cloud Run): never intercepted.
 *
 * IMPORTANT: bump CACHE_VERSION on every release so old caches are purged.
 */

const CACHE_VERSION = 'crystal-cascades-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './crystal-cascades.jpeg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => Promise.all(
        APP_SHELL.map(url => cache.add(url).catch(err => {
          console.warn('[SW] Failed to precache (skipping):', url, err);
        }))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GETs. Backend POSTs to Cloud Run pass straight through.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations and the HTML shell: network first, cache fallback
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    event.respondWith(
      fetch(req)
        .then(resp => {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then(c => c.put('./index.html', copy));
          return resp;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets: cache first, then network (and store)
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        }
        return resp;
      });
    })
  );
});

// ── Web Push ────────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let payload = { title: 'Rural Rosters', body: 'You have a new update.', url: './' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (e) {
    if (event.data) payload.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { url: payload.url || './' },
      tag: payload.tag || undefined
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
