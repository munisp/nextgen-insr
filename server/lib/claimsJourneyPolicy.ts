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
