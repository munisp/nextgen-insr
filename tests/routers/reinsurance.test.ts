import { describe, it, expect } from "vitest";

// ─── Reinsurance logic ───────────────────────────────────────────────────────

type TreatyType = "quota_share" | "surplus" | "excess_of_loss" | "stop_loss";

interface TreatyTerms {
  type: TreatyType;
  cessionRate?: number;       // quota share: % ceded
  retentionLimit?: number;    // surplus: max retention
  attachmentPoint?: number;   // XL: loss must exceed this
  exitPoint?: number;         // XL: max covered amount
  stopLossRatio?: number;     // stop loss: loss ratio trigger
}

function calculateCession(grossPremium: number, treaty: TreatyTerms): number {
  switch (treaty.type) {
    case "quota_share":
      return grossPremium * (treaty.cessionRate ?? 0);
    case "surplus": {
      const retention = treaty.retentionLimit ?? 0;
      if (grossPremium <= retention) return 0;
      return grossPremium - retention;
    }
    case "excess_of_loss":
      return 0; // XL is loss-triggered, not premium-based
    case "stop_loss":
      return 0; // Stop loss is ratio-triggered
    default:
      return 0;
  }
}

function calculateXLRecovery(
  lossAmount: number,
  attachmentPoint: number,
  exitPoint: number
): number {
  if (lossAmount <= attachmentPoint) return 0;
  const coveredLoss = Math.min(lossAmount, exitPoint) - attachmentPoint;
  return Math.max(0, coveredLoss);
}

function calculateStopLossRecovery(
  totalLosses: number,
  earnedPremium: number,
  triggerRatio: number,
  maxRecoveryRatio: number
): number {
  const actualRatio = totalLosses / earnedPremium;
  if (actualRatio <= triggerRatio) return 0;
  const excessLoss = totalLosses - (earnedPremium * triggerRatio);
  const maxRecovery = earnedPremium * maxRecoveryRatio;
  return Math.min(excessLoss, maxRecovery);
}

function validateTreatyTerms(treaty: TreatyTerms): string[] {
  const errors: string[] = [];
  if (treaty.type === "quota_share") {
    if (!treaty.cessionRate || treaty.cessionRate <= 0 || treaty.cessionRate >= 1) {
      errors.push("Cession rate must be between 0 and 1 (exclusive)");
    }
  }
  if (treaty.type === "surplus") {
    if (!treaty.retentionLimit || treaty.retentionLimit <= 0) {
      errors.push("Retention limit must be positive");
    }
  }
  if (treaty.type === "excess_of_loss") {
    if (!treaty.attachmentPoint || treaty.attachmentPoint <= 0) {
      errors.push("Attachment point must be positive");
    }
    if (!treaty.exitPoint || treaty.exitPoint <= (treaty.attachmentPoint ?? 0)) {
      errors.push("Exit point must exceed attachment point");
    }
  }
  return errors;
}

describe("Reinsurance Management", () => {
  describe("Quota Share Cession", () => {
    it("should cede correct proportion of premium", () => {
      expect(calculateCession(1000000, { type: "quota_share", cessionRate: 0.4 })).toBe(400000);
    });

    it("should cede 0 with zero rate", () => {
      expect(calculateCession(1000000, { type: "quota_share", cessionRate: 0 })).toBe(0);
    });

    it("should handle 70/30 split correctly", () => {
      expect(calculateCession(500000, { type: "quota_share", cessionRate: 0.3 })).toBe(150000);
    });
  });

  describe("Surplus Treaty Cession", () => {
    it("should cede nothing when premium is within retention", () => {
      expect(calculateCession(500000, { type: "surplus", retentionLimit: 1000000 })).toBe(0);
    });

    it("should cede excess above retention limit", () => {
      expect(calculateCession(3000000, { type: "surplus", retentionLimit: 1000000 })).toBe(2000000);
    });

    it("should cede nothing when premium equals retention", () => {
      expect(calculateCession(1000000, { type: "surplus", retentionLimit: 1000000 })).toBe(0);
    });
  });

  describe("Excess of Loss Recovery", () => {
    it("should recover nothing below attachment point", () => {
      expect(calculateXLRecovery(500000, 1000000, 5000000)).toBe(0);
    });

    it("should recover loss between attachment and exit", () => {
      expect(calculateXLRecovery(3000000, 1000000, 5000000)).toBe(2000000);
    });

    it("should cap recovery at exit point", () => {
      expect(calculateXLRecovery(10000000, 1000000, 5000000)).toBe(4000000);
    });

    it("should recover nothing at exactly attachment point", () => {
      expect(calculateXLRecovery(1000000, 1000000, 5000000)).toBe(0);
    });

    it("should recover full layer when loss equals exit point", () => {
      expect(calculateXLRecovery(5000000, 1000000, 5000000)).toBe(4000000);
    });
  });

  describe("Stop Loss Recovery", () => {
    it("should recover nothing when loss ratio is below trigger", () => {
      expect(calculateStopLossRecovery(600000, 1000000, 0.7, 0.5)).toBe(0);
    });

    it("should recover excess when loss ratio exceeds trigger", () => {
      // Losses: 900K, Premium: 1M, Trigger: 70%, Max: 50%
      // Excess = 900K - 700K = 200K, Max = 500K → 200K
      expect(calculateStopLossRecovery(900000, 1000000, 0.7, 0.5)).toBe(200000);
    });

    it("should cap recovery at max recovery ratio", () => {
      // Losses: 2M, Premium: 1M, Trigger: 70%, Max: 50%
      // Excess = 2M - 700K = 1.3M, Max = 500K → 500K
      expect(calculateStopLossRecovery(2000000, 1000000, 0.7, 0.5)).toBe(500000);
    });
  });

  describe("Treaty Validation", () => {
    it("should reject quota share with cession rate >= 1", () => {
      const errors = validateTreatyTerms({ type: "quota_share", cessionRate: 1.0 });
      expect(errors.length).toBeGreaterThan(0);
    });

    it("should reject quota share with cession rate <= 0", () => {
      const errors = validateTreatyTerms({ type: "quota_share", cessionRate: -0.1 });
      expect(errors.length).toBeGreaterThan(0);
    });

    it("should accept valid quota share", () => {
      const errors = validateTreatyTerms({ type: "quota_share", cessionRate: 0.4 });
      expect(errors).toEqual([]);
    });

    it("should reject surplus with no retention limit", () => {
      const errors = validateTreatyTerms({ type: "surplus" });
      expect(errors.length).toBeGreaterThan(0);
    });

    it("should reject XL with exit point below attachment", () => {
      const errors = validateTreatyTerms({
        type: "excess_of_loss",
        attachmentPoint: 5000000,
        exitPoint: 3000000,
      });
      expect(errors).toContain("Exit point must exceed attachment point");
    });

    it("should accept valid XL terms", () => {
      const errors = validateTreatyTerms({
        type: "excess_of_loss",
        attachmentPoint: 1000000,
        exitPoint: 5000000,
      });
      expect(errors).toEqual([]);
    });
  });
});
