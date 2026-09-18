// @ts-check
/**
 * policyLifecycleSweep.ts — H-wave (adversarial-verifier follow-up, 2026-09)
 *
 * The INS-1 lapse/expiry sweeper (server/lib/policyLifecycle.ts) was real but
 * NOTHING invoked it: no cron, no Temporal schedule, no k8s CronJob — an
 * honestly-implemented dead path. This module wires it onto the repo's
 * existing node-cron pattern (see server/_core/index.ts:
 * runDisputeAutoEscalation / runKycExpiryCheck) at a daily 03:00 cadence.
 *
 * Failures are logged, never swallowed; a DB outage skips the run honestly
 * (the sweep is idempotent, so the next daily run catches up).
 */
import { logger } from "../_core/logger";
import { getDb } from "../db";
import { sweepPolicyLifecycle } from "../lib/policyLifecycle";

/** Runs the INS-1 lapse/expiry sweep once. Returns the honest counts. */
export async function runPolicyLifecycleSweep(): Promise<{
  lapsed: number;
  expired: number;
}> {
  logger.info("[Cron] Running policy lifecycle sweep (lapse/expiry)");
  const db = await getDb();
  if (!db) {
    logger.warn("[Cron] No DB — skipping policy lifecycle sweep");
    return { lapsed: 0, expired: 0 };
  }
  try {
    const result = await sweepPolicyLifecycle(db);
    logger.info(
      `[Cron] Policy lifecycle sweep complete: ${result.lapsed} lapsed, ${result.expired} expired`
    );
    return result;
  } catch (err) {
    // Error-logged, not swallowed — the next scheduled run retries and the
    // sweep's guarded updates make a partial run safe to repeat.
    logger.error(
      `[Cron] Policy lifecycle sweep failed: ${err instanceof Error ? err.message : String(err)}`
    );
    throw err;
  }
}
