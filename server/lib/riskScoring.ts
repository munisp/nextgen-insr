/**
 * riskScoring.ts — server-side underwriting risk scoring (2026-10-02, A3)
 *
 * Trust boundary: an underwriting risk score must NEVER be caller-supplied.
 * A client self-certifying a low score is a direct premium-avoidance /
 * adverse-selection attack. This module computes the score deterministically
 * from server-fetchable inputs ONLY:
 *
 *   1. Claims history — COUNT of claims.claimantId = policy customer id
 *      (the memberQuotes.ts callerClaimsCount pattern, 2026-10-02 A1c: the
 *      count is always read from the DB, never accepted from the caller).
 *   2. Age — derived from the customers.dateOfBirth row resolved
 *      server-side. If the profile or DOB is missing/unparseable the age
 *      factor is EXCLUDED and the exclusion is recorded in `factors`
 *      (no fabricated default).
 *   3. Coverage type — high-hazard classes carry a fixed loading.
 *   4. Sum insured — banded loading on the policy's own numeric column.
 *
 * Properties:
 *   - Deterministic: no randomness, no wall-clock dependence except age
 *     derivation, no external calls, no ML stubs.
 *   - Fail-closed: any DB error propagates to the caller — a score is
 *     never invented when the lookups fail.
 *   - Auditable: every contributing input (and every excluded input)
 *     appears in `factors`.
 */

import { count, eq } from "drizzle-orm";

import { claims, customers } from "../../drizzle/schema";
import type { DrizzleDb } from "./memberGuards";

export type RiskBand = "low" | "medium" | "high" | "refer";

export interface RiskFactor {
  /** Which input drove (or failed to drive) this factor. */
  name: string;
  /** Human-readable detail, e.g. "claims_count=2 → +25". */
  detail: string;
  /** Points contributed to the score (0 for excluded inputs). */
  points: number;
}

export interface RiskScoreResult {
  /** 0–100, higher = riskier. */
  score: number;
  band: RiskBand;
  factors: RiskFactor[];
}

export interface RiskScoreInputs {
  /** Policyholder customer id (policies.customerId), resolved server-side. */
  customerId: number;
  /** policies.coverageType (may be null on legacy rows). */
  coverageType?: string | null;
  /** policies.sumInsured as a number (may be null). */
  sumInsured?: number | null;
}

/** Coverage classes with materially higher hazard (fixed loading). */
const HIGH_HAZARD_COVERAGE = new Set([
  "aviation",
  "marine",
  "liability",
  "credit",
]);

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function bandForScore(score: number): RiskBand {
  if (score < 30) return "low";
  if (score < 55) return "medium";
  if (score < 80) return "high";
  return "refer";
}

/**
 * Compute the underwriting risk score for a policy. Throws on DB failure
 * (fail-closed — the router surfaces an error rather than persisting a
 * fabricated score).
 */
export async function computeUnderwritingRiskScore(
  db: DrizzleDb,
  input: RiskScoreInputs
): Promise<RiskScoreResult> {
  const factors: RiskFactor[] = [];

  // ── Factor 1: claims history (real COUNT, DB-sourced) ────────────────────
  const [{ n: claimsCount }] = await db
    .select({ n: count() })
    .from(claims)
    .where(eq(claims.claimantId, input.customerId));
  const claimsN = Number(claimsCount);
  const claimsPoints =
    claimsN <= 0 ? 0 : claimsN === 1 ? 15 : claimsN === 2 ? 25 : 40;
  factors.push({
    name: "claims_history",
    detail: `claims_count=${claimsN} → +${claimsPoints}`,
    points: claimsPoints,
  });

  // ── Factor 2: age (from the server-resolved customer row; excluded if absent)
  const [customer] = await db
    .select({ dateOfBirth: customers.dateOfBirth })
    .from(customers)
    .where(eq(customers.id, input.customerId))
    .limit(1);
  const dobRaw = customer?.dateOfBirth ?? null;
  const dob = dobRaw ? new Date(dobRaw) : null;
  if (dob && !Number.isNaN(dob.getTime())) {
    const now = new Date();
    let age = now.getUTCFullYear() - dob.getUTCFullYear();
    const beforeBirthday =
      now.getUTCMonth() < dob.getUTCMonth() ||
      (now.getUTCMonth() === dob.getUTCMonth() &&
        now.getUTCDate() < dob.getUTCDate());
    if (beforeBirthday) age -= 1;
    if (age >= 0 && age <= 130) {
      const agePoints = age < 25 ? 15 : age > 60 ? 10 : 0;
      factors.push({
        name: "age",
        detail: `age=${age} → +${agePoints}`,
        points: agePoints,
      });
    } else {
      factors.push({
        name: "age",
        detail: `dateOfBirth '${dobRaw}' implausible (age=${age}) — excluded`,
        points: 0,
      });
    }
  } else {
    factors.push({
      name: "age",
      detail: customer
        ? "dateOfBirth missing/unparseable — excluded"
        : "no customer profile row — excluded",
      points: 0,
    });
  }

  // ── Factor 3: coverage type ───────────────────────────────────────────────
  if (input.coverageType) {
    const covPoints = HIGH_HAZARD_COVERAGE.has(input.coverageType) ? 10 : 0;
    factors.push({
      name: "coverage_type",
      detail: `coverage_type='${input.coverageType}' → +${covPoints}`,
      points: covPoints,
    });
  } else {
    factors.push({
      name: "coverage_type",
      detail: "coverage type missing — excluded",
      points: 0,
    });
  }

  // ── Factor 4: sum insured band ────────────────────────────────────────────
  if (input.sumInsured != null && Number.isFinite(input.sumInsured)) {
    const si = input.sumInsured;
    const siPoints = si > 10_000_000 ? 20 : si > 1_000_000 ? 10 : 0;
    factors.push({
      name: "sum_insured",
      detail: `sum_insured=${si} → +${siPoints}`,
      points: siPoints,
    });
  } else {
    factors.push({
      name: "sum_insured",
      detail: "sum insured missing — excluded",
      points: 0,
    });
  }

  const score = clampScore(factors.reduce((acc, f) => acc + f.points, 0));
  return { score, band: bandForScore(score), factors };
}
