// @ts-check
// TypeScript enabled — Sprint 96 security audit
/**
 * Runtime Configuration Module
 * P1-3: Runtime-configurable batch/concurrency parameters
 *
 * Stores configuration in PostgreSQL system_config table with in-memory LRU cache.
 * Parameters can be updated at runtime via admin tRPC procedures without restart.
 *
 * Key parameters managed:
 * - tb_batch_size: TigerBeetle batch size (default: 8190)
 * - settlement_batch_size: Settlement processing batch size (default: 500)
 * - max_concurrent_settlements: Max parallel settlement workers (default: 4)
 * - kafka_batch_size: Kafka producer batch size (default: 1000)
 * - redis_pipeline_size: Redis pipeline batch size (default: 100)
 * - copy_chunk_size: PostgreSQL COPY chunk size (default: 500)
 * - archival_retention_days: Days before cold-tier archival (default: 90)
 * - circuit_breaker_threshold: Failure threshold for circuit breaker (default: 5)
 */

import { getDb } from "../db";
import { systemConfig } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import logger from "../_core/logger";

// ── Default Configuration Values ─────────────────────────────────────────────

const DEFAULTS: Record<string, { value: string; description: string }> = {
  tb_batch_size: {
    value: "8190",
    description:
      "TigerBeetle max batch size per request (optimal: 8190 for 228K TPS)",
  },
  settlement_batch_size: {
    value: "500",
    description:
      "Number of settlements to process per batch in bulk operations",
  },
  max_concurrent_settlements: {
    value: "4",
    description: "Maximum parallel settlement processing workers",
  },
  kafka_batch_size: {
    value: "1000",
    description: "Kafka producer batch size for event publishing",
  },
  redis_pipeline_size: {
    value: "100",
    description: "Redis pipeline batch size for bulk cache operations",
  },
  copy_chunk_size: {
    value: "500",
    description: "PostgreSQL COPY/multi-row VALUES chunk size for bulk inserts",
  },
  archival_retention_days: {
    value: "90",
    description: "Days before settlements/disputes are archived to cold tier",
  },
  circuit_breaker_threshold: {
    value: "5",
    description: "Number of consecutive failures before circuit breaker opens",
  },
  circuit_breaker_reset_ms: {
    value: "30000",
    description:
      "Milliseconds before circuit breaker half-opens after tripping",
  },
  connection_pool_size: {
    value: "10",
    description: "Database connection pool size (formula: cores*2 + spindles)",
  },
  write_pipeline_buffer: {
    value: "1000",
    description: "TigerBeetle single-worker write pipeline channel buffer size",
  },
  batch_flush_interval_ms: {
    value: "100",
    description:
      "Milliseconds before partial batch is flushed in write pipeline",
  },
  progress_report_interval: {
    value: "100",
    description: "Report progress every N settlements during batch processing",
  },
  load_test_rps: {
    value: "1000",
    description: "Target requests per second for load testing",
  },
  load_test_duration_s: {
    value: "60",
    description: "Load test duration in seconds",
  },
};

// ── In-Memory Cache ──────────────────────────────────────────────────────────

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000; // 1 minute cache TTL

function getCached(key: string): string | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCache(key: string, value: string): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get a runtime configuration value. Checks cache first, then DB, then defaults.
 */
export async function getConfig(key: string): Promise<string> {
  // 1. Check cache
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  // 2. Check database
  try {
    const db = (await getDb())!;
    const [row] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, key))
      .limit(1);
    if (row) {
      setCache(key, row.value);
      return row.value;
    }
  } catch (error) {
    logger.warn(
      `[RuntimeConfig] DB lookup failed for ${key}, using default: ${error}`
    );
  }

  // 3. Return default
  const def = DEFAULTS[key];
  if (def) {
    setCache(key, def.value);
    return def.value;
  }

  return "";
}

/**
 * Get a numeric configuration value.
 */
export async function getConfigNumber(key: string): Promise<number> {
  const val = await getConfig(key);
  const num = Number(val);
  return isNaN(num) ? 0 : num;
}

/**
 * Set a runtime configuration value. Updates DB and cache.
 */
export async function setConfig(
  key: string,
  value: string,
  updatedBy?: string
): Promise<void> {
  try {
    const db = (await getDb())!;
    const [existing] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, key))
      .limit(1);

    if (existing) {
      await db
        .update(systemConfig)
        .set({
          value,
          updatedBy: updatedBy ?? "system",
          updatedAt: new Date(),
        })
        .where(eq(systemConfig.key, key));
    } else {
      const description =
        DEFAULTS[key]?.description ?? `Runtime config: ${key}`;
      await db.insert(systemConfig).values({
        key,
        value,
        description,
        updatedBy: updatedBy ?? "system",
      });
    }

    setCache(key, value);
    logger.info(
      `[RuntimeConfig] Updated ${key} = ${value} (by ${updatedBy ?? "system"})`
    );
  } catch (error) {
    logger.error(`[RuntimeConfig] Failed to set ${key}: ${error}`);
    throw error;
  }
}

/**
 * Get all configuration values with their defaults and current values.
 */
export async function getAllConfig(): Promise<
  Array<{
    key: string;
    value: string;
    defaultValue: string;
    description: string;
    isCustom: boolean;
    updatedBy: string | null;
    updatedAt: Date | null;
  }>
> {
  const results: Array<{
    key: string;
    value: string;
    defaultValue: string;
    description: string;
    isCustom: boolean;
    updatedBy: string | null;
    updatedAt: Date | null;
  }> = [];

  try {
    const db = (await getDb())!;
    const dbRows = await db.select().from(systemConfig);
    const dbMap = new Map(dbRows.map(r => [r.key, r]));

    for (const [key, def] of Object.entries(DEFAULTS)) {
      const dbRow = dbMap.get(key);
      results.push({
        key,
        value: dbRow?.value ?? def.value,
        defaultValue: def.value,
        description: def.description,
        isCustom: !!dbRow && dbRow.value !== def.value,
        updatedBy: dbRow?.updatedBy ?? null,
        updatedAt: dbRow?.updatedAt ?? null,
      });
    }

    // Include any DB-only keys not in defaults
    for (const row of dbRows) {
      if (!DEFAULTS[row.key]) {
        results.push({
          key: row.key,
          value: row.value,
          defaultValue: "",
          description: row.description ?? "",
          isCustom: true,
          updatedBy: row.updatedBy ?? null,
          updatedAt: row.updatedAt ?? null,
        });
      }
    }
  } catch (error) {
    // Return defaults if DB is unavailable
    for (const [key, def] of Object.entries(DEFAULTS)) {
      results.push({
        key,
        value: def.value,
        defaultValue: def.value,
        description: def.description,
        isCustom: false,
        updatedBy: null,
        updatedAt: null,
      });
    }
  }

  return results;
}

/**
 * Reset a configuration value to its default.
 */
export async function resetConfig(
  key: string,
  updatedBy?: string
): Promise<void> {
  const def = DEFAULTS[key];
  if (!def) throw new Error(`Unknown config key: ${key}`);
  await setConfig(key, def.value, updatedBy ?? "system");
}

/**
 * Seed all default configuration values into the database.
 * Idempotent — only inserts keys that don't already exist.
 */
export async function seedDefaults(): Promise<number> {
  let seeded = 0;
  try {
    const db = (await getDb())!;
    for (const [key, def] of Object.entries(DEFAULTS)) {
      const [existing] = await db
        .select()
        .from(systemConfig)
        .where(eq(systemConfig.key, key))
        .limit(1);
      if (!existing) {
        await db.insert(systemConfig).values({
          key,
          value: def.value,
          description: def.description,
          updatedBy: "system-seed",
        });
        seeded++;
      }
    }
    if (seeded > 0) {
      logger.info(
        `[RuntimeConfig] Seeded ${seeded} default configuration values`
      );
    }
  } catch (error) {
    logger.warn(`[RuntimeConfig] Failed to seed defaults: ${error}`);
  }
  return seeded;
}

/**
 * Invalidate the in-memory cache for a specific key or all keys.
 */
export function invalidateCache(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}
