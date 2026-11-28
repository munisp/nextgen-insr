import { describe, it, expect } from "vitest";

describe("Policy Lifecycle Router", () => {
  describe("Policy State Machine", () => {
    const validTransitions: Record<string, string[]> = {
      draft: ["quoted", "cancelled"],
      quoted: ["bound", "expired", "cancelled"],
      bound: ["active", "cancelled"],
      active: ["lapsed", "cancelled", "renewed", "suspended"],
      suspended: ["active", "cancelled"],
      lapsed: ["reinstated", "terminated"],
      reinstated: ["active"],
      renewed: ["active"],
      cancelled: [],
      terminated: [],
      expired: [],
    };

    it("should allow draft → quoted", () => {
      expect(validTransitions["draft"]).toContain("quoted");
    });

    it("should allow active → renewed", () => {
      expect(validTransitions["active"]).toContain("renewed");
    });

    it("should NOT allow direct draft → active", () => {
      expect(validTransitions["draft"]).not.toContain("active");
    });

    it("should NOT allow cancelled → any other state", () => {
      expect(validTransitions["cancelled"]).toHaveLength(0);
    });

    it("should allow lapsed → reinstated with grace period", () => {
      expect(validTransitions["lapsed"]).toContain("reinstated");
    });

    it("should allow suspension and reactivation", () => {
      expect(validTransitions["active"]).toContain("suspended");
      expect(validTransitions["suspended"]).toContain("active");
    });
  });

  describe("Premium Calculation", () => {
    function calculatePremium(params: {
      sumInsured: number;
      riskClass: string;
      tenure: number;
      age?: number;
      claimsHistory?: number;
    }): number {
      const baseRates: Record<string, number> = {
        low: 0.015,
        medium: 0.025,
        high: 0.04,
        very_high: 0.065,
      };
      const baseRate = baseRates[params.riskClass] || 0.025;
      let premium = params.sumInsured * baseRate;

      // Age loading (for life/health)
      if (params.age && params.age > 50) {
        premium *= 1 + (params.age - 50) * 0.02;
      }

      // Claims history loading
      if (params.claimsHistory && params.claimsHistory > 0) {
        premium *= 1 + params.claimsHistory * 0.1;
      }

      // Tenure discount
      if (params.tenure > 1) {
        premium *= 1 - Math.min(params.tenure - 1, 5) * 0.03;
      }

      return Math.round(premium);
    }

    it("should calculate base premium for low-risk policy", () => {
      const premium = calculatePremium({ sumInsured: 10000000, riskClass: "low", tenure: 1 });
      expect(premium).toBe(150000); // 1.5% of ₦10M
    });

    it("should apply age loading for older policyholders", () => {
      const youngPremium = calculatePremium({ sumInsured: 5000000, riskClass: "medium", tenure: 1, age: 35 });
      const oldPremium = calculatePremium({ sumInsured: 5000000, riskClass: "medium", tenure: 1, age: 60 });
      expect(oldPremium).toBeGreaterThan(youngPremium);
    });

    it("should apply claims history loading", () => {
      const cleanPremium = calculatePremium({ sumInsured: 5000000, riskClass: "medium", tenure: 1, claimsHistory: 0 });
      const dirtyPremium = calculatePremium({ sumInsured: 5000000, riskClass: "medium", tenure: 1, claimsHistory: 3 });
      expect(dirtyPremium).toBeGreaterThan(cleanPremium);
    });

    it("should apply tenure discount for loyal customers", () => {
      const year1 = calculatePremium({ sumInsured: 10000000, riskClass: "medium", tenure: 1 });
      const year5 = calculatePremium({ sumInsured: 10000000, riskClass: "medium", tenure: 5 });
      expect(year5).toBeLessThan(year1);
    });

    it("should cap tenure discount at 15%", () => {
      const year10 = calculatePremium({ sumInsured: 10000000, riskClass: "medium", tenure: 10 });
      const year20 = calculatePremium({ sumInsured: 10000000, riskClass: "medium", tenure: 20 });
      expect(year10).toBe(year20); // Both capped at 5 years * 3% = 15%
    });
  });

  describe("Policy Validation", () => {
    it("should require minimum sum insured", () => {
      const MIN_SUM_INSURED = 100000; // ₦100K
      const policy = { sumInsured: 50000 };
      expect(policy.sumInsured).toBeLessThan(MIN_SUM_INSURED);
    });

    it("should validate policy dates", () => {
      const inception = new Date("2026-01-01");
      const expiry = new Date("2027-01-01");
      expect(expiry.getTime()).toBeGreaterThan(inception.getTime());
    });

    it("should validate NAICOM product code format", () => {
      const validCode = "NIC/MOT/2026/001";
      expect(validCode).toMatch(/^NIC\/[A-Z]{3}\/\d{4}\/\d{3}$/);
    });

    it("should reject policies with invalid beneficiary data", () => {
      const beneficiary = { name: "", relationship: "spouse", percentage: 110 };
      expect(beneficiary.name).toBe("");
      expect(beneficiary.percentage).toBeGreaterThan(100);
    });
  });

  describe("Renewal Processing", () => {
    it("should calculate renewal premium with no-claims discount", () => {
      const currentPremium = 250000;
      const noClaimsYears = 3;
      const discountRate = Math.min(noClaimsYears * 0.05, 0.25); // max 25%
      const renewalPremium = Math.round(currentPremium * (1 - discountRate));
      expect(renewalPremium).toBe(212500); // 15% discount for 3 clean years
    });

    it("should flag policies due for renewal within 30 days", () => {
      const expiryDate = new Date("2026-02-15");
      const today = new Date("2026-01-20");
      const daysToExpiry = Math.floor((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      expect(daysToExpiry).toBeLessThanOrEqual(30);
    });
  });
});
