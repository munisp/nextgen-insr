// TypeScript enabled — Sprint 96 security audit
/**
 * redisClient.ts — Redis integration for InsurePortal POS Shell
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides a thin wrapper around the platform's Redis service (accessed via
 * the APISix gateway at PLATFORM_BASE_URL/v1/cache/*).
 *
 * When REDIS_URL is set directly, the module uses ioredis for low-latency
 * local access (useful for session caching, rate-limit counters, and
 * real-time leaderboards). When only PLATFORM_BASE_URL is available, all
 * calls are forwarded through the platform proxy.
 *
 * Environment variables:
 *  - REDIS_URL           e.g. redis://localhost:6379 (optional, direct mode)
 *  - PLATFORM_BASE_URL   APISix gateway base URL (proxy mode fallback)
 *  - PLATFORM_API_KEY    Bearer token for the gateway
 *
 * Fail-open: all methods return null / false on error so callers can
 * continue without Redis (e.g., fall back to DB for session data).
 */

const REDIS_URL = ENV.redisUrl;
const PLATFORM_BASE_URL = ENV.platformBaseUrl;
const PLATFORM_API_KEY = ENV.platformApiKey;

// ── Direct ioredis client (optional) ─────────────────────────────────────────
// Only loaded when REDIS_URL is explicitly set to avoid pulling ioredis into
// environments that rely solely on the platform proxy.
import type { Redis as RedisType } from "ioredis";

import { ENV } from "./_core/env";
import { logger } from './_core/logger';
let _directClient: RedisType | null = null;

async function getDirectClient(): Promise<RedisType | null> {
  if (!REDIS_URL) return null;
  if (_directClient) return _directClient;
  let pending: RedisType | null = null;
  try {
    const { default: Redis } = await import("ioredis");
    pending = new Redis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 3000,
      enableOfflineQueue: false,
    }) as RedisType;
    pending.on("error", (err: Error) => {
      logger.error("[Redis] Connection error:: " + err.message);
    });
    await pending.connect();
    // 2026-11-26 (W19): cache the singleton only AFTER connect() succeeds.
    // Previously _directClient was assigned before `await connect()`; a failed
    // connect left a permanently dead client (status "reconnecting"/"end")
    // that every later call reused, turning one transient connect failure
    // into persistent command rejections on every cache operation.
    _directClient = pending;
    logger.info("[Redis] Direct connection established →: " + REDIS_URL);
    return pending;
  } catch (err) {
    // 2026-11-26 (W19): dispose the half-open client so the next call retries
    // with a fresh socket instead of leaking one stuck in "reconnecting".
    try {
      pending?.disconnect();
    } catch {
      // best-effort cleanup — a failed disconnect must not mask the cause
    }
    logger.warn("[Redis] Could not connect directly:: " + (err as Error).message);
    return null;
  }
}

// ── Proxy helper (via APISix) ─────────────────────────────────────────────────
async function proxyGet(path: string): Promise<unknown> {
  const res = await fetch(`${PLATFORM_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${PLATFORM_API_KEY}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Redis proxy ${path} → ${res.status}`);
  return res.json();
}

async function proxyPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${PLATFORM_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PLATFORM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Redis proxy POST ${path} → ${res.status}`);
  return res.json();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get a cached value by key.
 * Returns null if the key does not exist or Redis is unavailable.
 */
export async function cacheGet(key: string): Promise<string | null> {
  try {
    const client = await getDirectClient();
    // 2026-11-26 (W19): `await` here is load-bearing — do NOT "simplify" to
    // `return client.get(key)`. ioredis rejects the command promise
    // ASYNCHRONOUSLY (Redis.js sendCommand → command.reject, e.g. "Stream
    // isn't writeable and enableOfflineQueue options is false") rather than
    // throwing synchronously, and a bare `return <promise>` lets that
    // rejection escape this try/catch to the caller (CI job 139493405438,
    // proven against ioredis@5.11.1). Awaiting keeps the fail-open contract:
    // cache errors degrade to null so callers fall back to the DB.
    if (client) return await client.get(key);
    const data = (await proxyGet(`/v1/cache/${encodeURIComponent(key)}`)) as {
      value: string | null;
    };
    return data.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Set a cached value with an optional TTL in seconds.
 * Returns true on success, false on failure.
 */
export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds?: number
): Promise<boolean> {
  try {
    const client = await getDirectClient();
    if (client) {
      if (ttlSeconds) await client.setex(key, ttlSeconds, value);
      else await client.set(key, value);
      return true;
    }
    await proxyPost("/v1/cache", { key, value, ttl: ttlSeconds });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a cached key.
 */
export async function cacheDel(key: string): Promise<boolean> {
  try {
    const client = await getDirectClient();
    if (client) {
      await client.del(key);
      return true;
    }
    await fetch(`${PLATFORM_BASE_URL}/v1/cache/${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${PLATFORM_API_KEY}` },
      signal: AbortSignal.timeout(3000),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Increment a counter (used for rate limiting, leaderboards).
 */
export async function cacheIncr(
  key: string,
  ttlSeconds?: number
): Promise<number> {
  try {
    const client = await getDirectClient();
    if (client) {
      const val = await client.incr(key);
      if (ttlSeconds && val === 1) await client.expire(key, ttlSeconds);
      return val;
    }
    const data = (await proxyPost("/v1/cache/incr", {
      key,
      ttl: ttlSeconds,
    })) as { value: number };
    return data.value;
  } catch {
    return 0;
  }
}

/**
 * Publish a message to a Redis pub/sub channel.
 */
export async function cachePublish(
  channel: string,
  message: string
): Promise<boolean> {
  try {
    const client = await getDirectClient();
    if (client) {
      await client.publish(channel, message);
      return true;
    }
    await proxyPost("/v1/cache/publish", { channel, message });
    return true;
  } catch {
    return false;
  }
}

/**
 * Health check — returns true if Redis is reachable.
 */
export async function redisIsHealthy(): Promise<boolean> {
  try {
    const client = await getDirectClient();
    if (client) {
      await client.ping();
      return true;
    }
    await proxyGet("/v1/cache/health");
    return true;
  } catch {
    return false;
  }
}
