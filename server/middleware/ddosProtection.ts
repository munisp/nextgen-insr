// TypeScript enabled — Sprint 96 security audit
/**
 * DDoS Protection & Circuit Breaker Middleware
 * Provides adaptive rate limiting, connection throttling, IP reputation,
 * circuit breaker pattern, and slowloris protection.
 */
import { Request, Response, NextFunction } from "express";
import { logger } from './_core/logger';

// ── IP Reputation Store ──────────────────────────────────────────────
interface IPRecord {
  requests: number;
  firstSeen: number;
  lastSeen: number;
  violations: number;
  blocked: boolean;
  blockedUntil: number;
  score: number; // 0-100, lower = more suspicious
}

const ipStore = new Map<string, IPRecord>();
const CLEANUP_INTERVAL = 60_000; // 1 min
const BLOCK_DURATION = 300_000; // 5 min block
const PERMANENT_BLOCK_THRESHOLD = 10; // violations before permanent block

// Cleanup stale entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipStore) {
    if (now - record.lastSeen > 3_600_000 && !record.blocked) {
      // 1hr inactive
      ipStore.delete(ip);
    }
  }
}, CLEANUP_INTERVAL);

function getIPRecord(ip: string): IPRecord {
  if (!ipStore.has(ip)) {
    ipStore.set(ip, {
      requests: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      violations: 0,
      blocked: false,
      blockedUntil: 0,
      score: 100,
    });
  }
  return ipStore.get(ip)!;
}

function getClientIP(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

// ── Adaptive Rate Limiter ────────────────────────────────────────────
// Adjusts limits based on IP reputation score
interface AdaptiveWindow {
  count: number;
  windowStart: number;
}

const adaptiveWindows = new Map<string, AdaptiveWindow>();

// Per-IP request counter for rate limiting tracking
let requestCount = 0;

export function getRequestCount(): number {
  return requestCount;
}

export function adaptiveRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const ip = getClientIP(req);
  const record = getIPRecord(ip);
  const now = Date.now();
  requestCount++;

  // Check if IP is blocked
  if (record.blocked) {
    if (
      now < record.blockedUntil &&
      record.violations < PERMANENT_BLOCK_THRESHOLD
    ) {
      res.status(429).json({
        error: "Too many requests",
        retryAfter: Math.ceil((record.blockedUntil - now) / 1000),
      });
      return;
    }
    if (record.violations >= PERMANENT_BLOCK_THRESHOLD) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    // Unblock if time expired
    record.blocked = false;
  }

  // Adaptive limit based on reputation score
  const baseLimit = 200; // requests per minute
  const adjustedLimit = Math.max(
    10,
    Math.floor(baseLimit * (record.score / 100))
  );
  const windowMs = 60_000;

  const key = `adaptive:${ip}`;
  let window = adaptiveWindows.get(key);
  if (!window || now - window.windowStart > windowMs) {
    window = { count: 0, windowStart: now };
    adaptiveWindows.set(key, window);
  }
  window.count++;
  record.requests++;
  record.lastSeen = now;

  if (window.count > adjustedLimit) {
    record.violations++;
    record.score = Math.max(0, record.score - 10);
    if (record.violations >= 3) {
      record.blocked = true;
      record.blockedUntil =
        now + BLOCK_DURATION * Math.min(record.violations, 10);
    }
    res.status(429).json({
      error: "Rate limit exceeded",
      limit: adjustedLimit,
      retryAfter: Math.ceil((window.windowStart + windowMs - now) / 1000),
    });
    return;
  }

  // Slowly restore reputation for good behavior
  if (window.count < adjustedLimit / 2 && record.score < 100) {
    record.score = Math.min(100, record.score + 1);
  }

  res.setHeader("X-RateLimit-Limit", adjustedLimit);
  res.setHeader(
    "X-RateLimit-Remaining",
    Math.max(0, adjustedLimit - window.count)
  );
  next();
}

// ── Circuit Breaker ──────────────────────────────────────────────────
// Trips when error rate exceeds threshold, preventing cascade failures
interface CircuitState {
  state: "closed" | "open" | "half-open";
  failures: number;
  successes: number;
  lastFailure: number;
  openedAt: number;
}

const circuits = new Map<string, CircuitState>();
const FAILURE_THRESHOLD = 10;
const RECOVERY_TIMEOUT = 30_000; // 30s
const HALF_OPEN_MAX = 3;

export function circuitBreaker(serviceName: string) {
  if (!circuits.has(serviceName)) {
    circuits.set(serviceName, {
      state: "closed",
      failures: 0,
      successes: 0,
      lastFailure: 0,
      openedAt: 0,
    });
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const circuit = circuits.get(serviceName)!;
    const now = Date.now();

    if (circuit.state === "open") {
      if (now - circuit.openedAt > RECOVERY_TIMEOUT) {
        circuit.state = "half-open";
        circuit.successes = 0;
      } else {
        res.status(503).json({
          error: "Service temporarily unavailable",
          service: serviceName,
          retryAfter: Math.ceil(
            (circuit.openedAt + RECOVERY_TIMEOUT - now) / 1000
          ),
        });
        return;
      }
    }

    if (circuit.state === "half-open") {
      if (circuit.successes >= HALF_OPEN_MAX) {
        circuit.state = "closed";
        circuit.failures = 0;
      }
    }

    // Intercept response to track success/failure
    const originalEnd = res.end;
    (res as any).end = function (...args: any[]) {
      if (res.statusCode >= 500) {
        circuit.failures++;
        circuit.lastFailure = Date.now();
        if (circuit.failures >= FAILURE_THRESHOLD) {
          circuit.state = "open";
          circuit.openedAt = Date.now();
          logger.warn(
            `[CircuitBreaker] ${serviceName} circuit OPENED after ${circuit.failures} failures`
          );
        }
      } else {
        if (circuit.state === "half-open") circuit.successes++;
        if (circuit.state === "closed")
          circuit.failures = Math.max(0, circuit.failures - 1);
      }
      return originalEnd.apply(res, args as any);
    };

    next();
  };
}

// ── Slowloris Protection ─────────────────────────────────────────────
// Detect and terminate slow/incomplete requests
export function slowlorisProtection(timeoutMs: number = 10_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({ error: "Request timeout" });
        req.destroy();
      }
    }, timeoutMs);

    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));
    next();
  };
}

// ── Connection Throttling ────────────────────────────────────────────
// Limit concurrent connections per IP
const activeConnections = new Map<string, number>();
const MAX_CONCURRENT_PER_IP = 50;

export function connectionThrottle(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const ip = getClientIP(req);
  const current = activeConnections.get(ip) || 0;

  if (current >= MAX_CONCURRENT_PER_IP) {
    const record = getIPRecord(ip);
    record.violations++;
    record.score = Math.max(0, record.score - 5);
    res.status(429).json({ error: "Too many concurrent connections" });
    return;
  }

  activeConnections.set(ip, current + 1);
  res.on("finish", () => {
    const c = activeConnections.get(ip) || 1;
    if (c <= 1) activeConnections.delete(ip);
    else activeConnections.set(ip, c - 1);
  });
  res.on("close", () => {
    const c = activeConnections.get(ip) || 1;
    if (c <= 1) activeConnections.delete(ip);
    else activeConnections.set(ip, c - 1);
  });

  next();
}

// ── Request Body Bomb Protection ─────────────────────────────────────
export function bodyBombProtection(maxSizeBytes: number = 1_048_576) {
  // 1MB
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);
    if (contentLength > maxSizeBytes) {
      res
        .status(413)
        .json({ error: "Request entity too large", maxSize: maxSizeBytes });
      return;
    }
    next();
  };
}

// ── IP Blocklist Management ──────────────────────────────────────────
const permanentBlocklist = new Set<string>();

export function blockIP(ip: string) {
  permanentBlocklist.add(ip);
  const record = getIPRecord(ip);
  record.blocked = true;
  record.blockedUntil = Date.now() + 365 * 24 * 3600 * 1000; // 1 year
}

export function unblockIP(ip: string) {
  permanentBlocklist.delete(ip);
  const record = getIPRecord(ip);
  record.blocked = false;
  record.violations = 0;
  record.score = 50;
}

export function getBlockedIPs(): string[] {
  return [...permanentBlocklist];
}

export function getIPReputation(ip: string): IPRecord | null {
  return ipStore.get(ip) || null;
}

// ── Aggregate DDoS Middleware ────────────────────────────────────────
export function applyDDoSProtection(app: any) {
  if (process.env.NODE_ENV === "development") {
    logger.info(
      "[DDoS] Skipped in development mode (Vite needs 400+ concurrent module requests)"
    );
    return;
  }
  app.use(bodyBombProtection(2 * 1024 * 1024)); // 2MB max
  app.use(connectionThrottle);
  app.use(adaptiveRateLimit);
  app.use(slowlorisProtection(15_000)); // 15s timeout
  logger.info(
    "[DDoS] Protection layers applied: body bomb, connection throttle, adaptive rate limit, slowloris"
  );
}

// ── Circuit Breaker Status ───────────────────────────────────────────
export function getCircuitStatus(): Record<string, CircuitState> {
  const result: Record<string, CircuitState> = {};
  for (const [name, state] of circuits) {
    result[name] = { ...state };
  }
  return result;
}
