/**
 * F07: Merchant Payout Settlement
 * Batch payouts, settlement cycles, reconciliation, payout tracking
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, and, gte, count, isNull, isNotNull, ne, or, sum, sql } from "drizzle-orm";
import { z } from "zod";

import {
  merchantPayouts,
  merchants,
  merchantSettlementChangeRequests,
} from "../../drizzle/schema";
import { financialProcedure } from "../_core/permifyMiddleware";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


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

  // CRIT-5 (G1 fix-wave, 2026-06): the payout destination is ALWAYS the
  // merchant's verified settlement account on file — never client-supplied.
  // The previous version accepted bankCode/accountNumber/accountName from
  // the caller (arbitrary cash-out) and never checked merchant status or
  // balance.
  initiatePayout: financialProcedure
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

        // CRIT-3 hold: payouts are blocked while a freshly-changed
        // settlement account is inside its cooling-off window.
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

        // Balance gate: never pay out more than the merchant's settled
        // wallet balance.
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
        const reference = `PO-${merchant.merchantCode}-${Date.now()}`;
        const [payout] = await db
          .insert(merchantPayouts)
          .values({
            merchantId: input.merchantId,
            amount: String(input.amount),
            // Destination from the VERIFIED settlement record only.
            bankCode: merchant.settlementBankCode,
            accountNumber: merchant.settlementAccountNumber,
            accountName: merchant.businessName,
            reference,
            periodStart: new Date(),
            periodEnd: settlementDate,
            status: "pending",
            initiatedBy: ctx.user.id,
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

  // F7-3: expected-state guards + maker-checker. Every transition is a
  // DB-guarded update: zero claimed rows means wrong state or self-approval,
  // and the honest reason is reported after a follow-up read.
  approvePayout: financialProcedure
    .input(z.object({ payoutId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const claimed = await db
          .update(merchantPayouts)
          .set({
            status: "approved",
          })
          .where(
            and(
              eq(merchantPayouts.id, input.payoutId),
              eq(merchantPayouts.status, "pending"),
              // HIGH-6 (G1 fix-wave, 2026-06): the NULL-initiator exemption
              // is REMOVED. A payout with no recorded initiator can never be
              // approved/processed (fail-closed for legacy rows) — otherwise
              // the same user could create AND approve it.
              isNotNull(merchantPayouts.initiatedBy),
              ne(merchantPayouts.initiatedBy, ctx.user.id)
            )
          )
          .returning({ id: merchantPayouts.id });
        if (claimed.length === 0) {
          const [current] = await db
            .select()
            .from(merchantPayouts)
            .where(eq(merchantPayouts.id, input.payoutId))
            .limit(1);
          if (!current)
            throw new TRPCError({ code: "NOT_FOUND", message: "Payout not found" });
          if (current.initiatedBy == null)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Payout has no recorded initiator and cannot be approved (maker-checker requires attribution)",
            });
          if (current.initiatedBy === ctx.user.id)
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "Maker-checker violation: the payout initiator cannot approve their own payout",
            });
          throw new TRPCError({
            code: "CONFLICT",
            message: `Payout is not in pending state (current: ${current.status})`,
          });
        }
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

  processPayout: financialProcedure
    .input(z.object({ payoutId: z.number(), transferRef: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const claimed = await db
          .update(merchantPayouts)
          .set({
            status: "processing",
            processedAt: new Date(),
          })
          .where(
            and(
              eq(merchantPayouts.id, input.payoutId),
              eq(merchantPayouts.status, "approved"),
              // HIGH-6 (G1 fix-wave, 2026-06): the NULL-initiator exemption
              // is REMOVED. A payout with no recorded initiator can never be
              // approved/processed (fail-closed for legacy rows) — otherwise
              // the same user could create AND approve it.
              isNotNull(merchantPayouts.initiatedBy),
              ne(merchantPayouts.initiatedBy, ctx.user.id)
            )
          )
          .returning({ id: merchantPayouts.id });
        if (claimed.length === 0) {
          const [current] = await db
            .select()
            .from(merchantPayouts)
            .where(eq(merchantPayouts.id, input.payoutId))
            .limit(1);
          if (!current)
            throw new TRPCError({ code: "NOT_FOUND", message: "Payout not found" });
          if (current.initiatedBy == null)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Payout has no recorded initiator and cannot be processed (maker-checker requires attribution)",
            });
          if (current.initiatedBy === ctx.user.id)
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "Maker-checker violation: the payout initiator cannot process their own payout",
            });
          throw new TRPCError({
            code: "CONFLICT",
            message: `Payout is not in approved state (current: ${current.status})`,
          });
        }
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

  completePayout: financialProcedure
    .input(z.object({ payoutId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const claimed = await db
          .update(merchantPayouts)
          .set({
            status: "completed",
          })
          .where(
            and(
              eq(merchantPayouts.id, input.payoutId),
              eq(merchantPayouts.status, "processing")
            )
          )
          .returning({ id: merchantPayouts.id });
        if (claimed.length === 0) {
          const [current] = await db
            .select()
            .from(merchantPayouts)
            .where(eq(merchantPayouts.id, input.payoutId))
            .limit(1);
          if (!current)
            throw new TRPCError({ code: "NOT_FOUND", message: "Payout not found" });
          throw new TRPCError({
            code: "CONFLICT",
            message: `Payout is not in processing state (current: ${current.status})`,
          });
        }
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
