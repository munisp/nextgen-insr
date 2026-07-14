/**
 * InsurePortal PWA Service Worker v2
 * Features: Offline-first, push notifications, background sync,
 * claims draft caching, real-time event buffering, voice recording cache.
 */
const CACHE_VERSION = "insureportal-v2";
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const API_CACHE = `api-${CACHE_VERSION}`;
const CLAIMS_CACHE = `claims-draft-${CACHE_VERSION}`;
const VOICE_CACHE = `voice-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  "/",
  "/offline.html",
  "/manifest.json",
  "/favicon.ico",
  "/assets/logo.svg",
];

// Network-first (fresh data preferred, fallback to cache)
const CACHEABLE_API = [
  "/api/trpc/policies.list",
  "/api/trpc/claims.list",
  "/api/trpc/dashboard",
  "/api/trpc/notifications.list",
  "/api/trpc/products.list",
  "/api/v1/compare",
  "/api/v1/quote",
  "/health",
];

// Never cache (mutations, payments, auth)
const NO_CACHE = [
  "/api/v1/payments",
  "/api/trpc/auth.login",
  "/api/trpc/auth.signup",
  "/api/trpc/claims.create",
  "/api/trpc/claims.approve",
];

// ── Install ──────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("insureportal-") || k.startsWith("shell-") || k.startsWith("api-"))
            .filter((k) => k !== SHELL_CACHE && k !== API_CACHE && k !== CLAIMS_CACHE)
            .map((k) => caches.delete(k))
        )
      )
  );
  self.clients.claim();
});

// ── Fetch Strategy ───────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (event.request.headers.get("upgrade") === "websocket") return;
  if (NO_CACHE.some((r) => url.pathname.startsWith(r))) return;

  // API routes: network-first with cache fallback
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstWithCache(event.request, API_CACHE));
    return;
  }

  // Static assets: cache-first with background refresh
  if (/\.(js|css|png|jpg|svg|woff2?|ico)$/i.test(url.pathname)) {
    event.respondWith(cacheFirstWithRefresh(event.request, SHELL_CACHE));
    return;
  }

  // App shell: cache-first
  event.respondWith(cacheFirstWithRefresh(event.request, SHELL_CACHE));
});

async function networkFirstWithCache(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(10000) });
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("X-Cache-Status", "offline-fallback");
      return new Response(cached.body, { status: cached.status, headers });
    }
    return new Response(
      JSON.stringify({ error: "offline", message: "You are offline. Data will sync when reconnected." }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function cacheFirstWithRefresh(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    fetch(request).then((r) => { if (r.ok) cache.put(request, r); }).catch(() => {});
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const offline = await cache.match("/offline.html");
    return offline || new Response("Offline", { status: 503 });
  }
}

// ── Push Notifications ───────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || data.message,
    icon: "/assets/logo-192.png",
    badge: "/assets/badge-72.png",
    vibrate: [100, 50, 100],
    tag: data.tag || "insureportal",
    data: {
      url: data.url || "/",
      action: data.action,
      claimId: data.claim_id,
      policyId: data.policy_id,
    },
    actions: getNotificationActions(data.type),
  };

  event.waitUntil(self.registration.showNotification(data.title || "InsurePortal", options));
});

function getNotificationActions(type) {
  switch (type) {
    case "claim_status":
      return [
        { action: "view", title: "View Claim" },
        { action: "dismiss", title: "Dismiss" },
      ];
    case "payment_due":
      return [
        { action: "pay", title: "Pay Now" },
        { action: "remind", title: "Remind Later" },
      ];
    case "policy_renewal":
      return [
        { action: "renew", title: "Renew" },
        { action: "view", title: "View Details" },
      ];
    default:
      return [{ action: "view", title: "Open" }];
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});

// ── Background Sync (offline claims/payments) ────────────────────────────────

self.addEventListener("sync", (event) => {
  switch (event.tag) {
    case "sync-claims-draft":
      event.waitUntil(syncClaimsDrafts());
      break;
    case "sync-payment-intents":
      event.waitUntil(syncPaymentIntents());
      break;
    case "sync-voice-recordings":
      event.waitUntil(syncVoiceRecordings());
      break;
  }
});

async function syncClaimsDrafts() {
  const cache = await caches.open(CLAIMS_CACHE);
  const requests = await cache.keys();
  for (const request of requests) {
    const response = await cache.match(request);
    if (!response) continue;
    const draft = await response.json();
    try {
      await fetch("/api/trpc/claims.create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      await cache.delete(request);
    } catch {
      // Will retry on next sync
    }
  }
}

async function syncPaymentIntents() {
  // Retry queued payment verifications
  const stored = await getFromIDB("payment-intents");
  for (const intent of stored) {
    try {
      await fetch("/api/v1/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: intent.reference }),
      });
      await removeFromIDB("payment-intents", intent.id);
    } catch {
      // Will retry
    }
  }
}

async function syncVoiceRecordings() {
  const cache = await caches.open(VOICE_CACHE);
  const requests = await cache.keys();
  for (const request of requests) {
    const response = await cache.match(request);
    if (!response) continue;
    const blob = await response.blob();
    try {
      const formData = new FormData();
      formData.append("audio", blob);
      await fetch("/api/v1/voice/transcribe", { method: "POST", body: formData });
      await cache.delete(request);
    } catch {
      // Will retry
    }
  }
}

// ── IndexedDB helpers ────────────────────────────────────────────────────────

function getFromIDB(store) {
  return new Promise((resolve) => {
    const req = indexedDB.open("insureportal-sw", 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(store, { keyPath: "id" });
    req.onsuccess = (e) => {
      try {
        const tx = e.target.result.transaction(store, "readonly");
        const all = tx.objectStore(store).getAll();
        all.onsuccess = () => resolve(all.result || []);
        all.onerror = () => resolve([]);
      } catch { resolve([]); }
    };
    req.onerror = () => resolve([]);
  });
}

function removeFromIDB(store, id) {
  return new Promise((resolve) => {
    const req = indexedDB.open("insureportal-sw", 1);
    req.onsuccess = (e) => {
      try {
        const tx = e.target.result.transaction(store, "readwrite");
        tx.objectStore(store).delete(id);
        tx.oncomplete = () => resolve();
      } catch { resolve(); }
    };
    req.onerror = () => resolve();
  });
}
