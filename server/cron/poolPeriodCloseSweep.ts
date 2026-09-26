/**
 * poolPeriodCloseSweep.ts — Q-wave Q3 (2026-09-25).
 *
 * Repo-precedent scheduling: node-cron in server/_core/index.ts (same
 * pattern as runDisputeAutoEscalation / runKycExpiryCheck /
 * runPolicyLifecycleSweep; Temporal workers exist but the in-process
 * node-cron pattern is what this repo uses for DB sweeps).
 *
 * Two idempotent jobs:
 *   1. Usage-cover expiry sweep (hourly): flips active activations past
 *      expiresAt to "expired" via a guarded UPDATE (safe to re-run).
 *   2. Pool period-close sweep (daily 04:00): closes pool periods whose
 *      periodEnd has passed and that have no closed pool_periods row yet,
 *      using the SAME engine (server/lib/poolSurplus.ts) as the staff
 *      closePoolPeriod endpoint — reserve bps default, p2p_refund mode.
 *      It only CLOSES + computes; distribution still requires the
 *      dual-control staff lifecycle (propose → approve → execute).
 *
 * Failures are logged, never swallowed; both jobs are idempotent so the
 * next tick catches up after an outage.
 */
import { and, eq, lt, sql } from "drizzle-orm";

import { p2pPools, poolPeriods } from "../../drizzle/schema.innovations";
import { logger } from "../_core/logger";
import { getDb } from "../db";
import { computePeriodClose, persistPeriodClose } from "../lib/poolSurplus";
import { expireDueUsageCover } from "../routers/innovationRouters";

/** Hourly: expire due usage-cover activations. Returns the count flipped. */
export async function runUsageCoverExpirySweep(): Promise<{ expired: number }> {
  const db = await getDb();
  if (!db) {
    logger.warn("[Cron] No DB — skipping usage-cover expiry sweep");
    return { expired: 0 };
  }
  try {
    const expired = await expireDueUsageCover(db);
    if (expired > 0) logger.info(`[Cron] Usage-cover expiry sweep: ${expired} expired`);
    return { expired };
  } catch (err) {
    logger.error(
      `[Cron] Usage-cover expiry sweep failed: ${err instanceof Error ? err.message : String(err)}`
    );
    throw err;
  }
}

/**
 * Daily: close due pool periods (periodEnd < today, no closed row). Returns
 * honest counts. A pool whose accounting computation throws (e.g. negative
 * balance drift) is skipped with an error log — fail-closed, never closed
 * on broken numbers.
 */
export async function runPoolPeriodCloseSweep(): Promise<{ closed: number; skipped: number }> {
  const db = await getDb();
  if (!db) {
    logger.warn("[Cron] No DB — skipping pool period-close sweep");
    return { closed: 0, skipped: 0 };
  }
  const today = new Date().toISOString().slice(0, 10);
  const duePools = await db
    .select()
    .from(p2pPools)
    .where(and(
      lt(sql`${p2pPools.periodEnd}::date`, today),
      sql`${p2pPools.status} IN ('forming','active')`,
    ))
    .limit(50);

  let closed = 0;
  let skipped = 0;
  for (const pool of duePools) {
    const [existing] = await db
      .select({ id: poolPeriods.id })
      .from(poolPeriods)
      .where(and(eq(poolPeriods.poolId, pool.id), eq(poolPeriods.periodStart, pool.periodStart)))
      .limit(1);
    if (existing) continue; // already closed — idempotent skip
    try {
      const comp = await computePeriodClose(db, {
        poolId: pool.id,
        periodStart: pool.periodStart,
        periodEnd: pool.periodEnd,
      });
      await persistPeriodClose(db, comp, null); // system close — no user
      closed++;
    } catch (err) {
      skipped++;
      logger.error(
        `[Cron] Pool ${pool.id} period close failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  if (closed > 0 || skipped > 0) {
    logger.info(`[Cron] Pool period-close sweep: ${closed} closed, ${skipped} skipped`);
  }
  return { closed, skipped };
}
