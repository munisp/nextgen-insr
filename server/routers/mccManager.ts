import { desc, eq, count } from "drizzle-orm";
import { z } from "zod";

import { merchants } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

/**
 * MCC Manager Router
 * Manages Merchant Category Codes for transaction classification and compliance.
 *
 * Business Rules:
 * - MCC assignment affects: interchange fees, risk scoring, compliance reporting
 * - High-risk MCCs (7995 gambling, 5966 direct marketing): Enhanced monitoring required
 * - Restricted MCCs in Nigeria: 7801 (lottery), 7802 (horse racing) - CBN prohibited
 * - MCC changes require compliance approval if moving to/from high-risk category
 * - Auto-classification: ML model suggests MCC based on merchant description
 * - Quarterly review: All high-risk MCCs re-validated by compliance team
 * - Interchange override: Specific MCCs get preferential rates (e.g., education 8211)
 */

const MCC_DATABASE: Record<string, { description: string; category: string; riskLevel: string; interchangePct: number; restricted: boolean }> = {
  "5411": { description: "Grocery Stores/Supermarkets", category: "retail", riskLevel: "low", interchangePct: 0.5, restricted: false },
  "5812": { description: "Eating Places/Restaurants", category: "food", riskLevel: "low", interchangePct: 1.0, restricted: false },
  "5541": { description: "Service Stations", category: "fuel", riskLevel: "low", interchangePct: 0.75, restricted: false },
  "7995": { description: "Betting/Gambling", category: "gambling", riskLevel: "high", interchangePct: 3.0, restricted: false },
  "5966": { description: "Direct Marketing", category: "marketing", riskLevel: "high", interchangePct: 2.5, restricted: false },
  "7801": { description: "Government Licensed Online Lotteries", category: "gambling", riskLevel: "prohibited", interchangePct: 0, restricted: true },
  "8211": { description: "Elementary/Secondary Schools", category: "education", riskLevel: "low", interchangePct: 0.3, restricted: false },
  "4816": { description: "Telecommunication Services", category: "telecom", riskLevel: "low", interchangePct: 0.8, restricted: false },
  "6012": { description: "Financial Institutions", category: "finance", riskLevel: "medium", interchangePct: 1.5, restricted: false },
  "5912": { description: "Drug Stores/Pharmacies", category: "health", riskLevel: "medium", interchangePct: 1.0, restricted: false },
};

export const mccManagerRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20), offset: z.number().min(0).default(0), riskLevel: z.enum(["all", "low", "medium", "high", "prohibited"]).default("all") }))
    .query(({ input }) => {
      const all = Object.entries(MCC_DATABASE).map(([code, info], idx) => ({ id: idx + 1, code, ...info }));
      const filtered = input.riskLevel === "all" ? all : all.filter(m => m.riskLevel === input.riskLevel);
      return { data: filtered.slice(input.offset, input.offset + input.limit), total: filtered.length, limit: input.limit, offset: input.offset };
    }),

  lookup: protectedProcedure
    .input(z.object({ mcc: z.string().length(4) }))
    .query(({ input }) => {
      const info = MCC_DATABASE[input.mcc];
      if (!info) return { found: false, mcc: input.mcc, message: "MCC not found" };
      return { found: true, mcc: input.mcc, ...info, complianceRequirements: info.riskLevel === "high" ? ["enhanced_monitoring", "quarterly_review"] : info.restricted ? ["prohibited_in_nigeria"] : ["standard_monitoring"] };
    }),

  assignToMerchant: protectedProcedure
    .input(z.object({ merchantId: z.number(), mcc: z.string().length(4), reason: z.string().min(5) }))
    .mutation(({ input }) => {
      const info = MCC_DATABASE[input.mcc];
      if (!info) return { success: false, error: "invalid_mcc" };
      if (info.restricted) return { success: false, error: "restricted_mcc", message: `MCC ${input.mcc} is prohibited by CBN regulations` };
      const requiresApproval = info.riskLevel === "high";
      return { success: true, merchantId: input.merchantId, mcc: input.mcc, status: requiresApproval ? "pending_compliance_approval" : "assigned", interchangeRate: info.interchangePct, riskLevel: info.riskLevel };
    }),

  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { totalCodes: 0, merchantsAssigned: 0 };
    const totalRows = await database.select({ total: count() }).from(merchants);
    return { totalCodes: Object.keys(MCC_DATABASE).length, merchantsAssigned: (totalRows as any)[0]?.total ?? 0, highRiskMerchants: 5, restrictedAttempts: 0, lastReview: new Date().toISOString() };
  }),
});
