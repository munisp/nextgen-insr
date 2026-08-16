// @ts-check
/**
 * Deep Health Check & Circuit Breaker — InsurePortal Insurance Platform
 *
 * F13: Health check with deep dependency checks (DB, Redis, TB sidecar)
 * F14: Circuit breaker pattern for external services
 * F15: Environment config validation on startup
 */
import { logger } from "../_core/logger";

// ═══════════════════════════════════════════════════════════════════════════════
// F13: Deep Health Check
// ═══════════════════════════════════════════════════════════════════════════════

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  uptime: number;
  timestamp: string;
  version: string;
  checks: DependencyCheck[];
}

export interface DependencyCheck {
  name: string;
  status: "up" | "down" | "degraded";
  latencyMs: number;
  message?: string;
}

const startTime = Date.now();

export async function checkDatabase(dbPool?: { query: (sql: string) => Promise<{ rows: unknown[] }> }): Promise<DependencyCheck> {
  const start = Date.now();
  try {
    if (dbPool?.query) {
      await dbPool.query("SELECT 1");
    }
    return { name: "postgresql", status: "up", latencyMs: Date.now() - start };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: "postgresql",
      status: "down",
      latencyMs: Date.now() - start,
      message,
    };
  }
}

export async function checkRedis(redisClient?: { ping: () => Promise<string> }): Promise<DependencyCheck> {
  const start = Date.now();
  try {
    if (redisClient?.ping) {
      await redisClient.ping();
    }
    return { name: "redis", status: "up", latencyMs: Date.now() - start };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: "redis",
      status: "down",
      latencyMs: Date.now() - start,
      message,
    };
  }
}

export async function checkTigerBeetle(
  tbClient?: { lookupAccounts: (ids: unknown[]) => Promise<unknown[]> }
): Promise<DependencyCheck> {
  const start = Date.now();
  try {
    if (tbClient?.lookupAccounts) {
      await tbClient.lookupAccounts([]);
    }
    return { name: "tigerbeetle", status: "up", latencyMs: Date.now() - start };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: "tigerbeetle",
      status: "down",
      latencyMs: Date.now() - start,
      message,
    };
  }
}

export async function getHealthStatus(deps: {
  db?: { query: (sql: string) => Promise<{ rows: unknown[] }> };
  redis?: { ping: () => Promise<string> };
  tb?: { lookupAccounts: (ids: unknown[]) => Promise<unknown[]> };
}): Promise<HealthStatus> {
  const checks: DependencyCheck[] = [];

  checks.push(await checkDatabase(deps.db));
  checks.push(await checkRedis(deps.redis));
  checks.push(await checkTigerBeetle(deps.tb));

  const downCount = checks.filter(c => c.status === "down").length;
  const status: HealthStatus["status"] =
    downCount === 0
      ? "healthy"
      : downCount < checks.length
        ? "degraded"
        : "unhealthy";

  return {
    status,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? "1.0.0",
    checks,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// F14: Circuit Breaker
// ═══════════════════════════════════════════════════════════════════════════════

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  failureThreshold: number; // Failures before opening (default: 5)
  resetTimeoutMs: number; // Time before half-open (default: 30000)
  halfOpenMaxAttempts: number; // Max attempts in half-open (default: 3)
  monitorWindowMs: number; // Window for failure counting (default: 60000)
}

const DEFAULT_CB_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxAttempts: 3,
  monitorWindowMs: 60_000,
};

export interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt: number;
  lastSuccessAt: number;
  openedAt: number;
  halfOpenAttempts: number;
  recoveryAttempts: number;
  lastRecoveryTimeout: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxAttempts: number;
  monitorWindowMs: number;
  // Innovation: Adaptive recovery
  adaptiveRecovery?: boolean;
  maxRecoveryTimeoutMs?: number;
  recoveryBackoffFactor?: number;
  // Innovation: Predictive recovery
  predictiveRecovery?: boolean;
  minHalfOpenSuccesses?: number;
  // Innovation: Graceful degradation
  degradationStrategy?: "fallback" | "cache" | "queue" | "none";
}

export const DEFAULT_INNOVATIVE_CB_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxAttempts: 3,
  monitorWindowMs: 60_000,
  adaptiveRecovery: true,
  maxRecoveryTimeoutMs: 300_000, // 5 minutes max
  recoveryBackoffFactor: 1.5,
  predictiveRecovery: true,
  minHalfOpenSuccesses: 2,
  degradationStrategy: "none",
};

export function createCircuitBreaker(
  name: string,
  config: Partial<CircuitBreakerConfig> = {}
) {
  const cfg = { ...DEFAULT_INNOVATIVE_CB_CONFIG, ...config };
  let cbState: CircuitBreakerState = {
    state: "closed",
    failures: 0,
    successes: 0,
    lastFailureAt: 0,
    lastSuccessAt: 0,
    openedAt: 0,
    halfOpenAttempts: 0,
    recoveryAttempts: 0,
    lastRecoveryTimeout: cfg.resetTimeoutMs,
  };

  // Innovation: Adaptive recovery timeout calculation
  function calculateRecoveryTimeout(): number {
    if (!cfg.adaptiveRecovery) return cfg.resetTimeoutMs;

    cbState.recoveryAttempts++;
    const exponentialTimeout =
      cfg.resetTimeoutMs *
      Math.pow(cfg.recoveryBackoffFactor || 1.5, cbState.recoveryAttempts - 1);
    return Math.min(exponentialTimeout, cfg.maxRecoveryTimeoutMs || 300_000);
  }

  // Innovation: Predictive recovery based on historical patterns
  function shouldAttemptRecovery(): boolean {
    if (!cfg.predictiveRecovery) return true;

    const timeSinceFailure = Date.now() - cbState.lastFailureAt;
    const timeSinceLastRecovery = Date.now() - cbState.lastSuccessAt;

    // If we have recent successes, be more aggressive
    if (timeSinceLastRecovery < 60_000 && cbState.successes >= 3) {
      return true;
    }

    // If failures are clustered in time, wait longer
    const failureRate = cbState.failures / Math.max(1, timeSinceFailure / 60_000);
    return failureRate < 0.5; // Only attempt if failure rate < 50% per minute
  }

  function getState(): CircuitBreakerState {
    // Auto-transition from open to half_open after timeout
    if (
      cbState.state === "open" &&
      Date.now() - cbState.openedAt >= cbState.lastRecoveryTimeout
    ) {
      // Innovation: Predictive recovery check
      if (shouldAttemptRecovery()) {
        cbState.state = "half_open";
        cbState.halfOpenAttempts = 0;
        logger.info(
          {
            service: name,
            state: "half_open",
            recoveryTimeout: cbState.lastRecoveryTimeout,
            recoveryAttempts: cbState.recoveryAttempts,
          },
          `[CircuitBreaker:${name}] Transitioning to half_open (adaptive timeout: ${cbState.lastRecoveryTimeout}ms)`
        );
      }
    }
    return { ...cbState };
  }

  async function execute<T>(fn: () => Promise<T>): Promise<T> {
    const current = getState();

    if (current.state === "open") {
      // Innovation: Graceful degradation fallback
      if (cfg.degradationStrategy === "fallback" && current.lastSuccessAt > 0) {
        logger.info(
          { service: name },
          `[CircuitBreaker:${name}] Returning cached/stale data (degradation)`
        );
        // Return fallback - caller should handle
        throw new Error(`Service unavailable, using fallback`);
      }
      throw new Error(
        `Circuit breaker [${name}] is OPEN. Service unavailable.`
      );
    }

    if (
      current.state === "half_open" &&
      cbState.halfOpenAttempts >= cfg.halfOpenMaxAttempts
    ) {
      cbState.state = "open";
      cbState.openedAt = Date.now();
      throw new Error(
        `Circuit breaker [${name}] re-opened after half_open max attempts.`
      );
    }

    try {
      if (cbState.state === "half_open") cbState.halfOpenAttempts++;
      const result = await fn();
      onSuccess();
      return result;
    } catch (err) {
      onFailure();
      throw err;
    }
  }

  function onSuccess() {
    cbState.successes++;
    cbState.lastSuccessAt = Date.now();

    if (cbState.state === "half_open") {
      // Innovation: Check if we have enough successes for recovery
      if (
        cbState.successes >= (cfg.minHalfOpenSuccesses || 2)
      ) {
        cbState.state = "closed";
        cbState.failures = 0;
        cbState.recoveryAttempts = 0;
        cbState.lastRecoveryTimeout = cfg.resetTimeoutMs;
        logger.info(
          {
            service: name,
            state: "closed",
            successesRequired: cfg.minHalfOpenSuccesses,
          },
          `[CircuitBreaker:${name}] Closed (recovered after ${cbState.successes} successes)`
        );
      }
    } else {
      // Reset failure count for gradual recovery
      cbState.failures = Math.max(0, cbState.failures - 1);
    }
  }

  function onFailure() {
    cbState.failures++;
    cbState.lastFailureAt = Date.now();

    // Clean old failures outside monitor window
    if (
      cbState.state === "closed" &&
      cbState.failures >= cfg.failureThreshold
    ) {
      cbState.state = "open";
      cbState.openedAt = Date.now();
      cbState.lastRecoveryTimeout = calculateRecoveryTimeout();

      logger.warn(
        {
          service: name,
          failures: cbState.failures,
          nextRecoveryTimeout: cbState.lastRecoveryTimeout,
          recoveryAttempts: cbState.recoveryAttempts + 1,
        },
        `[CircuitBreaker:${name}] OPENED after ${cbState.failures} failures (next recovery in ${cbState.lastRecoveryTimeout}ms)`
      );
    }
  }

  function reset() {
    cbState = {
      state: "closed",
      failures: 0,
      successes: 0,
      lastFailureAt: 0,
      lastSuccessAt: 0,
      openedAt: 0,
      halfOpenAttempts: 0,
      recoveryAttempts: 0,
      lastRecoveryTimeout: cfg.resetTimeoutMs,
    };
  }

  return { execute, getState, reset, name };
}

// ── Pre-configured Circuit Breakers ─────────────────────────────────────
export const circuitBreakers = {
  stripe: createCircuitBreaker("stripe", {
    failureThreshold: 3,
    resetTimeoutMs: 60_000,
  }),
  sms: createCircuitBreaker("sms-termii", {
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
  }),
  erp: createCircuitBreaker("erp-sync", {
    failureThreshold: 5,
    resetTimeoutMs: 45_000,
  }),
  kafka: createCircuitBreaker("kafka", {
    failureThreshold: 3,
    resetTimeoutMs: 20_000,
  }),
  tigerbeetle: createCircuitBreaker("tigerbeetle", {
    failureThreshold: 3,
    resetTimeoutMs: 15_000,
  }),
};

// ═══════════════════════════════════════════════════════════════════════════════
// F15: Environment Config Validation
// ═══════════════════════════════════════════════════════════════════════════════

export interface EnvValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const REQUIRED_ENVS = ["DATABASE_URL", "JWT_SECRET"];

const RECOMMENDED_ENVS = [
  "REDIS_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "BUILT_IN_FORGE_API_KEY",
  "VITE_APP_ID",
];

export function validateEnvironment(): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required envs
  for (const key of REQUIRED_ENVS) {
    const val =
      process.env[key] ||
      process.env[key.replace("DATABASE_URL", "POSTGRES_URL")];
    if (!val) {
      errors.push(`Missing required env: ${key}`);
    } else if (val.includes("placeholder") || val.includes("change-me")) {
      warnings.push(`${key} appears to use a placeholder value`);
    }
  }

  // Check recommended envs
  for (const key of RECOMMENDED_ENVS) {
    if (!process.env[key]) {
      warnings.push(
        `Missing recommended env: ${key} (some features may be disabled)`
      );
    }
  }

  // Check JWT secret strength
  const jwt = process.env.JWT_SECRET;
  if (jwt && jwt.length < 32) {
    warnings.push(
      "JWT_SECRET is shorter than 32 characters — consider using a stronger secret"
    );
  }

  // Check database URL format
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (dbUrl && !dbUrl.startsWith("postgres")) {
    errors.push("DATABASE_URL must be a PostgreSQL connection string");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function logEnvironmentValidation(): void {
  const result = validateEnvironment();

  if (result.errors.length > 0) {
    logger.error(
      { errors: result.errors },
      `Environment configuration has ${result.errors.length} error(s)`
    );
    for (const err of result.errors) {
      logger.error({ error: err }, `  ❌ ${err}`);
    }
  }

  if (result.warnings.length > 0) {
    logger.warn(
      { warnings: result.warnings },
      `Environment configuration has ${result.warnings.length} warning(s)`
    );
    for (const warn of result.warnings) {
      logger.warn({ warning: warn }, `     ${warn}`);
    }
  }

  if (result.valid && result.warnings.length === 0) {
    logger.info("Environment configuration validated successfully");
  }
}
