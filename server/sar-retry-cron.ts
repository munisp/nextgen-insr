/**
 * sar-retry-cron.ts — SAR Retry Cron Job
 *
 * Runs every 15 minutes to retry pending SAR submissions to NFIU.
 * Uses pg_try_advisory_lock to prevent concurrent runs.
 * Processes in batches of 50 to avoid overwhelming NFIU API.
 * Exponential backoff per SAR: 100ms → 200ms → 400ms.
 * Fail-open: if NFIU is still down, SARs stay pending for next run.
 */
import { eq, and, inArray, lte } from "drizzle-orm";

import { getDb } from "./db";
import { publishToFluvio } from "./fluvio";
import { complianceFilings } from "../drizzle/schema";
import { writeAuditLog } from "./lib/auditLogger";

const NFIU_API_URL = process.env.NFIU_API_URL ?? "https://nfiu.gov.ng/api/v1";
const BATCH_SIZE = 50;
const MAX_RETRIES = 3;
const DLQ_THRESHOLD = 9; // After 9 total retries (3 cron runs × 3 attempts), route to DLQ
const BACKOFF_MS = 100;
const ADVISORY_LOCK_KEY = 7777001; // Unique key for SAR retry cron

interface SarFiling {
  id: number;
  referenceNumber: string;
  filingData: string | null;
  status: string;
  createdAt: Date | null;
}

async function submitToNfiu(sarData: {
  referenceNumber: string;
  filingData: Record<string, unknown>;
}): Promise<{ success: boolean; nfiuReference?: string; error?: string; isDuplicate?: boolean }> {
  try {
    const res = await fetch(`${NFIU_API_URL}/sar/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": process.env.NFIU_API_KEY ?? "nfiu-key",
        "X-Institution-Code": process.env.NFIU_INSTITUTION_CODE ?? "INSUREPORTAL",
      },
      body: JSON.stringify({
        sar_reference: sarData.referenceNumber,
        ...sarData.filingData,
        submission_date: new Date().toISOString(),
        is_retry: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 409) {
      return { success: false, isDuplicate: true, error: "SAR already submitted to NFIU" };
    }
    if (res.ok) {
      const data = await res.json() as { reference?: string };
      return { success: true, nfiuReference: data.reference };
    }
    return { success: false, error: `NFIU API ${res.status}` };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function processSar(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  filing: SarFiling
): Promise<{ submitted: boolean; skipped: boolean; error?: string }> {
  const filingData = JSON.parse(filing.filingData ?? "{}") as Record<string, unknown>;

  // Skip if already has NFIU reference (idempotency)
  if (filingData.nfiuReference) {
    await db.update(complianceFilings)
      .set({ status: "submitted" } as Record<string, unknown>)
      .where(eq(complianceFilings.id, filing.id));
    return { submitted: false, skipped: true };
  }

  let lastError: string | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await submitToNfiu({ referenceNumber: filing.referenceNumber, filingData });

    if (result.success) {
      await db.update(complianceFilings).set({
        status: "submitted",
        submittedAt: new Date(),
        filingData: JSON.stringify({ ...filingData, nfiuReference: result.nfiuReference, retryAttempts: attempt }),
      } as Record<string, unknown>).where(eq(complianceFilings.id, filing.id));
      return { submitted: true, skipped: false };
    }

    if (result.isDuplicate) {
      await db.update(complianceFilings).set({ status: "submitted", submittedAt: new Date() } as Record<string, unknown>)
        .where(eq(complianceFilings.id, filing.id));
      return { submitted: false, skipped: true };
    }

    lastError = result.error;
    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, BACKOFF_MS * Math.pow(2, attempt - 1)));
    }
  }

  // Update retry count in filing data
  await db.update(complianceFilings).set({
    filingData: JSON.stringify({
      ...filingData,
      lastError,
      retryCount: ((filingData.retryCount as number) ?? 0) + MAX_RETRIES,
      lastRetryAt: new Date().toISOString(),
    }),
  } as Record<string, unknown>).where(eq(complianceFilings.id, filing.id));

  return { submitted: false, skipped: false, error: lastError };
}

export async function runSarRetryCron(): Promise<{
  processed: number;
  submitted: number;
  failed: number;
  skipped: number;
  durationMs: number;
}> {
  const start = Date.now();
  const db = await getDb();
  if (!db) return { processed: 0, submitted: 0, failed: 0, skipped: 0, durationMs: 0 };

  // Acquire advisory lock to prevent concurrent runs
  const [lockResult] = await db.execute<{ pg_try_advisory_lock: boolean }>(
    `SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY})`
  ) as unknown as Array<{ pg_try_advisory_lock: boolean }>;

  if (!lockResult?.pg_try_advisory_lock) {
    console.log("[SAR-CRON] Another instance is running — skipping");
    return { processed: 0, submitted: 0, failed: 0, skipped: 0, durationMs: Date.now() - start };
  }

  let processed = 0, submitted = 0, failed = 0, skipped = 0;

  try {
    let offset = 0;
    while (true) {
      // Use the composite index: (filing_type, status, created_at) — cf_filingType_status_createdAt_idx
      const batch = await db.select().from(complianceFilings)
        .where(and(
          eq(complianceFilings.filingType, "SAR"),
          eq(complianceFilings.status, "pending"),
        ))
        .orderBy(complianceFilings.createdAt)
        .limit(BATCH_SIZE)
        .offset(offset);

      if (batch.length === 0) break;

      const results = await Promise.all(batch.map(f => processSar(db, f as SarFiling)));

      const batchSubmitted = results.filter(r => r.submitted).length;
      const batchFailed = results.filter(r => !r.submitted && !r.skipped).length;
      const batchSkipped = results.filter(r => r.skipped).length;

      processed += batch.length;
      submitted += batchSubmitted;
      failed += batchFailed;
      skipped += batchSkipped;

      // Only advance offset for failed/skipped (submitted ones are no longer pending)
      offset += batchFailed + batchSkipped;

      if (batch.length < BATCH_SIZE) break; // Last batch
    }

    const durationMs = Date.now() - start;
    console.log(`[SAR-CRON] Complete: ${submitted} submitted, ${failed} failed, ${skipped} skipped in ${durationMs}ms`);

    if (submitted > 0 || failed > 0) {
      await writeAuditLog({
        action: "SAR_RETRY_CRON",
        resource: "compliance",
        resourceId: "cron",
        metadata: { processed, submitted, failed, skipped, durationMs },
      });

      await publishToFluvio("aml.sar.retry.complete", {
        processed, submitted, failed, skipped, durationMs,
        timestamp: new Date().toISOString(),
      }).catch(() => {});
    }

    return { processed, submitted, failed, skipped, durationMs };
  } finally {
    // Always release the advisory lock
    await db.execute(`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`);
  }
}

// ── Schedule the cron job every 15 minutes ────────────────────────────────────
export function startSarRetryCronSchedule(): void {
  const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

  console.log("[SAR-CRON] Scheduled — runs every 15 minutes");

  // Run immediately on startup (catch any SARs from previous outage)
  runSarRetryCron().catch(err => console.error("[SAR-CRON] Startup run failed:", err));

  // Then run every 15 minutes
  setInterval(() => {
    runSarRetryCron().catch(err => console.error("[SAR-CRON] Scheduled run failed:", err));
  }, INTERVAL_MS);
}
