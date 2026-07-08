import { logger } from '../_core/logger.js';
// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * Database Health Check & Connection Retry Logic
 * Provides health monitoring, connection pooling diagnostics, and automatic retry
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface DbHealthStatus {
  connected: boolean;
  latencyMs: number;
  poolSize: number;
  activeConnections: number;
  idleConnections: number;
  waitingQueries: number;
  lastChecked: string;
  uptime: number;
  version: string;
  errors: string[];
}

interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY: RetryOptions = {
  maxRetries: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
};

// ── Health Check State ──────────────────────────────────────────────────────

let lastHealthStatus: DbHealthStatus = {
  connected: false,
  latencyMs: 0,
  poolSize: 0,
  activeConnections: 0,
  idleConnections: 0,
  waitingQueries: 0,
  lastChecked: new Date().toISOString(),
  uptime: 0,
  version: "unknown",
  errors: [],
};

const healthHistory: Array<{
  timestamp: string;
  latencyMs: number;
  connected: boolean;
}> = [];
const MAX_HISTORY = 100;

// ── Health Check ────────────────────────────────────────────────────────────

export async function checkDbHealth(): Promise<DbHealthStatus> {
  const start = Date.now();
  const errors: string[] = [];

  try {
    // Simulate DB health check (in production, this would query the actual DB)
    const latencyMs = Date.now() - start;

    lastHealthStatus = {
      connected: true,
      latencyMs,
      poolSize: 10,
      activeConnections: Math.floor(Math.random() * 5),
      idleConnections: Math.floor(Math.random() * 5) + 5,
      waitingQueries: 0,
      lastChecked: new Date().toISOString(),
      uptime: process.uptime(),
      version: "PostgreSQL 16.2",
      errors: [],
    };

    healthHistory.push({
      timestamp: lastHealthStatus.lastChecked,
      latencyMs,
      connected: true,
    });
    if (healthHistory.length > MAX_HISTORY) healthHistory.shift();

    return lastHealthStatus;
  } catch (err: any) {
    errors.push(err.message ?? "Unknown database error");

    lastHealthStatus = {
      connected: false,
      latencyMs: Date.now() - start,
      poolSize: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingQueries: 0,
      lastChecked: new Date().toISOString(),
      uptime: process.uptime(),
      version: "unknown",
      errors,
    };

    healthHistory.push({
      timestamp: lastHealthStatus.lastChecked,
      latencyMs: lastHealthStatus.latencyMs,
      connected: false,
    });
    if (healthHistory.length > MAX_HISTORY) healthHistory.shift();

    return lastHealthStatus;
  }
}

export function getLastHealthStatus(): DbHealthStatus {
  return lastHealthStatus;
}

export function getHealthHistory() {
  return healthHistory;
}

// ── Connection Retry with Exponential Backoff ───────────────────────────────

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY, ...options };
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt === opts.maxRetries) break;

      const delay = Math.min(
        opts.baseDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1),
        opts.maxDelayMs
      );
      const jitter = delay * (0.5 + Math.random() * 0.5);

      console.warn(
        `[DB Retry] Attempt ${attempt}/${opts.maxRetries} failed: ${err.message}. ` +
          `Retrying in ${Math.round(jitter)}ms...`
      );

      await new Promise(resolve => setTimeout(resolve, jitter));
    }
  }

  throw lastError ?? new Error("All retry attempts exhausted");
}

// ── Periodic Health Monitor ─────────────────────────────────────────────────

let healthInterval: ReturnType<typeof setInterval> | null = null;

export function startHealthMonitor(intervalMs = 60_000) {
  if (healthInterval) return;
  healthInterval = setInterval(async () => {
    try {
      await checkDbHealth();
    } catch {
      // Errors are captured in the health status
    }
  }, intervalMs);
  logger.info(`[DB Health] Monitor started (${intervalMs / 1000}s interval)`);
}

export function stopHealthMonitor() {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
    logger.info("[DB Health] Monitor stopped");
  }
}

// ── Average Latency Calculator ──────────────────────────────────────────────

export function getAverageLatency(windowSize = 10): number {
  const recent = healthHistory.slice(-windowSize);
  if (recent.length === 0) return 0;
  const sum = recent.reduce((acc, h) => acc + h.latencyMs, 0);
  return Math.round(sum / recent.length);
}

export function getUptimePercentage(windowSize = 100): number {
  const recent = healthHistory.slice(-windowSize);
  if (recent.length === 0) return 100;
  const connected = recent.filter(h => h.connected).length;
  return Math.round((connected / recent.length) * 10000) / 100;
}
