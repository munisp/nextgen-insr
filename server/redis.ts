// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * InsurePortal Redis Client
 * Provides connection-pooled ioredis client with typed cache helpers.
 *
 * Cache namespaces:
 *   agent:session:{agentId}  → agent profile (TTL 12h)
 *   agent:float:{agentId}    → premium reserve string (TTL 30s, write-through)
 *   fraud:rules                → serialized fraud rules array (TTL 5min)
 *   probe:latest:{terminalId}  → latest connectivity reading (TTL 60s)
 */
import Redis from "ioredis";
import logger from "./_core/logger";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

let _client: Redis | null = null;

/**
 * Get (or create) the shared Redis client.
 * Returns null if Redis is unavailable — callers must handle gracefully.
 */
export function getRedisClient(): Redis | null {
  if (_client) return _client;

  try {
    _client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 3_000,
      commandTimeout: 2_000,
    });

    _client.on("connect", () => logger.info("[Redis] Connected"));
    _client.on("error", err =>
      logger.warn({ err }, "[Redis] Connection error — cache disabled")
    );
    _client.on("close", () => logger.warn("[Redis] Connection closed"));

    return _client;
  } catch (err) {
    logger.warn({ err }, "[Redis] Failed to initialise client");
    return null;
  }
}

// ── TTL constants ──────────────────────────────────────────────────────────────
const TTL = {
  SESSION: 60 * 60 * 12, // 12 hours
  FLOAT: 30, // 30 seconds (write-through)
  FRAUD_RULES: 60 * 5, // 5 minutes
  PROBE: 60, // 60 seconds
};

// ── Agent session cache ────────────────────────────────────────────────────────

export async function cacheAgentSession(
  agentId: string,
  profile: object
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.setex(
      `agent:session:${agentId}`,
      TTL.SESSION,
      JSON.stringify(profile)
    );
  } catch (err) {
    logger.warn({ err }, "[Redis] cacheAgentSession failed");
  }
}

export async function getCachedAgentSession<T>(
  agentId: string
): Promise<T | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(`agent:session:${agentId}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    logger.warn({ err }, "[Redis] getCachedAgentSession failed");
    return null;
  }
}

export async function invalidateAgentSession(agentId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.del(`agent:session:${agentId}`);
  } catch (err) {
    logger.warn({ err }, "[Redis] invalidateAgentSession failed");
  }
}

// ── Float balance cache (write-through) ───────────────────────────────────────

export async function cacheAgentFloat(
  agentId: string,
  balanceKobo: number
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.setex(
      `agent:float:${agentId}`,
      TTL.FLOAT,
      String(balanceKobo)
    );
  } catch (err) {
    logger.warn({ err }, "[Redis] cacheAgentFloat failed");
  }
}

export async function getCachedAgentFloat(
  agentId: string
): Promise<number | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(`agent:float:${agentId}`);
    return raw !== null ? Number(raw) : null;
  } catch (err) {
    logger.warn({ err }, "[Redis] getCachedAgentFloat failed");
    return null;
  }
}

// ── Fraud rules cache ──────────────────────────────────────────────────────────

export async function cacheFraudRules(rules: object[]): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.setex("fraud:rules", TTL.FRAUD_RULES, JSON.stringify(rules));
  } catch (err) {
    logger.warn({ err }, "[Redis] cacheFraudRules failed");
  }
}

export async function getCachedFraudRules<T>(): Promise<T[] | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get("fraud:rules");
    return raw ? (JSON.parse(raw) as T[]) : null;
  } catch (err) {
    logger.warn({ err }, "[Redis] getCachedFraudRules failed");
    return null;
  }
}

export async function invalidateFraudRules(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.del("fraud:rules");
  } catch (err) {
    logger.warn({ err }, "[Redis] invalidateFraudRules failed");
  }
}

// ── Connectivity probe cache ───────────────────────────────────────────────────

export async function cacheProbeReading(
  terminalId: string,
  reading: object
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.setex(
      `probe:latest:${terminalId}`,
      TTL.PROBE,
      JSON.stringify(reading)
    );
  } catch (err) {
    logger.warn({ err }, "[Redis] cacheProbeReading failed");
  }
}

export async function getCachedProbeReading<T>(
  terminalId: string
): Promise<T | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(`probe:latest:${terminalId}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    logger.warn({ err }, "[Redis] getCachedProbeReading failed");
    return null;
  }
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────

export async function closeRedis(): Promise<void> {
  if (_client) {
    await _client.quit();
    _client = null;
    logger.info("[Redis] Connection closed");
  }
}
