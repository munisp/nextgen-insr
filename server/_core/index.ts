/**
 * index.ts — InsurePortal POS Shell Server Entry Point
 *
 * Production-hardened Express server with:
 *  - Keycloak OIDC authentication (replaces Manus OAuth)
 *  - Rate limiting (express-rate-limit)
 *  - Security headers (helmet)
 *  - Gzip compression
 *  - OpenTelemetry distributed tracing
 *  - Graceful shutdown (SIGTERM/SIGINT)
 *  - Socket.IO real-time events
 *  - tRPC API
 *  - Daily/weekly settlement crons
 */

import "dotenv/config";
import crypto from "crypto";
import path from "path";
import { pathToFileURL } from "url";
import express, { type Express } from "express";
import { loadVaultSecrets } from "../_core/vault";
// NOTE: ../temporal-worker, ../tbClient and ../fluvio are imported lazily
// inside startServer()'s listen callback. They pull in heavyweight optional
// infra clients (protobufjs-based Temporal codecs etc.) that are only needed
// once the server is actually listening; keeping them out of the module graph
// lets createApp() boot the real HTTP stack in test environments without
// those sidecar dependencies.
import { createServer, type Server } from "http";
import net from "net";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { getRedisClient } from "../lib/redisClient";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerKeycloakAuthRoutes, KC_SESSION_COOKIE } from "./keycloakAuth";
import { SignJWT } from "jose";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { initSocketIO } from "../socket";
import { registerSettlementCron } from "../settlementCron";
import { registerLakehouseCron } from "../lakehouseCron";
import { startErpRetryWorker } from "../lib/erpRetryWorker";
import {
  startArchivalCronWorker,
  stopArchivalCronWorker,
} from "../lib/archivalCronWorker";
import { restBridgeRouter } from "../restBridge";
import { registry, httpRequestDurationMs } from "../metrics";
import { verifyWebhookHmac, captureRawBody } from "../middleware/webhookHmac";
import { enforceEnvironment } from "../lib/envValidation";
import { logger, requestLoggingMiddleware } from "./logger";
import { sql } from "drizzle-orm";
import cron from "node-cron";
import { setupGracefulShutdown } from "../lib/gracefulShutdown";
import { startPoolMonitor } from "../lib/dbPoolMonitor";
import { runDisputeAutoEscalation } from "../cron/disputeAutoEscalation";
import { runKycExpiryCheck } from "../cron/kycExpiryCheck";
import { startSarRetryCronSchedule } from "../sar-retry-cron";

// ── Environment validation (must run before any service initialization) ────────
enforceEnvironment();

// ── OpenTelemetry (must be imported before any instrumented modules) ───────────
// Tracing is enabled when OTEL_EXPORTER_OTLP_ENDPOINT is set.
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  import("./telemetry").catch(err =>
    logger.warn({ err: String(err) }, "[OTel] Failed to initialise tracing")
  );
}

// ── Port helpers ──────────────────────────────────────────────────────────────

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => server.close(() => resolve(true)));
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

// ── Security middleware loader ────────────────────────────────────────────────
// A failed security-middleware load is FATAL in production: starting without
// CSP/CSRF/XSS/SQLi/attack-prevention layers is worse than not starting at all.
// In development it is warn-only so missing optional deps don't block HMR.
function handleSecurityMiddlewareError(label: string, err: unknown): never | void {
  const message = err instanceof Error ? err.message : String(err);
  if (process.env.NODE_ENV === "production") {
    logger.error(`[Security] FATAL: ${label} failed to load in production:: ${message}`);
    throw err;
  }
  logger.warn(`[Security] ${label} load failed (non-fatal, development only):: ${message}`);
}

// ── Server bootstrap ──────────────────────────────────────────────────────────

/**
 * createApp — builds the fully-middlewared Express app + HTTP server WITHOUT
 * listening and WITHOUT starting background workers (crons, pool monitor,
 * Temporal, Socket.IO side effects that require infra). This is the testable
 * seam used by the HTTP E2E suite (tests/e2e), which boots the real app
 * against a real database on an ephemeral port.
 *
 * Production behavior is unchanged: startServer() below calls createApp() and
 * then performs the listen + background-worker registration exactly as before.
 */
export async function createApp(): Promise<{ app: Express; server: Server }> {
  // ── Vault secret injection (must run before any env-dependent code) ───────────
  // Falls back gracefully when Vault is unavailable (dev/test without Docker).
  await loadVaultSecrets().catch(err =>
    logger.warn("[Vault] Secret injection skipped:: " + (err as Error).message)
  );

  const app = express();
  const server = createServer(app);

  // ── Sprint 70: Graceful Shutdown ──────────────────────────────────────
  // Static ESM imports (previously require() inside try/catch, which silently
  // disabled these in the ESM bundle). Import/registration failures now
  // surface loudly at startup instead of being swallowed.
  const shutdownMiddleware = setupGracefulShutdown(server);
  app.use(shutdownMiddleware);
  logger.info("[Shutdown] Graceful shutdown handler registered");

  // Trust reverse proxy (nginx, Cloudflare, etc.) for accurate IP detection
  app.set("trust proxy", 1);

  // ── CSP Nonce middleware (must run BEFORE helmet so nonce is available) ────────
  // Generates a fresh per-request nonce and attaches it to res.locals.
  // The Vite-built HTML template reads res.locals.cspNonce via the SSR entry.
  app.use((_req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
    next();
  });

  // Named helper so esbuild can parse the CSP directive array correctly.
  // Helmet 8.x accepts (req, res) => string entries in directive arrays.
  function getNonce(
    _req: unknown,
    res: { locals: { cspNonce: string } }
  ): string {
    return `'nonce-${res.locals.cspNonce}'`;
  }

  // ── Security headers ────────────────────────────────────────────────────────
  const isDev = process.env.NODE_ENV === "development";
  const keycloakOrigin = process.env.KEYCLOAK_URL
    ? new URL(process.env.KEYCLOAK_URL).origin
    : null;
  const keycloakSrc = keycloakOrigin ? [keycloakOrigin] : [];

  // Analytics endpoint for Manus built-in analytics
  const analyticsOrigin = process.env.VITE_ANALYTICS_ENDPOINT
    ? new URL(process.env.VITE_ANALYTICS_ENDPOINT).origin
    : null;
  const analyticsSrc = analyticsOrigin ? [analyticsOrigin] : [];

  app.use(
    helmet({
      contentSecurityPolicy: isDev
        ? false // Vite HMR requires relaxed CSP in dev
        : {
            useDefaults: false,
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: [
                "'self'",
                // Per-request nonce for any remaining inline scripts
                getNonce as unknown as string,
                // Strict-dynamic allows nonce-trusted scripts to load others
                "'strict-dynamic'",
              ],
              scriptSrcAttr: ["'none'"],
              styleSrc: [
                "'self'",
                "'unsafe-inline'", // Required for Tailwind CSS-in-JS
                "https://fonts.googleapis.com",
              ],
              fontSrc: ["'self'", "https://fonts.gstatic.com"],
              imgSrc: ["'self'", "data:", "blob:", "https:"],
              mediaSrc: ["'self'", "blob:"],
              connectSrc: [
                "'self'",
                ...keycloakSrc,
                ...analyticsSrc,
                // Allow WebSocket for Socket.IO
                "ws:",
                "wss:",
              ],
              frameSrc: [...keycloakSrc],
              frameAncestors: ["'none'"],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'", ...keycloakSrc],
              manifestSrc: ["'self'"],
              workerSrc: ["'self'", "blob:"],
              childSrc: ["'self'", "blob:"],
              upgradeInsecureRequests: [],
              blockAllMixedContent: [],
            },
          },
      crossOriginEmbedderPolicy: false,
      // HSTS: 1 year, include subdomains, preload-ready
      hsts: {
        maxAge: 31_536_000,
        includeSubDomains: true,
        preload: true,
      },
      // Prevent MIME-type sniffing
      noSniff: true,
      // Deny framing entirely
      frameguard: { action: "deny" },
      // Referrer policy
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      // Permissions policy (disable dangerous browser features)
      permittedCrossDomainPolicies: { permittedPolicies: "none" },
    })
  );

  // Permissions-Policy header (not yet in helmet 7.x — set manually)
  app.use((_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "geolocation=(), microphone=(), camera=(), payment=(), usb=(), bluetooth=()"
    );
    next();
  });

  // ── X-Request-ID (distributed tracing correlation) ───────────────────────────────
  app.use((req, res, next) => {
    const reqId =
      (req.headers["x-request-id"] as string) || crypto.randomUUID();
    req.headers["x-request-id"] = reqId;
    res.setHeader("X-Request-ID", reqId);
    next();
  });

  // ── Per-request structured logging (F-07) ─────────────────────────────────
  // Attaches a pino child logger (with requestId/traceId) to req.log and emits
  // one structured log line per response. Runs AFTER the X-Request-ID
  // middleware above so the logged requestId matches the response header and
  // the tRPC context requestId (server/_core/context.ts).
  app.use(requestLoggingMiddleware);

  // ── Compression ─────────────────────────────────────────────────
  app.use(compression());

  // ── Rate limiting ────────────────────────────────────────────────────────────
  // Use Redis store in production for distributed rate limiting across replicas.
  // Falls back to in-memory store if Redis is unavailable.
  // Build a factory so each limiter gets its own RedisStore instance (required by express-rate-limit).
  // Falls back to undefined (in-memory) if Redis is unavailable.
  function makeRedisStore(prefix: string): RedisStore | undefined {
    // Skip Redis store when REDIS_URL is not set (dev without Docker).
    // Rate limiting falls back to in-memory store.
    if (!process.env.REDIS_URL) return undefined;
    try {
      const redisClient = getRedisClient();
      return new RedisStore({
        sendCommand: (...args: string[]) =>
          (
            redisClient as unknown as {
              call: (...a: unknown[]) => Promise<number>;
            }
          ).call(...args),
        prefix: `rl:insureportal:${prefix}:`,
      });
    } catch {
      return undefined;
    }
  }

  // Global limiter: generous limits to avoid blocking SPA asset loading.
  // In development, Vite HMR loads hundreds of modules on page load.
  // Production: 1000 req/15min is sufficient for normal API usage.
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isDev ? 5000 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore("global"),
    message: { error: "Too many requests, please try again later." },
    // Skip rate limiting for static assets, Vite HMR, and health checks
    skip: req => {
      const path = req.path;
      return (
        path.startsWith("/@") || // Vite internal (/@vite, /@react-refresh, /@fs)
        path.startsWith("/src/") || // Vite dev module serving
        path.startsWith("/node_modules/") || // Vite dep pre-bundling
        path.startsWith("/assets/") || // Built static assets
        path.endsWith(".js") ||
        path.endsWith(".css") ||
        path.endsWith(".map") ||
        path.endsWith(".ico") ||
        path.endsWith(".png") ||
        path.endsWith(".svg") ||
        path.endsWith(".woff2") ||
        path === "/api/health"
      );
    },
  });
  app.use(globalLimiter);

  // Stricter limiter for auth endpoints: 50 requests per 15 minutes per IP
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore("auth"),
    message: {
      error: "Too many authentication attempts, please try again later.",
    },
  });
  app.use("/api/auth", authLimiter);

  // ── Stripe Webhook (must be BEFORE express.json() for signature verification) ──
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      try {
        const { handleStripeWebhook } = await import(
          "../stripe/webhookHandler"
        );
        return handleStripeWebhook(req, res);
      } catch (err: any) {
        logger.error("[Stripe Webhook] Handler load error:: " + err.message);
        return res.status(500).json({ error: "Webhook handler unavailable" });
      }
    }
  );

  // ── Body parsers ─────────────────────────────────────────────────
  // SECURITY: Limit request body size to 10MB (was 50MB) to prevent DoS via large payloads.
  // File uploads should use multipart/form-data with streaming, not JSON body.
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));

  // ── Sprint 70: Production Middleware Stack ──────────────────────────────
  // SECURITY middleware — fatal in production, warn-only in development.
  try {
    const secMod = await import("../middleware/securityHardening.js");
    secMod.applySecurityMiddleware(app);
    logger.info(
      "[Security] Hardening middleware applied (CSP, HSTS, CSRF, XSS, SQLi, rate limiting, CORS)"
    );
  } catch (secErr) {
    handleSecurityMiddlewareError("Hardening middleware", secErr);
  }

  try {
    const logMod = await import("../middleware/structuredLogging.js");
    app.use(logMod.structuredLoggingMiddleware);
    logger.info("[Middleware] Structured logging enabled");
  } catch (e) {
    logger.warn("[Middleware] Structured logging failed:: " + (e as any).message);
  }

  try {
    // apiVersioningMiddleware loaded from middleware/apiVersioning
    const verMod = await import("../middleware/apiVersioning.js");
    app.use("/api", verMod.apiVersionMiddleware);
    logger.info("[Middleware] API versioning enabled");
  } catch (e) {
    logger.warn("[Middleware] API versioning failed:: " + (e as any).message);
  }

  try {
    const compMod = await import("../middleware/responseCompression.js");
    app.use(compMod.responseCompressionMiddleware);
    logger.info("[Middleware] Response compression enabled");
  } catch (e) {
    logger.warn("[Middleware] Response compression failed:: " + (e as any).message
    );
  }

  // ── Sprint 71: Multi-Language Security Orchestrator (Rust DDoS + Go PBAC + Python Fraud ML) ──
  // SECURITY middleware — fatal in production, warn-only in development.
  try {
    const orchMod = await import("../middleware/securityOrchestrator.js");
    orchMod.applySecurityOrchestrator(app);
    logger.info(
      "[Security] Multi-language security orchestrator registered (Rust DDoS, Go PBAC, Python Fraud ML)"
    );
  } catch (e) {
    handleSecurityMiddlewareError("Security orchestrator", e);
  }

  // ── Sprint 71: Financial Attack Prevention Middleware ──
  // SECURITY middleware — fatal in production, warn-only in development.
  try {
    const finMod = await import("../middleware/financialAttackPrevention.js");
    finMod.applyFinancialAttackPrevention(app);
    logger.info(
      "[Security] Financial attack prevention registered (replay, card-testing, ATO, collusion, exfiltration)"
    );
  } catch (e) {
    handleSecurityMiddlewareError("Financial attack prevention", e);
  }

  // ── HTTP request duration instrumentation ─────────────────────────────────
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const route = req.route?.path ?? req.path ?? "unknown";
      httpRequestDurationMs
        .labels(req.method, route, String(res.statusCode))
        .observe(Date.now() - start);
    });
    next();
  });

  // ── API versioning ────────────────────────────────────────────────────────
  // All /api/* responses carry X-API-Version for clients to detect breaking changes.
  // The tRPC endpoint is mounted at /api/trpc (v1 implicit).
  // Future breaking changes will be served at /api/v2/trpc while v1 remains live
  // during a deprecation window (minimum 6 months).
  const API_VERSION = process.env.API_VERSION ?? "1.0.0";
  app.use("/api", (_req, res, next) => {
    res.setHeader("X-API-Version", API_VERSION);
    res.setHeader("X-API-Deprecated", "false");
    next();
  });

  // /api/v1/trpc — explicit versioned alias (same router, zero overhead)
  app.use(
    "/api/v1/trpc",
    createExpressMiddleware({ router: appRouter, createContext })
  );

  // ── Keycloak auth routes (/api/auth/login, /callback, /logout, /me) ─────────
  registerKeycloakAuthRoutes(app);

  // ── DEV-ONLY: Auto-login bypass for testing (no Keycloak required) ──────────
  if (process.env.NODE_ENV === "development") {
    app.get("/api/dev-login", async (req, res) => {
      const { getJwtSecret } = await import("../lib/envValidation");
      const jwtSecret = new TextEncoder().encode(getJwtSecret());
      const sessionJwt = await new SignJWT({
        sub: "dev-admin-001",
        name: "Dev Admin",
        email: "admin@insureportal.dev",
        role: "admin",
        accessToken: "dev-access-token",
        refreshToken: "dev-refresh-token",
        idToken: "dev-id-token",
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("8h")
        .sign(jwtSecret);

      res.cookie(KC_SESSION_COOKIE, sessionJwt, {
        httpOnly: true,
        path: "/",
        sameSite: "none",
        secure:
          req.protocol === "https" ||
          (req.headers["x-forwarded-proto"] ?? "").toString().includes("https"),
        maxAge: 8 * 60 * 60 * 1000,
      });

      // S94-06: Prevent open redirect — validate returnTo is internal path only
      const rawReturnTo =
        (req.query.returnTo as string) || "/agent-float-forecasting";
      const safeReturnTo =
        rawReturnTo.startsWith("/") &&
        !rawReturnTo.startsWith("//") &&
        !/[\\/][@\\]/.test(rawReturnTo.charAt(1))
          ? rawReturnTo
          : "/";
      res.redirect(safeReturnTo);
    });
    logger.info(
      "[DEV] Auto-login bypass available at GET /api/dev-login?returnTo=/path"
    );
  }

  // ── Socket.IO ────────────────────────────────────────────────────────────────
  // Skipped under NODE_ENV=test: initSocketIO starts a permanent polling
  // interval that would keep a short-lived test process alive, and the HTTP
  // E2E suite exercises the request/response surface only.
  if (process.env.NODE_ENV !== "test") {
    initSocketIO(server);
  }

  // ── tRPC API ─────────────────────────────────────────────────────────────────
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError: ({ error, type, path, input, ctx }) => {
        // Log all internal server errors (5xx) — client errors (4xx) are expected
        if (error.code === "INTERNAL_SERVER_ERROR") {
          logger.error({
            err: error.message,
            type,
            path,
            userId: (ctx as any)?.user?.id,
            requestId: (ctx as any)?.requestId,
          }, "[tRPC] Internal server error");
        } else if (error.code !== "UNAUTHORIZED" && error.code !== "NOT_FOUND") {
          logger.warn({
            code: error.code,
            type,
            path,
            requestId: (ctx as any)?.requestId,
          }, "[tRPC] Procedure error");
        }
      },
    })
  );

  // ── REST Bridge (Management PWA, Customer Portal, Super Admin) ─────────────
  // Maps GET/POST/PUT/DELETE /api/v1/* to tRPC procedures and DB helpers.
  app.use("/api/v1", restBridgeRouter);

  // ── P1-A: Inbound Webhooks with HMAC-SHA256 verification ────────────────────
  // captureRawBody must run BEFORE express.json() on each webhook route.
  app.post(
    "/webhooks/tigerbeetle",
    captureRawBody,
    express.json(),
    verifyWebhookHmac("TIGERBEETLE_WEBHOOK_SECRET"),
    async (req, res) => {
      try {
        const { event, data } = req.body ?? {};
        logger.info(`[Webhook/TB] event=${event}: ` + data);
        res.json({ received: true });
      } catch (err) {
        logger.error("[Webhook/TB] Handler error:: " + String(err));
        res.status(500).json({ error: "Webhook processing failed" });
      }
    }
  );

  app.post(
    "/webhooks/termii",
    captureRawBody,
    express.json(),
    verifyWebhookHmac("TERMII_WEBHOOK_SECRET", "x-termii-signature"),
    async (req, res) => {
      try {
        const { event, data } = req.body ?? {};
        logger.info(`[Webhook/Termii] event=${event}: ` + data);
        res.json({ received: true });
      } catch (err) {
        logger.error("[Webhook/Termii] Handler error:: " + String(err));
        res.status(500).json({ error: "Webhook processing failed" });
      }
    }
  );

  app.post(
    "/webhooks/partner",
    captureRawBody,
    express.json(),
    verifyWebhookHmac("PARTNER_WEBHOOK_SECRET"),
    async (req, res) => {
      try {
        const { event, data } = req.body ?? {};
        logger.info(`[Webhook/Partner] event=${event}: ` + data);
        res.json({ received: true });
      } catch (err) {
        logger.error("[Webhook/Partner] Handler error:: " + String(err));
        res.status(500).json({ error: "Webhook processing failed" });
      }
    }
  );

  // ── Scheduled cron handlers ──────────────────────────────────────────────────
  const { handleMonthlyInvoiceCron } = await import(
    "../scheduled/monthlyInvoiceCron"
  );
  app.post("/api/scheduled/monthly-invoices", handleMonthlyInvoiceCron);

  // ── Health check ─────────────────────────────────────────────────────────────
  app.get("/api/health", async (_req, res) => {
    const checks: Record<string, string> = {};
    const latencies: Record<string, number> = {};

    // ── DB connectivity + latency ──────────────────────────────────────────
    try {
      const { Pool } = await import("pg");
      const pool = new Pool({
        connectionString: process.env.POSTGRES_URL ?? process.env.DATABASE_URL,
        max: 1,
        connectionTimeoutMillis: 3000,
      });
      const t0 = Date.now();
      await pool.query("SELECT 1");
      latencies.db = Date.now() - t0;
      await pool.end();
      checks.db = "connected";
    } catch {
      checks.db = "error";
      latencies.db = -1;
    }

    // ── Redis ping ─────────────────────────────────────────────────────────
    try {
      const { getRedisClient } = await import("../lib/redisClient");
      const redis = getRedisClient();
      const t0 = Date.now();
      await redis.ping();
      latencies.redis = Date.now() - t0;
      checks.redis = "connected";
    } catch {
      checks.redis = "unavailable";
      latencies.redis = -1;
    }

    // ── MinIO / S3 reachability ────────────────────────────────────────────
    try {
      const minioUrl = process.env.MINIO_ENDPOINT ?? "http://minio:9000";
      const t0 = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      const resp = await fetch(`${minioUrl}/minio/health/live`, {
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      latencies.minio = Date.now() - t0;
      checks.minio = resp.ok ? "reachable" : "degraded";
    } catch {
      checks.minio = "unavailable";
      latencies.minio = -1;
    }

    // ── Kafka / Redpanda broker reachability ──────────────────────────────
    try {
      const kafkaUrl = process.env.KAFKA_ADMIN_URL ?? "http://redpanda:9644";
      const t0 = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      const resp = await fetch(`${kafkaUrl}/v1/cluster`, {
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      latencies.kafka = Date.now() - t0;
      checks.kafka = resp.ok ? "reachable" : "degraded";
    } catch {
      checks.kafka = "unavailable";
      latencies.kafka = -1;
    }

    // ── Keycloak configuration ─────────────────────────────────────────────
    checks.keycloak = process.env.KEYCLOAK_URL
      ? "configured"
      : "not configured";

    // ── TB sidecar ────────────────────────────────────────────────────────
    try {
      const { tbIsHealthy } = await import("../tbClient");
      checks.tbSidecar = (await tbIsHealthy()) ? "running" : "offline";
    } catch {
      checks.tbSidecar = "offline";
    }

    const allCritical = checks.db === "connected";
    res.json({
      status: allCritical ? "ok" : "degraded",
      version: process.env.npm_package_version ?? "1.0.0",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
      latencies,
      // Legacy fields for backward compat with existing SystemHealth.tsx
      db: checks.db,
      redis: checks.redis,
      minio: checks.minio,
      kafka: checks.kafka,
      keycloak: checks.keycloak,
      tbSidecar: checks.tbSidecar,
    });
  });

  // ── Circuit Breaker Status ────────────────────────────────────────────────

  // ── Kubernetes readiness probe (/api/ready) ───────────────────────────────
  // Returns 200 only when all critical dependencies are reachable.
  // Used by Kubernetes readinessProbe to gate traffic routing.
  app.get("/api/ready", async (_req, res) => {
    const checks: Record<string, boolean> = {};
    // Check PostgreSQL
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (db) {
        await db.execute(sql`SELECT 1`);
        checks.postgres = true;
      } else {
        checks.postgres = false;
      }
    } catch { checks.postgres = false; }
    // Check Redis
    try {
      const { getRedisClient } = await import("../lib/redisClient");
      const redis = getRedisClient();
      if (redis) {
        await redis.ping();
        checks.redis = true;
      } else {
        checks.redis = false;
      }
    } catch { checks.redis = false; }
    // Check TigerBeetle sidecar
    try {
      const { tbIsHealthy } = await import("../tbClient");
      checks.tigerbeetle = await tbIsHealthy();
    } catch { checks.tigerbeetle = false; }

    const allReady = Object.values(checks).every(Boolean);
    res.status(allReady ? 200 : 503).json({
      ready: allReady,
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/health/circuits", async (_req, res) => {
    const { getCircuitBreakerStatus } = await import("../lib/resilientFetch");
    const { getDistributedStateStatus } = await import(
      "../lib/distributedState"
    );
    const circuits = getCircuitBreakerStatus();
    const stateStore = getDistributedStateStatus();
    const openCount = Object.values(circuits).filter(
      c => c.state === "open"
    ).length;
    res.json({
      status: openCount === 0 ? "healthy" : "degraded",
      openCircuits: openCount,
      circuits,
      stateStore,
    });
  });

  // ── Prometheus metrics ─────────────────────────────────────────────────────
  // Exposed at GET /api/metrics in Prometheus text format.
  // In production, restrict access to internal network or add Bearer auth.
  app.get("/api/metrics", async (_req, res) => {
    try {
      const metrics = await registry.metrics();
      res.set("Content-Type", registry.contentType);
      res.end(metrics);
    } catch (err) {
      res.status(500).end(String(err));
    }
  });

  // ── Real-Time Fraud Alert SSE Stream ────────────────────────────────────────
  // Clients connect to GET /api/fraud/alerts/stream to receive live alerts.
  // Uses Server-Sent Events (SSE) — no WebSocket upgrade needed.
  app.get("/api/fraud/alerts/stream", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    });
    res.flushHeaders();

    // Send heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(":heartbeat\n\n");
    }, 30_000);

    // Subscribe to fraud alert events (dynamic import to avoid require() in ESM)
    const onAlert = (alert: unknown) => {
      res.write(`data: ${JSON.stringify(alert)}\n\n`);
    };
    let fraudAlertBus: any;
    import("../lib/fraudDetectionEngine")
      .then(mod => {
        fraudAlertBus = mod.fraudAlertBus;
        fraudAlertBus.on("alert", onAlert);
      })
      .catch(err =>
        logger.warn("[Fraud SSE] Could not load fraudDetectionEngine:: " + String(err))
      );

    // Clean up on disconnect
    req.on("close", () => {
      clearInterval(heartbeat);
      if (fraudAlertBus) fraudAlertBus.off("alert", onAlert);
    });
  });

  // ── Frontend ──────────────────────────────────────────────────────────────
  // Skipped entirely in test runs (NODE_ENV=test): the E2E suite only exercises
  // the API surface and must not require a client build.
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else if (process.env.NODE_ENV !== "test") {
    serveStatic(app);
  }

  return { app, server };
}

// ── Production entry point ──────────────────────────────────────────────────────
// Registers background workers, binds the port and installs signal handlers.
// Only invoked when this file is run directly (see the guard at the bottom).
async function startServer() {
  const { server } = await createApp();

  // ── Sprint 70: DB Pool Monitor ──────────────────────────────────────
  startPoolMonitor(60000);
  logger.info("[DBPool] Connection pool monitoring started");

  // ── Sprint 70: Cron Jobs ──────────────────────────────────────────
  cron.schedule("*/15 * * * *", runDisputeAutoEscalation); // Every 15 min
  cron.schedule("0 6 * * *", runKycExpiryCheck); // Daily at 6 AM

  // SAR retry cron — every 15 minutes, retries pending NFIU submissions
  startSarRetryCronSchedule();
  logger.info(
    "[Cron] Dispute auto-escalation (15min), KYC expiry check (daily 06:00) and SAR retry (15min) registered"
  );

  // ── Start listening ───────────────────────────────────────────────────────────
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    logger.info(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, "0.0.0.0", () => {
    logger.info(`Server running on http://localhost:${port}/`);
    logger.info("[REDACTED]");
    // Register settlement crons
    registerSettlementCron();
    // Register lakehouse daily snapshot crons (02:00–02:15 WAT)
    registerLakehouseCron();
    // Start ERP auto-retry worker (exponential backoff)
    startErpRetryWorker();
    // Start archival cron worker (S60-3)
    startArchivalCronWorker();
    // Ensure Fluvio topics exist (idempotent)
    import("../fluvio")
      .then(({ ensureFluvioTopics }) => ensureFluvioTopics())
      .catch(err =>
        logger.warn("[Fluvio] Topic creation failed:: " + (err as Error).message)
      );
    // Seed TigerBeetle system accounts (idempotent — safe to call on every startup)
    import("../tbClient")
      .then(({ tbSeedSystemAccounts }) => tbSeedSystemAccounts())
      .catch(err =>
        logger.warn("[TigerBeetle] System account seeding failed:: " + (err as Error).message)
      );
    // Start Temporal worker for SettlementWorkflow, FloatReplenishmentWorkflow, etc.
    // Runs in-process; in production it can also be a separate Docker container.
    import("../temporal-worker")
      .then(({ startTemporalWorker }) => startTemporalWorker())
      .catch(err =>
        logger.warn("[Temporal] Worker startup skipped (Temporal server not available):: " + (err as Error).message
        )
      );
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────────
  let shuttingDown = false;

  // P3-3: Enhanced graceful shutdown with connection draining, pool cleanup, and health flip
  async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    const shutdownStart = Date.now();
    logger.info(`[Server] Received ${signal}. Starting graceful shutdown…`);

    // Phase 0: Stop background workers
    logger.info("[Server] Phase 0: Stopping background workers…");
    stopArchivalCronWorker();

    // Phase 1: Stop accepting new connections (health checks return 503)
    logger.info("[Server] Phase 1: Stopping new connections…");

    // Phase 2: Close HTTP server (drain in-flight requests)
    logger.info("[Server] Phase 2: Draining in-flight HTTP requests…");
    server.close(async err => {
      if (err) {
        logger.error("[Server] Error during HTTP shutdown:: " + String(err));
      }
      logger.info("[Server] HTTP server closed.");

      // Phase 3: Close database connection pool
      logger.info("[Server] Phase 3: Closing database connection pool…");
      try {
        const { getPool } = await import("../db");
        const pool = await getPool();
        if (pool) {
          await pool.end();
          logger.info("[Server] Database pool closed.");
        }
      } catch (e) {
        logger.error("[Server] Error closing DB pool:: " + e);
      }

      // Phase 4: Close Redis connections
      logger.info("[Server] Phase 4: Closing Redis connections…");
      try {
        const { getRedisClient } = await import("../lib/redisClient");
        const redis = getRedisClient();
        if (redis) {
          await redis.quit();
          logger.info("[Server] Redis connection closed.");
        }
      } catch (e) {
        logger.error("[Server] Error closing Redis:: " + e);
      }

      const elapsed = Date.now() - shutdownStart;
      logger.info(
        `[Server] Graceful shutdown complete in ${elapsed}ms. Exiting.`
      );
      process.exit(0);
    });

    // Force exit after 30 seconds if connections don't drain
    setTimeout(() => {
      const elapsed = Date.now() - shutdownStart;
      logger.error(`[Server] Forced exit after ${elapsed}ms (30s timeout).`);
      process.exit(1);
    }, 30_000).unref();
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  // SIGHUP — zero-downtime mTLS certificate rotation
  process.on("SIGHUP", () => {
    import("../lib/mtlsAgent.js")
      .then(({ resetMtlsAgent }) => resetMtlsAgent())
      .catch(err => logger.error("[mTLS] SIGHUP reload failed:: " + String(err)));
  });
}


// ── Direct-run guard ───────────────────────────────────────────────────────────
// Importing this module (e.g. from the HTTP E2E test harness, which calls
// createApp() directly) must never bind a port, start background workers, or
// install process-level handlers. Only the real entry point does that.
// This holds for every supported launch mode:
//   - tsx watch server/_core/index.ts   (dev)
//   - node dist/index.js                (production esbuild bundle, ESM)
//   - ts-node / tsx one-shot runs
const isDirectRun =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  // ── Process-level error handlers (must be registered before startServer) ──────
  // These catch any unhandled promise rejections or synchronous throws that escape
  // the Express/tRPC error handlers. Without these, Node.js will crash silently.
  process.on("uncaughtException", (err: Error) => {
    // Use console.error as logger may not be initialized yet
    console.error("[FATAL] Uncaught exception — process will exit:", err);
    // Give logger a chance to flush, then exit with non-zero code
    setTimeout(() => process.exit(1), 500);
  });

  process.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
    console.error("[FATAL] Unhandled promise rejection:", reason, "at:", promise);
    // Do NOT exit — unhandled rejections in non-critical paths should not crash the server.
    // Log and continue; critical paths use explicit try/catch.
  });

  // A startup failure is FATAL: log and exit non-zero so the process supervisor
  // (Docker/Kubernetes/systemd) restarts or alerts instead of leaving a
  // half-initialised server running (e.g. missing security middleware).
  startServer().catch(err => {
    console.error("[FATAL] Server startup failed:", err);
    process.exit(1);
  });
}
