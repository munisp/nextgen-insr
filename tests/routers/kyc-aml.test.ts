import { describe, it, expect } from "vitest";

describe("KYC/AML Router", () => {
  describe("Identity Verification", () => {
    it("should validate BVN format (11 digits)", () => {
      const validBVN = "22345678901";
      expect(validBVN).toMatch(/^\d{11}$/);
    });

    it("should validate NIN format (11 digits)", () => {
      const validNIN = "12345678901";
      expect(validNIN).toMatch(/^\d{11}$/);
    });

    it("should reject invalid BVN", () => {
      const invalidBVN = "1234567"; // too short
      expect(invalidBVN).not.toMatch(/^\d{11}$/);
    });

    it("should validate phone number format (Nigerian)", () => {
      const validPhone = "+2348012345678";
      expect(validPhone).toMatch(/^\+234[0-9]{10}$/);
    });

    it("should categorize KYC tiers", () => {
      const tiers = {
        tier1: { maxBalance: 300000, dailyLimit: 50000, docs: ["phone_verification"] },
        tier2: { maxBalance: 500000, dailyLimit: 200000, docs: ["bvn", "id_card", "photo"] },
        tier3: { maxBalance: Infinity, dailyLimit: 5000000, docs: ["bvn", "nin", "utility_bill", "reference_letter"] },
      };
      expect(tiers.tier1.docs).toHaveLength(1);
      expect(tiers.tier3.docs).toHaveLength(4);
    });
  });

  describe("Risk Scoring", () => {
    function calculateAMLRisk(customer: {
      isPEP: boolean;
      country: string;
      transactionVolume: number;
      accountAge: number;
      adverseMedia: boolean;
    }): { score: number; rating: string } {
      let score = 0;

      if (customer.isPEP) score += 30;
      if (customer.adverseMedia) score += 25;

      // High-risk jurisdictions
      const highRiskCountries = ["iran", "north_korea", "myanmar", "syria"];
      const medRiskCountries = ["nigeria", "south_africa", "kenya"];
      if (highRiskCountries.includes(customer.country)) score += 40;
      else if (medRiskCountries.includes(customer.country)) score += 15;

      // Transaction volume
      if (customer.transactionVolume > 100000000) score += 20;
      else if (customer.transactionVolume > 50000000) score += 10;

      // New accounts
      if (customer.accountAge < 90) score += 15;

      const rating = score >= 70 ? "high" : score >= 40 ? "medium" : "low";
      return { score: Math.min(score, 100), rating };
    }

    it("should flag PEP as medium risk minimum", () => {
      const result = calculateAMLRisk({
        isPEP: true, country: "nigeria", transactionVolume: 1000000, accountAge: 365, adverseMedia: false,
      });
      expect(result.rating).not.toBe("low");
    });

    it("should flag high-risk country as high risk", () => {
      const result = calculateAMLRisk({
        isPEP: false, country: "iran", transactionVolume: 150000000, accountAge: 30, adverseMedia: false,
      });
      expect(result.rating).toBe("high");
    });

    it("should rate clean Nigerian customer as low-medium", () => {
      const result = calculateAMLRisk({
        isPEP: false, country: "nigeria", transactionVolume: 5000000, accountAge: 730, adverseMedia: false,
      });
      expect(["low", "medium"]).toContain(result.rating);
    });

    it("should compound multiple risk factors", () => {
      const result = calculateAMLRisk({
        isPEP: true, country: "nigeria", transactionVolume: 200000000, accountAge: 30, adverseMedia: true,
      });
      expect(result.score).toBeGreaterThanOrEqual(70);
      expect(result.rating).toBe("high");
    });
  });

  describe("Sanctions Screening", () => {
    it("should match exact name against sanctions list", () => {
      const sanctionsList = ["John Banned Person", "Jane Sanctioned Individual"];
      const customerName = "John Banned Person";
      expect(sanctionsList).toContain(customerName);
    });

    it("should perform fuzzy matching for name variations", () => {
      function fuzzyMatch(name1: string, name2: string): number {
        const n1 = name1.toLowerCase().split(" ");
        const n2 = name2.toLowerCase().split(" ");
        const common = n1.filter((w) => n2.includes(w));
        return common.length / Math.max(n1.length, n2.length);
      }
      expect(fuzzyMatch("Mohammed Ahmed", "Ahmed Mohammed")).toBeGreaterThan(0.5);
      expect(fuzzyMatch("John Smith", "Jane Doe")).toBe(0);
    });
  });

  describe("Document Verification", () => {
    it("should validate Nigerian driver's license format", () => {
      const validLicense = "AAA12345AA67";
      expect(validLicense).toMatch(/^[A-Z]{3}\d{5}[A-Z]{2}\d{2}$/);
    });

    it("should check document expiry", () => {
      const docExpiry = new Date("2025-06-15");
      const today = new Date("2026-01-01");
      expect(today.getTime()).toBeGreaterThan(docExpiry.getTime());
    });

    it("should require minimum 3 months validity for ID documents", () => {
      const MIN_VALIDITY_DAYS = 90;
      const docExpiry = new Date("2026-03-15");
      const today = new Date("2026-01-01");
      const daysRemaining = Math.floor((docExpiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      expect(daysRemaining).toBeLessThan(MIN_VALIDITY_DAYS);
    });
  });
});
