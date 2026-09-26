/**
 * parametricEngine.ts — Q-wave Q2 (2026-09-25)
 *
 * Parametric Trigger Engine (Pula/Neptune/AXA-heatwave/ZhongAn auto-payout
 * model) + straight-through claims (Lemonade/Curacel STP model), built on
 * EXISTING components:
 *   - datasource adapters: server/lib/parametricDatasources (fail-closed)
 *   - STP tiers: server/lib/claimsJourneyPolicy + server/lib/stpPolicy
 *     (₦200k default preserved, fraud gate fail-closed via fraud-detection-go)
 *   - settlement: journey-activities.settleClaimPayment — the EXISTING payout
 *     path (TigerBeetle via tbClient, claims_payments amount == adjudicated
 *     approvedAmount, beneficiary-OF-RECORD enforced, fail-closed)
 *   - manual review: journey-activities.routeClaimToAdjudicationQueue
 *     (pending_adjudication, migration 0084)
 *   - audit: audit_log inserts (same helper discipline as journey-activities)
 *
 * Idempotency: parametric_events.event_key is UNIQUE — one row per trigger
 * per evaluation window; a duplicate evaluation returns the recorded event
 * and never double-pays. parametric_payout_settlements (event_id, claim_id)
 * is UNIQUE as a second line of defence.
 */
import { createHash } from "crypto";

import { eq, and, desc, lte, or, gte, isNull } from "drizzle-orm";

import { getDb } from "../db";
import {
  auditLog,
  claims,
  claimWorkflowEvents,
  parametricEvents,
  parametricManualReadings,
  parametricPayoutSettlements,
  parametricProducts,
  parametricTriggerDefinitions,
  policies,
} from "../../drizzle/schema";
import {
  routeClaimToAdjudicationQueue,
  settleClaimPayment,
} from "../journey-activities";
import {
  datasourceConfigSchema,
  DatasourceUnavailableError,
  fetchHttpReading,
  thresholdBreached,
  validateManualReading,
} from "./parametricDatasources";
import { decideStpRoute, fraudGateRequired, scoreClaimFraud } from "./stpPolicy";

// ── Small helpers (same fail-open discipline as journey-activities) ─────────
async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database unavailable");
  return d;
}

async function audit(
  action: string,
  resource: string,
  resourceId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const d = await getDb();
    if (d) {
      await d.insert(auditLog).values({
        action,
        resource,
        resourceId,
        status: "success",
        metadata: metadata ?? null,
      });
    }
  } catch { /* fail-open */ }
}

/** Deterministic evaluation-window key: one event per trigger per window. */
export function evaluationWindowKey(
  triggerId: number,
  windowSeconds: number,
  nowMs = Date.now(),
): string {
  const start = Math.floor(nowMs / (windowSeconds * 1000)) * windowSeconds;
  return `trigger-${triggerId}:window-${start}`;
}

export interface EvaluationResult {
  eventId: number;
  eventKey: string;
  status: "fired" | "not_fired" | "data_unavailable";
  measuredValue: number | null;
  idempotent: boolean;
  payouts: { claimId: number; outcome: "paid" | "pending_adjudication" }[];
}

// ── Reading resolution ───────────────────────────────────────────────────────
async function resolveReading(trigger: {
  id: number;
  metric: string;
  windowSeconds: number;
  datasourceConfig: unknown;
}): Promise<{ value: number; payloadHash: string; payload: unknown; datasourceType: string }> {
  const config = datasourceConfigSchema.parse(trigger.datasourceConfig);
  if (config.type === "http") {
    const { reading, payloadHash, raw } = await fetchHttpReading(
      config,
      trigger.metric,
      trigger.windowSeconds,
    );
    return { value: reading.value, payloadHash, payload: raw, datasourceType: "http" };
  }
  // manual: latest CONFIRMED dual-control reading for this trigger
  const d = await db();
  const [reading] = await d
    .select()
    .from(parametricManualReadings)
    .where(eq(parametricManualReadings.triggerId, trigger.id))
    .orderBy(desc(parametricManualReadings.id))
    .limit(1);
  if (!reading) {
    throw new DatasourceUnavailableError(
      `no manual reading recorded for trigger ${trigger.id}`,
      "unconfirmed",
    );
  }
  const validated = validateManualReading(
    {
      metric: reading.metric,
      value: Number(reading.value),
      observedAt: reading.observedAt.toISOString(),
    },
    trigger.metric,
    trigger.windowSeconds,
    reading.confirmedBy,
    reading.attestedBy,
  );
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ id: reading.id, v: validated.value, at: validated.observedAt }))
    .digest("hex");
  return {
    value: validated.value,
    payloadHash,
    payload: { manualReadingId: reading.id, attestedBy: reading.attestedBy, confirmedBy: reading.confirmedBy },
    datasourceType: "manual",
  };
}

// ── Claim creation for in-force parametric policies ─────────────────────────
async function createParametricClaim(input: {
  eventId: number;
  product: { triggerId: number; productId: number; payoutAmount: string; coveredPeril: string };
  policyId: number;
  claimantId: number;
  incidentDate: Date;
  description: string;
}): Promise<number> {
  const d = await db();
  const claimNumber = `PARAM-${input.eventId}-${input.policyId}`;
  // Retry-safe: the claim number is deterministic per (event, policy).
  const [existing] = await d.select({ id: claims.id }).from(claims)
    .where(eq(claims.claimNumber, claimNumber)).limit(1);
  if (existing) return existing.id;
  const [claim] = await d.insert(claims).values({
    claimNumber,
    policyId: input.policyId,
    claimantId: input.claimantId,
    status: "submitted",
    claimType: input.product.coveredPeril,
    incidentDate: input.incidentDate,
    claimedAmount: input.product.payoutAmount,
    incidentDescription: input.description,
    metadata: {
      parametricEventId: input.eventId,
      parametricTriggerId: input.product.triggerId,
      parametricProductId: input.product.productId,
    },
  }).returning({ id: claims.id });
  await d.insert(claimWorkflowEvents).values({
    claimId: claim.id,
    eventType: "claim.submitted",
    toStatus: "submitted",
    triggeredBy: null,
    payload: { source: "parametric_engine", eventId: input.eventId },
  });
  return claim.id;
}

/** Server-side approval (system context) honoring the product STP cap. */
async function autoApproveClaim(input: {
  claimId: number;
  approvedAmount: number;
  eventId: number;
}): Promise<void> {
  const d = await db();
  await d.update(claims).set({
    status: "approved",
    approvedAmount: String(input.approvedAmount),
    updatedAt: new Date(),
  }).where(and(eq(claims.id, input.claimId), eq(claims.status, "submitted")));
  await d.insert(claimWorkflowEvents).values({
    claimId: input.claimId,
    eventType: "claim.approved",
    fromStatus: "submitted",
    toStatus: "approved",
    triggeredBy: null,
    payload: {
      approvedAmount: input.approvedAmount,
      source: "parametric_engine",
      eventId: input.eventId,
    },
  });
}

// ── Payout processing for a fired event ──────────────────────────────────────
async function processEventPayouts(event: {
  id: number;
  triggerId: number;
  createdAt: Date;
}): Promise<{ claimId: number; outcome: "paid" | "pending_adjudication" }[]> {
  const d = await db();
  const results: { claimId: number; outcome: "paid" | "pending_adjudication" }[] = [];

  const products = await d.select().from(parametricProducts).where(
    and(
      eq(parametricProducts.triggerId, event.triggerId),
      eq(parametricProducts.status, "active"),
    ),
  );

  for (const product of products) {
    const payoutAmount = Number(product.payoutAmount);
    if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) continue;

    // In-force policies for the mapped product.
    const now = new Date();
    const inForce = await d.select({
      id: policies.id,
      customerId: policies.customerId,
    }).from(policies).where(and(
      eq(policies.productId, product.productId),
      eq(policies.status, "active"),
      or(isNull(policies.startDate), lte(policies.startDate, now)),
      or(isNull(policies.endDate), gte(policies.endDate, now)),
    ));

    for (const policy of inForce) {
      const claimId = await createParametricClaim({
        eventId: event.id,
        product,
        policyId: policy.id,
        claimantId: policy.customerId,
        incidentDate: event.createdAt,
        description: `Parametric event ${event.id} (trigger ${event.triggerId}) fired — fixed payout for covered peril '${product.coveredPeril}'`,
      });

      // One settlement row per (event, claim) — unique, so a replayed fire
      // finds the recorded outcome instead of paying twice.
      const [existingSettlement] = await d.select().from(parametricPayoutSettlements)
        .where(and(
          eq(parametricPayoutSettlements.eventId, event.id),
          eq(parametricPayoutSettlements.claimId, claimId),
        )).limit(1);
      if (existingSettlement) {
        results.push({
          claimId,
          outcome: existingSettlement.status === "paid" ? "paid" : "pending_adjudication",
        });
        continue;
      }

      // STP decision: per-product tier cap + fraud gate (fail-closed).
      const gate = await fraudGateRequired(product.productId);
      const fraudScore = gate
        ? await scoreClaimFraud({ claimId, amount: payoutAmount, customerId: policy.customerId })
        : null;
      const route = await decideStpRoute({
        productId: product.productId,
        claimedAmount: payoutAmount,
        initiatedByStaff: true, // server system context (verified parametric event)
        fraudScore,
      });

      if (route === "auto") {
        try {
          await autoApproveClaim({ claimId, approvedAmount: payoutAmount, eventId: event.id });
          // EXISTING payout path: amount == adjudicated approvedAmount,
          // beneficiary-of-record enforced inside (fail-closed).
          const settled = await settleClaimPayment({
            claimId,
            approvedAmount: payoutAmount,
            paymentMethod: "parametric_auto",
            paymentRef: `PARAM-SETTLE-${event.id}-${claimId}`,
          });
          await d.insert(parametricPayoutSettlements).values({
            eventId: event.id,
            claimId,
            paymentId: settled.paymentId,
            amount: String(payoutAmount),
            status: "paid",
          });
          await audit("PARAMETRIC_CLAIM_AUTOPAID", "claims", String(claimId), {
            eventId: event.id,
            amount: payoutAmount,
            tbTransferId: settled.tbTransferId,
            fraudScore,
          });
          results.push({ claimId, outcome: "paid" });
          continue;
        } catch (err) {
          // Fail-closed: never leave a half-settled auto path — hand to staff.
          await routeClaimToAdjudicationQueue({
            claimId,
            reason: `parametric auto-payout failed closed: ${(err as Error).message}`,
          });
          await d.insert(parametricPayoutSettlements).values({
            eventId: event.id,
            claimId,
            amount: String(payoutAmount),
            status: "pending_adjudication",
          });
          await audit("PARAMETRIC_CLAIM_ROUTED", "claims", String(claimId), {
            eventId: event.id,
            reason: (err as Error).message,
          });
          results.push({ claimId, outcome: "pending_adjudication" });
          continue;
        }
      }

      // STP declined (above product cap / fraud gate) → manual review queue.
      await routeClaimToAdjudicationQueue({
        claimId,
        reason: gate && fraudScore == null
          ? "parametric STP fail-closed: fraud scoring unavailable"
          : "parametric STP: exceeds auto-adjudication tier or fraud bound",
      });
      await d.insert(parametricPayoutSettlements).values({
        eventId: event.id,
        claimId,
        amount: String(payoutAmount),
        status: "pending_adjudication",
      });
      await audit("PARAMETRIC_CLAIM_ROUTED", "claims", String(claimId), {
        eventId: event.id,
        reason: "stp_staff_queue",
        fraudScore,
      });
      results.push({ claimId, outcome: "pending_adjudication" });
    }
  }
  return results;
}

// ── Main evaluation entry (scheduler-invoked and admin-triggered) ───────────
export async function evaluateTrigger(triggerId: number): Promise<EvaluationResult> {
  const d = await db();
  const [trigger] = await d.select().from(parametricTriggerDefinitions)
    .where(eq(parametricTriggerDefinitions.id, triggerId)).limit(1);
  if (!trigger) throw new Error(`parametric trigger ${triggerId} not found`);
  if (trigger.status !== "active") {
    throw new Error(`parametric trigger ${triggerId} is not active (status=${trigger.status})`);
  }

  const eventKey = evaluationWindowKey(trigger.id, trigger.windowSeconds);

  // Idempotency: one evaluation per trigger per window.
  const [existing] = await d.select().from(parametricEvents)
    .where(eq(parametricEvents.eventKey, eventKey)).limit(1);
  if (existing) {
    return {
      eventId: existing.id,
      eventKey,
      status: existing.status as EvaluationResult["status"],
      measuredValue: existing.measuredValue == null ? null : Number(existing.measuredValue),
      idempotent: true,
      payouts: existing.status === "fired" ? await processEventPayouts(existing) : [],
    };
  }

  let reading: { value: number; payloadHash: string; payload: unknown; datasourceType: string };
  try {
    reading = await resolveReading(trigger);
  } catch (err) {
    if (!(err instanceof DatasourceUnavailableError)) throw err;
    // FAIL-CLOSED: unreachable/unparseable/stale data ⇒ NO payout. The event
    // is recorded data_unavailable and in-force policyholders' claims are
    // routed to the manual review queue (pending_adjudication, 0084).
    const [event] = await d.insert(parametricEvents).values({
      eventKey,
      triggerId: trigger.id,
      measuredValue: null,
      payloadHash: null,
      payload: { error: err.message, reason: err.reason },
      datasourceType: "unknown",
      status: "data_unavailable",
    }).returning();
    await audit("PARAMETRIC_DATA_UNAVAILABLE", "parametric_events", String(event.id), {
      triggerId: trigger.id,
      reason: err.reason,
      error: err.message,
    });

    const products = await d.select().from(parametricProducts).where(and(
      eq(parametricProducts.triggerId, trigger.id),
      eq(parametricProducts.status, "active"),
    ));
    const payouts: EvaluationResult["payouts"] = [];
    const now = new Date();
    for (const product of products) {
      const inForce = await d.select({ id: policies.id, customerId: policies.customerId })
        .from(policies).where(and(
          eq(policies.productId, product.productId),
          eq(policies.status, "active"),
          or(isNull(policies.startDate), lte(policies.startDate, now)),
          or(isNull(policies.endDate), gte(policies.endDate, now)),
        ));
      for (const policy of inForce) {
        const claimId = await createParametricClaim({
          eventId: event.id,
          product,
          policyId: policy.id,
          claimantId: policy.customerId,
          incidentDate: event.createdAt,
          description: `Parametric trigger ${trigger.id} evaluation could not obtain evidence (${err.reason}) — routed to manual review`,
        });
        await routeClaimToAdjudicationQueue({
          claimId,
          reason: `parametric datasource ${err.reason}: no payout without evidence (fail-closed)`,
        });
        await d.insert(parametricPayoutSettlements).values({
          eventId: event.id,
          claimId,
          amount: product.payoutAmount,
          status: "pending_adjudication",
        }).onConflictDoNothing();
        payouts.push({ claimId, outcome: "pending_adjudication" });
      }
    }
    return {
      eventId: event.id,
      eventKey,
      status: "data_unavailable",
      measuredValue: null,
      idempotent: false,
      payouts,
    };
  }

  const fired = thresholdBreached(trigger.operator, reading.value, Number(trigger.threshold));
  const [event] = await d.insert(parametricEvents).values({
    eventKey,
    triggerId: trigger.id,
    measuredValue: String(reading.value),
    payloadHash: reading.payloadHash,
    payload: reading.payload as Record<string, unknown>,
    datasourceType: reading.datasourceType,
    status: fired ? "fired" : "not_fired",
  }).returning();
  await audit(
    fired ? "PARAMETRIC_TRIGGER_FIRED" : "PARAMETRIC_TRIGGER_EVALUATED",
    "parametric_events",
    String(event.id),
    {
      triggerId: trigger.id,
      measuredValue: reading.value,
      threshold: Number(trigger.threshold),
      operator: trigger.operator,
      payloadHash: reading.payloadHash,
    },
  );

  const payouts = fired ? await processEventPayouts(event) : [];
  return {
    eventId: event.id,
    eventKey,
    status: event.status as EvaluationResult["status"],
    measuredValue: reading.value,
    idempotent: false,
    payouts,
  };
}

/** Evaluate every active trigger once (one scheduler tick). */
export async function evaluateAllActiveTriggers(): Promise<{
  evaluated: number;
  errors: { triggerId: number; error: string }[];
}> {
  const d = await db();
  const active = await d.select({ id: parametricTriggerDefinitions.id })
    .from(parametricTriggerDefinitions)
    .where(eq(parametricTriggerDefinitions.status, "active"))
    .limit(500); // bounded batch; remainder runs on the next tick
  const errors: { triggerId: number; error: string }[] = [];
  let evaluated = 0;
  for (const t of active) {
    try {
      await evaluateTrigger(t.id);
      evaluated++;
    } catch (err) {
      errors.push({ triggerId: t.id, error: (err as Error).message });
    }
  }
  return { evaluated, errors };
}
