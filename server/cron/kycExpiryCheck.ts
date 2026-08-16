// @ts-check
import { getDb } from "../db";
import { agents } from "../../drizzle/schema";
import { eq, and, lt, isNotNull } from "drizzle-orm";
import { logger } from "../_core/logger";

/**
 * Runs daily — flags agents with expired KYC documents and notifies them.
 */
export async function runKycExpiryCheck() {
  logger.warn("[Cron] KYC expiry tracking not configured (no schema column) — skipping");
  logger.info("[Cron] Running KYC expiry check");
  const db = await getDb();
  if (!db) {
    logger.warn("[Cron] No DB — skipping KYC expiry check");
    return { flagged: 0 };
  }

  try {
    const now = new Date();
    const thirtyDaysFromNow = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000
    );

    // DECISION-REQUIRED: no KYC expiry column is modeled in the schema (there is no
    // agents.kycExpiresAt and kycSessions has no expiresAt). The previous query
    // referenced a non-existent column and would have failed at runtime. Until a
    // column + migration is added, there is nothing to check.
    void thirtyDaysFromNow;
    const expiringAgents: Array<typeof agents.$inferSelect> = [];
    logger.warn("[Cron] KYC expiry column not modeled in schema — nothing to check");

    let flagged = 0;
    let expired = 0;

    for (const agent of expiringAgents) {
      const expiryDate = new Date((agent as any).kycExpiresAt);
      const isExpired = expiryDate < now;

      if (isExpired) {
        // Mark agent as KYC-expired — restrict transaction limits
        expired++;
        logger.warn({ agentId: agent.agentId, expiryDate: expiryDate.toISOString() }, "[KYC] Agent KYC expired");
      } else {
        // Send warning notification
        flagged++;
        const daysUntilExpiry = Math.ceil(
          (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        logger.info({ agentId: agent.agentId, daysUntilExpiry }, "[KYC] Agent KYC expiring soon");
      }
    }

    logger.info({ expired, flagged, checked: expiringAgents.length }, "[Cron] KYC expiry check complete");
    return { expired, flagged, checked: expiringAgents.length };
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[Cron] KYC expiry check error");
    return { flagged: 0, error: (err as Error).message };
  }
}
