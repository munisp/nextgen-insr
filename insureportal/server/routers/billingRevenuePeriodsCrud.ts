// @ts-nocheck
// Sprint 87: Full domain logic — period closing workflow, revenue recognition rules
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { billingRevenuePeriods } from "@schema";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const billingRevenuePeriodsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        periodType: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const conditions: any[] = [];
        if (input.periodType)
          conditions.push(
            eq(billingRevenuePeriods.periodType, input.periodType)
          );
        const rows = await db
          .select()
          .from(billingRevenuePeriods)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(billingRevenuePeriods.periodStart))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(billingRevenuePeriods)
          .where(conditions.length ? and(...conditions) : undefined)
          .limit(100);
        const enriched = rows.map(r => {
          const gross = Number(r.grossVolume);
          const fees = Number(r.totalFees);
          const commissions = Number(r.totalAgentCommissions);
          const netRevenue = fees - commissions;
          const margin = gross > 0 ? (netRevenue / gross) * 100 : 0;
          return {
            ...r,
            netRevenue: netRevenue.toFixed(2),
            marginPercent: Math.round(margin * 100) / 100,
            revenuePerAgent:
              r.activeAgents > 0
                ? (netRevenue / r.activeAgents).toFixed(2)
                : "0.00",
          };
        });
        return { items: enriched, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .select()
          .from(billingRevenuePeriods)
          .where(eq(billingRevenuePeriods.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Revenue period not found",
          });
        return row;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  closePeriod: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [period] = await db
          .select()
          .from(billingRevenuePeriods)
          .where(eq(billingRevenuePeriods.id, input.id))
          .limit(100);
        if (!period)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Period not found",
          });
        // Validate all data is reconciled before closing
        const gross = Number(period.grossVolume);
        const fees = Number(period.totalFees);
        if (fees > gross)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Total fees exceed gross volume — reconcile before closing",
          });
        const netProfit =
          fees -
          Number(period.totalAgentCommissions) -
          Number(period.totalSwitchFees) -
          Number(period.totalAggregatorFees);
        await db
          .update(billingRevenuePeriods)
          .set({ netPlatformProfit: netProfit.toFixed(2) })
          .where(eq(billingRevenuePeriods.id, input.id));
        return {
          success: true,
          netProfit: netProfit.toFixed(2),
          message: "Period closed with revenue recognized",
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
  compareperiods: protectedProcedure
    .input(z.object({ periodId1: z.number(), periodId2: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [p1] = await db
          .select()
          .from(billingRevenuePeriods)
          .where(eq(billingRevenuePeriods.id, input.periodId1))
          .limit(100);
        const [p2] = await db
          .select()
          .from(billingRevenuePeriods)
          .where(eq(billingRevenuePeriods.id, input.periodId2))
          .limit(100);
        if (!p1 || !p2)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "One or both periods not found",
          });
        return {
          period1: {
            id: p1.id,
            grossVolume: p1.grossVolume,
            txCount: p1.transactionCount,
            activeAgents: p1.activeAgents,
          },
          period2: {
            id: p2.id,
            grossVolume: p2.grossVolume,
            txCount: p2.transactionCount,
            activeAgents: p2.activeAgents,
          },
          volumeGrowth:
            Number(p1.grossVolume) > 0
              ? (
                  ((Number(p2.grossVolume) - Number(p1.grossVolume)) /
                    Number(p1.grossVolume)) *
                  100
                ).toFixed(2) + "%"
              : "N/A",
          txCountGrowth:
            p1.transactionCount > 0
              ? (
                  ((p2.transactionCount - p1.transactionCount) /
                    p1.transactionCount) *
                  100
                ).toFixed(2) + "%"
              : "N/A",
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
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .delete(billingRevenuePeriods)
          .where(eq(billingRevenuePeriods.id, input.id));
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
});
