// TypeScript enabled — Sprint 96 security audit
/**
 * Performance Tuning Module — Sprint 56
 * Response compression, query result caching, connection pool optimization,
 * and request metrics for P99 response times
 */
import { cacheGet, cacheSet } from "../redisClient";
import logger from "../_core/logger";

// ── 1. In-Memory LRU Cache for Hot Queries ────────────────────────────────────
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  hits: number;
}

class LRUQueryCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private readonly maxSize: number;
  private readonly defaultTtlMs: number;
  private hitCount = 0;
  private missCount = 0;

  constructor(maxSize = 500, defaultTtlMs = 30_000) {
    this.maxSize = maxSize;
    this.defaultTtlMs = defaultTtlMs;
    // Periodic cleanup every 60s
    setInterval(() => this.evictExpired(), 60_000).unref();
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.missCount++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.missCount++;
      return null;
    }
    entry.hits++;
    this.hitCount++;
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    if (this.cache.size >= this.maxSize) {
      // Evict least recently used (first entry)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
      hits: 0,
    });
  }

  invalidate(pattern: string): number {
    let removed = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) this.cache.delete(key);
    }
  }

  getStats() {
    const total = this.hitCount + this.missCount;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: total > 0 ? Math.round((this.hitCount / total) * 1000) / 10 : 0,
    };
  }
}

export const queryCache = new LRUQueryCache(500, 30_000);

// ── 2. Cached Query Wrapper ───────────────────────────────────────────────────
export async function cachedQuery<T>(
  key: string,
  queryFn: () => Promise<T>,
  ttlMs = 30_000,
  useRedis = false
): Promise<T> {
  // L1: In-memory cache
  const memResult = queryCache.get<T>(key);
  if (memResult !== null) return memResult;

  // L2: Redis cache (optional)
  if (useRedis) {
    try {
      const redisResult = await cacheGet(key);
      if (redisResult) {
        const parsed = JSON.parse(redisResult) as T;
        queryCache.set(key, parsed, ttlMs); // Populate L1
        return parsed;
      }
    } catch (err) { logger.error("[performanceTuning] operation failed:", err); }
  }

  // L3: Database query
  const result = await queryFn();

  // Populate caches
  queryCache.set(key, result, ttlMs);
  if (useRedis) {
    try {
      await cacheSet(key, JSON.stringify(result), Math.ceil(ttlMs / 1000));
    } catch (err) { logger.error("[performanceTuning] operation failed:", err); }
  }

  return result;
}

// ── 3. Request Metrics Collector ──────────────────────────────────────────────
interface RequestMetric {
  path: string;
  method: string;
  statusCode: number;
  durationMs: number;
  timestamp: number;
}

class RequestMetricsCollector {
  private metrics: RequestMetric[] = [];
  private readonly maxSize = 10_000;
  private readonly buckets = new Map<string, number[]>();

  record(metric: RequestMetric): void {
    this.metrics.push(metric);
    if (this.metrics.length > this.maxSize) {
      this.metrics = this.metrics.slice(-this.maxSize / 2);
    }

    // Track per-path latency
    const key = `${metric.method}:${metric.path}`;
    if (!this.buckets.has(key)) this.buckets.set(key, []);
    const bucket = this.buckets.get(key)!;
    bucket.push(metric.durationMs);
    if (bucket.length > 1000) bucket.splice(0, 500);
  }

  getPercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  getSummary(windowMs = 300_000) {
    const cutoff = Date.now() - windowMs;
    const recent = this.metrics.filter(m => m.timestamp > cutoff);
    const durations = recent.map(m => m.durationMs);

    return {
      totalRequests: recent.length,
      avgDurationMs:
        durations.length > 0
          ? Math.round(
              (durations.reduce((a, b) => a + b, 0) / durations.length) * 10
            ) / 10
          : 0,
      p50Ms: this.getPercentile(durations, 50),
      p90Ms: this.getPercentile(durations, 90),
      p95Ms: this.getPercentile(durations, 95),
      p99Ms: this.getPercentile(durations, 99),
      errorRate:
        recent.length > 0
          ? Math.round(
              (recent.filter(m => m.statusCode >= 400).length / recent.length) *
                1000
            ) / 10
          : 0,
      slowestEndpoints: this.getSlowestEndpoints(5),
      cacheStats: queryCache.getStats(),
    };
  }

  private getSlowestEndpoints(topN: number) {
    const entries: { path: string; p95Ms: number; count: number }[] = [];
    for (const [key, durations] of this.buckets) {
      entries.push({
        path: key,
        p95Ms: this.getPercentile(durations, 95),
        count: durations.length,
      });
    }
    return entries.sort((a, b) => b.p95Ms - a.p95Ms).slice(0, topN);
  }
}

export const requestMetrics = new RequestMetricsCollector();

// ── 4. Express Middleware: Response Time Tracking ─────────────────────────────
import type { Request, Response, NextFunction } from "express";
import { logger } from '../_core/logger';

export function responseTimeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationMs = Math.round((durationNs / 1_000_000) * 100) / 100;

    requestMetrics.record({
      path: req.path,
      method: req.method,
      statusCode: res.statusCode,
      durationMs,
      timestamp: Date.now(),
    });

    // Log slow requests (>500ms)
    if (durationMs > 500) {
      logger.warn(
        `[SLOW] ${req.method} ${req.path} took ${durationMs}ms (status: ${res.statusCode})`
      );
    }

    // Set Server-Timing header for observability
    res.setHeader("Server-Timing", `total;dur=${durationMs}`);
  });

  next();
}

// ── 5. Express Middleware: Response Compression ───────────────────────────────
export function compressionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const acceptEncoding = req.headers["accept-encoding"] || "";

  // Only compress text-based responses > 1KB
  const originalSend = res.send.bind(res);
  res.send = function (body: any) {
    const contentType = (res.getHeader("content-type") as string) || "";
    const isCompressible = /json|text|javascript|css|html|xml|svg/.test(
      contentType
    );

    if (
      isCompressible &&
      typeof body === "string" &&
      body.length > 1024 &&
      acceptEncoding.includes("gzip")
    ) {
      // Node.js built-in zlib compression
      const zlib = require("zlib");
      const compressed = zlib.gzipSync(Buffer.from(body));
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", compressed.length);
      res.setHeader("Vary", "Accept-Encoding");
      return originalSend(compressed);
    }

    return originalSend(body);
  } as any;

  next();
}

// ── 6. Connection Pool Optimization ───────────────────────────────────────────
export const POOL_CONFIG = {
  // Optimal settings for production POS workloads
  max: 25, // Max connections (balance between concurrency and DB limits)
  min: 5, // Keep warm connections ready
  idleTimeoutMillis: 30_000, // Close idle connections after 30s
  connectionTimeoutMillis: 5_000, // Fail fast if can't connect in 5s
  maxUses: 7500, // Recycle connections after 7500 uses to prevent memory leaks
  allowExitOnIdle: false, // Keep pool alive for server lifetime
  statement_timeout: 30_000, // Kill queries running > 30s
  query_timeout: 30_000, // Query-level timeout
};

// ── 7. Database Query Optimization Hints ──────────────────────────────────────
export const DB_OPTIMIZATION = {
  // Recommended indexes for hot queries
  indexes: [
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_disputes_status ON disputes(status)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_disputes_created ON disputes(created_at DESC)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_disputes_priority ON disputes(priority)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commission_tiers_type ON commission_tiers(transaction_type)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commission_splits_active ON commission_splits(is_active)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchant_settlements_status ON merchant_settlements(status)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchant_settlements_merchant ON merchant_settlements(merchant_id)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commission_payouts_status ON commission_payouts(status)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commission_payouts_agent ON commission_payouts(agent_id)",
  ],
  // Query patterns to avoid
  antiPatterns: [
    "SELECT * (always specify columns)",
    "Missing LIMIT on list queries",
    "N+1 queries (use joins or batch)",
    "Unparameterized queries (SQL injection risk)",
  ],
};

// ── 8. Apply Performance Indexes ──────────────────────────────────────────────
export async function applyPerformanceIndexes(pool: any): Promise<void> {
  if (!pool) return;
  for (const idx of DB_OPTIMIZATION.indexes) {
    try {
      await pool.query(idx);
      logger.info(`[PerfTuning] Applied: ${idx.substring(0, 80)}...`);
    } catch (e: any) {
      // Index may already exist
      if (!e.message?.includes("already exists")) {
        logger.warn(`[PerfTuning] Index failed: ${e.message}`);
      }
    }
  }
}

export default {
  queryCache,
  cachedQuery,
  requestMetrics,
  responseTimeMiddleware,
  compressionMiddleware,
  POOL_CONFIG,
  DB_OPTIMIZATION,
  applyPerformanceIndexes,
};
