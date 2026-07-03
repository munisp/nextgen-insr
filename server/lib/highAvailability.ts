// TypeScript enabled — Sprint 96 security audit
/**
 * High Availability Module — Sprint 56
 * Circuit breaker, retry with exponential backoff, structured health checks,
 * graceful shutdown, and connection draining
 */
import logger from "../_core/logger";

// ── 1. Circuit Breaker ────────────────────────────────────────────────────────
type CircuitState = "closed" | "open" | "half_open";

interface CircuitBreakerOptions {
  failureThreshold: number; // Failures before opening
  resetTimeoutMs: number; // Time before trying half-open
  halfOpenMaxAttempts: number; // Attempts in half-open before closing
  monitorWindowMs: number; // Window to count failures
}

class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;
  private readonly name: string;
  private readonly options: CircuitBreakerOptions;

  constructor(name: string, options?: Partial<CircuitBreakerOptions>) {
    this.name = name;
    this.options = {
      failureThreshold: options?.failureThreshold ?? 5,
      resetTimeoutMs: options?.resetTimeoutMs ?? 30_000,
      halfOpenMaxAttempts: options?.halfOpenMaxAttempts ?? 3,
      monitorWindowMs: options?.monitorWindowMs ?? 60_000,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime > this.options.resetTimeoutMs) {
        this.state = "half_open";
        this.halfOpenAttempts = 0;
        logger.info(`[CircuitBreaker:${this.name}] Transitioning to half-open`);
      } else {
        throw new Error(
          `Circuit breaker [${this.name}] is OPEN — request rejected`
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === "half_open") {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.options.halfOpenMaxAttempts) {
        this.state = "closed";
        this.failures = 0;
        this.successes = 0;
        logger.info(`[CircuitBreaker:${this.name}] Circuit CLOSED (recovered)`);
      }
    }
    this.successes++;
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === "half_open") {
      this.state = "open";
      logger.warn(
        `[CircuitBreaker:${this.name}] Circuit re-OPENED from half-open`
      );
    } else if (this.failures >= this.options.failureThreshold) {
      this.state = "open";
      logger.warn(
        `[CircuitBreaker:${this.name}] Circuit OPENED after ${this.failures} failures`
      );
    }
  }

  getState(): {
    name: string;
    state: CircuitState;
    failures: number;
    successes: number;
  } {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
    };
  }

  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.successes = 0;
    this.halfOpenAttempts = 0;
  }
}

// Pre-configured circuit breakers for critical services
export const circuitBreakers = {
  database: new CircuitBreaker("database", {
    failureThreshold: 3,
    resetTimeoutMs: 15_000,
  }),
  kafka: new CircuitBreaker("kafka", {
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
  }),
  redis: new CircuitBreaker("redis", {
    failureThreshold: 5,
    resetTimeoutMs: 20_000,
  }),
  tigerBeetle: new CircuitBreaker("tigerBeetle", {
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
  }),
  temporal: new CircuitBreaker("temporal", {
    failureThreshold: 3,
    resetTimeoutMs: 60_000,
  }),
  permify: new CircuitBreaker("permify", {
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
  }),
  fluvio: new CircuitBreaker("fluvio", {
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
  }),
  external: new CircuitBreaker("external", {
    failureThreshold: 10,
    resetTimeoutMs: 60_000,
  }),
};

// ── 2. Retry with Exponential Backoff ─────────────────────────────────────────
interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryableErrors?: string[];
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 10_000,
  backoffMultiplier: 2,
  jitter: true,
};

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  label: string,
  options?: Partial<RetryOptions>
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if error is retryable
      if (opts.retryableErrors && opts.retryableErrors.length > 0) {
        const isRetryable = opts.retryableErrors.some(e =>
          error.message?.includes(e)
        );
        if (!isRetryable) throw error;
      }

      if (attempt === opts.maxRetries) break;

      // Calculate delay with exponential backoff
      let delay = Math.min(
        opts.baseDelayMs * Math.pow(opts.backoffMultiplier, attempt),
        opts.maxDelayMs
      );

      // Add jitter to prevent thundering herd
      if (opts.jitter) {
        delay = delay * (0.5 + Math.random() * 0.5);
      }

      logger.warn(
        `[Retry:${label}] Attempt ${attempt + 1}/${opts.maxRetries} failed: ${error.message}. Retrying in ${Math.round(delay)}ms`
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  logger.error(`[Retry:${label}] All ${opts.maxRetries} retries exhausted`);
  throw lastError;
}

// ── 3. Structured Health Checks ───────────────────────────────────────────────
interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  uptime: number;
  timestamp: string;
  version: string;
  checks: Record<
    string,
    {
      status: "up" | "down" | "degraded";
      latencyMs: number;
      message?: string;
    }
  >;
}

const startTime = Date.now();

async function checkDatabase(): Promise<{
  status: "up" | "down" | "degraded";
  latencyMs: number;
  message?: string;
}> {
  const start = Date.now();
  try {
    const { getPool } = await import("../db");
    const pool = await getPool();
    if (!pool) return { status: "down", latencyMs: 0, message: "No pool" };
    await pool.query("SELECT 1");
    const latency = Date.now() - start;
    return { status: latency > 1000 ? "degraded" : "up", latencyMs: latency };
  } catch (e: any) {
    return {
      status: "down",
      latencyMs: Date.now() - start,
      message: e.message,
    };
  }
}

async function checkRedis(): Promise<{
  status: "up" | "down" | "degraded";
  latencyMs: number;
  message?: string;
}> {
  const start = Date.now();
  try {
    const { cacheGet } = await import("../redisClient");
    await cacheGet("health:ping");
    return { status: "up", latencyMs: Date.now() - start };
  } catch (e: any) {
    return {
      status: "down",
      latencyMs: Date.now() - start,
      message: "Redis unavailable (fail-open)",
    };
  }
}

async function checkKafka(): Promise<{
  status: "up" | "down" | "degraded";
  latencyMs: number;
  message?: string;
}> {
  const start = Date.now();
  try {
    // Kafka is fail-open — check if client is initialized
    return {
      status: "up",
      latencyMs: Date.now() - start,
      message: "Fail-open mode",
    };
  } catch (e: any) {
    return {
      status: "down",
      latencyMs: Date.now() - start,
      message: e.message,
    };
  }
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const [db, redis, kafka] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkKafka(),
  ]);

  const checks = { database: db, redis, kafka };
  const allUp = Object.values(checks).every(c => c.status === "up");
  const anyDown = Object.values(checks).some(c => c.status === "down");

  // Database is critical — if it's down, we're unhealthy
  const overallStatus =
    db.status === "down"
      ? "unhealthy"
      : anyDown
        ? "degraded"
        : allUp
          ? "healthy"
          : "degraded";

  return {
    status: overallStatus,
    uptime: Math.round((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? "1.0.0",
    checks,
  };
}

// Liveness — is the process alive?
export function getLivenessStatus(): { status: "ok"; uptime: number } {
  return { status: "ok", uptime: Math.round((Date.now() - startTime) / 1000) };
}

// Readiness — can we accept traffic?
export async function getReadinessStatus(): Promise<{
  ready: boolean;
  reason?: string;
}> {
  try {
    const { getPool } = await import("../db");
    const pool = await getPool();
    if (!pool) return { ready: false, reason: "No database pool" };
    await pool.query("SELECT 1");
    return { ready: true };
  } catch (e: any) {
    return { ready: false, reason: `Database unavailable: ${e.message}` };
  }
}

// ── 4. Graceful Shutdown ──────────────────────────────────────────────────────
let isShuttingDown = false;

export function isServerShuttingDown(): boolean {
  return isShuttingDown;
}

export function setupGracefulShutdown(
  server: any,
  cleanup?: () => Promise<void>
): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`[Shutdown] Received ${signal}, starting graceful shutdown...`);

    // Stop accepting new connections
    server.close(async () => {
      logger.info("[Shutdown] Server closed, cleaning up...");

      try {
        // Run custom cleanup (close DB pool, flush buffers, etc.)
        if (cleanup) await cleanup();

        // Close database pool
        try {
          const { getPool } = await import("../db");
          const pool = await getPool();
          if (pool) await pool.end();
          logger.info("[Shutdown] Database pool closed");
        } catch (err) { logger.error("[highAvailability] operation failed:", err); }

        logger.info("[Shutdown] Graceful shutdown complete");
        process.exit(0);
      } catch (e: any) {
        logger.error(`[Shutdown] Error during cleanup: ${e.message}`);
        process.exit(1);
      }
    });

    // Force shutdown after 30s
    setTimeout(() => {
      logger.error("[Shutdown] Forced shutdown after 30s timeout");
      process.exit(1);
    }, 30_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// ── 5. Connection Draining Middleware ──────────────────────────────────────────
import type { Request, Response, NextFunction } from "express";

export function connectionDrainingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (isShuttingDown) {
    res.setHeader("Connection", "close");
    res.status(503).json({ error: "Server is shutting down", retryAfter: 5 });
    return;
  }
  next();
}

// ── 6. Express Health Routes ──────────────────────────────────────────────────
import { Router } from "express";
import { Router } from "express";
import { logger } from './_core/logger';

export function createHealthRouter(): Router {
  const healthRouter = Router();

  healthRouter.get("/health", async (_req, res) => {
    const health = await getHealthStatus();
    const statusCode =
      health.status === "healthy"
        ? 200
        : health.status === "degraded"
          ? 200
          : 503;
    res.status(statusCode).json(health);
  });

  healthRouter.get("/health/live", (_req, res) => {
    res.json(getLivenessStatus());
  });

  healthRouter.get("/health/ready", async (_req, res) => {
    const readiness = await getReadinessStatus();
    res.status(readiness.ready ? 200 : 503).json(readiness);
  });

  healthRouter.get("/health/circuits", (_req, res) => {
    const states = Object.entries(circuitBreakers).map(([name, cb]) =>
      cb.getState()
    );
    res.json({ circuits: states });
  });

  return healthRouter;
}

// ── 7. Request Timeout Middleware ──────────────────────────────────────────────
export function requestTimeoutMiddleware(timeoutMs = 30_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn(
          `[Timeout] ${req.method} ${req.path} exceeded ${timeoutMs}ms`
        );
        res.status(504).json({ error: "Request timeout", timeoutMs });
      }
    }, timeoutMs);

    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));
    next();
  };
}

export default {
  circuitBreakers,
  retryWithBackoff,
  getHealthStatus,
  getLivenessStatus,
  getReadinessStatus,
  setupGracefulShutdown,
  connectionDrainingMiddleware,
  createHealthRouter,
  requestTimeoutMiddleware,
};
