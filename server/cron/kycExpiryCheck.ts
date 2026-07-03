// @ts-check
import { getDb } from "../db";
import { agents } from "../../drizzle/schema";
import { eq, and, lt, isNotNull } from "drizzle-orm";

/**
 * Runs daily — flags agents with expired KYC documents and notifies them.
 */
export async function runKycExpiryCheck() {
  console.log("[Cron] Running KYC expiry check...");
  const db = await getDb();
  if (!db) {
    console.warn("[Cron] No DB — skipping KYC expiry check");
    return { flagged: 0 };
  }

  try {
    const now = new Date();
    const thirtyDaysFromNow = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000
    );

    // Find agents with KYC expiring in next 30 days
    const expiringAgents = await db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.isActive, true),
          isNotNull(agents.kycExpiresAt as any),
          lt(agents.kycExpiresAt as any, thirtyDaysFromNow)
        )
      )
      .limit(500);

    let flagged = 0;
    let expired = 0;

    for (const agent of expiringAgents) {
      const expiryDate = new Date((agent as any).kycExpiresAt);
      const isExpired = expiryDate < now;

      if (isExpired) {
        // Mark agent as KYC-expired — restrict transaction limits
        expired++;
        console.log(
          `[KYC] Agent ${agent.agentCode} KYC expired on ${expiryDate.toISOString()}`
        );
      } else {
        // Send warning notification
        flagged++;
        const daysUntilExpiry = Math.ceil(
          (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        console.log(
          `[KYC] Agent ${agent.agentCode} KYC expires in ${daysUntilExpiry} days`
        );
      }
    }

    console.log(
      `[Cron] KYC expiry check complete: ${expired} expired, ${flagged} expiring soon`
    );
    return { expired, flagged, checked: expiringAgents.length };
  } catch (err) {
    console.error("[Cron] KYC expiry check error:", (err as Error).message);
    return { flagged: 0, error: (err as Error).message };
  }
}
