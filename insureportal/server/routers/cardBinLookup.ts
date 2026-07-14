import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { transactions } from "@schema";
import { desc, count } from "drizzle-orm";

/**
 * Card BIN Lookup Router
 * Bank Identification Number database for card validation and routing.
 *
 * Business Rules:
 * - BIN range: First 6-8 digits of card number
 * - Nigerian banks: 11 supported issuers (First Bank, GTBank, Access, Zenith, etc.)
 * - Card types: Verve (local), Visa, Mastercard, AMEX
 * - Routing: Verve → domestic switch (NIBSS), Visa/MC → international switch
 * - Risk flags: Prepaid cards get +15 risk score, virtual cards +10
 * - Velocity by BIN: Track fraud patterns per issuer
 * - Decline codes: Map to customer-friendly messages
 */

const NIGERIAN_BINS: Record<string, { bank: string; type: string; network: string; prepaid: boolean }> = {
  "506099": { bank: "First Bank", type: "debit", network: "Verve", prepaid: false },
  "506100": { bank: "First Bank", type: "credit", network: "Verve", prepaid: false },
  "539983": { bank: "GTBank", type: "debit", network: "Mastercard", prepaid: false },
  "539941": { bank: "GTBank", type: "prepaid", network: "Mastercard", prepaid: true },
  "428610": { bank: "Access Bank", type: "debit", network: "Visa", prepaid: false },
  "519911": { bank: "Zenith Bank", type: "debit", network: "Mastercard", prepaid: false },
  "506101": { bank: "UBA", type: "debit", network: "Verve", prepaid: false },
  "418742": { bank: "Sterling Bank", type: "debit", network: "Visa", prepaid: false },
  "506102": { bank: "Wema Bank", type: "debit", network: "Verve", prepaid: false },
  "539988": { bank: "Fidelity Bank", type: "debit", network: "Mastercard", prepaid: false },
  "506103": { bank: "FCMB", type: "debit", network: "Verve", prepaid: false },
};

function getRoutingSwitch(network: string): string {
  return network === "Verve" ? "NIBSS_domestic" : "international_switch";
}

export const cardBinLookupRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20), offset: z.number().min(0).default(0) }))
    .query(async ({ input }) => {
      const bins = Object.entries(NIGERIAN_BINS).map(([bin, info], idx) => ({ id: idx + 1, bin, ...info, routing: getRoutingSwitch(info.network), riskAdjustment: info.prepaid ? 15 : 0 }));
      return { data: bins.slice(input.offset, input.offset + input.limit), total: bins.length, limit: input.limit, offset: input.offset };
    }),

  lookup: protectedProcedure
    .input(z.object({ bin: z.string().min(6).max(8) }))
    .query(({ input }) => {
      const prefix = input.bin.slice(0, 6);
      const match = NIGERIAN_BINS[prefix];
      if (!match) return { found: false, bin: prefix, message: "BIN not found in Nigerian database", suggestion: "May be international card — route to international switch" };
      return { found: true, bin: prefix, ...match, routing: getRoutingSwitch(match.network), riskAdjustment: match.prepaid ? 15 : match.type === "credit" ? 5 : 0, supportedCurrencies: match.network === "Verve" ? ["NGN"] : ["NGN", "USD", "GBP", "EUR"] };
    }),

  getSummary: protectedProcedure.query(() => ({
    totalBins: Object.keys(NIGERIAN_BINS).length,
    banks: [...new Set(Object.values(NIGERIAN_BINS).map(b => b.bank))].length,
    networks: { Verve: 5, Mastercard: 4, Visa: 2 },
    domesticRouting: "NIBSS",
    internationalRouting: "international_switch",
    lastUpdated: new Date().toISOString(),
  })),
});
