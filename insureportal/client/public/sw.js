/**
 * InsurePortal Service Worker — Offline-First PWA
 * 
 * Strategy:
 * - App Shell (HTML/CSS/JS): Cache-first with network fallback
 * - API data: Network-first with cache fallback (stale-while-revalidate)
 * - Images/fonts: Cache-first (long-lived)
 * - POST requests: Queue for background sync when offline
 */

const CACHE_VERSION = 'insureportal-v3';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DATA_CACHE = `${CACHE_VERSION}-data`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;

// App shell resources to precache
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
];

// API routes to cache for offline access
const CACHEABLE_API_PATTERNS = [
  /\/api\/trpc\/policy\./,
  /\/api\/trpc\/claims\./,
  /\/api\/trpc\/agent\./,
  /\/api\/trpc\/dashboard\./,
  /\/api\/trpc\/geospatial\./,
  /\/api\/trpc\/kyc\./,
  /\/api\/trpc\/compliance\./,
  /\/api\/trpc\/notification\./,
];

// Background sync queue for offline mutations
const SYNC_QUEUE = 'offline-mutations';

// ─── Install: Precache app shell ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Precaching app shell');
      return cache.addAll(APP_SHELL).catch((err) => {
        console.warn('[SW] Some app shell resources failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// ─── Activate: Clean old caches ──────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith('insureportal-') && key !== STATIC_CACHE && key !== DATA_CACHE && key !== IMAGE_CACHE)
          .map((key) => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    })
  );
  self.clients.claim();
});

// ─── Fetch: Route-based caching strategies ───────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET for caching (but queue POSTs for sync)
  if (request.method !== 'GET') {
    if (request.method === 'POST' && !navigator.onLine) {
      event.respondWith(queueForSync(request));
      return;
    }
    return;
  }

  // API requests: Network-first with cache fallback
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/trpc/')) {
    event.respondWith(networkFirstWithCache(request, DATA_CACHE));
    return;
  }

  // Images and fonts: Cache-first
  if (isAssetRequest(url)) {
    event.respondWith(cacheFirstWithNetwork(request, IMAGE_CACHE));
    return;
  }

  // HTML/JS/CSS (app shell): Cache-first with network update
  event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
});

// ─── Background Sync: Retry offline mutations ────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_QUEUE) {
    event.waitUntil(replayOfflineMutations());
  }
});

// ─── Push Notifications ──────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || 'New notification',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'insureportal',
    data: { url: data.url || '/' },
    actions: data.actions || [],
    vibrate: [200, 100, 200],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'InsurePortal', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});

// ─── Caching Strategies ──────────────────────────────────────────────────────

async function networkFirstWithCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) {
      console.log('[SW] Serving from cache (offline):', request.url);
      return cached;
    }
    return new Response(
      JSON.stringify({ error: 'offline', message: 'You are offline. This data is not available in cache.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function cacheFirstWithNetwork(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return new Response('', { status: 408 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || (await fetchPromise) || new Response('Offline', { status: 503 });
}

// ─── Offline Mutation Queue ──────────────────────────────────────────────────

async function queueForSync(request) {
  const body = await request.text();
  const mutation = {
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    timestamp: Date.now(),
  };

  // Store in IndexedDB
  const db = await openSyncDB();
  const tx = db.transaction('mutations', 'readwrite');
  tx.objectStore('mutations').add(mutation);
  await tx.complete;

  // Register for background sync
  if (self.registration.sync) {
    await self.registration.sync.register(SYNC_QUEUE);
  }

  return new Response(
    JSON.stringify({ queued: true, message: 'Request queued for sync when online' }),
    { status: 202, headers: { 'Content-Type': 'application/json' } }
  );
}

async function replayOfflineMutations() {
  const db = await openSyncDB();
  const tx = db.transaction('mutations', 'readonly');
  const mutations = await getAllFromStore(tx.objectStore('mutations'));

  for (const mutation of mutations) {
    try {
      await fetch(mutation.url, {
        method: mutation.method,
        headers: mutation.headers,
        body: mutation.body,
      });

      // Remove successful mutation
      const deleteTx = db.transaction('mutations', 'readwrite');
      deleteTx.objectStore('mutations').delete(mutation.id);
    } catch (err) {
      console.warn('[SW] Sync retry failed for:', mutation.url, err);
    }
  }
}

function openSyncDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('insureportal-sync', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('mutations', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllFromStore(store) {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isAssetRequest(url) {
  return /\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot)$/i.test(url.pathname);
}
