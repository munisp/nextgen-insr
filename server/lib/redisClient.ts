// TypeScript enabled — Sprint 96 security audit
/**
 * redisClient.ts — Shared ioredis client for the InsurePortal POS Shell
 *
 * Provides a single Redis connection used by:
 *  - Rate limiting (rate-limit-redis store)
 *  - Push notification subscription caching
 *  - Session token blacklist
 *  - Distributed locks (float top-up, settlement)
 *
 * Connection defaults to redis://localhost:6379 in development,
 * overridden by REDIS_URL in production (docker-compose sets redis://redis:6379).
 */

import Redis from "ioredis";
import { logger } from '../_core/logger';

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

let _client: Redis | null = null;

export function getRedisClient(): Redis {
  // Recover from an externally-closed client (e.g. graceful shutdown or a
  // test harness quit the shared client): recreate so later callers get a
  // working client instead of "Connection is closed" forever.
  if (_client && (_client.status === "end" || _client.status === "close")) {
    _client = null;
  }
  if (!_client) {
    _client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null, // Prevent MaxRetriesPerRequestError crash
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy: (times: number) => {
        // Test environments (PGlite harness, no Redis): give up immediately so
        // fail-open paths engage in ms instead of ~31s. The long stall let the
        // pg pool's 30s idle timeout reap the single shared connection
        // mid-procedure, and reconnecting to pglite-socket desynced its
        // wire-protocol state (misaligned columns in later queries) — the root
        // cause of order-dependent funds-flow flakes.
        const maxAttempts = process.env.NODE_ENV === "test" ? 2 : 20;
        if (times > maxAttempts) return null; // stop retrying (~3 min in prod)
        return Math.min(times * 200, 2000);
      },
      reconnectOnError: (err: Error) => {
        // Reconnect on READONLY errors (Redis failover) and connection errors
        const shouldReconnect = err.message.includes("READONLY") ||
          err.message.includes("ECONNREFUSED") ||
          err.message.includes("ECONNRESET");
        if (shouldReconnect) {
          console.warn("[Redis] Reconnecting due to:", err.message);
        }
        return shouldReconnect;
      }
    });

    _client.on("error", err => {
      // Log but don't crash — app degrades gracefully without Redis
      if (process.env.NODE_ENV !== "test") {
        logger.warn("[Redis] Connection error (rate-limit will use memory store):: " + err.message);
      }
    });

    _client.on("connect", () => {
      if (process.env.NODE_ENV !== "test") {
        logger.info("[Redis] Connected to: " + REDIS_URL);
      }
    });
  }
  return _client;
}

/**
 * Ping Redis and return latency in ms, or null if unavailable.
 */
export async function pingRedis(): Promise<number | null> {
  try {
    const client = getRedisClient();
    const start = Date.now();
    await client.ping();
    return Date.now() - start;
  } catch {
    return null;
  }
}

/**
 * Acquire a distributed lock. Returns true if lock was acquired.
 * Lock expires after ttlMs milliseconds.
 */
export async function acquireLock(
  key: string,
  ttlMs: number = 10_000
): Promise<boolean> {
  try {
    const client = getRedisClient();
    const result = await client.set(`lock:${key}`, "1", "PX", ttlMs, "NX");
    return result === "OK";
  } catch {
    return true; // fail-open: allow operation if Redis is down
  }
}

/**
 * Release a distributed lock.
 */
export async function releaseLock(key: string): Promise<void> {
  try {
    const client = getRedisClient();
    await client.del(`lock:${key}`);
  } catch {
    // ignore
  }
}

export default getRedisClient;

/**
 * Blacklist a JWT token (by its jti claim or a hash of the token).
 * The token is stored with a TTL equal to its remaining validity period.
 * Falls back silently if Redis is unavailable — the token will expire naturally.
 */
export async function blacklistToken(
  tokenId: string,
  expiresAt: number // Unix timestamp (seconds)
): Promise<void> {
  try {
    const client = getRedisClient();
    const ttlSeconds = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
    if (ttlSeconds <= 0) return; // already expired
    await client.set(`blacklist:token:${tokenId}`, '1', 'EX', ttlSeconds);
  } catch {
    // fail-open: if Redis is down, token expires naturally via JWT exp claim
    logger.warn('[Redis] Token blacklist write failed — token will expire via JWT exp');
  }
}

/**
 * Check if a JWT token has been blacklisted.
 * Returns false (not blacklisted) if Redis is unavailable — fail-open to avoid
 * locking out users during Redis outages.
 */
export async function isTokenBlacklisted(tokenId: string): Promise<boolean> {
  try {
    const client = getRedisClient();
    const result = await client.get(`blacklist:token:${tokenId}`);
    return result !== null;
  } catch {
    // fail-open: allow request if Redis is down
    logger.warn('[Redis] Token blacklist check failed — allowing request (fail-open)');
    return false;
  }
}

/**
 * Blacklist all tokens for a user (force logout from all devices).
 * Stores a user-level revocation timestamp. Any token issued before this
 * timestamp is considered revoked.
 */
export async function revokeAllUserTokens(
  userId: string,
  revokedAt: number = Math.floor(Date.now() / 1000)
): Promise<void> {
  try {
    const client = getRedisClient();
    // Store for 90 days (max token lifetime)
    await client.set(`blacklist:user:${userId}:revoked_at`, String(revokedAt), 'EX', 90 * 24 * 3600);
  } catch {
    logger.warn('[Redis] User token revocation write failed');
  }
}

/**
 * Check if a token was issued before the user's revocation timestamp.
 * Returns false if Redis is unavailable (fail-open).
 */
export async function isUserTokenRevoked(userId: string, issuedAt: number): Promise<boolean> {
  try {
    const client = getRedisClient();
    const revokedAtStr = await client.get(`blacklist:user:${userId}:revoked_at`);
    if (!revokedAtStr) return false;
    return issuedAt < parseInt(revokedAtStr, 10);
  } catch {
    return false; // fail-open
  }
}
