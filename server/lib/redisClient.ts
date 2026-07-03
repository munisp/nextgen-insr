// TypeScript enabled — Sprint 96 security audit
/**
 * redisClient.ts — Shared ioredis client for the 54Link POS Shell
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
  if (!_client) {
    _client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null, // Prevent MaxRetriesPerRequestError crash
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy: (times: number) => {
        if (times > 5) return null; // stop retrying after 5 attempts
        return Math.min(times * 200, 2000);
      },
      reconnectOnError: () => false, // Don't reconnect on errors in dev
    });

    _client.on("error", err => {
      // Log but don't crash — app degrades gracefully without Redis
      if (process.env.NODE_ENV !== "test") {
        logger.warn(
          "[Redis] Connection error (rate-limit will use memory store):",
          err.message
        );
      }
    });

    _client.on("connect", () => {
      if (process.env.NODE_ENV !== "test") {
        logger.info("[Redis] Connected to", REDIS_URL);
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
