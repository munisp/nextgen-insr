const CACHE_NAME = 'ngapp-showcase-v2';
const API_CACHE = 'ngapp-api-v1';
const ASSETS = ['/', '/index.html', '/manifest.json'];
const API_ROUTES = ['/api/v1/products', '/api/v1/policies', '/api/v1/notifications'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME && k !== API_CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API requests: network-first with cache fallback
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp.ok && e.request.method === 'GET') {
          const clone = resp.clone();
          caches.open(API_CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Static assets: cache-first
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() =>
      caches.match('/index.html')
    ))
  );
});

// Background sync for offline mutations
self.addEventListener('sync', e => {
  if (e.tag === 'sync-offline-mutations') {
    e.waitUntil(syncOfflineMutations());
  }
});

async function syncOfflineMutations() {
  const db = await openSyncDB();
  const tx = db.transaction('pending', 'readonly');
  const store = tx.objectStore('pending');
  const all = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  for (const item of all) {
    try {
      await fetch(item.url, { method: item.method, headers: item.headers, body: item.body });
      const delTx = db.transaction('pending', 'readwrite');
      delTx.objectStore('pending').delete(item.id);
    } catch (_) {
      break; // retry next sync
    }
  }
}

function openSyncDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ngapp-sync', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('pending', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
