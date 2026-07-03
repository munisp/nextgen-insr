// @ts-check
import { getDb } from "../db";
import { disputes } from "../../drizzle/schema";
import { eq, and, lt, isNull } from "drizzle-orm";

/**
 * Runs every 15 minutes — auto-escalates disputes that have exceeded their SLA deadline.
 */
export async function runDisputeAutoEscalation() {
  console.log("[Cron] Running dispute auto-escalation...");
  const db = await getDb();
  if (!db) {
    console.warn("[Cron] No DB — skipping dispute escalation");
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
      const hoursOpen =
        (now.getTime() - new Date(dispute.createdAt).getTime()) /
        (1000 * 60 * 60);
      const amount = Number(dispute.amount ?? 0);
      const escalationResult = shouldAutoEscalate(
        hoursOpen,
        amount,
        (dispute.priority as any) ?? "medium",
        0 // responseCount — would need to query messages
      );

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
        console.log(
          `[Cron] Escalated dispute #${dispute.id}: ${escalationResult.reasons.join(", ")}`
        );
      }
    }

    console.log(
      `[Cron] Dispute auto-escalation complete: ${escalated}/${overdueDisputes.length} escalated`
    );
    return { escalated, checked: overdueDisputes.length };
  } catch (err) {
    console.error("[Cron] Dispute escalation error:", (err as Error).message);
    return { escalated: 0, error: (err as Error).message };
  }
}
