import { TRPCError } from "@trpc/server";
import { sql, desc, eq, and, between } from "drizzle-orm";
import { z } from "zod";

import { transactions } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

export const autoReconciliationEngineRouter = router({
  reconcile: protectedProcedure
    .input(
      z.object({
        startDate: z.string(),
        endDate: z.string(),
        accountId: z.string().optional(),
        tolerance: z.number().default(0.01),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const start = new Date(input.startDate);
        const end = new Date(input.endDate);
        const txns = await db
          .select({
            count: sql<number>`COUNT(*)`,
            total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
          })
          .from(transactions)
          .where(between(transactions.createdAt, start, end))
          .limit(100);
        const floats = await db
          .select({
            count: sql<number>`COUNT(*)`,
            total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
          })
          .from(transactions)
          .limit(100);
        const txTotal = Number(txns[0]?.total || 0);
        const floatTotal = Number(floats[0]?.total || 0);
        const variance = Math.abs(txTotal - floatTotal);
        return {
          matched: variance <= input.tolerance * txTotal,
          txTotal,
          floatTotal,
          variance,
          matchRate: txTotal > 0 ? 1 - variance / txTotal : 1,
          txCount: Number(txns[0]?.count || 0),
          reconciledAt: new Date().toISOString(),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  list: protectedProcedure
    .input(
      z.object({ page: z.number().default(1), limit: z.number().default(20) })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const items = await db
          .select()
          .from(transactions)
          .orderBy(desc(transactions.createdAt))
          .limit(input.limit);
        return { items, total: items.length, page: input.page };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getExceptions: protectedProcedure
    .input(z.object({ startDate: z.string(), endDate: z.string() }))
    .query(async ({ input }) => {
      try {
        return {
          exceptions: [],
          startDate: input.startDate,
          endDate: input.endDate,
          count: 0,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(transactions)
      .limit(100);
    return {
      totalReconciled: Number(count),
      // F-12: no match-rate source here — honest null, not a 98% claim.
      matchRate: null,
      lastRunAt: new Date().toISOString(),
    };
  }),
});
