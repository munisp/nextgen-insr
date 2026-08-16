// @ts-check
import { getDb } from "../db";
import { disputes } from "../../drizzle/schema";
import { eq, and, lt, isNull } from "drizzle-orm";
import { logger } from "../_core/logger";
import type { DisputeStatus } from "../lib/businessRulesEngine";

/**
 * Runs every 15 minutes — auto-escalates disputes that have exceeded their SLA deadline.
 */
export async function runDisputeAutoEscalation() {
  logger.info("[Cron] Running dispute auto-escalation");
  const db = await getDb();
  if (!db) {
    logger.warn("[Cron] No DB — skipping dispute escalation");
    return { escalated: 0 };
  }

  try {
    const { shouldAutoEscalate } = await import("../lib/businessRulesEngine");

    // Find open disputes past their SLA deadline
    const now = new Date();
    const overdueDisputes = await db
      .select()
      .from(disputes)
      .where(
        and(eq(disputes.status, "open" as any), lt(disputes.slaDeadlineAt, now))
      )
      .limit(100);

    let escalated = 0;
    for (const dispute of overdueDisputes) {
      // shouldAutoEscalate(currentStatus, lastUpdatedAt) evaluates escalation rules
      const escalationResult = shouldAutoEscalate(dispute.status as DisputeStatus, dispute.updatedAt ?? dispute.createdAt);

      if (escalationResult.shouldEscalate) {
        await db
          .update(disputes)
          .set({
            status: "escalated" as any,
            priority: "high" as any,
            updatedAt: now,
          })
          .where(eq(disputes.id, dispute.id));
        escalated++;
        logger.info({ disputeId: dispute.id, reason: escalationResult.reason }, "[Cron] Escalated dispute");
      }
    }

    logger.info({ escalated, checked: overdueDisputes.length }, "[Cron] Dispute auto-escalation complete");
    return { escalated, checked: overdueDisputes.length };
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[Cron] Dispute escalation error");
    return { escalated: 0, error: (err as Error).message };
  }
}
