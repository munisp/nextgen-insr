// Unified Insurance Platform - Service Worker
// Bumped to v2 (Q6, 2026-09-25): the activate handler deletes v1 so the old
// cache-first static entries are replaced under the new SWR + no-API policy.
const CACHE_NAME = 'uip-v2';
const OFFLINE_URL = '/offline.html';

const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  OFFLINE_URL, // Q6 2026-09-25: precache the offline fallback so it works offline
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ── Caching policy disclosure (Q-wave Q6 hardening, 2026-09-25) ──────────
  // NEVER cache: (1) non-GET requests — POST/PUT/DELETE carry mutations whose
  // responses must never be replayed; (2) ANY API/tRPC traffic, including
  // read-only queries — they are member-scoped and may carry Set-Cookie /
  // Authorization headers, and auth tokens or session data must never persist
  // in Cache Storage; (3) cross-origin responses (opaque). Only same-origin
  // static assets and navigation shells are cacheable, via
  // stale-while-revalidate below (read-only content ONLY).
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/trpc/')) return;
  // Defence in depth: never cache anything that carries credentials headers.
  if (request.headers.get('Authorization') || request.headers.get('Cookie')) return;

  // For navigation requests, use network-first with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match('/') || caches.match(OFFLINE_URL))
    );
    return;
  }

  // For static assets, use stale-while-revalidate (Q6 2026-09-25): serve the
  // cached copy immediately and refresh it in the background. Applies ONLY to
  // same-origin, unauthenticated, read-only GETs that passed the filters
  // above — API responses, mutations and tokens are never cached.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response.ok && response.type === 'basic') {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    )
  );
});

// Background sync for offline form submissions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-claims') {
    event.waitUntil(syncPendingClaims());
  }
  if (event.tag === 'sync-payments') {
    event.waitUntil(syncPendingPayments());
  }
});

async function syncPendingClaims() {
  // Sync any offline-queued claims when connectivity is restored
  const clients = await self.clients.matchAll();
  clients.forEach((client) => client.postMessage({ type: 'SYNC_CLAIMS' }));
}

async function syncPendingPayments() {
  const clients = await self.clients.matchAll();
  clients.forEach((client) => client.postMessage({ type: 'SYNC_PAYMENTS' }));
}

// Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Insurance Platform', {
      body: data.body || 'You have a new notification',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-96x96.png',
      data: { url: data.url || '/' },
      actions: [
        { action: 'view', title: 'View' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'view' || !event.action) {
    const url = event.notification.data?.url || '/';
    event.waitUntil(clients.openWindow(url));
  }
});
