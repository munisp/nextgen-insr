/**
 * F07: Merchant Payout Settlement
 * Batch payouts, settlement cycles, reconciliation, payout tracking
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { merchantPayouts, merchants, merchantSettlementChangeRequests } from "@schema";
import { eq, desc, and, gte, count, sum, sql, isNull, isNotNull, ne } from "drizzle-orm";

function isNotNullGuard() {
  return isNotNull(merchantPayouts.initiatedBy);
}
import type { TrpcContext } from "../_core/context";

// ─── Merchant identity binding (H2-wave, 2026-09) ────────────────────────────
// Same contract as the merchant.ts port: the caller's Keycloak principal must
// be bound to a merchant row via merchants.keycloakSub. Fail-closed: no
// principal → 401, no bound merchant → 403, DB unavailable → 503-class,
// suspended merchant → 403. A caller can only initiate payouts for THEIR OWN
// merchant — a caller-supplied merchantId for another merchant is 403.
async function getBoundMerchant(ctx: TrpcContext): Promise<{
  id: number;
  merchantCode: string;
  businessName: string;
}> {
  const user = ctx.user;
  if (!user?.keycloakSub) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Merchant session required",
    });
  }
  let db;
  try {
    db = await getDb();
    // FAIL-CLOSED (503-class): this tree's getDb() returns a truthy NO-OP
    // chain when the database is unreachable/unconfigured — a truthy value
    // is NOT proof of availability. getPool() exposes the real connection
    // state; a null pool means identity lookup is impossible and every
    // merchant/money path must refuse.
    const { getPool } = await import("../db");
    const pool = await getPool();
    if (!pool) db = null;
  } catch (err) {
    // FAIL-CLOSED (503-class): never degrade to unbound access.
    console.error(
      `[payout] merchant binding DB unavailable: ${err instanceof Error ? err.message : String(err)}`
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Merchant identity service unavailable",
    });
  }
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Merchant identity service unavailable",
    });
  }
  const rows = await db
    .select({
      id: merchants.id,
      merchantCode: merchants.merchantCode,
      businessName: merchants.businessName,
      status: merchants.status,
    })
    .from(merchants)
    .where(
      and(
        eq(merchants.keycloakSub, user.keycloakSub),
        isNull(merchants.deletedAt)
      )
    )
    .limit(1);
  const merchant = rows[0];
  if (!merchant) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No merchant account is bound to this identity",
    });
  }
  if (merchant.status === "suspended") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Merchant account is suspended",
    });
  }
  return merchant;
}

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

        // H2-wave: the caller must be BOUND to the merchant they pay out
        // from — a caller-supplied merchantId for someone else's merchant
        // is 403, not an instruction.
        const bound = await getBoundMerchant(ctx);
        if (input.merchantId !== bound.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Payouts can only be initiated for your own merchant account",
          });
        }

        const [merchant] = await db
          .select()
          .from(merchants)
          .where(
            and(eq(merchants.id, bound.id), isNull(merchants.deletedAt))
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

        const settlementDate = new Date();
        const cycleMap = { T0: 0, T1: 1, T2: 2, weekly: 7 };
        settlementDate.setDate(
          settlementDate.getDate() + cycleMap[input.settlementCycle]
        );

        // H2-wave: ATOMIC debit + initiation in ONE transaction. The wallet
        // debit is a guarded UPDATE (WHERE walletBalance >= amount) — no
        // check-then-act; if the balance moved concurrently the guard trips,
        // zero rows come back, and the whole transaction (including the
        // payout row) rolls back. The funds are held from this point; the
        // payout lifecycle owns any reversal.
        const payout = await db.transaction(async tx => {
          const [debited] = await tx
            .update(merchants)
            .set({
              walletBalance: sql`${merchants.walletBalance} - ${input.amount}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(merchants.id, merchant.id),
                sql`${merchants.walletBalance}::numeric >= ${input.amount}`
              )
            )
            .returning({ walletBalance: merchants.walletBalance });
          if (!debited) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `Insufficient merchant balance. Available: ₦${Number(merchant.walletBalance ?? 0).toLocaleString()}`,
            });
          }
          const reference = `PO-${merchant.merchantCode}-${Date.now()}`;
          const [row] = await tx
            .insert(merchantPayouts)
            .values({
              merchantId: merchant.id,
              amount: String(input.amount),
              // Destination from the VERIFIED settlement record only.
              bankCode: merchant.settlementBankCode,
              accountNumber: merchant.settlementAccountNumber,
              accountName: merchant.businessName,
              // H2-wave: the insert previously wrote PHANTOM columns
              // (settlementCycle/settlementDate do not exist in this tree)
              // and omitted NOT NULL reference/period columns — it would have
              // failed on a real database. The settlement cycle now only
              // shifts the period end, and reference is generated honestly.
              reference,
              periodStart: new Date(),
              periodEnd: settlementDate,
              status: "pending",
              initiatedBy: ctx.user!.id,
            })
            .returning();
          return row;
        });
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

  // H2-wave (2026-09): admin-only — a merchant (or any plain user) must not
  // approve payouts, least of all their own. Guarded pending-only transition
  // + maker-checker: the initiator can never approve their own payout, and a
  // payout with no recorded initiator can never be approved (fail-closed).
  approvePayout: adminProcedure
    .input(z.object({ payoutId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const claimed = await db
          .update(merchantPayouts)
          .set({ status: "approved" })
          .where(
            and(
              eq(merchantPayouts.id, input.payoutId),
              eq(merchantPayouts.status, "pending"),
              isNotNullGuard(),
              ne(merchantPayouts.initiatedBy, ctx.user!.id)
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
          if (current.status !== "pending")
            throw new TRPCError({
              code: "CONFLICT",
              message: `Payout is not pending approval (current: ${current.status})`,
            });
          if (current.initiatedBy == null)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Payout has no recorded initiator and cannot be approved (maker-checker requires attribution)",
            });
          if (current.initiatedBy === ctx.user!.id)
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "Maker-checker violation: the payout initiator cannot approve their own payout",
            });
          throw new TRPCError({ code: "CONFLICT", message: "Payout cannot be approved" });
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
