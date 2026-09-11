/**
 * claimRiskScorer.ts — B11: honest in-repo statistical claim-risk scorer.
 *
 * modelType: 'heuristic-v1'. This is a TRANSPARENT WEIGHTED FORMULA over
 * documented real features — it is NOT a trained ML model and is never
 * presented as one. There is no randomness anywhere in this module.
 *
 * Features (all sourced from real rows in claims / policies):
 *   amountToPremiumRatio  claims."claimedAmount" / policies."annualPremium",
 *                         normalised as min(ratio / 3, 1) — a claim at or
 *                         above 3x the annual premium is max-signal.
 *   claimantHistoryCount  number of claims by the same claimantId (including
 *                         the scored claim), normalised as min(count / 5, 1).
 *   policyAgeDays         days from policies."startDate" to the claim's
 *                         reportedDate (younger policy = riskier), normalised
 *                         as max(0, 1 - ageDays / 365); missing startDate
 *                         yields 0 (cannot establish youth).
 *   priorFraudFlag        1 if ANY claim by this claimant (including this
 *                         one) has "isFraudSuspected" = true, else 0.
 *
 * Score = Σ weight_i × feature_i, clamped to [0, 1]. Weights come from
 * system_config key 'mlScoring.claimRisk.weights' (seeded with documented
 * defaults by migration 0059); loading FAILS LOUD when the key is absent or
 * malformed — no hidden magic constants.
 *
 * Risk bands: score < 0.33 → 'low', < 0.66 → 'medium', else 'high'.
 */
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { systemConfig } from "../../drizzle/schema";

export const MODEL_TYPE = "heuristic-v1" as const;
export const WEIGHTS_CONFIG_KEY = "mlScoring.claimRisk.weights";

export interface ClaimRiskRawFeatures {
  /** claims."claimedAmount" / policies."annualPremium" (unbounded ratio). */
  amountToPremiumRatio: number;
  /** Claims by the same claimantId including the scored claim. */
  claimantHistoryCount: number;
  /** Days from policies."startDate" to claims."reportedDate"; null if unknown. */
  policyAgeDays: number | null;
  /** Any claim by this claimant flagged isFraudSuspected (incl. this one). */
  priorFraudFlag: boolean;
}

export type ClaimRiskWeights = {
  [K in keyof ClaimRiskRawFeatures]: number;
};

export interface ClaimRiskFeatureBreakdown {
  features: {
    amountToPremiumRatio: { raw: number; normalized: number; weight: number; contribution: number };
    claimantHistoryCount: { raw: number; normalized: number; weight: number; contribution: number };
    policyAgeDays: { raw: number | null; normalized: number; weight: number; contribution: number };
    priorFraudFlag: { raw: boolean; normalized: number; weight: number; contribution: number };
  };
  modelType: typeof MODEL_TYPE;
  formula: string;
}

export interface ClaimRiskScore {
  score: number;
  riskBand: "low" | "medium" | "high";
  modelType: typeof MODEL_TYPE;
  featureBreakdown: ClaimRiskFeatureBreakdown;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Documented normalisers (see module header). Pure — no randomness. */
export function normalizeFeatures(raw: ClaimRiskRawFeatures) {
  return {
    amountToPremiumRatio: clamp01(raw.amountToPremiumRatio / 3),
    claimantHistoryCount: clamp01(raw.claimantHistoryCount / 5),
    policyAgeDays:
      raw.policyAgeDays === null ? 0 : clamp01(1 - raw.policyAgeDays / 365),
    priorFraudFlag: raw.priorFraudFlag ? 1 : 0,
  };
}

/** Pure weighted-formula scorer. Deterministic by construction. */
export function computeClaimRiskScore(
  raw: ClaimRiskRawFeatures,
  weights: ClaimRiskWeights
): ClaimRiskScore {
  const n = normalizeFeatures(raw);
  const contributions = {
    amountToPremiumRatio: weights.amountToPremiumRatio * n.amountToPremiumRatio,
    claimantHistoryCount: weights.claimantHistoryCount * n.claimantHistoryCount,
    policyAgeDays: weights.policyAgeDays * n.policyAgeDays,
    priorFraudFlag: weights.priorFraudFlag * n.priorFraudFlag,
  };
  const score = clamp01(
    contributions.amountToPremiumRatio +
      contributions.claimantHistoryCount +
      contributions.policyAgeDays +
      contributions.priorFraudFlag
  );
  const riskBand = score < 0.33 ? "low" : score < 0.66 ? "medium" : "high";
  return {
    score,
    riskBand,
    modelType: MODEL_TYPE,
    featureBreakdown: {
      modelType: MODEL_TYPE,
      formula:
        "score = w_ratio*min(ratio/3,1) + w_history*min(count/5,1) + w_age*max(0,1-ageDays/365) + w_fraud*flag",
      features: {
        amountToPremiumRatio: {
          raw: raw.amountToPremiumRatio,
          normalized: n.amountToPremiumRatio,
          weight: weights.amountToPremiumRatio,
          contribution: contributions.amountToPremiumRatio,
        },
        claimantHistoryCount: {
          raw: raw.claimantHistoryCount,
          normalized: n.claimantHistoryCount,
          weight: weights.claimantHistoryCount,
          contribution: contributions.claimantHistoryCount,
        },
        policyAgeDays: {
          raw: raw.policyAgeDays,
          normalized: n.policyAgeDays,
          weight: weights.policyAgeDays,
          contribution: contributions.policyAgeDays,
        },
        priorFraudFlag: {
          raw: raw.priorFraudFlag,
          normalized: n.priorFraudFlag,
          weight: weights.priorFraudFlag,
          contribution: contributions.priorFraudFlag,
        },
      },
    },
  };
}

/** Validate the parsed system_config payload. Throws (fail-loud) on malformed. */
export function parseClaimRiskWeights(raw: string): ClaimRiskWeights {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `claim_risk_weights_malformed: system_config '${WEIGHTS_CONFIG_KEY}' is not valid JSON`,
    });
  }
  const w = parsed as Record<string, unknown>;
  const keys: (keyof ClaimRiskWeights)[] = [
    "amountToPremiumRatio",
    "claimantHistoryCount",
    "policyAgeDays",
    "priorFraudFlag",
  ];
  for (const k of keys) {
    if (typeof w?.[k] !== "number" || !Number.isFinite(w[k] as number) || (w[k] as number) < 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `claim_risk_weights_malformed: system_config '${WEIGHTS_CONFIG_KEY}' missing numeric non-negative '${k}'`,
      });
    }
  }
  const weights = w as unknown as ClaimRiskWeights;
  const sum = keys.reduce((acc, k) => acc + weights[k], 0);
  if (Math.abs(sum - 1) > 1e-6) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `claim_risk_weights_malformed: system_config '${WEIGHTS_CONFIG_KEY}' weights must sum to 1.0 (got ${sum})`,
    });
  }
  return weights;
}

/**
 * Load scorer weights from system_config. FAILS LOUD when unset — the
 * scorer never falls back to embedded defaults.
 */
export async function loadClaimRiskWeights(
  db: NonNullable<Awaited<ReturnType<typeof import("../db").getDb>>>
): Promise<ClaimRiskWeights> {
  const [row] = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, WEIGHTS_CONFIG_KEY))
    .limit(1);
  if (!row) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `claim_risk_weights_unset: system_config '${WEIGHTS_CONFIG_KEY}' is not configured (migration 0059 seeds documented defaults)`,
    });
  }
  return parseClaimRiskWeights(row.value);
}
