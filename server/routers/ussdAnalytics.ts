import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { transactions } from "../../drizzle/schema";
import { desc, eq, sql, count, sum, gte } from "drizzle-orm";

/**
 * USSD Analytics Router
 *
 * Tracks USSD channel performance: session volumes, completion rates,
 * drop-off points, revenue attribution, and carrier breakdown.
 */
export const ussdAnalyticsRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };
      const results = await database.select().from(transactions).orderBy(desc(transactions.createdAt)).limit(input.limit).offset(input.offset);
      const [{ total }] = await database.select({ total: count() }).from(transactions);
      return { data: results, total: total ?? 0 };
    }),
  getDashboard: protectedProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(7) }))
    .query(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "USSD analytics dashboard is not implemented yet",
      });
    }),
  getMenuHeatmap: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "USSD menu heatmap is not implemented yet",
    });
  }),
});
