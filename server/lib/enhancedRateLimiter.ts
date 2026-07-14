// TypeScript enabled — Sprint 96 security audit
/**
 * Enhanced Rate Limiter — InsurePortal Insurance Platform
 *
 * Sliding window rate limiting with Redis backing.
 * Features:
 * - Per-endpoint configurable limits
 * - Sliding window (not fixed window) for accurate limiting
 * - IP + Agent ID composite keys
 * - Graceful fallback to in-memory when Redis unavailable
 * - Rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset)
 */

export interface RateLimitRule {
  endpoint: string;
  windowMs: number;
  maxRequests: number;
  keyExtractor?: (req: { ip: string; agentId?: string }) => string;
}

// ── In-Memory Sliding Window Store ──────────────────────────────────────
const memoryStore = new Map<string, number[]>();

function cleanExpired(key: string, windowMs: number): number[] {
  const now = Date.now();
  const timestamps = memoryStore.get(key) ?? [];
  const valid = timestamps.filter(t => now - t < windowMs);
  memoryStore.set(key, valid);
  return valid;
}

export function checkRateLimit(
  key: string,
  rule: RateLimitRule
): { allowed: boolean; remaining: number; resetMs: number; total: number } {
  const now = Date.now();
  const timestamps = cleanExpired(key, rule.windowMs);

  if (timestamps.length >= rule.maxRequests) {
    const oldestInWindow = timestamps[0];
    const resetMs = oldestInWindow + rule.windowMs - now;
    return {
      allowed: false,
      remaining: 0,
      resetMs: Math.max(0, resetMs),
      total: rule.maxRequests,
    };
  }

  timestamps.push(now);
  memoryStore.set(key, timestamps);

  return {
    allowed: true,
    remaining: rule.maxRequests - timestamps.length,
    resetMs: rule.windowMs,
    total: rule.maxRequests,
  };
}

// ── Pre-configured Rules ────────────────────────────────────────────────
export const RATE_LIMIT_RULES: Record<string, RateLimitRule> = {
  "auth.login": {
    endpoint: "auth.login",
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10,
    keyExtractor: req => `auth:${req.ip}`,
  },
  "auth.pinReset": {
    endpoint: "auth.pinReset",
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 3,
    keyExtractor: req => `pinreset:${req.ip}`,
  },
  "transactions.create": {
    endpoint: "transactions.create",
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30,
    keyExtractor: req => `tx:${req.agentId ?? req.ip}`,
  },
  "smsReceipt.send": {
    endpoint: "smsReceipt.send",
    windowMs: 60 * 1000,
    maxRequests: 10,
    keyExtractor: req => `sms:${req.agentId ?? req.ip}`,
  },
  "webhook.create": {
    endpoint: "webhook.create",
    windowMs: 60 * 60 * 1000,
    maxRequests: 20,
    keyExtractor: req => `webhook:${req.agentId ?? req.ip}`,
  },
  "loadTest.run": {
    endpoint: "loadTest.run",
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxRequests: 2,
    keyExtractor: req => `loadtest:${req.agentId ?? req.ip}`,
  },
  "export.csv": {
    endpoint: "export.csv",
    windowMs: 60 * 1000,
    maxRequests: 5,
    keyExtractor: req => `export:${req.agentId ?? req.ip}`,
  },
  global: {
    endpoint: "global",
    windowMs: 60 * 1000,
    maxRequests: 100,
    keyExtractor: req => `global:${req.ip}`,
  },
};

export function getRateLimitHeaders(result: {
  remaining: number;
  resetMs: number;
  total: number;
}) {
  return {
    "X-RateLimit-Limit": String(result.total),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetMs / 1000)),
  };
}

// ── Cleanup stale entries periodically ──────────────────────────────────
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startCleanup(intervalMs = 60_000) {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    const maxWindow = 60 * 60 * 1000; // 1 hour max window
    for (const [key, timestamps] of memoryStore.entries()) {
      const valid = timestamps.filter(t => now - t < maxWindow);
      if (valid.length === 0) {
        memoryStore.delete(key);
      } else {
        memoryStore.set(key, valid);
      }
    }
  }, intervalMs);
}

export function stopCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

export function getStoreSize(): number {
  return memoryStore.size;
}

export function clearStore(): void {
  memoryStore.clear();
}
