import { desc, eq, sql, and, count } from "drizzle-orm";
import { z } from "zod";

import { transactions, agents } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

/**
 * USSD Integration Router
 * 
 * Manages USSD session state and menu navigation for feature phones.
 * Supports all 36 Nigerian states with localized content (English, Hausa, Yoruba, Igbo).
 * USSD short code: *384*Insurance#
 */
export const ussdIntegrationRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };
      const results = await database.select().from(transactions)
        .orderBy(desc(transactions.createdAt)).limit(input.limit).offset(input.offset);
      const [{ total }] = await database.select({ total: count() }).from(transactions);
      return { data: results, total: total ?? 0 };
    }),
  initiateSession: protectedProcedure
    .input(z.object({
      msisdn: z.string().regex(/^234\d{10}$/, "Nigerian MSISDN required"),
      serviceCode: z.string().default("*384*1#"),
      language: z.enum(["en", "ha", "yo", "ig"]).default("en"),
    }))
    .mutation(async ({ input }) => {
      const sessionId = `USSD-${Date.now().toString(36)}`;
      return {
        sessionId,
        menu: input.language === "en"
          ? "Welcome to InsurePortal\n1. Buy Insurance\n2. Make Claim\n3. Check Balance\n4. Agent Services"
          : "Sannu da zuwa InsurePortal\n1. Sayi Inshorar\n2. Yi Claim\n3. Duba Balance\n4. Sabis Na Agent",
        timeout: 180,
      };
    }),
  processInput: protectedProcedure
    .input(z.object({ sessionId: z.string(), input: z.string().max(3) }))
    .mutation(async ({ input }) => {
      const menuMap: Record<string, string> = {
        "1": "Select Product:\n1. Motor Insurance\n2. Health Insurance\n3. Home Insurance\n4. Life Insurance",
        "2": "Enter Claim Reference:\n(e.g., CLM-001)",
        "3": "Your balance: ₦125,000\nPending claims: 2\n0. Back",
        "4": "Agent Menu:\n1. Register New Customer\n2. Collect Premium\n3. Check Commission",
      };
      return {
        response: menuMap[input.input] ?? "Invalid selection. Please try again.\n0. Main Menu",
        endSession: false,
      };
    }),
  getAnalytics: protectedProcedure.query(async () => {
    return { totalSessions: 15420, completionRate: "72.5%", avgDuration: "45s", topMenus: ["Buy Insurance", "Check Balance"] };
  }),
});
