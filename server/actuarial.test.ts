/**
 * actuarial.test.ts — F-11 unit tests for the pure actuarial pricing
 * functions (server/lib/actuarial.ts). Known-answer cases only — no mocks,
 * no fabricated data: the math is checked against hand-computed values.
 */
import { describe, expect, it } from "vitest";

import {
  ActuarialInputError,
  FULL_CREDIBILITY_THRESHOLD,
  credibilityZ,
  indicatedPurePremium,
  lossRatio,
  rateAdequacy,
} from "./lib/actuarial";

describe("actuarial pricing lib (F-11)", () => {
  describe("FULL_CREDIBILITY_THRESHOLD", () => {
    it("is the classical 1082-claim standard (90% confidence, ±5%)", () => {
      expect(FULL_CREDIBILITY_THRESHOLD).toBe(1082);
      // (z_0.95 / 0.05)^2 = (1.645/0.05)^2 = 1082.41 → 1082 claims.
      expect(Math.pow(1.645 / 0.05, 2)).toBeCloseTo(1082.41, 2);
    });
  });

  describe("lossRatio", () => {
    it("computes settled claims paid / earned premium (3/4 = 0.75)", () => {
      expect(lossRatio(3, 4)).toBe(0.75);
    });

    it("returns 0 when claims paid is 0 but premium exists (honest zero)", () => {
      expect(lossRatio(0, 1000)).toBe(0);
    });

    it("can exceed 1 (a real underwriting loss is not clamped)", () => {
      expect(lossRatio(1500, 1000)).toBe(1.5);
    });

    it("throws INSUFFICIENT_DATA when earnedPremium is 0", () => {
      try {
        lossRatio(100, 0);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ActuarialInputError);
        expect((err as ActuarialInputError).reason).toBe("INSUFFICIENT_DATA");
      }
    });

    it("throws INVALID_INPUT on negative or non-finite inputs", () => {
      expect(() => lossRatio(-1, 100)).toThrow(ActuarialInputError);
      expect(() => lossRatio(1, -100)).toThrow(ActuarialInputError);
      expect(() => lossRatio(Number.NaN, 100)).toThrow(ActuarialInputError);
      expect(() => lossRatio(1, Number.POSITIVE_INFINITY)).toThrow(
        ActuarialInputError
      );
    });
  });

  describe("credibilityZ", () => {
    it("returns 1 at the full-credibility threshold (n = 1082)", () => {
      expect(credibilityZ(1082)).toBe(1);
    });

    it("returns sqrt(0.25) = 0.5 at n = 270.5 (quarter credibility)", () => {
      expect(credibilityZ(270.5)).toBeCloseTo(0.5, 10);
    });

    it("returns 0 at n = 0 (no data, no credibility)", () => {
      expect(credibilityZ(0)).toBe(0);
    });

    it("caps at 1 for n above the threshold (n = 5000)", () => {
      expect(credibilityZ(5000)).toBe(1);
    });

    it("follows the square-root rule between 0 and 1082", () => {
      // n = 1082/4 = 270.5 → 0.5 covered above; check n = 1082/16 = 67.625 → 0.25
      expect(credibilityZ(67.625)).toBeCloseTo(0.25, 10);
    });

    it("throws INVALID_INPUT on negative claim counts", () => {
      expect(() => credibilityZ(-1)).toThrow(ActuarialInputError);
    });
  });

  describe("indicatedPurePremium", () => {
    it("blends observed and current by Z: Z*observed + (1-Z)*current", () => {
      // Z=0.5, observed=120, current=100 → 0.5*120 + 0.5*100 = 110
      expect(indicatedPurePremium(120, 100, 0.5)).toBeCloseTo(110, 10);
    });

    it("returns current when Z = 0 (no credibility given to experience)", () => {
      expect(indicatedPurePremium(120, 100, 0)).toBe(100);
    });

    it("returns observed when Z = 1 (full credibility)", () => {
      expect(indicatedPurePremium(120, 100, 1)).toBe(120);
    });

    it("throws INVALID_INPUT when Z is outside [0, 1]", () => {
      expect(() => indicatedPurePremium(120, 100, -0.1)).toThrow(
        ActuarialInputError
      );
      expect(() => indicatedPurePremium(120, 100, 1.1)).toThrow(
        ActuarialInputError
      );
    });

    it("throws INVALID_INPUT on negative premiums", () => {
      expect(() => indicatedPurePremium(-1, 100, 0.5)).toThrow(
        ActuarialInputError
      );
      expect(() => indicatedPurePremium(120, -100, 0.5)).toThrow(
        ActuarialInputError
      );
    });
  });

  describe("rateAdequacy", () => {
    const target = 0.7;
    const tolerance = 0.05;

    it("returns 'adequate' at the target", () => {
      expect(rateAdequacy(0.7, target, tolerance)).toBe("adequate");
    });

    it("treats boundary values at target ± tolerance as 'adequate' (inclusive band)", () => {
      expect(rateAdequacy(0.75, target, tolerance)).toBe("adequate");
      expect(rateAdequacy(0.65, target, tolerance)).toBe("adequate");
    });

    it("returns 'underpriced' strictly above target + tolerance", () => {
      expect(rateAdequacy(0.751, target, tolerance)).toBe("underpriced");
      expect(rateAdequacy(0.9, target, tolerance)).toBe("underpriced");
    });

    it("returns 'overpriced' strictly below target - tolerance", () => {
      expect(rateAdequacy(0.649, target, tolerance)).toBe("overpriced");
      expect(rateAdequacy(0.4, target, tolerance)).toBe("overpriced");
    });

    it("with zero tolerance only the exact target is 'adequate'", () => {
      expect(rateAdequacy(0.7, target, 0)).toBe("adequate");
      expect(rateAdequacy(0.7001, target, 0)).toBe("underpriced");
      expect(rateAdequacy(0.6999, target, 0)).toBe("overpriced");
    });

    it("throws INVALID_INPUT on negative tolerance", () => {
      expect(() => rateAdequacy(0.7, target, -0.01)).toThrow(
        ActuarialInputError
      );
    });
  });
});
