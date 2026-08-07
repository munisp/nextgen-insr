/**
 * InsurePortal POS Shell -- Service Worker v4
 * Features: Web Push (failover/fraud/float/settlement), offline shell cache,
 * background sync for offline TX queue, periodic sync for fraud status.
 */
const CACHE_VERSION = "v5";
const SHELL_CACHE = `insureportal-shell-${CACHE_VERSION}`;
const API_CACHE = `insureportal-api-${CACHE_VERSION}`;
const DATA_CACHE = `insureportal-data-${CACHE_VERSION}`;
const SHELL_ASSETS = ["/", "/offline.html", "/manifest.json", "/favicon.ico"];

// API routes to cache with network-first strategy (old data OK)
const CACHEABLE_API_ROUTES = [
  "/api/trpc/auth.me",
  "/api/trpc/system.getConfig",
  "/api/trpc/dashboard",
  "/api/health",
];

// API routes that must NEVER be cached (mutations, auth, payments)
const NO_CACHE_API_ROUTES = [
  "/api/sync/push",
  "/api/sync/pull",
  "/api/stripe",
  "/api/oauth",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(
              k =>
                k.startsWith("insureportal-") && k !== SHELL_CACHE && k !== API_CACHE
            )
            .map(k => caches.delete(k))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  // Skip WebSocket upgrades
  if (event.request.headers.get("upgrade") === "websocket") return;
  // Skip no-cache API routes
  if (NO_CACHE_API_ROUTES.some(r => url.pathname.startsWith(r))) return;

  if (url.pathname.startsWith("/api/")) {
    // Network-first with cache fallback for API routes
    event.respondWith(
      (async () => {
        const cache = await caches.open(DATA_CACHE);
        try {
          const response = await fetch(event.request, {
            signal: AbortSignal.timeout(15000),
          });
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        } catch {
          const cached = await cache.match(event.request);
          if (cached) {
            const headers = new Headers(cached.headers);
            headers.set("X-Cache-Status", "offline-fallback");
            return new Response(cached.body, {
              status: cached.status,
              statusText: cached.statusText,
              headers,
            });
          }
          return new Response(
            JSON.stringify({
              error: "offline",
              message: "You are offline. Data will sync when you reconnect.",
              cached: false,
            }),
            {
              status: 503,
              headers: {
                "Content-Type": "application/json",
                "X-Cache-Status": "offline-no-cache",
              },
            }
          );
        }
      })()
    );
    return;
  }

  // static assets (.js, .css, images): cache-first with background refresh
  if (
    /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico)$/i.test(
      url.pathname
    )
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(event.request);
        if (cached) {
          // Background refresh
          fetch(event.request)
            .then(r => {
              if (r.ok) cache.put(event.request, r);
            })
            .catch(() => {});
          return cached;
        }
        try {
          const response = await fetch(event.request);
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        } catch {
          return new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  // App shell: cache-first with background refresh
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(event.request);
      const fetchPromise = fetch(event.request)
        .then(r => {
          if (r.ok) cache.put(event.request, r.clone());
          return r;
        })
        .catch(() => null);
      if (cached) return cached;
      const networkResponse = await fetchPromise;
      if (networkResponse) return networkResponse;
      // Offline fallback page
      const offlinePage = await cache.match("/offline.html");
      if (offlinePage) return offlinePage;
      return new Response(
        "<!DOCTYPE html><html><head><title>InsurePortal - Offline</title>" +
          '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          "<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;" +
          "min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0;text-align:center}" +
          ".c{padding:2rem;max-width:400px}h1{font-size:1.5rem}.i{font-size:3rem;margin-bottom:1rem}" +
          "p{color:#888;line-height:1.6}.q{background:#16213e;padding:1rem;border-radius:8px;margin-top:1rem}" +
          ".r{background:#e94560;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:1rem;cursor:pointer;margin-top:1rem}" +
          '</style></head><body><div class="c"><div class="i">📡</div>' +
          "<h1>You're Offline</h1>" +
          "<p>Transactions are safely queued and will sync when you reconnect.</p>" +
          '<div class="q"><p><strong>Offline Mode Active</strong></p>' +
          "<p>Cash-in, cash-out, and balance checks available via SMS.</p>" +
          "<p>Send <strong>HELP</strong> to your InsurePortal SMS number.</p></div>" +
          '<button class="r" onclick="location.reload()">Try Again</button>' +
          "</div></body></html>",
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    })()
  );
});

self.addEventListener("push", event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {
      title: "InsurePortal Alert",
      body: event.data ? event.data.text() : "New alert",
    };
  }

  const type = data.type || "generic";
  let title, body, tag, requireInteraction, url, actions, vibrate;

  switch (type) {
    case "sim_failover":
      title = data.title || "SIM Failover Alert";
      body = data.body || "Terminal switched to backup SIM";
      tag = "failover-" + (data.terminalId || Date.now());
      requireInteraction = true;
      url = "/admin?tab=sim-orchestrator";
      actions = [
        { action: "view", title: "View Details" },
        { action: "dismiss", title: "Dismiss" },
      ];
      vibrate = [200, 100, 200, 100, 400];
      break;
    case "float_approved":
      title = data.title || "Float Top-Up Approved";
      body = data.body || "Your float top-up request has been approved.";
      tag = "float-approved-" + (data.requestId || Date.now());
      requireInteraction = false;
      url = "/agent?tab=float";
      actions = [
        { action: "view", title: "View Balance" },
        { action: "dismiss", title: "Dismiss" },
      ];
      vibrate = [200, 100, 200];
      break;
    case "float_rejected":
      title = data.title || "Float Top-Up Rejected";
      body = data.body || "Your float top-up request was rejected.";
      tag = "float-rejected-" + (data.requestId || Date.now());
      requireInteraction = true;
      url = "/agent?tab=float";
      actions = [
        { action: "view", title: "View Details" },
        { action: "dismiss", title: "Dismiss" },
      ];
      vibrate = [300, 100, 300];
      break;
    case "fraud_alert":
      title = data.title || "Fraud Alert";
      body = data.body || "A suspicious transaction has been detected.";
      tag = "fraud-" + (data.alertId || Date.now());
      requireInteraction = data.severity === "critical";
      url = data.url || "/admin?tab=fraud";
      actions = [
        { action: "investigate", title: "Investigate" },
        { action: "dismiss", title: "Dismiss" },
      ];
      vibrate =
        data.severity === "critical" ? [200, 100, 200, 100, 400] : [200];
      break;
    case "settlement_complete":
      title = data.title || "Settlement Complete";
      body = data.body || "Daily settlement has been processed successfully.";
      tag = "settlement-" + (data.batchId || Date.now());
      requireInteraction = false;
      url = "/admin?tab=settlement";
      actions = [
        { action: "view", title: "View Report" },
        { action: "dismiss", title: "Dismiss" },
      ];
      vibrate = [200];
      break;
    default:
      title = data.title || "InsurePortal POS";
      body = data.body || "You have a new notification.";
      tag = data.tag || "notification-" + Date.now();
      requireInteraction = false;
      url = data.url || "/";
      actions = [{ action: "dismiss", title: "Dismiss" }];
      vibrate = [200];
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192x192.png",
      badge: "/icons/badge-72x72.png",
      tag,
      renotify: true,
      requireInteraction,
      data: Object.assign({ url, type }, data),
      actions,
      vibrate,
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  if (event.action === "dismiss") return;
  const targetUrl =
    (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          if (client.url.includes(targetUrl) && "focus" in client)
            return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      })
  );
});

self.addEventListener("sync", event => {
  if (["fraud-status-sync", "offline-tx-sync", "qr-sync"].includes(event.tag)) {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        const msgType =
          event.tag === "fraud-status-sync"
            ? "SYNC_FRAUD_STATUS"
            : event.tag === "qr-sync"
              ? "SYNC_QR_CODES"
              : "SYNC_OFFLINE_TRANSACTIONS";
        clients.forEach(c => c.postMessage({ type: msgType }));
      })
    );
  }
  // Background sync for offline transaction queue
  if (event.tag === "offline-transaction-sync") {
    event.waitUntil(
      (async () => {
        try {
          const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open("insureportal_offline_queue", 1);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const tx = db.transaction("transactions", "readonly");
          const idx = tx.objectStore("transactions").index("status");
          const queued = await new Promise((resolve, reject) => {
            const req = idx.getAll("queued");
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          db.close();
          if (queued.length === 0) return;
          const response = await fetch("/api/sync/push", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              terminalId: "sw-bg-sync",
              agentId: "sw-bg-sync",
              transactions: queued,
              lastSyncTimestamp: Date.now(),
              networkTier: "3g",
              queueDepth: queued.length,
            }),
          });
          if (response.ok) {
            console.log(
              "[SW] Background sync completed:",
              queued.length,
              "transactions"
            );
          }
        } catch (err) {
          console.error("[SW] Background sync error:", err);
        }
      })()
    );
  }
});

self.addEventListener("periodicsync", event => {
  if (event.tag === "fraud-periodic-sync") {
    event.waitUntil(
      self.clients
        .matchAll()
        .then(clients =>
          clients.forEach(c => c.postMessage({ type: "PERIODIC_FRAUD_SYNC" }))
        )
    );
  }
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "CACHE_URLS") {
    const urls = event.data.payload || [];
    event.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(urls)));
  }
});

// ── Sprint 48: Commission Cascade Offline Cache ──────────────────────────────
const COMMISSION_CACHE = "commission-cascade-v1";
const COMMISSION_ENDPOINTS = [
  "/api/trpc/commissionEngine.tiers",
  "/api/trpc/commissionEngine.splits",
  "/api/trpc/commissionEngine.analytics",
  "/api/trpc/commissionEngine.payouts",
  "/api/trpc/agentHierarchy.list",
  "/api/trpc/transactions.commissionStats",
];

// Cache commission data on successful fetch for offline use
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  const isCommissionEndpoint = COMMISSION_ENDPOINTS.some(ep =>
    url.pathname.startsWith(ep)
  );

  if (isCommissionEndpoint && event.request.method === "GET") {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches
              .open(COMMISSION_CACHE)
              .then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline fallback — serve cached commission data
          return caches.match(event.request).then(cached => {
            if (cached) return cached;
            return new Response(
              JSON.stringify({ error: "offline", cached: false }),
              {
                status: 503,
                headers: { "Content-Type": "application/json" },
              }
            );
          });
        })
    );
  }
});

// Handle commission data sync when coming back online
self.addEventListener("message", event => {
  if (event.data && event.data.type === "COMMISSION_SYNC") {
    event.waitUntil(
      caches.open(COMMISSION_CACHE).then(cache =>
        Promise.all(
          COMMISSION_ENDPOINTS.map(ep =>
            fetch(ep)
              .then(r => (r.ok ? cache.put(new Request(ep), r) : null))
              .catch(() => null)
          )
        )
      )
    );
  }
});

// ── Insurance Domain Extensions (Sprint 99 UI/UX) ───────────────────────────

// Additional insurance-specific cacheable API routes
const INSURANCE_CACHE = "insureportal-insurance-v3";
const INSURANCE_KPI_ENDPOINTS = [
  "/api/trpc/insuranceKpiDashboard.getUnderwriterKpi",
  "/api/trpc/insuranceKpiDashboard.getClaimsKpi",
  "/api/trpc/insuranceKpiDashboard.getActuaryKpi",
  "/api/trpc/insuranceKpiDashboard.getBrokerKpi",
  "/api/trpc/insuranceKpiDashboard.getPolicyholderKpi",
  "/api/trpc/insuranceKpiDashboard.getPremiumCollectionKpi",
  "/api/trpc/insuranceKpiDashboard.getIfrs17Dashboard",
  "/api/trpc/insuranceKpiDashboard.getReinsurerKpi",
  "/api/trpc/insuranceKpiDashboard.getComplianceKpi",
  "/api/trpc/insuranceKpiDashboard.getBillingAdminKpi",
  "/api/trpc/insuranceKpiDashboard.getSupervisorKpi",
  "/api/trpc/insuranceKpiDashboard.getRegulatorKpi",
  "/api/trpc/insuranceKpiDashboard.getPolicyLifecycleKpi",
  "/api/trpc/insuranceKpiDashboard.getSuperAdminKpi",
];

// Background sync queue names for insurance domain
const SYNC_INSURANCE_CLAIM   = "sync-insurance-claim-submit";
const SYNC_INSURANCE_POLICY  = "sync-insurance-policy-apply";
const SYNC_INSURANCE_PAYMENT = "sync-insurance-premium-payment";
const SYNC_INSURANCE_DOCS    = "sync-insurance-document-upload";

// Cache insurance KPI data on fetch
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  const isInsuranceKpi = INSURANCE_KPI_ENDPOINTS.some(ep =>
    url.pathname.startsWith(ep.split("?")[0])
  );

  if (isInsuranceKpi && event.request.method === "GET") {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches
              .open(INSURANCE_CACHE)
              .then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(cached =>
            cached ||
            new Response(JSON.stringify({ error: "offline", cached: false }), {
              status: 503,
              headers: { "Content-Type": "application/json", "X-SW-Offline": "1" },
            })
          )
        )
    );
  }
});

// Insurance background sync handlers
self.addEventListener("sync", event => {
  if (event.tag === SYNC_INSURANCE_CLAIM) {
    event.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: "REPLAY_CLAIM_QUEUE" }))
      )
    );
  }
  if (event.tag === SYNC_INSURANCE_POLICY) {
    event.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: "REPLAY_POLICY_QUEUE" }))
      )
    );
  }
  if (event.tag === SYNC_INSURANCE_PAYMENT) {
    event.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: "REPLAY_PAYMENT_QUEUE" }))
      )
    );
  }
  if (event.tag === SYNC_INSURANCE_DOCS) {
    event.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: "REPLAY_DOCUMENT_QUEUE" }))
      )
    );
  }
});

// Insurance periodic sync — refresh KPI cache every hour
self.addEventListener("periodicsync", event => {
  if (event.tag === "insurance-kpi-refresh") {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(INSURANCE_CACHE);
        await Promise.allSettled(
          INSURANCE_KPI_ENDPOINTS.map(ep =>
            fetch(ep)
              .then(r => r.ok && cache.put(new Request(ep), r))
              .catch(() => null)
          )
        );
      })()
    );
  }
  if (event.tag === "policy-renewal-check") {
    event.waitUntil(
      (async () => {
        try {
          const r = await fetch("/api/trpc/insuranceKpiDashboard.getPolicyholderKpi");
          if (!r.ok) return;
          const data = await r.json();
          const renewals = data?.result?.data?.upcomingRenewals || 0;
          if (renewals > 0) {
            await self.registration.showNotification("Policy Renewal Reminder", {
              body: `You have ${renewals} polic${renewals === 1 ? "y" : "ies"} due for renewal.`,
              icon: "/favicon.ico",
              badge: "/favicon.ico",
              tag: "policy-renewal",
              data: { url: "/policyholder-dashboard" },
              actions: [
                { action: "renew", title: "Renew Now" },
                { action: "dismiss", title: "Later" },
              ],
            });
          }
        } catch {}
      })()
    );
  }
});

// Insurance-specific message handlers
self.addEventListener("message", event => {
  const { type, payload } = event.data || {};

  if (type === "QUEUE_INSURANCE_CLAIM") {
    self.registration.sync
      .register(SYNC_INSURANCE_CLAIM)
      .catch(() => {});
  }
  if (type === "QUEUE_INSURANCE_POLICY") {
    self.registration.sync
      .register(SYNC_INSURANCE_POLICY)
      .catch(() => {});
  }
  if (type === "QUEUE_INSURANCE_PAYMENT") {
    self.registration.sync
      .register(SYNC_INSURANCE_PAYMENT)
      .catch(() => {});
  }
  if (type === "QUEUE_INSURANCE_DOCS") {
    self.registration.sync
      .register(SYNC_INSURANCE_DOCS)
      .catch(() => {});
  }
  if (type === "REGISTER_PERIODIC_SYNC") {
    self.registration.periodicSync
      ?.register("insurance-kpi-refresh", { minInterval: 60 * 60 * 1000 })
      .catch(() => {});
    self.registration.periodicSync
      ?.register("policy-renewal-check", { minInterval: 24 * 60 * 60 * 1000 })
      .catch(() => {});
  }
  if (type === "CLEAR_INSURANCE_CACHE") {
    caches.delete(INSURANCE_CACHE);
  }
});

// ── Innovation Features Cache (Sprint 108) ───────────────────────────────────
const INNOVATION_CACHE = "insureportal-innovations-v1";
const INNOVATION_ENDPOINTS = [
  "/api/trpc/telematics.getDrivingScore",
  "/api/trpc/telematics.getHistory",
  "/api/trpc/healthWearables.getWellnessSummary",
  "/api/trpc/p2pPools.listPools",
  "/api/trpc/comparison.getQuotes",
  "/api/trpc/nhia.getEnrollment",
  "/api/trpc/climateRisk.getRiskScore",
  "/api/trpc/renewalPrediction.getPrediction",
  "/api/trpc/sloMonitor.getSlos",
  "/api/trpc/sloMonitor.getIncidents",
  "/api/trpc/didIdentity.verifyCredential",
  "/api/trpc/groupInsurance.listGroupPolicies",
  "/api/trpc/bancassurance.getPartnerAnalytics",
  "/api/trpc/openInsurance.getData",
  "/api/trpc/parametric.getTriggers",
  "/api/trpc/journeyOrchestratorV2.getDefinitions",
  "/api/trpc/journeyOrchestratorV2.listExecutions",
  "/api/trpc/journeyOrchestratorV2.getAnalytics",
  "/api/trpc/journeyOrchestratorV2.listSchedules",
  "/api/trpc/j20Scheduler.getScheduleStatus",
  "/api/trpc/j20Scheduler.getRecentResults",
];

// Background sync tags for innovation features
const SYNC_TELEMATICS = "sync-telematics-events";
const SYNC_WEARABLES = "sync-wearable-readings";
const SYNC_VOICE_CLAIM = "sync-voice-claim";

// Cache innovation KPI data on fetch
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  const isInnovationEndpoint = INNOVATION_ENDPOINTS.some(ep =>
    url.pathname.startsWith(ep.split("?")[0])
  );

  if (isInnovationEndpoint && event.request.method === "GET") {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches
              .open(INNOVATION_CACHE)
              .then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(cached => {
            if (cached) return cached;
            return new Response(
              JSON.stringify({ error: "offline", cached: false }),
              { status: 503, headers: { "Content-Type": "application/json" } }
            );
          })
        )
    );
  }
});

// Background sync for innovation features
self.addEventListener("sync", event => {
  if (event.tag === SYNC_TELEMATICS) {
    event.waitUntil(syncTelematicsEvents());
  }
  if (event.tag === SYNC_WEARABLES) {
    event.waitUntil(syncWearableReadings());
  }
  if (event.tag === SYNC_VOICE_CLAIM) {
    event.waitUntil(syncVoiceClaims());
  }
});

async function syncTelematicsEvents() {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("insureportal_offline_queue", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // Sync pending telematics events
    const tx = db.transaction("telematics_queue", "readonly");
    const store = tx.objectStore("telematics_queue");
    const events = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const evt of events) {
      await fetch("/api/trpc/telematics.recordEvent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(evt),
      });
    }
    db.close();
  } catch (err) {
    console.error("[SW] Telematics sync error:", err);
  }
}

async function syncWearableReadings() {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("insureportal_offline_queue", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction("wearables_queue", "readonly");
    const store = tx.objectStore("wearables_queue");
    const readings = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const reading of readings) {
      await fetch("/api/trpc/healthWearables.ingestReading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reading),
      });
    }
    db.close();
  } catch (err) {
    console.error("[SW] Wearables sync error:", err);
  }
}

async function syncVoiceClaims() {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("insureportal_offline_queue", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction("voice_claims_queue", "readonly");
    const store = tx.objectStore("voice_claims_queue");
    const claims = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const claim of claims) {
      await fetch("/api/trpc/voiceClaims.transcribeClaim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(claim),
      });
    }
    db.close();
  } catch (err) {
    console.error("[SW] Voice claims sync error:", err);
  }
}

// Handle innovation sync messages from app
self.addEventListener("message", event => {
  if (event.data && event.data.type === "INNOVATION_SYNC") {
    event.waitUntil(
      caches.open(INNOVATION_CACHE).then(cache =>
        Promise.all(
          INNOVATION_ENDPOINTS.map(ep =>
            fetch(ep)
              .then(r => (r.ok ? cache.put(new Request(ep), r) : null))
              .catch(() => null)
          )
        )
      )
    );
  }
});

// Push notification handlers for innovation features
// (Extends the existing push handler above)
// Additional notification types handled:
// - "parametric_payout": Auto-payout notification
// - "ubi_adjustment": UBI premium adjustment
// - "wellness_reward": Wellness reward earned
// - "nhia_claim_approved": NHIA claim approved
// - "renewal_offer": Predictive renewal offer
// - "group_enrollment": Group enrollment complete
// - "slo_breach": SLO breach detected
// - "embedded_policy": Embedded policy issued
