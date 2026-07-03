// TypeScript enabled — Sprint 96 security audit
/**
 * erpRetryWorker.ts
 * Background worker that retries failed ERP syncs with exponential backoff + jitter.
 *
 * Schedule: runs every 60 seconds.
 * Strategy: base delay 30s, multiplier 2x, max delay 4h, max retries 5 (configurable per record).
 * Jitter: ±20% of computed delay to prevent thundering herd.
 */
import { getDb } from "../db";
import { notifyOwner } from "../_core/notification";
import { erpSyncLog, erpConfig } from "../../drizzle/schema";
import { eq, and, lte, lt } from "drizzle-orm";
import { recordMetric } from "./analyticsMetrics";
import { logger } from './_core/logger';

const BASE_DELAY_MS = 30_000; // 30 seconds
const BACKOFF_MULTIPLIER = 2;
const MAX_DELAY_MS = 4 * 60 * 60 * 1000; // 4 hours
const JITTER_FACTOR = 0.2; // ±20%

export function computeNextRetryAt(retryCount: number): Date {
  const base = Math.min(
    BASE_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, retryCount),
    MAX_DELAY_MS
  );
  const jitter = base * JITTER_FACTOR * (Math.random() * 2 - 1); // ±20%
  return new Date(Date.now() + base + jitter);
}

async function runRetryBatch(): Promise<void> {
  const db = (await getDb())!;
  if (!db) return;

  const now = new Date();

  // Find failed syncs that are due for retry and haven't exceeded maxRetries
  let due: (typeof erpSyncLog.$inferSelect)[];
  try {
    due = await db
      .select()
      .from(erpSyncLog)
      .where(
        and(
          eq(erpSyncLog.status, "failed"),
          lte(erpSyncLog.nextRetryAt, now)
          // retryCount < maxRetries — use raw SQL comparison
        )
      )
      .limit(20);
  } catch (queryErr: unknown) {
    // Transient DB connection error — skip this cycle, will retry on next interval
    const msg = queryErr instanceof Error ? queryErr.message : String(queryErr);
    if (
      msg.includes("Connection terminated") ||
      msg.includes("timeout") ||
      msg.includes("ECONNREFUSED")
    ) {
      return; // Silently skip — DB not ready yet
    }
    throw queryErr;
  }

  // Filter in JS since drizzle doesn't support column-to-column comparison easily
  const eligible = due.filter(r => r.retryCount < r.maxRetries);

  if (eligible.length === 0) return;

  // Load ERP config for the webhook URL
  const configs = await db.select().from(erpConfig).limit(1);
  const cfg = configs[0];
  if (!cfg || !cfg.baseUrl) {
    // ERP not configured — mark as permanently failed after maxRetries
    for (const record of eligible) {
      if (record.retryCount >= record.maxRetries - 1) {
        await db
          .update(erpSyncLog)
          .set({
            status: "failed",
            errorMessage: "ERP not configured — max retries reached",
            nextRetryAt: null,
          })
          .where(eq(erpSyncLog.id, record.id));
      }
    }
    return;
  }

  for (const record of eligible) {
    try {
      const payload = record.payload ?? {};
      const webhookUrl = cfg.baseUrl.endsWith("/")
        ? cfg.baseUrl.slice(0, -1)
        : cfg.baseUrl;
      const res = await fetch(`${webhookUrl}/api/54link/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey ?? ""}`,
          "X-ERP-Type": cfg.erpType ?? "custom",
          "X-54Link-Retry": String(record.retryCount + 1),
        },
        body: JSON.stringify({
          entityType: record.entityType,
          entityId: record.entityId,
          erpDocType: record.erpDocType,
          payload,
          retryAttempt: record.retryCount + 1,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        await db
          .update(erpSyncLog)
          .set({
            status: "synced",
            syncedAt: new Date(),
            retryCount: record.retryCount + 1,
            nextRetryAt: null,
            errorMessage: null,
          })
          .where(eq(erpSyncLog.id, record.id));
        await recordMetric("erp.sync.success", 1, {
          entityType: record.entityType,
        });
        logger.info(
          `[ERP Retry] ✓ Synced record ${record.id} (attempt ${record.retryCount + 1})`
        );
      } else {
        const errText = await res.text().catch(() => res.statusText);
        const newRetryCount = record.retryCount + 1;
        const isExhausted = newRetryCount >= record.maxRetries;
        await db
          .update(erpSyncLog)
          .set({
            status: isExhausted ? "failed" : "failed",
            errorMessage: `HTTP ${res.status}: ${errText.slice(0, 256)}`,
            retryCount: newRetryCount,
            nextRetryAt: isExhausted ? null : computeNextRetryAt(newRetryCount),
          })
          .where(eq(erpSyncLog.id, record.id));
        await recordMetric("erp.sync.failure", 1, {
          entityType: record.entityType,
        });
        if (isExhausted) {
          logger.warn(
            `[ERP Retry] ✗ Record ${record.id} exhausted ${record.maxRetries} retries`
          );
          // P1-A: Dead letter notification — alert owner when retries are exhausted
          notifyOwner({
            title: `ERP Sync Dead Letter: ${record.entityType} #${record.entityId}`,
            content: `ERP sync record ${record.id} (${record.entityType} #${record.entityId}) has exhausted all ${record.maxRetries} retry attempts.\n\nLast error: HTTP ${res.status}: ${errText.slice(0, 200)}\n\nAction required: Check ERP connectivity and manually re-queue this record from the ERP Config tab.`,
          }).catch((e: unknown) =>
            logger.error("[ERP Retry] Dead letter notification failed:", e)
          );
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const newRetryCount = record.retryCount + 1;
      const isExhausted = newRetryCount >= record.maxRetries;
      await db
        .update(erpSyncLog)
        .set({
          errorMessage: msg.slice(0, 256),
          retryCount: newRetryCount,
          nextRetryAt: isExhausted ? null : computeNextRetryAt(newRetryCount),
        })
        .where(eq(erpSyncLog.id, record.id));
      await recordMetric("erp.sync.failure", 1, {
        entityType: record.entityType,
      });
      if (isExhausted) {
        // P1-A: Dead letter notification — alert owner when retries are exhausted (network error)
        notifyOwner({
          title: `ERP Sync Dead Letter: ${record.entityType} #${record.entityId}`,
          content: `ERP sync record ${record.id} (${record.entityType} #${record.entityId}) has exhausted all ${record.maxRetries} retry attempts.\n\nLast error: ${msg.slice(0, 200)}\n\nAction required: Check ERP connectivity and manually re-queue this record from the ERP Config tab.`,
        }).catch((e: unknown) =>
          logger.error("[ERP Retry] Dead letter notification failed:", e)
        );
      }
    }
  }
}

let workerInterval: ReturnType<typeof setInterval> | null = null;

export function startErpRetryWorker(): void {
  if (workerInterval) return;
  logger.info("[ERP Retry Worker] Started — polling every 60s");
  workerInterval = setInterval(() => {
    runRetryBatch().catch(err =>
      logger.error("[ERP Retry Worker] Error:", err)
    );
  }, 60_000);
  // Run once immediately on startup
  runRetryBatch().catch(err =>
    logger.error("[ERP Retry Worker] Startup error:", err)
  );
}

export function stopErpRetryWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    logger.info("[ERP Retry Worker] Stopped");
  }
}
