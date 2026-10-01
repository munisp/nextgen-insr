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
  token: string,
  opts?: { consume?: boolean }
): Promise<boolean> {
  // 2026-10-01 (C2-mw): `consume` option added for inputSanitizer
  // consolidation (B6). Default true preserves the original one-time-token
  // semantics for existing callers; inputSanitizer.validateCsrfToken passes
  // { consume: false } because its CSRF contract is session-long, not
  // single-use.
  const consume = opts?.consume ?? true;
  const redis = await getRedis();
  if (redis) {
    try {
      const stored = await redis.get(`csrf:${sessionId}`);
      if (stored === token) {
        if (consume) await redis.del(`csrf:${sessionId}`);
        return true;
      }
      return false;
    } catch (err) {
      logger.error(
        { err, sessionId },
        "[DistributedState] Redis CSRF validate failed — falling back to IN-MEMORY store (2026-10-01, C2-mw). State is NOT shared across instances/restarts while Redis is down."
      );
    }
  }
  const entry = memoryCsrf.get(sessionId);
  if (!entry) return false;
  if (entry.expires < Date.now()) {
    memoryCsrf.delete(sessionId);
    return false;
  }
  if (entry.token === token) {
    if (consume) memoryCsrf.delete(sessionId);
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

// ── Generic Security-State JSON Store ────────────────────────────────────────
// 2026-10-01 (C2-mw): added for the Class-B persistence fixes (audit rows
// B1, B4, B7, B13). Security middleware state (liveness lockouts, login
// attempt lockouts, card-testing windows, chat abuse blocks, sanitizer rate
// limits) MUST survive process restarts — a restart that clears a lockout is
// a brute-force bypass. State is stored in Redis under `sec:<ns>:<key>` with
// a TTL.
//
// Fallback semantics (disclosed, deliberate):
//  - Availability is prioritized over fail-closed for these stores: when
//    Redis is unavailable the store falls back to a per-process in-memory
//    Map. This re-introduces the restart-clears-state risk ONLY for the
//    duration of the Redis outage, and every fallback is logged loudly
//    (error level on writes) so operators can alert on it.
//  - WRITE failures surface to the caller: secStateSet throws if BOTH the
//    Redis write and the in-memory fallback write fail, so lockout writers
//    (e.g. recordLivenessFailure) never silently drop a security state
//    transition.

interface SecStateMemoryEntry {
  value: string;
  expiresAt: number;
}

const memorySecState = new Map<string, SecStateMemoryEntry>();

function secStateFullKey(ns: string, key: string): string {
  return `sec:${ns}:${key}`;
}

let secStateFallbackWarnedAt = 0;

function logSecStateFallback(op: string, ns: string, err: unknown): void {
  // Throttle identical fallback logs to one per 30s to avoid log floods
  // during a Redis outage, but never swallow the first occurrence.
  const now = Date.now();
  const level = now - secStateFallbackWarnedAt > 30_000 ? "error" : "warn";
  secStateFallbackWarnedAt = now;
  logger[level](
    { err, op, ns },
    `[DistributedState] Redis ${op} failed for security-state namespace '${ns}' — using IN-MEMORY fallback; security state is NOT durable/shared until Redis recovers (2026-10-01, C2-mw)`
  );
}

export async function secStateGet(
  ns: string,
  key: string
): Promise<string | null> {
  const redis = await getRedis();
  if (redis) {
    try {
      return await redis.get(secStateFullKey(ns, key));
    } catch (err) {
      logSecStateFallback("GET", ns, err);
    }
  }
  const entry = memorySecState.get(secStateFullKey(ns, key));
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memorySecState.delete(secStateFullKey(ns, key));
    return null;
  }
  return entry.value;
}

export async function secStateSet(
  ns: string,
  key: string,
  value: string,
  ttlSeconds: number
): Promise<void> {
  const redis = await getRedis();
  let redisError: unknown = null;
  if (redis) {
    try {
      await redis.set(secStateFullKey(ns, key), value, "EX", ttlSeconds);
      return;
    } catch (err) {
      redisError = err;
      logSecStateFallback("SET", ns, err);
    }
  } else if (process.env.REDIS_URL) {
    // Redis is configured but unreachable — this is the dangerous case.
    logSecStateFallback("SET", ns, new Error("Redis client unavailable"));
  }
  try {
    memorySecState.set(secStateFullKey(ns, key), {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  } catch (memErr) {
    // Both backends failed — surface the write failure to the caller.
    logger.error(
      { redisError, memErr, ns, key },
      "[DistributedState] Security-state WRITE failed on ALL backends — lockout state lost (2026-10-01, C2-mw)"
    );
    throw memErr instanceof Error ? memErr : new Error(String(memErr));
  }
}

export async function secStateDelete(
  ns: string,
  key: string
): Promise<boolean> {
  const redis = await getRedis();
  if (redis) {
    try {
      const removed = await redis.del(secStateFullKey(ns, key));
      return removed > 0;
    } catch (err) {
      logSecStateFallback("DEL", ns, err);
    }
  }
  return memorySecState.delete(secStateFullKey(ns, key));
}

/** List all entries in a namespace (admin dashboards). */
export async function secStateList(
  ns: string
): Promise<Array<{ key: string; value: string }>> {
  const prefix = secStateFullKey(ns, "");
  const redis = await getRedis();
  if (redis) {
    try {
      const out: Array<{ key: string; value: string }> = [];
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(
          cursor,
          "MATCH",
          `${prefix}*`,
          "COUNT",
          200
        );
        cursor = next;
        for (const k of keys) {
          const v = await redis.get(k);
          if (v !== null) out.push({ key: k.slice(prefix.length), value: v });
        }
      } while (cursor !== "0");
      return out;
    } catch (err) {
      logSecStateFallback("LIST", ns, err);
    }
  }
  const now = Date.now();
  const out: Array<{ key: string; value: string }> = [];
  for (const [k, entry] of memorySecState) {
    if (!k.startsWith(prefix)) continue;
    if (entry.expiresAt < now) {
      memorySecState.delete(k);
      continue;
    }
    out.push({ key: k.slice(prefix.length), value: entry.value });
  }
  return out;
}

// ── Durable Priority Queue (sorted-set) ─────────────────────────────────────
// 2026-10-01 (C2-lib, A6): generic queue semantics used by agentOperations to
// persist the live-chat waiting queue. Redis ZSET (score = priority+timestamp)
// is the durable store; the memory fallback follows this module's existing
// pattern (development/single-instance only — log line below warns loudly in
// that mode). Members are unique strings (JSON payloads); score ordering is
// ascending (lowest score = head of queue).

interface RedisSortedSetClient {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrange(key: string, start: number, stop: number, ...withScores: string[]): Promise<unknown>;
  zrem(key: string, member: string): Promise<unknown>;
  zcard(key: string): Promise<unknown>;
}

const memorySortedSets = new Map<string, Map<string, number>>();

export async function sortedSetAdd(key: string, score: number, member: string): Promise<void> {
  const redis = (await getRedis()) as RedisSortedSetClient | null;
  if (redis) {
    try {
      await redis.zadd(`sq:${key}`, score, member);
      return;
    } catch (err) {
      logger.warn(`[DistributedState] Redis ZADD failed for sq:${key}, using memory fallback:: ${String(err)}`);
    }
  }
  let set = memorySortedSets.get(key);
  if (!set) {
    set = new Map<string, number>();
    memorySortedSets.set(key, set);
  }
  set.set(member, score);
}

/** Read all members ascending by score (queue head first). */
export async function sortedSetRange(key: string): Promise<Array<{ member: string; score: number }>> {
  const redis = (await getRedis()) as RedisSortedSetClient | null;
  if (redis) {
    try {
      const raw = await redis.zrange(`sq:${key}`, 0, -1, "WITHSCORES");
      const flat = raw as string[];
      const out: Array<{ member: string; score: number }> = [];
      for (let i = 0; i < flat.length; i += 2) {
        out.push({ member: flat[i], score: Number(flat[i + 1]) });
      }
      return out;
    } catch (err) {
      logger.warn(`[DistributedState] Redis ZRANGE failed for sq:${key}, using memory fallback:: ${String(err)}`);
    }
  }
  const set = memorySortedSets.get(key);
  if (!set) return [];
  return Array.from(set.entries())
    .map(([member, score]) => ({ member, score }))
    .sort((a, b) => a.score - b.score);
}

export async function sortedSetRemove(key: string, member: string): Promise<void> {
  const redis = (await getRedis()) as RedisSortedSetClient | null;
  if (redis) {
    try {
      await redis.zrem(`sq:${key}`, member);
      return;
    } catch (err) {
      logger.warn(`[DistributedState] Redis ZREM failed for sq:${key}, using memory fallback:: ${String(err)}`);
    }
  }
  memorySortedSets.get(key)?.delete(member);
}

export async function sortedSetSize(key: string): Promise<number> {
  const redis = (await getRedis()) as RedisSortedSetClient | null;
  if (redis) {
    try {
      return Number(await redis.zcard(`sq:${key}`));
    } catch (err) {
      logger.warn(`[DistributedState] Redis ZCARD failed for sq:${key}, using memory fallback:: ${String(err)}`);
    }
  }
  return memorySortedSets.get(key)?.size ?? 0;
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

  // Clean expired security-state entries (2026-10-01, C2-mw)
  for (const [key, entry] of memorySecState) {
    if (entry.expiresAt < now) {
      memorySecState.delete(key);
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
