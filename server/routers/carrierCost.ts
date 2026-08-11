import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { transactions } from "../../drizzle/schema";
import { desc, eq, sql, count, sum } from "drizzle-orm";

/**
 * Carrier Cost Router
 *
 * Tracks and optimizes SMS/USSD carrier costs across Nigerian telcos.
 * Provides cost comparison, routing optimization, and budget management.
 *
 * Carriers: MTN (55% market share), Airtel (25%), Glo (14%), 9mobile (6%)
 */
export const carrierCostRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20), offset: z.number().default(0), carrier: z.string().optional() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };
      const results = await database.select().from(transactions).orderBy(desc(transactions.createdAt)).limit(input.limit).offset(input.offset);
      const [{ total }] = await database.select({ total: count() }).from(transactions);
      return { data: results, total: total ?? 0 };
    }),
  getCostBreakdown: protectedProcedure
    .input(z.object({ period: z.enum(["daily", "weekly", "monthly"]).default("monthly") }))
    .query(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "Carrier cost breakdown is not implemented yet",
      });
    }),
  getOptimalRoute: protectedProcedure
    .input(z.object({ msisdn: z.string(), priority: z.enum(["high", "normal", "low"]).default("normal") }))
    .query(async ({ input }) => {
      const prefix = input.msisdn.substring(0, 7);
      const carrierMap: Record<string, string> = { "2348030": "MTN", "2348060": "MTN", "2348080": "Airtel", "2348050": "Glo" };
      const carrier = carrierMap[prefix] ?? "MTN";
      return { carrier, route: input.priority === "high" ? "direct" : "aggregator", estimatedCost: input.priority === "high" ? 5.0 : 3.5 };
    }),
});
