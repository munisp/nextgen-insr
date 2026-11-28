import { describe, it, expect } from "vitest";

// ─── Premium billing logic ───────────────────────────────────────────────────

interface PremiumSchedule {
  frequency: "monthly" | "quarterly" | "semi-annual" | "annual";
  basePremium: number;
  loadingFactor: number;
  discount: number;
}

function calculateInstallment(schedule: PremiumSchedule): number {
  const annualPremium = schedule.basePremium * (1 + schedule.loadingFactor) * (1 - schedule.discount);
  const periods: Record<string, number> = {
    monthly: 12,
    quarterly: 4,
    "semi-annual": 2,
    annual: 1,
  };
  return Math.round((annualPremium / periods[schedule.frequency]) * 100) / 100;
}

function calculateLateFee(daysPastDue: number, installmentAmount: number): number {
  if (daysPastDue <= 0) return 0;
  if (daysPastDue <= 7) return 0;
  if (daysPastDue <= 30) return Math.round(installmentAmount * 0.02 * 100) / 100;
  if (daysPastDue <= 60) return Math.round(installmentAmount * 0.05 * 100) / 100;
  return Math.round(installmentAmount * 0.10 * 100) / 100;
}

type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled" | "written_off";

function validateStatusTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  const allowed: Record<InvoiceStatus, InvoiceStatus[]> = {
    draft: ["sent", "cancelled"],
    sent: ["paid", "overdue", "cancelled"],
    paid: [],
    overdue: ["paid", "written_off", "cancelled"],
    cancelled: [],
    written_off: [],
  };
  return allowed[from]?.includes(to) ?? false;
}

function calculateCommission(premium: number, agentTier: string): number {
  const rates: Record<string, number> = {
    bronze: 0.05,
    silver: 0.07,
    gold: 0.10,
    platinum: 0.12,
  };
  const rate = rates[agentTier.toLowerCase()] ?? 0.05;
  return Math.round(premium * rate * 100) / 100;
}

describe("Premium Billing & Invoicing", () => {
  describe("Installment Calculation", () => {
    it("should calculate monthly installment correctly", () => {
      const result = calculateInstallment({
        frequency: "monthly",
        basePremium: 120000,
        loadingFactor: 0,
        discount: 0,
      });
      expect(result).toBe(10000);
    });

    it("should apply loading factor", () => {
      const result = calculateInstallment({
        frequency: "annual",
        basePremium: 100000,
        loadingFactor: 0.2,
        discount: 0,
      });
      expect(result).toBe(120000);
    });

    it("should apply discount", () => {
      const result = calculateInstallment({
        frequency: "annual",
        basePremium: 100000,
        loadingFactor: 0,
        discount: 0.1,
      });
      expect(result).toBe(90000);
    });

    it("should apply both loading and discount", () => {
      const result = calculateInstallment({
        frequency: "quarterly",
        basePremium: 100000,
        loadingFactor: 0.2,
        discount: 0.1,
      });
      // 100000 * 1.2 * 0.9 = 108000 / 4 = 27000
      expect(result).toBe(27000);
    });

    it("should handle semi-annual frequency", () => {
      const result = calculateInstallment({
        frequency: "semi-annual",
        basePremium: 200000,
        loadingFactor: 0,
        discount: 0,
      });
      expect(result).toBe(100000);
    });
  });

  describe("Late Fee Calculation", () => {
    it("should charge no late fee for on-time payments", () => {
      expect(calculateLateFee(0, 10000)).toBe(0);
    });

    it("should charge no late fee within 7-day grace period", () => {
      expect(calculateLateFee(5, 10000)).toBe(0);
    });

    it("should charge 2% for 8-30 days past due", () => {
      expect(calculateLateFee(15, 10000)).toBe(200);
    });

    it("should charge 5% for 31-60 days past due", () => {
      expect(calculateLateFee(45, 10000)).toBe(500);
    });

    it("should charge 10% for 60+ days past due", () => {
      expect(calculateLateFee(90, 10000)).toBe(1000);
    });
  });

  describe("Invoice Status Transitions", () => {
    it("should allow draft → sent", () => {
      expect(validateStatusTransition("draft", "sent")).toBe(true);
    });

    it("should allow sent → paid", () => {
      expect(validateStatusTransition("sent", "paid")).toBe(true);
    });

    it("should allow sent → overdue", () => {
      expect(validateStatusTransition("sent", "overdue")).toBe(true);
    });

    it("should allow overdue → paid", () => {
      expect(validateStatusTransition("overdue", "paid")).toBe(true);
    });

    it("should allow overdue → written_off", () => {
      expect(validateStatusTransition("overdue", "written_off")).toBe(true);
    });

    it("should block paid → anything", () => {
      expect(validateStatusTransition("paid", "cancelled")).toBe(false);
      expect(validateStatusTransition("paid", "overdue")).toBe(false);
    });

    it("should block draft → paid (must be sent first)", () => {
      expect(validateStatusTransition("draft", "paid")).toBe(false);
    });

    it("should block written_off → anything", () => {
      expect(validateStatusTransition("written_off", "paid")).toBe(false);
    });
  });

  describe("Agent Commission Calculation", () => {
    it("should calculate 5% for bronze agents", () => {
      expect(calculateCommission(100000, "bronze")).toBe(5000);
    });

    it("should calculate 7% for silver agents", () => {
      expect(calculateCommission(100000, "silver")).toBe(7000);
    });

    it("should calculate 10% for gold agents", () => {
      expect(calculateCommission(100000, "gold")).toBe(10000);
    });

    it("should calculate 12% for platinum agents", () => {
      expect(calculateCommission(100000, "platinum")).toBe(12000);
    });

    it("should default to 5% for unknown tier", () => {
      expect(calculateCommission(100000, "unknown")).toBe(5000);
    });
  });
});
