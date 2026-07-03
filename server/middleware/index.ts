// TypeScript enabled — Sprint 96 security audit
/**
 * Sprint 52 — Server Middleware Stack
 * F03: Rate limiting, request logging, request ID tracking
 * F07: Input sanitization, XSS prevention
 * F10: CORS hardening
 */
import { Request, Response, NextFunction, Express } from "express";
import crypto from "crypto";
import { logger } from '../_core/logger';

// ─── Request ID Middleware ───────────────────────────────────────
export function requestIdMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const id = (req.headers["x-request-id"] as string) || crypto.randomUUID();
  (req as any).requestId = id;
  _res.setHeader("X-Request-Id", id);
  next();
}

// ─── Request Logger ─────────────────────────────────────────────
export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const start = Date.now();
  const reqId = (req as any).requestId || "-";
  res.on("finish", () => {
    const duration = Date.now() - start;
    const level =
      res.statusCode >= 500 ? "ERROR" : res.statusCode >= 400 ? "WARN" : "INFO";
    logger.info(
      `[${level}] ${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms reqId=${reqId} ip=${req.ip}`
    );
  });
  next();
}

// ─── In-Memory Rate Limiter ─────────────────────────────────────
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 120; // requests per window

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAt < now) rateLimitStore.delete(key);
  }
}, 300_000);

export function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Skip health checks
  if (
    req.path === "/healthz" ||
    req.path === "/readyz" ||
    req.path === "/livez"
  )
    return next();

  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  let entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < now) {
    entry = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitStore.set(key, entry);
  } else {
    entry.count++;
  }

  res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX);
  res.setHeader(
    "X-RateLimit-Remaining",
    Math.max(0, RATE_LIMIT_MAX - entry.count)
  );
  res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: "Too Many Requests",
      message: `Rate limit exceeded. Max ${RATE_LIMIT_MAX} requests per minute.`,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    });
  }
  next();
}

// ─── XSS Sanitization ──────────────────────────────────────────
function sanitizeValue(val: any): any {
  if (typeof val === "string") {
    return val
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/javascript:/gi, "")
      .replace(/on\w+\s*=/gi, "");
  }
  if (Array.isArray(val)) return val.map(sanitizeValue);
  if (val && typeof val === "object") {
    const sanitized: any = {};
    for (const [k, v] of Object.entries(val)) sanitized[k] = sanitizeValue(v);
    return sanitized;
  }
  return val;
}

export function xssSanitizeMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeValue(req.body);
  }
  next();
}

// ─── CORS Hardening ─────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/.*\.manus\.(computer|space)$/,
  /^https?:\/\/.*\.54link\.com$/,
];

export function corsHardeningMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.some(re => re.test(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,X-Request-Id"
  );
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Max-Age", "86400");

  // Security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self)"
  );

  if (req.method === "OPTIONS") return res.status(204).end();
  next();
}

// ─── Health Check Endpoints (F04) ───────────────────────────────
let serverReady = false;
export function setServerReady(ready: boolean) {
  serverReady = ready;
}

export function registerHealthEndpoints(app: Express) {
  // Liveness — is the process alive?
  app.get("/livez", (_req, res) => {
    res.status(200).json({
      status: "alive",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Readiness — is the server ready to accept traffic?
  app.get("/readyz", (_req, res) => {
    if (serverReady) {
      res
        .status(200)
        .json({ status: "ready", timestamp: new Date().toISOString() });
    } else {
      res
        .status(503)
        .json({ status: "not_ready", timestamp: new Date().toISOString() });
    }
  });

  // Health — comprehensive health check
  app.get("/healthz", async (_req, res) => {
    const checks: Record<string, any> = {
      server: {
        status: "healthy",
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "1.0.0",
      node: process.version,
    };

    // DB check
    try {
      const { getPool } = await import("../db");
      const pool = await getPool();
      if (pool) {
        await pool.query("SELECT 1 as ok");
        checks.database = { status: "healthy", connected: true };
      } else {
        checks.database = { status: "unhealthy", error: "no pool" };
      }
    } catch (e: any) {
      checks.database = { status: "unhealthy", error: e.message };
    }

    const allHealthy = Object.values(checks).every(
      (c: any) => typeof c !== "object" || c.status !== "unhealthy"
    );
    res
      .status(allHealthy ? 200 : 503)
      .json({ status: allHealthy ? "healthy" : "degraded", checks });
  });
}

// ─── Graceful Shutdown (F09) ────────────────────────────────────
export function registerGracefulShutdown(server: any) {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    setServerReady(false);
    logger.info(`[SHUTDOWN] Received ${signal}. Draining connections...`);

    // Stop accepting new connections
    server.close(() => {
      logger.info("[SHUTDOWN] HTTP server closed.");
    });

    // Give in-flight requests 10 seconds to complete
    setTimeout(() => {
      logger.info("[SHUTDOWN] Force exit after timeout.");
      process.exit(0);
    }, 10_000);

    // Close DB pool
    try {
      const { getPool } = await import("../db");
      const pool = await getPool();
      if (pool) await pool.end();
      logger.info("[SHUTDOWN] Database pool closed.");
    } catch (e) {
      logger.info("[SHUTDOWN] DB pool close error:: " + e);
    }

    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// ─── Audit Trail Logging (F11) ─────────────────────────────────
export function auditTrailMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
    // Log mutations (POST, PUT, PATCH, DELETE)
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      const userId = (req as any).user?.id || "anonymous";
      const reqId = (req as any).requestId || "-";
      logger.info(
        `[AUDIT] ${new Date().toISOString()} user=${userId} method=${req.method} path=${req.originalUrl} status=${res.statusCode} reqId=${reqId}`
      );
    }
    return originalJson(body);
  };
  next();
}

// ─── Mount All Middleware ────────────────────────────────────────
export function mountAllMiddleware(app: Express) {
  app.use(requestIdMiddleware);
  app.use(corsHardeningMiddleware);
  app.use(requestLoggerMiddleware);
  app.use(rateLimitMiddleware);
  app.use(auditTrailMiddleware);
  // XSS sanitize is applied after body parsing, so mount it after express.json()
  app.use(xssSanitizeMiddleware);
  registerHealthEndpoints(app);
}
