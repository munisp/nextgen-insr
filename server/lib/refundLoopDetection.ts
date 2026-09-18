/**
 * refundLoopDetection.ts — AB-10: buy–cancel–refund gaming detection.
 *
 * F2 owns the cooling-off refund logic; this module is the F5 complement:
 * it watches cancel/refund FREQUENCY per policy and per customer and files
 * a fraud-queue alert (fraud_alerts) when velocity thresholds are tripped.
 * Detection is fire-and-forget by design at the call site — it must never
 * block or fail the cancellation itself, but the alert row is durable.
 */
import { and, eq, gte, sql } from "drizzle-orm";

import { fraudAlerts, policies, policyWorkflowEvents } from "../../drizzle/schema";

// Thresholds: N cancellation events within a rolling 30-day window.
export const REFUND_LOOP_POLICY_THRESHOLD = 2; // same policy cancelled+re-bought repeatedly
export const REFUND_LOOP_CUSTOMER_THRESHOLD = 3; // same customer cancelling across policies
export const REFUND_LOOP_WINDOW_DAYS = 30;

/**
 * Check cancel-refund frequency for the policy/customer and insert a fraud
 * alert when thresholds are exceeded. Returns the alert id when flagged.
 */
export async function flagRefundLoopIfAbusive(
  db: any,
  params: { policyId: number; tenantId?: number | null }
): Promise<{ flagged: boolean; policyCancels: number; customerCancels: number }> {
  const since = new Date(Date.now() - REFUND_LOOP_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [policy] = await db
    .select({ customerId: policies.customerId })
    .from(policies)
    .where(eq(policies.id, params.policyId))
    .limit(1);
  const customerId = policy?.customerId ?? null;

  // Cancellations of THIS policy in the window (re-buy + cancel looping).
  const policyRows = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(policyWorkflowEvents)
    .where(
      and(
        eq(policyWorkflowEvents.policyId, params.policyId),
        eq(policyWorkflowEvents.eventType, "policy.cancelled"),
        gte(policyWorkflowEvents.createdAt, since)
      )
    );
  const policyCancels = Number(policyRows[0]?.n ?? 0);

  // Cancellations across ALL of this customer's policies in the window.
  let customerCancels = 0;
  if (customerId != null) {
    const customerRows = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(policyWorkflowEvents)
      .innerJoin(policies, eq(policyWorkflowEvents.policyId, policies.id))
      .where(
        and(
          eq(policies.customerId, customerId),
          eq(policyWorkflowEvents.eventType, "policy.cancelled"),
          gte(policyWorkflowEvents.createdAt, since)
        )
      );
    customerCancels = Number(customerRows[0]?.n ?? 0);
  }

  const flagged =
    policyCancels >= REFUND_LOOP_POLICY_THRESHOLD ||
    customerCancels >= REFUND_LOOP_CUSTOMER_THRESHOLD;

  if (flagged) {
    await db.insert(fraudAlerts).values({
      severity: customerCancels >= REFUND_LOOP_CUSTOMER_THRESHOLD ? "high" : "medium",
      type: "refund_loop_velocity",
      reason:
        `Refund-loop velocity: policy ${params.policyId} cancelled ${policyCancels}x, ` +
        `customer ${customerId ?? "unknown"} cancelled ${customerCancels}x in ${REFUND_LOOP_WINDOW_DAYS}d`,
      fraudScore: "0.75",
      status: "open",
      tenantId: params.tenantId ?? null,
    });
  }

  return { flagged, policyCancels, customerCancels };
}
