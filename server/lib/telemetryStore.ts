/**
 * telemetryStore.ts — B8 + B9 (Zero-Undelivered-Scope wave 2): in-repo APM
 * request-metrics and error-event store.
 *
 * Recording model (called from server/middleware/observabilityMiddleware.ts):
 *  - Request metrics are buffered in memory and flushed to request_metrics in
 *    a single batched INSERT when the buffer reaches BATCH_SIZE or the flush
 *    timer fires. The flush is fire-and-forget: it is never awaited by the
 *    request path, so telemetry can never block or fail a request.
 *  - A failed flush logs loudly and DROPS the batch — nothing pretends to
 *    have been written; systemHealthMonitor.apiLatency reads only rows that
 *    actually landed and fails loud (NO_METRICS_YET) when the scope is empty.
 *  - Error events are upserted one row per fingerprint (sha256 of
 *    path + message + stack hash); repeats increment count / advance
 *    lastSeen. Also fire-and-forget with the same honest-drop semantics.
 *
 * Overhead: one object allocation + array push per request on the hot path;
 * DB work happens off the request path in batches of up to BATCH_SIZE rows.
 */
import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { errorEvents, requestMetrics } from "../../drizzle/schema.additions";
import { getDb } from "../db";
import { logger } from "../_core/logger";

export interface RequestMetricSample {
  path: string;
  procedureType: string;
  durationMs: number;
  success: boolean;
  errorCode?: string;
  userId?: string;
}

export interface ErrorEventSample {
  path: string;
  message: string;
  stack?: string;
}

const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 5_000;

let buffer: RequestMetricSample[] = [];
let flushing = false;
let flushTimer: NodeJS.Timeout | null = null;

async function flushRequestMetrics(): Promise<void> {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  const batch = buffer;
  buffer = [];
  try {
    const db = await getDb();
    if (!db) {
      logger.warn(
        `[telemetryStore] dropping ${batch.length} request-metric rows: no database connection (honest drop, nothing was written)`
      );
      return;
    }
    await db.insert(requestMetrics).values(
      batch.map(s => ({
        path: s.path.slice(0, 255),
        procedureType: s.procedureType.slice(0, 16),
        durationMs: Math.max(0, Math.round(s.durationMs)),
        success: s.success,
        errorCode: s.errorCode ?? null,
        userId: s.userId ?? null,
      }))
    );
  } catch (err) {
    // Loud, honest drop: the rows are lost rather than pretended-written.
    logger.error(
      `[telemetryStore] request-metrics flush failed, dropping ${batch.length} rows: ${err}`
    );
  } finally {
    flushing = false;
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushRequestMetrics();
  }, FLUSH_INTERVAL_MS);
  // Never keep the process alive for telemetry.
  if (typeof flushTimer.unref === "function") flushTimer.unref();
}

/**
 * Buffer a request-metric sample. Synchronous and non-blocking; the actual
 * INSERT happens in a later batched flush. Never throws.
 */
export function recordRequestMetric(sample: RequestMetricSample): void {
  try {
    buffer.push(sample);
    if (buffer.length >= BATCH_SIZE) {
      void flushRequestMetrics();
    } else {
      scheduleFlush();
    }
  } catch (err) {
    logger.error(`[telemetryStore] recordRequestMetric failed: ${err}`);
  }
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function errorFingerprint(sample: ErrorEventSample): string {
  const stackHash = sample.stack ? sha256(sample.stack) : "";
  return sha256(`${sample.path}\n${sample.message}\n${stackHash}`);
}

/**
 * Record an application-error occurrence (real upsert by fingerprint).
 * Fire-and-forget; failures are logged loudly, never thrown into the
 * request path, and never reported as written.
 */
export async function recordErrorEvent(sample: ErrorEventSample): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      logger.warn(
        `[telemetryStore] dropping error event for ${sample.path}: no database connection (honest drop, nothing was written)`
      );
      return;
    }
    const fingerprint = errorFingerprint(sample);
    const stackHash = sample.stack ? sha256(sample.stack) : null;
    await db
      .insert(errorEvents)
      .values({
        fingerprint,
        message: sample.message,
        stackHash,
        path: sample.path.slice(0, 255),
      })
      .onConflictDoUpdate({
        target: errorEvents.fingerprint,
        set: {
          count: sql`${errorEvents.count} + 1`,
          lastSeen: sql`now()`,
        },
      });
  } catch (err) {
    logger.error(
      `[telemetryStore] error-event upsert failed for ${sample.path}: ${err}`
    );
  }
}

/**
 * Flush any buffered request metrics immediately. Exposed for the
 * integration harness (assert a row landed right after a real procedure
 * call) and for graceful shutdown — NOT used on the request path.
 */
export async function flushTelemetryNow(): Promise<void> {
  // Wait out any in-flight flush, then drain rows that were pushed into the
  // buffer while that flush was running (single-flight means an early return
  // can leave the buffer non-empty).
  for (let i = 0; i < 40 && (flushing || buffer.length > 0); i++) {
    await flushRequestMetrics();
    if (flushing || buffer.length > 0) {
      await new Promise(r => setTimeout(r, 50));
    }
  }
}

/** Test/introspection helper: number of buffered, not-yet-flushed samples. */
export function pendingMetricCount(): number {
  return buffer.length;
}
