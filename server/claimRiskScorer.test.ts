/**
 * claimRiskScorer.test.ts — B11 known-answer unit tests for the heuristic-v1
 * claim-risk scorer (server/lib/claimRiskScorer.ts). Every expected score
 * below is computed BY HAND from the documented formula:
 *
 *   score = w_ratio*min(ratio/3,1) + w_history*min(count/5,1)
 *         + w_age*max(0,1-ageDays/365) + w_fraud*flag
 *
 * with the migration-0059 default weights
 *   ratio 0.40, history 0.20, age 0.15, fraud 0.25
 * and bands <0.33 low, <0.66 medium, else high.
 */
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";

import {
  computeClaimRiskScore,
  parseClaimRiskWeights,
  MODEL_TYPE,
} from "./lib/claimRiskScorer";

const DEFAULT_WEIGHTS = {
  amountToPremiumRatio: 0.4,
  claimantHistoryCount: 0.2,
  policyAgeDays: 0.15,
  priorFraudFlag: 0.25,
};

describe("claimRiskScorer (heuristic-v1) — known answers", () => {
  it("mid-risk claim: ratio 1.5, 5 claims, age 365d, fraud flagged → 0.65 medium", () => {
    const r = computeClaimRiskScore(
      {
        amountToPremiumRatio: 1.5, // n = 0.5
        claimantHistoryCount: 5, //   n = 1.0
        policyAgeDays: 365, //        n = 0.0
        priorFraudFlag: true, //      n = 1.0
      },
      DEFAULT_WEIGHTS
    );
    // 0.4*0.5 + 0.2*1 + 0.15*0 + 0.25*1 = 0.20 + 0.20 + 0 + 0.25
    expect(r.score).toBeCloseTo(0.65, 10);
    expect(r.riskBand).toBe("medium");
    expect(r.modelType).toBe(MODEL_TYPE);
    expect(r.modelType).toBe("heuristic-v1");
    expect(r.featureBreakdown.features.amountToPremiumRatio.contribution).toBeCloseTo(0.2, 10);
    expect(r.featureBreakdown.features.claimantHistoryCount.contribution).toBeCloseTo(0.2, 10);
    expect(r.featureBreakdown.features.policyAgeDays.contribution).toBeCloseTo(0, 10);
    expect(r.featureBreakdown.features.priorFraudFlag.contribution).toBeCloseTo(0.25, 10);
  });

  it("low-risk claim: ratio 0.3, first claim, unknown age, no fraud → 0.08 low", () => {
    const r = computeClaimRiskScore(
      {
        amountToPremiumRatio: 0.3, // n = 0.1
        claimantHistoryCount: 1, //   n = 0.2
        policyAgeDays: null, //       n = 0.0 (documented: cannot establish youth)
        priorFraudFlag: false, //     n = 0.0
      },
      DEFAULT_WEIGHTS
    );
    // 0.4*0.1 + 0.2*0.2 = 0.04 + 0.04
    expect(r.score).toBeCloseTo(0.08, 10);
    expect(r.riskBand).toBe("low");
  });

  it("max-risk claim: all features saturate → 1.0 high", () => {
    const r = computeClaimRiskScore(
      {
        amountToPremiumRatio: 6, //   n = 1.0 (clamped)
        claimantHistoryCount: 10, //  n = 1.0 (clamped)
        policyAgeDays: 0, //          n = 1.0
        priorFraudFlag: true, //      n = 1.0
      },
      DEFAULT_WEIGHTS
    );
    expect(r.score).toBeCloseTo(1.0, 10);
    expect(r.riskBand).toBe("high");
  });

  it("is deterministic — identical inputs give identical outputs (no randomness)", () => {
    const features = {
      amountToPremiumRatio: 2.2,
      claimantHistoryCount: 3,
      policyAgeDays: 90,
      priorFraudFlag: false,
    };
    const a = computeClaimRiskScore(features, DEFAULT_WEIGHTS);
    const b = computeClaimRiskScore(features, DEFAULT_WEIGHTS);
    expect(a).toEqual(b);
    // hand check: 0.4*min(2.2/3,1) + 0.2*(3/5) + 0.15*(1-90/365) + 0
    // = 0.4*0.733333… + 0.12 + 0.15*0.753424… = 0.293333… + 0.12 + 0.113013…
    expect(a.score).toBeCloseTo(0.526347, 5);
  });
});

describe("claimRiskScorer weights — fail-loud validation", () => {
  it("accepts the documented default JSON", () => {
    const w = parseClaimRiskWeights(
      '{"amountToPremiumRatio":0.40,"claimantHistoryCount":0.20,"policyAgeDays":0.15,"priorFraudFlag":0.25}'
    );
    expect(w).toEqual(DEFAULT_WEIGHTS);
  });

  it("fails loud on malformed JSON", () => {
    expect(() => parseClaimRiskWeights("not-json")).toThrowError(TRPCError);
    try {
      parseClaimRiskWeights("not-json");
    } catch (e) {
      expect((e as TRPCError).code).toBe("PRECONDITION_FAILED");
      expect((e as TRPCError).message).toContain("claim_risk_weights_malformed");
    }
  });

  it("fails loud on a missing feature weight", () => {
    try {
      parseClaimRiskWeights(
        '{"amountToPremiumRatio":0.5,"claimantHistoryCount":0.5}'
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as TRPCError).code).toBe("PRECONDITION_FAILED");
      expect((e as TRPCError).message).toContain("policyAgeDays");
    }
  });

  it("fails loud when weights do not sum to 1.0", () => {
    try {
      parseClaimRiskWeights(
        '{"amountToPremiumRatio":0.5,"claimantHistoryCount":0.2,"policyAgeDays":0.15,"priorFraudFlag":0.25}'
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as TRPCError).code).toBe("PRECONDITION_FAILED");
      expect((e as TRPCError).message).toContain("sum to 1.0");
    }
  });

  it("fails loud on negative weights", () => {
    try {
      parseClaimRiskWeights(
        '{"amountToPremiumRatio":1.25,"claimantHistoryCount":0.0,"policyAgeDays":0.0,"priorFraudFlag":-0.25}'
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as TRPCError).code).toBe("PRECONDITION_FAILED");
    }
  });
});
