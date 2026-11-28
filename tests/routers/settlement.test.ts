import { describe, it, expect } from "vitest";

// ─── Settlement logic ────────────────────────────────────────────────────────

interface SettlementBatch {
  id: string;
  entries: SettlementEntry[];
  status: "pending" | "processing" | "completed" | "failed" | "partially_completed";
}

interface SettlementEntry {
  agentId: string;
  amount: number;
  type: "commission" | "claim_payout" | "refund" | "bonus";
  bankCode: string;
  accountNumber: string;
}

function validateSettlementEntry(entry: SettlementEntry): string[] {
  const errors: string[] = [];
  if (entry.amount <= 0) errors.push("Amount must be positive");
  if (entry.amount > 50000000) errors.push("Amount exceeds single settlement limit (₦50M)");
  if (!entry.bankCode || entry.bankCode.length !== 3) errors.push("Invalid bank code");
  if (!entry.accountNumber || !/^\d{10}$/.test(entry.accountNumber)) errors.push("Account number must be 10 digits");
  if (!entry.agentId) errors.push("Agent ID is required");
  return errors;
}

function calculateBatchTotal(entries: SettlementEntry[]): number {
  return entries.reduce((sum, e) => sum + e.amount, 0);
}

function groupByBank(entries: SettlementEntry[]): Map<string, SettlementEntry[]> {
  const grouped = new Map<string, SettlementEntry[]>();
  for (const entry of entries) {
    const existing = grouped.get(entry.bankCode) || [];
    existing.push(entry);
    grouped.set(entry.bankCode, existing);
  }
  return grouped;
}

function determineSettlementWindow(amount: number): "instant" | "same_day" | "next_day" | "t_plus_2" {
  if (amount <= 100000) return "instant";
  if (amount <= 5000000) return "same_day";
  if (amount <= 25000000) return "next_day";
  return "t_plus_2";
}

function calculateSettlementFee(amount: number, type: string): number {
  if (type === "claim_payout") return 0;
  if (amount <= 5000) return 10;
  if (amount <= 50000) return 25;
  if (amount <= 500000) return 50;
  return 100;
}

describe("Settlement Processing", () => {
  describe("Entry Validation", () => {
    const validEntry: SettlementEntry = {
      agentId: "AGT-001",
      amount: 50000,
      type: "commission",
      bankCode: "044",
      accountNumber: "0123456789",
    };

    it("should accept valid settlement entry", () => {
      expect(validateSettlementEntry(validEntry)).toEqual([]);
    });

    it("should reject zero amount", () => {
      const errors = validateSettlementEntry({ ...validEntry, amount: 0 });
      expect(errors).toContain("Amount must be positive");
    });

    it("should reject negative amount", () => {
      const errors = validateSettlementEntry({ ...validEntry, amount: -1000 });
      expect(errors).toContain("Amount must be positive");
    });

    it("should reject amount exceeding ₦50M limit", () => {
      const errors = validateSettlementEntry({ ...validEntry, amount: 60000000 });
      expect(errors).toContain("Amount exceeds single settlement limit (₦50M)");
    });

    it("should reject invalid bank code", () => {
      const errors = validateSettlementEntry({ ...validEntry, bankCode: "AB" });
      expect(errors).toContain("Invalid bank code");
    });

    it("should reject non-10-digit account number", () => {
      const errors = validateSettlementEntry({ ...validEntry, accountNumber: "12345" });
      expect(errors).toContain("Account number must be 10 digits");
    });

    it("should reject missing agent ID", () => {
      const errors = validateSettlementEntry({ ...validEntry, agentId: "" });
      expect(errors).toContain("Agent ID is required");
    });

    it("should report multiple errors simultaneously", () => {
      const errors = validateSettlementEntry({
        agentId: "",
        amount: -1,
        type: "commission",
        bankCode: "",
        accountNumber: "abc",
      });
      expect(errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Batch Calculations", () => {
    it("should calculate correct batch total", () => {
      const entries: SettlementEntry[] = [
        { agentId: "A1", amount: 10000, type: "commission", bankCode: "044", accountNumber: "0000000001" },
        { agentId: "A2", amount: 25000, type: "commission", bankCode: "044", accountNumber: "0000000002" },
        { agentId: "A3", amount: 15000, type: "bonus", bankCode: "058", accountNumber: "0000000003" },
      ];
      expect(calculateBatchTotal(entries)).toBe(50000);
    });

    it("should group entries by bank", () => {
      const entries: SettlementEntry[] = [
        { agentId: "A1", amount: 10000, type: "commission", bankCode: "044", accountNumber: "0000000001" },
        { agentId: "A2", amount: 25000, type: "commission", bankCode: "044", accountNumber: "0000000002" },
        { agentId: "A3", amount: 15000, type: "bonus", bankCode: "058", accountNumber: "0000000003" },
      ];
      const grouped = groupByBank(entries);
      expect(grouped.get("044")?.length).toBe(2);
      expect(grouped.get("058")?.length).toBe(1);
    });
  });

  describe("Settlement Window", () => {
    it("should use instant for amounts ≤ ₦100K", () => {
      expect(determineSettlementWindow(50000)).toBe("instant");
      expect(determineSettlementWindow(100000)).toBe("instant");
    });

    it("should use same_day for amounts ≤ ₦5M", () => {
      expect(determineSettlementWindow(500000)).toBe("same_day");
      expect(determineSettlementWindow(5000000)).toBe("same_day");
    });

    it("should use next_day for amounts ≤ ₦25M", () => {
      expect(determineSettlementWindow(10000000)).toBe("next_day");
    });

    it("should use t+2 for amounts > ₦25M", () => {
      expect(determineSettlementWindow(30000000)).toBe("t_plus_2");
    });
  });

  describe("Settlement Fees", () => {
    it("should charge ₦0 for claim payouts", () => {
      expect(calculateSettlementFee(1000000, "claim_payout")).toBe(0);
    });

    it("should charge ₦10 for amounts ≤ ₦5K", () => {
      expect(calculateSettlementFee(3000, "commission")).toBe(10);
    });

    it("should charge ₦25 for amounts ≤ ₦50K", () => {
      expect(calculateSettlementFee(30000, "commission")).toBe(25);
    });

    it("should charge ₦50 for amounts ≤ ₦500K", () => {
      expect(calculateSettlementFee(200000, "commission")).toBe(50);
    });

    it("should charge ₦100 for amounts > ₦500K", () => {
      expect(calculateSettlementFee(1000000, "commission")).toBe(100);
    });
  });
});
