/**
 * F07: Merchant Payout Settlement
 * Batch payouts, settlement cycles, reconciliation, payout tracking
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { merchantPayouts, merchants, merchantSettlementChangeRequests } from "@schema";
import { eq, desc, and, gte, count, sum, sql, isNull } from "drizzle-orm";

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

  // H-wave (2026-09, mirrors platform G1 CRIT-5): the payout destination is
  // ALWAYS the merchant's verified settlement account on file — never
  // client-supplied. The previous version accepted arbitrary bank details
  // from the caller and checked neither merchant status nor balance.
  initiatePayout: protectedProcedure
    .input(
      z.object({
        merchantId: z.number(),
        amount: z.number().min(100),
        settlementCycle: z.enum(["T0", "T1", "T2", "weekly"]).default("T1"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");

        const [merchant] = await db
          .select()
          .from(merchants)
          .where(
            and(eq(merchants.id, input.merchantId), isNull(merchants.deletedAt))
          )
          .limit(1);
        if (!merchant)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Merchant not found",
          });
        if (merchant.status !== "active")
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Merchant is not active (status: ${merchant.status})`,
          });
        if (
          !merchant.settlementAccountNumber ||
          !merchant.settlementBankCode ||
          !merchant.settlementBankName
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Merchant has no verified settlement account on file",
          });

        // OTP-hold: payouts are blocked while a freshly-changed settlement
        // account is inside its cooling-off window (migration 0045).
        const [recentChange] = await db
          .select({ holdUntil: merchantSettlementChangeRequests.holdUntil })
          .from(merchantSettlementChangeRequests)
          .where(
            and(
              eq(merchantSettlementChangeRequests.merchantId, merchant.id),
              eq(merchantSettlementChangeRequests.status, "applied"),
              gte(merchantSettlementChangeRequests.holdUntil, new Date())
            )
          )
          .limit(1);
        if (recentChange)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Settlement account was recently changed; payouts held until ${recentChange.holdUntil?.toISOString()}`,
          });

        const walletBalance = Number(merchant.walletBalance ?? 0);
        if (walletBalance < input.amount)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Insufficient merchant balance. Available: ₦${walletBalance.toLocaleString()}`,
          });

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
            // Destination from the VERIFIED settlement record only.
            bankCode: merchant.settlementBankCode,
            accountNumber: merchant.settlementAccountNumber,
            accountName: merchant.businessName,
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
    .input(z.object({ payoutId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        // FAIL-LOUD (DD-LEGACY): this endpoint previously flipped a payout to
        // "processing" on the strength of a caller-supplied transferRef, with
        // no bank/rail call in the path. No payout rail is integrated in this
        // service, so execution is refused; the payout is left untouched.
        const [payout] = await db
          .select()
          .from(merchantPayouts)
          .where(eq(merchantPayouts.id, input.payoutId))
          .limit(1);
        if (!payout) throw new TRPCError({ code: "NOT_FOUND" });
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message:
            "merchantPayoutSettlement.processPayout is not implemented: no bank payout rail is integrated in this service and a caller-supplied transfer reference is not accepted as proof of execution. No state was changed.",
        });
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
        // FAIL-LOUD (DD-LEGACY): previously marked any payout "completed" on
        // the caller's say-so with no evidence of a real transfer. Terminal
        // status must only be written by a real rail callback, which does not
        // exist in this service — refuse loudly.
        const [payout] = await db
          .select()
          .from(merchantPayouts)
          .where(eq(merchantPayouts.id, input.payoutId))
          .limit(1);
        if (!payout) throw new TRPCError({ code: "NOT_FOUND" });
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message:
            "merchantPayoutSettlement.completePayout is not implemented: no payout rail exists in this service to confirm execution, so a terminal 'completed' status cannot be written from a caller request. No state was changed.",
        });
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
