/**
 * Distributed State Store — Redis-backed with in-memory fallback
 *
 * Provides a shared state layer for security middleware (rate limiting, CSRF,
 * DDoS protection, circuit breakers, nonce tracking). In production, state is
 * stored in Redis so it persists across restarts and is shared across instances.
 * Falls back to in-memory Maps when Redis is unavailable (development/single-instance).
 *
 * All methods are async and handle Redis failures gracefully.
 */
import logger from "../_core/logger";

let redisAvailable = false;
let redisClient: any = null;

async function getRedis(): Promise<any> {
  if (redisClient && redisAvailable) return redisClient;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { getRedisClient } = await import("./redisClient");
    redisClient = getRedisClient();
    await redisClient.ping();
    redisAvailable = true;
    return redisClient;
  } catch {
    redisAvailable = false;
    return null;
  }
}

// ── Rate Limit Store ─────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const memoryRateLimit = new Map<string, RateLimitEntry>();

export async function rateLimitIncrement(
  key: string,
  windowMs: number
): Promise<{ count: number; remaining: number; limit: number }> {
  const limit = 100; // default per-window limit
  const redis = await getRedis();
  const now = Date.now();

  if (redis) {
    try {
      const redisKey = `rl:${key}`;
      const current = await redis.incr(redisKey);
      if (current === 1) {
        await redis.pexpire(redisKey, windowMs);
      }
      return { count: current, remaining: Math.max(0, limit - current), limit };
    } catch {
      // Fall through to memory
    }
  }

  const entry = memoryRateLimit.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    memoryRateLimit.set(key, { count: 1, windowStart: now });
    return { count: 1, remaining: limit - 1, limit };
  }
  entry.count++;
  return {
    count: entry.count,
    remaining: Math.max(0, limit - entry.count),
    limit,
  };
}

export async function rateLimitCheck(
  key: string,
  windowMs: number,
  maxRequests: number
): Promise<boolean> {
  const redis = await getRedis();
  const now = Date.now();

  if (redis) {
    try {
      const redisKey = `rl:${key}`;
      const current = parseInt((await redis.get(redisKey)) || "0", 10);
      return current < maxRequests;
    } catch {
      // Fall through to memory
    }
  }

  const entry = memoryRateLimit.get(key);
  if (!entry || now - entry.windowStart > windowMs) return true;
  return entry.count < maxRequests;
}

// ── CSRF Token Store ─────────────────────────────────────────────────────────

const memoryCsrf = new Map<string, { token: string; expires: number }>();

export async function csrfStore(
  sessionId: string,
  token: string,
  ttlMs: number
): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.set(`csrf:${sessionId}`, token, "PX", ttlMs);
      return;
    } catch {
      // Fall through
    }
  }
  memoryCsrf.set(sessionId, { token, expires: Date.now() + ttlMs });
}

export async function csrfValidate(
  sessionId: string,
  token: string
): Promise<boolean> {
  const redis = await getRedis();
  if (redis) {
    try {
      const stored = await redis.get(`csrf:${sessionId}`);
      if (stored === token) {
        await redis.del(`csrf:${sessionId}`);
        return true;
      }
      return false;
    } catch {
      // Fall through
    }
  }
  const entry = memoryCsrf.get(sessionId);
  if (!entry) return false;
  if (entry.expires < Date.now()) {
    memoryCsrf.delete(sessionId);
    return false;
  }
  if (entry.token === token) {
    memoryCsrf.delete(sessionId);
    return true;
  }
  return false;
}

// ── IP Reputation / DDoS Store ───────────────────────────────────────────────

const memoryIpReputation = new Map<string, number>();

export async function ipReputationIncrement(ip: string): Promise<number> {
  const redis = await getRedis();
  if (redis) {
    try {
      const key = `ddos:ip:${ip}`;
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, 300); // 5-minute window
      }
      return count;
    } catch {
      // Fall through
    }
  }
  const current = memoryIpReputation.get(ip) || 0;
  memoryIpReputation.set(ip, current + 1);
  return current + 1;
}

export async function ipReputationGet(ip: string): Promise<number> {
  const redis = await getRedis();
  if (redis) {
    try {
      const count = await redis.get(`ddos:ip:${ip}`);
      return parseInt(count || "0", 10);
    } catch {
      // Fall through
    }
  }
  return memoryIpReputation.get(ip) || 0;
}

export async function ipReputationBan(
  ip: string,
  ttlSeconds: number
): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.set(`ddos:ban:${ip}`, "1", "EX", ttlSeconds);
      return;
    } catch {
      // Fall through
    }
  }
  memoryIpReputation.set(`ban:${ip}`, Date.now() + ttlSeconds * 1000);
}

export async function ipIsBanned(ip: string): Promise<boolean> {
  const redis = await getRedis();
  if (redis) {
    try {
      const banned = await redis.get(`ddos:ban:${ip}`);
      return banned === "1";
    } catch {
      // Fall through
    }
  }
  const banExpiry = memoryIpReputation.get(`ban:${ip}`);
  if (!banExpiry) return false;
  if (Date.now() > banExpiry) {
    memoryIpReputation.delete(`ban:${ip}`);
    return false;
  }
  return true;
}

// ── Nonce / Idempotency Store ────────────────────────────────────────────────

const memoryNonce = new Map<string, number>();

export async function nonceExists(nonce: string): Promise<boolean> {
  const redis = await getRedis();
  if (redis) {
    try {
      const exists = await redis.exists(`nonce:${nonce}`);
      return exists === 1;
    } catch {
      // Fall through
    }
  }
  return memoryNonce.has(nonce);
}

export async function nonceStore(
  nonce: string,
  ttlSeconds: number
): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.set(`nonce:${nonce}`, "1", "EX", ttlSeconds);
      return;
    } catch {
      // Fall through
    }
  }
  memoryNonce.set(nonce, Date.now() + ttlSeconds * 1000);
}

// ── Circuit Breaker State (Distributed) ──────────────────────────────────────

interface CircuitState {
  state: "closed" | "open" | "half_open";
  failures: number;
  lastFailure: number;
}

const memoryCircuits = new Map<string, CircuitState>();

export async function circuitGet(service: string): Promise<CircuitState> {
  const defaultState: CircuitState = {
    state: "closed",
    failures: 0,
    lastFailure: 0,
  };
  const redis = await getRedis();
  if (redis) {
    try {
      const data = await redis.get(`circuit:${service}`);
      if (data) return JSON.parse(data);
      return defaultState;
    } catch {
      // Fall through
    }
  }
  return memoryCircuits.get(service) || defaultState;
}

export async function circuitUpdate(
  service: string,
  state: CircuitState
): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.set(`circuit:${service}`, JSON.stringify(state), "EX", 300);
      return;
    } catch {
      // Fall through
    }
  }
  memoryCircuits.set(service, state);
}

// ── Login Attempt Tracking ───────────────────────────────────────────────────

export async function loginAttemptIncrement(
  identifier: string,
  windowSeconds: number
): Promise<number> {
  const redis = await getRedis();
  if (redis) {
    try {
      const key = `login:attempts:${identifier}`;
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSeconds);
      }
      return count;
    } catch {
      // Fall through
    }
  }
  const key = `login:${identifier}`;
  const current = (memoryNonce.get(key) || 0) + 1;
  memoryNonce.set(key, current);
  return current;
}

export async function loginAttemptReset(identifier: string): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.del(`login:attempts:${identifier}`);
      return;
    } catch {
      // Fall through
    }
  }
  memoryNonce.delete(`login:${identifier}`);
}

// ── Cache Store (for FX rates, commission tiers, etc.) ───────────────────────

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = await getRedis();
  if (redis) {
    try {
      const data = await redis.get(`cache:${key}`);
      if (data) return JSON.parse(data) as T;
    } catch {
      // Fall through
    }
  }
  return null;
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.set(`cache:${key}`, JSON.stringify(value), "EX", ttlSeconds);
      return;
    } catch {
      // Fall through
    }
  }
  // No-op for memory — hot path caching only meaningful with Redis
}

// ── Periodic cleanup for memory fallback maps ────────────────────────────────

function cleanupMemoryStores(): void {
  const now = Date.now();

  // Clean expired rate limit entries (older than 2 minutes)
  for (const [key, entry] of memoryRateLimit) {
    if (now - entry.windowStart > 120_000) {
      memoryRateLimit.delete(key);
    }
  }

  // Clean expired CSRF tokens
  for (const [key, entry] of memoryCsrf) {
    if (entry.expires < now) {
      memoryCsrf.delete(key);
    }
  }

  // Clean expired nonces (older than 10 minutes)
  for (const [key, timestamp] of memoryNonce) {
    if (typeof timestamp === "number" && timestamp < now) {
      memoryNonce.delete(key);
    }
  }

  // Cap IP reputation map size
  if (memoryIpReputation.size > 10_000) {
    const entries = Array.from(memoryIpReputation.entries());
    entries.sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < entries.length - 5_000; i++) {
      memoryIpReputation.delete(entries[i][0]);
    }
  }
}

// Run cleanup every 60 seconds
setInterval(cleanupMemoryStores, 60_000).unref();

// ── Status reporting ─────────────────────────────────────────────────────────

export function getDistributedStateStatus(): {
  backend: "redis" | "memory";
  redisConnected: boolean;
} {
  return {
    backend: redisAvailable ? "redis" : "memory",
    redisConnected: redisAvailable,
  };
}

logger.info(
  { redisConfigured: !!process.env.REDIS_URL },
  "Distributed state store initialized"
);
