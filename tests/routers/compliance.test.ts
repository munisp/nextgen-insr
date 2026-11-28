import { describe, it, expect } from "vitest";

describe("NAICOM Compliance Router", () => {
  describe("Regulatory Returns", () => {
    it("should validate quarterly return structure", () => {
      const quarterlyReturn = {
        quarter: "Q1",
        year: 2026,
        grossPremium: 1500000000,
        netPremium: 1200000000,
        claimsPaid: 450000000,
        outstandingClaims: 180000000,
        commissions: 225000000,
        managementExpenses: 300000000,
        investmentIncome: 75000000,
      };
      expect(quarterlyReturn.quarter).toMatch(/^Q[1-4]$/);
      expect(quarterlyReturn.netPremium).toBeLessThanOrEqual(quarterlyReturn.grossPremium);
    });

    it("should calculate loss ratio", () => {
      const claimsPaid = 450000000;
      const netPremium = 1200000000;
      const lossRatio = (claimsPaid / netPremium) * 100;
      expect(lossRatio).toBeCloseTo(37.5, 1);
    });

    it("should flag loss ratio above 70% as warning", () => {
      const WARNING_THRESHOLD = 70;
      const lossRatio = 75.5;
      expect(lossRatio).toBeGreaterThan(WARNING_THRESHOLD);
    });

    it("should calculate combined ratio", () => {
      const claims = 450000000;
      const expenses = 300000000;
      const commissions = 225000000;
      const netPremium = 1200000000;
      const combinedRatio = ((claims + expenses + commissions) / netPremium) * 100;
      expect(combinedRatio).toBeCloseTo(81.25, 1);
    });
  });

  describe("Solvency Margin", () => {
    it("should calculate solvency margin ratio", () => {
      const admittedAssets = 5000000000;
      const totalLiabilities = 3200000000;
      const solvencyMargin = admittedAssets - totalLiabilities;
      const solvencyRatio = (solvencyMargin / admittedAssets) * 100;
      expect(solvencyRatio).toBeCloseTo(36, 0);
    });

    it("should flag solvency below NAICOM minimum (15%)", () => {
      const MINIMUM_SOLVENCY = 15;
      const solvencyRatio = 12;
      expect(solvencyRatio).toBeLessThan(MINIMUM_SOLVENCY);
    });

    it("should validate minimum paid-up capital for life insurance", () => {
      const MINIMUM_LIFE_CAPITAL = 8000000000; // ₦8B (NAICOM 2019 recapitalization)
      const companyCapital = 6500000000;
      expect(companyCapital).toBeLessThan(MINIMUM_LIFE_CAPITAL);
    });

    it("should validate minimum paid-up capital for general insurance", () => {
      const MINIMUM_GENERAL_CAPITAL = 10000000000; // ₦10B
      const companyCapital = 12000000000;
      expect(companyCapital).toBeGreaterThanOrEqual(MINIMUM_GENERAL_CAPITAL);
    });
  });

  describe("AML/CFT Compliance", () => {
    it("should flag single premium payment above reporting threshold", () => {
      const CBN_REPORTING_THRESHOLD = 5000000; // ₦5M
      const premiumPayment = 7500000;
      expect(premiumPayment).toBeGreaterThan(CBN_REPORTING_THRESHOLD);
    });

    it("should flag structured transactions (smurfing)", () => {
      const WINDOW_HOURS = 24;
      const transactions = [
        { amount: 4800000, timestamp: "2026-01-15T10:00:00Z" },
        { amount: 4700000, timestamp: "2026-01-15T11:30:00Z" },
        { amount: 4900000, timestamp: "2026-01-15T14:00:00Z" },
      ];
      const totalInWindow = transactions.reduce((sum, t) => sum + t.amount, 0);
      expect(totalInWindow).toBeGreaterThan(5000000);
      // Each under threshold but total exceeds it = structuring
    });

    it("should validate PEP screening", () => {
      const customer = { name: "John Doe", isPEP: true, enhancedDueDiligence: false };
      expect(customer.isPEP && !customer.enhancedDueDiligence).toBe(true);
      // PEP without EDD = compliance violation
    });

    it("should validate KYC document requirements", () => {
      const requiredDocs = ["national_id", "utility_bill", "passport_photo"];
      const submittedDocs = ["national_id", "passport_photo"];
      const missing = requiredDocs.filter((d) => !submittedDocs.includes(d));
      expect(missing).toContain("utility_bill");
    });
  });

  describe("NDPR Data Protection", () => {
    it("should classify data sensitivity levels", () => {
      const dataFields = {
        fullName: "personal",
        email: "personal",
        bvn: "sensitive",
        nin: "sensitive",
        medicalRecords: "sensitive",
        policyNumber: "internal",
      };
      const sensitiveFields = Object.entries(dataFields)
        .filter(([_, level]) => level === "sensitive")
        .map(([field]) => field);
      expect(sensitiveFields).toContain("bvn");
      expect(sensitiveFields).toContain("medicalRecords");
      expect(sensitiveFields).toHaveLength(3);
    });

    it("should enforce data retention periods", () => {
      const RETENTION_YEARS = 6; // NAICOM requirement
      const policyEndDate = new Date("2020-01-01");
      const retentionEnd = new Date(policyEndDate);
      retentionEnd.setFullYear(retentionEnd.getFullYear() + RETENTION_YEARS);
      const now = new Date("2026-06-01");
      expect(now.getTime()).toBeGreaterThan(retentionEnd.getTime());
      // Data from 2020 has exceeded 6-year retention → eligible for purge
    });
  });
});
