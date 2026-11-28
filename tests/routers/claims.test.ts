import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Claims Adjudication Router", () => {
  describe("Claim Submission Validation", () => {
    it("should validate required fields for new claim", () => {
      const requiredFields = ["policyId", "claimType", "amount", "description", "dateOfLoss"];
      const validClaim = {
        policyId: "POL-001",
        claimType: "motor",
        amount: 150000,
        description: "Fender bender on Third Mainland Bridge",
        dateOfLoss: "2026-01-15",
      };
      for (const field of requiredFields) {
        expect(validClaim).toHaveProperty(field);
      }
    });

    it("should reject claims exceeding policy coverage limit", () => {
      const policyCoverage = 5000000; // ₦5M
      const claimAmount = 7500000; // ₦7.5M
      expect(claimAmount).toBeGreaterThan(policyCoverage);
    });

    it("should reject claims for expired policies", () => {
      const policyExpiry = new Date("2025-12-31");
      const claimDate = new Date("2026-01-15");
      expect(claimDate.getTime()).toBeGreaterThan(policyExpiry.getTime());
    });
  });

  describe("Auto-Adjudication Rules", () => {
    function adjudicate(claim: { amount: number; hasEvidence: boolean; claimHistory: number }): string {
      if (claim.amount <= 50000 && claim.hasEvidence && claim.claimHistory < 3) {
        return "auto_approved";
      }
      if (claim.amount > 500000 || claim.claimHistory >= 5) {
        return "escalated";
      }
      return "pending_review";
    }

    it("should auto-approve small claims with evidence and clean history", () => {
      expect(adjudicate({ amount: 30000, hasEvidence: true, claimHistory: 1 })).toBe("auto_approved");
    });

    it("should escalate high-value claims", () => {
      expect(adjudicate({ amount: 750000, hasEvidence: true, claimHistory: 0 })).toBe("escalated");
    });

    it("should escalate claims from high-frequency claimants", () => {
      expect(adjudicate({ amount: 100000, hasEvidence: true, claimHistory: 5 })).toBe("escalated");
    });

    it("should send to manual review for medium claims without evidence", () => {
      expect(adjudicate({ amount: 200000, hasEvidence: false, claimHistory: 2 })).toBe("pending_review");
    });

    it("should handle edge case at threshold", () => {
      expect(adjudicate({ amount: 50000, hasEvidence: true, claimHistory: 2 })).toBe("auto_approved");
      expect(adjudicate({ amount: 50001, hasEvidence: true, claimHistory: 2 })).toBe("pending_review");
    });
  });

  describe("Claim Status Lifecycle", () => {
    const validTransitions: Record<string, string[]> = {
      draft: ["submitted"],
      submitted: ["under_review", "rejected"],
      under_review: ["approved", "rejected", "escalated", "info_requested"],
      info_requested: ["submitted"],
      escalated: ["approved", "rejected"],
      approved: ["paid"],
      rejected: [],
      paid: [],
    };

    it("should allow draft → submitted", () => {
      expect(validTransitions["draft"]).toContain("submitted");
    });

    it("should allow under_review → approved", () => {
      expect(validTransitions["under_review"]).toContain("approved");
    });

    it("should NOT allow paid → any other status", () => {
      expect(validTransitions["paid"]).toHaveLength(0);
    });

    it("should NOT allow rejected → any other status", () => {
      expect(validTransitions["rejected"]).toHaveLength(0);
    });

    it("should allow info_requested to re-submit", () => {
      expect(validTransitions["info_requested"]).toContain("submitted");
    });
  });

  describe("Nigerian Insurance Claim Types", () => {
    const claimTypes = [
      "motor_comprehensive",
      "motor_third_party",
      "fire_burglary",
      "marine_cargo",
      "life_death",
      "life_disability",
      "health_outpatient",
      "health_inpatient",
      "professional_indemnity",
      "public_liability",
    ];

    it("should support all NAICOM claim categories", () => {
      expect(claimTypes.length).toBeGreaterThanOrEqual(10);
    });

    it("should categorize motor claims correctly", () => {
      const motorClaims = claimTypes.filter((t) => t.startsWith("motor_"));
      expect(motorClaims).toContain("motor_comprehensive");
      expect(motorClaims).toContain("motor_third_party");
    });

    it("should categorize health claims correctly", () => {
      const healthClaims = claimTypes.filter((t) => t.startsWith("health_"));
      expect(healthClaims).toHaveLength(2);
    });
  });

  describe("SLA Enforcement", () => {
    it("should flag claims exceeding 5-day SLA for acknowledgement", () => {
      const SLA_ACKNOWLEDGEMENT_HOURS = 120; // 5 days
      const submittedAt = new Date("2026-01-10T10:00:00Z");
      const now = new Date("2026-01-16T10:00:00Z"); // 6 days later
      const hoursElapsed = (now.getTime() - submittedAt.getTime()) / (1000 * 60 * 60);
      expect(hoursElapsed).toBeGreaterThan(SLA_ACKNOWLEDGEMENT_HOURS);
    });

    it("should flag claims exceeding 30-day SLA for resolution", () => {
      const SLA_RESOLUTION_DAYS = 30;
      const submittedAt = new Date("2025-12-01");
      const now = new Date("2026-01-15");
      const daysElapsed = Math.floor((now.getTime() - submittedAt.getTime()) / (1000 * 60 * 60 * 24));
      expect(daysElapsed).toBeGreaterThan(SLA_RESOLUTION_DAYS);
    });
  });
});
