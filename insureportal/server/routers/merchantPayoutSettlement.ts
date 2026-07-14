/**
 * F07: Merchant Payout Settlement
 * Batch payouts, settlement cycles, reconciliation, payout tracking
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { merchantPayouts } from "@schema";
import { eq, desc, and, gte, count, sum, sql } from "drizzle-orm";

export const merchantPayoutSettlementRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        merchantId: z.number().optional(),
        status: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const conditions = [];
        if (input.merchantId)
          conditions.push(eq(merchantPayouts.merchantId, input.merchantId));
        if (input.status)
          conditions.push(eq(merchantPayouts.status, input.status));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const items = await db
          .select()
          .from(merchantPayouts)
          .where(where)
          .orderBy(desc(merchantPayouts.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit);
        const [{ total }] = await db
          .select({ total: count() })
          .from(merchantPayouts)
          .where(where)
          .limit(100);
        return { items, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  initiatePayout: protectedProcedure
    .input(
      z.object({
        merchantId: z.number(),
        amount: z.number().min(100),
        bankCode: z.string(),
        accountNumber: z.string(),
        accountName: z.string(),
        settlementCycle: z.enum(["T0", "T1", "T2", "weekly"]).default("T1"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const settlementDate = new Date();
        const cycleMap = { T0: 0, T1: 1, T2: 2, weekly: 7 };
        settlementDate.setDate(
          settlementDate.getDate() + cycleMap[input.settlementCycle]
        );
        const [payout] = await db
          .insert(merchantPayouts)
          .values({
            merchantId: input.merchantId,
            amount: String(input.amount),
            bankCode: input.bankCode,
            accountNumber: input.accountNumber,
            accountName: input.accountName,
            settlementCycle: input.settlementCycle,
            settlementDate,
            status: "pending",
            initiatedBy: ctx.user?.id,
          } as any)
          .returning();
        return { payout };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  approvePayout: protectedProcedure
    .input(z.object({ payoutId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        await db
          .update(merchantPayouts)
          .set({
            status: "approved",
          })
          .where(eq(merchantPayouts.id, input.payoutId));
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

  processPayout: protectedProcedure
    .input(z.object({ payoutId: z.number(), transferRef: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        await db
          .update(merchantPayouts)
          .set({
            status: "processing",
            processedAt: new Date(),
          })
          .where(eq(merchantPayouts.id, input.payoutId));
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

  completePayout: protectedProcedure
    .input(z.object({ payoutId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        await db
          .update(merchantPayouts)
          .set({
            status: "completed",
          })
          .where(eq(merchantPayouts.id, input.payoutId));
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

  summary: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    if (!db)
      return {
        totalPayouts: 0,
        totalAmount: "0",
        pendingAmount: "0",
        completedAmount: "0",
      };
    const [stats] = await db
      .select({ total: count(), totalAmount: sum(merchantPayouts.amount) })
      .from(merchantPayouts)
      .limit(100);
    const [pending] = await db
      .select({ amount: sum(merchantPayouts.amount) })
      .from(merchantPayouts)
      .where(eq(merchantPayouts.status, "pending"))
      .limit(100);
    const [completed] = await db
      .select({ amount: sum(merchantPayouts.amount) })
      .from(merchantPayouts)
      .where(eq(merchantPayouts.status, "completed"))
      .limit(100);
    return {
      totalPayouts: stats.total || 0,
      totalAmount: stats.totalAmount || "0",
      pendingAmount: pending.amount || "0",
      completedAmount: completed.amount || "0",
    };
  }),
});
