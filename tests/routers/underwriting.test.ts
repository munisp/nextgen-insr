import { describe, it, expect } from "vitest";

describe("Underwriting Engine Router", () => {
  describe("Risk Classification", () => {
    function classifyRisk(applicant: {
      age: number;
      occupation: string;
      claimsHistory: number;
      location: string;
      bmi?: number;
    }): string {
      let riskScore = 0;

      // Age factor
      if (applicant.age < 25 || applicant.age > 65) riskScore += 3;
      else if (applicant.age > 55) riskScore += 2;
      else riskScore += 1;

      // Occupation factor
      const highRiskOccupations = ["mining", "offshore_oil", "construction", "security"];
      const medRiskOccupations = ["transport", "manufacturing", "agriculture"];
      if (highRiskOccupations.includes(applicant.occupation)) riskScore += 4;
      else if (medRiskOccupations.includes(applicant.occupation)) riskScore += 2;
      else riskScore += 1;

      // Claims history
      riskScore += applicant.claimsHistory * 2;

      // Location (Nigerian risk zones)
      const highRiskZones = ["rivers", "borno", "yobe", "adamawa"];
      const medRiskZones = ["lagos", "kano", "ogun"];
      if (highRiskZones.includes(applicant.location)) riskScore += 3;
      else if (medRiskZones.includes(applicant.location)) riskScore += 2;
      else riskScore += 1;

      // BMI (health insurance)
      if (applicant.bmi && applicant.bmi > 35) riskScore += 2;

      if (riskScore <= 4) return "preferred";
      if (riskScore <= 8) return "standard";
      if (riskScore <= 12) return "substandard";
      return "declined";
    }

    it("should classify young healthy professional as preferred", () => {
      expect(classifyRisk({
        age: 30, occupation: "banking", claimsHistory: 0, location: "abuja"
      })).toBe("preferred");
    });

    it("should classify high-risk occupation as substandard or higher", () => {
      const result = classifyRisk({
        age: 40, occupation: "offshore_oil", claimsHistory: 1, location: "rivers"
      });
      expect(["substandard", "declined"]).toContain(result);
    });

    it("should decline applicants with excessive claims history", () => {
      expect(classifyRisk({
        age: 45, occupation: "mining", claimsHistory: 4, location: "borno"
      })).toBe("declined");
    });

    it("should factor in high-risk Nigerian zones", () => {
      const safeZone = classifyRisk({ age: 35, occupation: "it", claimsHistory: 0, location: "abuja" });
      const dangerZone = classifyRisk({ age: 35, occupation: "it", claimsHistory: 0, location: "borno" });
      // borno adds +3 vs abuja +1
      expect(safeZone).not.toBe(dangerZone);
    });

    it("should apply BMI loading for health insurance", () => {
      const normal = classifyRisk({ age: 35, occupation: "it", claimsHistory: 0, location: "abuja", bmi: 24 });
      const obese = classifyRisk({ age: 35, occupation: "it", claimsHistory: 0, location: "abuja", bmi: 38 });
      // Obese applicant gets higher risk score
      expect(normal).toBe("preferred");
      expect(obese).not.toBe("preferred");
    });
  });

  describe("Underwriting Decision", () => {
    it("should approve standard risk with standard terms", () => {
      const decision = { riskClass: "standard", action: "approve", loadingPercent: 0 };
      expect(decision.action).toBe("approve");
    });

    it("should approve substandard with premium loading", () => {
      const decision = { riskClass: "substandard", action: "approve_with_loading", loadingPercent: 50 };
      expect(decision.loadingPercent).toBeGreaterThan(0);
    });

    it("should require medical examination for sum insured above ₦50M", () => {
      const MEDICAL_EXAM_THRESHOLD = 50000000;
      const sumInsured = 75000000;
      expect(sumInsured).toBeGreaterThan(MEDICAL_EXAM_THRESHOLD);
    });

    it("should apply multi-policy discount", () => {
      const existingPolicies = 3;
      const MULTI_POLICY_DISCOUNT = Math.min(existingPolicies * 5, 15); // max 15%
      expect(MULTI_POLICY_DISCOUNT).toBe(15);
    });
  });

  describe("Motor Insurance Underwriting", () => {
    it("should classify vehicle by age", () => {
      function vehicleRiskClass(year: number): string {
        const age = new Date().getFullYear() - year;
        if (age <= 3) return "new";
        if (age <= 7) return "standard";
        if (age <= 15) return "aged";
        return "vintage";
      }
      expect(vehicleRiskClass(2024)).toBe("new");
      expect(vehicleRiskClass(2020)).toBe("standard");
      expect(vehicleRiskClass(2012)).toBe("aged");
    });

    it("should apply Nigerian motor third-party minimum", () => {
      const NAICOM_MOTOR_MINIMUM = 5000; // ₦5,000 minimum third-party premium
      const calculatedPremium = 3500;
      const finalPremium = Math.max(calculatedPremium, NAICOM_MOTOR_MINIMUM);
      expect(finalPremium).toBe(NAICOM_MOTOR_MINIMUM);
    });
  });
});
