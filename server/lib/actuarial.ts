/**
 * actuarial.ts — F-11: pure actuarial pricing functions (v1).
 *
 * Every function here is pure and unit-testable: no I/O, no Date, no Math.
 * The router layer (server/routers/actuarialEngine.ts) is responsible for
 * sourcing REAL inputs from Postgres and for mapping the fail-loud errors
 * thrown here onto tRPC error codes. Nothing in this file fabricates data:
 * invalid or insufficient inputs THROW (ActuarialInputError) — the caller
 * decides how to surface the failure (documented per function).
 *
 * Method references:
 *   - Credibility: classical limited-fluctuation credibility. The full-
 *     credibility standard 1082 claims is the classical claim-count standard
 *     for being within ±5% of the true value with 90% probability under the
 *     Poisson frequency model:
 *       n0 = (z_{0.95} / 0.05)^2 = (1.645 / 0.05)^2 = 1082.41 ≈ 1082
 *     (see e.g. Klugman, Panjer & Willmot, "Loss Models", limited-fluctuation
 *     credibility; also the long-standing CAS/NAIC full-credibility standard
 *     of 1082 claims for 90%/±5%.)
 *   - Z = sqrt(n / 1082), capped at 1 (partial credibility square-root rule).
 *   - Indicated pure premium = Z*observed + (1-Z)*current (credibility blend).
 */

/** Full-credibility claim-count threshold (90% confidence, ±5% tolerance). */
export const FULL_CREDIBILITY_THRESHOLD = 1082;

/** Error type for invalid/insufficient actuarial inputs (fail-loud grammar). */
export class ActuarialInputError extends Error {
  readonly reason: "INSUFFICIENT_DATA" | "INVALID_INPUT";

  constructor(reason: "INSUFFICIENT_DATA" | "INVALID_INPUT", message: string) {
    super(message);
    this.name = "ActuarialInputError";
    this.reason = reason;
  }
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new ActuarialInputError(
      "INVALID_INPUT",
      `${name} must be a finite number, got ${String(value)}`
    );
  }
}

/**
 * Loss ratio = settled claims paid / earned premium.
 *
 * earnedPremium === 0: THROWS ActuarialInputError("INSUFFICIENT_DATA") —
 * a zero-premium period means there is no premium base to measure losses
 * against; returning 0 would fabricate a perfect loss ratio and returning
 * Infinity would fabricate a catastrophic one. The caller (router) maps this
 * to PRECONDITION_FAILED. Negative premium is INVALID_INPUT.
 */
export function lossRatio(
  settledClaimsPaid: number,
  earnedPremium: number
): number {
  assertFinite("settledClaimsPaid", settledClaimsPaid);
  assertFinite("earnedPremium", earnedPremium);
  if (settledClaimsPaid < 0) {
    throw new ActuarialInputError(
      "INVALID_INPUT",
      `settledClaimsPaid cannot be negative, got ${settledClaimsPaid}`
    );
  }
  if (earnedPremium < 0) {
    throw new ActuarialInputError(
      "INVALID_INPUT",
      `earnedPremium cannot be negative, got ${earnedPremium}`
    );
  }
  if (earnedPremium === 0) {
    throw new ActuarialInputError(
      "INSUFFICIENT_DATA",
      "earnedPremium is 0 — no premium base in period; a loss ratio cannot be computed honestly"
    );
  }
  return settledClaimsPaid / earnedPremium;
}

/**
 * Limited-fluctuation credibility factor Z = sqrt(n / 1082), capped at 1.
 * n = 0 → 0 (no data, no credibility — an honest 0, not a fabricated blend).
 * Negative claim counts are INVALID_INPUT.
 */
export function credibilityZ(claimCount: number): number {
  assertFinite("claimCount", claimCount);
  if (claimCount < 0) {
    throw new ActuarialInputError(
      "INVALID_INPUT",
      `claimCount cannot be negative, got ${claimCount}`
    );
  }
  const z = Math.sqrt(claimCount / FULL_CREDIBILITY_THRESHOLD);
  return Math.min(z, 1);
}

/**
 * Credibility-weighted indicated pure premium:
 *   indicated = Z*observed + (1-Z)*current
 * Z outside [0,1] or negative premiums are INVALID_INPUT.
 */
export function indicatedPurePremium(
  observed: number,
  current: number,
  z: number
): number {
  assertFinite("observed", observed);
  assertFinite("current", current);
  assertFinite("z", z);
  if (observed < 0 || current < 0) {
    throw new ActuarialInputError(
      "INVALID_INPUT",
      `pure premiums cannot be negative (observed=${observed}, current=${current})`
    );
  }
  if (z < 0 || z > 1) {
    throw new ActuarialInputError(
      "INVALID_INPUT",
      `credibility Z must be in [0, 1], got ${z}`
    );
  }
  return z * observed + (1 - z) * current;
}

export type RateAdequacy = "adequate" | "underpriced" | "overpriced";

/**
 * Rate adequacy vs a target loss ratio with a symmetric tolerance band:
 *   lossRatio >  target + tolerance  → 'underpriced' (losses too high for rate)
 *   lossRatio <  target - tolerance  → 'overpriced'
 *   otherwise                        → 'adequate'
 * Boundary values exactly at target ± tolerance are 'adequate' (inclusive band).
 */
export function rateAdequacy(
  lossRatioValue: number,
  targetLossRatio: number,
  tolerance: number
): RateAdequacy {
  assertFinite("lossRatio", lossRatioValue);
  assertFinite("targetLossRatio", targetLossRatio);
  assertFinite("tolerance", tolerance);
  if (tolerance < 0) {
    throw new ActuarialInputError(
      "INVALID_INPUT",
      `tolerance cannot be negative, got ${tolerance}`
    );
  }
  if (lossRatioValue > targetLossRatio + tolerance) return "underpriced";
  if (lossRatioValue < targetLossRatio - tolerance) return "overpriced";
  return "adequate";
}
