/**
 * stpPolicy.ts — Q-wave Q2 (2026-09-25)
 *
 * DB-backed glue for the per-product STP tiers (claim_stp_tiers, migration
 * 0087) around the PURE policy functions in ./claimsJourneyPolicy.
 *
 * Fraud gate: scores come from the fraud-detection-go service through the
 * EXISTING Dapr client (server/daprClient.invokeFraudScore). Fail-closed:
 * any error/null from the fraud service yields fraudScore=null, which
 * resolveStpRoute routes to the staff adjudication queue — a fraud outage
 * can NEVER produce an auto-approval.
 */
import { eq, and } from "drizzle-orm";

import { getDb } from "../db";
import { claimStpTiers } from "../../drizzle/schema";
import { invokeFraudScore } from "../daprClient";
import {
  resolveStpRoute,
  type StpTierConfig,
  type StpRoute,
} from "./claimsJourneyPolicy";

export async function loadStpTiers(productId: number | null): Promise<StpTierConfig[]> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const rows = await db
    .select()
    .from(claimStpTiers)
    .where(
      productId == null
        ? eq(claimStpTiers.isActive, true)
        : and(eq(claimStpTiers.isActive, true), eq(claimStpTiers.productId, productId)),
    );
  return rows.map(r => ({
    productId: r.productId,
    tierName: r.tierName,
    autoApproveCap: Number(r.autoApproveCap),
    maxFraudScore: r.maxFraudScore == null ? null : Number(r.maxFraudScore),
    isActive: r.isActive,
  }));
}

/** True when the product has at least one active tier with a fraud bound. */
export async function fraudGateRequired(productId: number | null): Promise<boolean> {
  const tiers = await loadStpTiers(productId);
  return tiers.some(t => t.maxFraudScore != null);
}

/**
 * Score a claim through fraud-detection-go (existing Dapr client).
 * Returns null on ANY failure — callers must treat null as fail-closed.
 */
export async function scoreClaimFraud(input: {
  claimId: number;
  amount: number;
  customerId: number;
}): Promise<number | null> {
  try {
    const res = await invokeFraudScore(`claim-${input.claimId}`, {
      amount: input.amount,
      currency: "NGN",
      customerId: input.customerId,
      channel: "parametric",
    });
    if (res == null || typeof res.score !== "number" || !Number.isFinite(res.score)) {
      return null;
    }
    return res.score;
  } catch {
    return null; // fail-closed
  }
}

/** Convenience: load tiers + decide the STP route for a claim. */
export async function decideStpRoute(input: {
  productId: number | null;
  claimedAmount: number;
  initiatedByStaff: boolean;
  fraudScore: number | null;
}): Promise<StpRoute> {
  const tiers = await loadStpTiers(input.productId);
  return resolveStpRoute({
    claimedAmount: input.claimedAmount,
    initiatedByStaff: input.initiatedByStaff,
    tiers,
    productId: input.productId,
    fraudScore: input.fraudScore,
  });
}
