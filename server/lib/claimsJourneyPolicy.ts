/**
 * claimsJourneyPolicy.ts — M-wave (W1, 2026-09-19)
 *
 * PURE module (no imports, no side effects) so it is safe to bundle into
 * Temporal workflow code AND to import from activities/routers/tests.
 *
 * Journey claims auto-adjudication policy:
 *   - Temporal journeys may auto-adjudicate ONLY small claims. ₦200,000
 *     matches the repo's existing small-claim convention (cvClaims
 *     assessDamage used the same 200_000 threshold for its — now removed —
 *     auto-approve flip).
 *   - Above the cap, or whenever the journey was NOT initiated by staff,
 *     the claim routes to the staff adjudication queue
 *     (status pending_adjudication), where the hardened router path
 *     (insuranceWorkflows.adjudicateClaim / settleClaimPayment with
 *     segregation of duties) owns it.
 */

export const J03_AUTO_ADJUDICATION_CAP_NGN = 200_000;

/**
 * Routing decision for the J03 claims journey. Auto-adjudication requires a
 * STAFF-initiated journey AND an amount within the auto tier; anything else
 * lands in the staff queue (fail-closed: non-finite amounts queue too).
 */
export function resolveJ03AdjudicationRoute(
  claimedAmount: number,
  initiatedByStaff: boolean,
): "auto" | "staff_queue" {
  if (!initiatedByStaff) return "staff_queue";
  if (!Number.isFinite(claimedAmount) || claimedAmount > J03_AUTO_ADJUDICATION_CAP_NGN) {
    return "staff_queue";
  }
  return "auto";
}

// ─── Q-wave Q2 (2026-09-25): configurable per-product STP tiers ─────────────
// Contract change (dated): auto-adjudication caps are now configurable PER
// PRODUCT/TIER via the claim_stp_tiers table (migration 0087). This module
// stays PURE (Temporal-bundle-safe): the DB read lives in
// server/lib/stpPolicy.ts, which passes the tier rows in here.
//   - No tier row for a product ⇒ J03_AUTO_ADJUDICATION_CAP_NGN (₦200,000)
//     applies unchanged (the default is preserved, not weakened).
//   - A tier may carry maxFraudScore: when set, the fraud gate is REQUIRED —
//     a missing/errored fraud score is NEVER auto-approved (fail-closed to
//     the staff queue).
export interface StpTierConfig {
  productId: number | null;
  tierName: string;
  autoApproveCap: number;
  maxFraudScore: number | null;
  isActive: boolean;
}

export type StpRoute = "auto" | "staff_queue";

/**
 * Resolve the effective auto-approve cap for a product: the highest active
 * tier cap for that product, else the platform default ₦200,000.
 */
export function resolveStpCap(
  tiers: readonly StpTierConfig[],
  productId: number | null,
): number {
  const caps = tiers
    .filter(t => t.isActive && t.productId === productId)
    .map(t => t.autoApproveCap)
    .filter(c => Number.isFinite(c) && c > 0);
  if (caps.length === 0) return J03_AUTO_ADJUDICATION_CAP_NGN;
  return Math.max(...caps);
}

/**
 * Full STP routing decision. Auto-approval requires:
 *   1. staff-initiated (or server-trusted system context, e.g. a verified
 *      parametric event — callers pass initiatedByStaff=true only when the
 *      initiation is server-side);
 *   2. amount within the effective product cap (see resolveStpCap);
 *   3. when ANY active tier for the product sets maxFraudScore, a REAL fraud
 *      score ≤ that bound. fraudScore === null means "fraud service
 *      unavailable/unscored" and fails CLOSED to the staff queue.
 */
export function resolveStpRoute(input: {
  claimedAmount: number;
  initiatedByStaff: boolean;
  tiers: readonly StpTierConfig[];
  productId: number | null;
  fraudScore: number | null;
}): StpRoute {
  if (!input.initiatedByStaff) return "staff_queue";
  if (!Number.isFinite(input.claimedAmount) || input.claimedAmount <= 0) {
    return "staff_queue";
  }
  const cap = resolveStpCap(input.tiers, input.productId);
  if (input.claimedAmount > cap) return "staff_queue";
  const gated = input.tiers.filter(
    t => t.isActive && t.productId === input.productId && t.maxFraudScore != null,
  );
  if (gated.length > 0) {
    if (input.fraudScore == null || !Number.isFinite(input.fraudScore)) {
      return "staff_queue"; // fraud service down → never auto-approve
    }
    const bound = Math.min(...gated.map(t => t.maxFraudScore!));
    if (input.fraudScore > bound) return "staff_queue";
  }
  return "auto";
}
