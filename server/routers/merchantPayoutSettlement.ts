/**
 * F07: Merchant Payout Settlement
 * Batch payouts, settlement cycles, reconciliation, payout tracking
 *
 * 2026-11-28 (insureportal→root manual merge): union of both sides'
 * hardening — root's W10-B2 F-02 idempotency_records store (reserve/replay/
 * fail) is kept; ip's H2-wave caller→merchant binding + atomic guarded
 * wallet debit, J-wave atomic claim+audit on approve, the H-wave OTP-hold
 * (CRIT-3 cooling-off) guard, and the DD-LEGACY fail-loud
 * processPayout/completePayout were ported in. No safeguard from either
 * side was dropped.
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, and, gte, count, isNull, isNotNull, ne, or, sum, sql } from "drizzle-orm";
import { z } from "zod";

import {
  merchantPayouts,
  merchants,
  merchantSettlementChangeRequests,
  auditLog,
} from "../../drizzle/schema";
import { financialProcedure } from "../_core/permifyMiddleware";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { logger } from "../_core/logger";
// 2026-10-02 (W10-B2): payout idempotency rides the repo's ESTABLISHED F-02
// DB-backed store (idempotency_records, drizzle/schema.ts:913) via the
// journey-activities helpers — the same reserve/complete/fail semantics the
// TigerBeetle payout journeys use. Fail-closed: any store error propagates
// and the payout is REFUSED (never proceeds unprotected).
import {
  checkIdempotency,
  failIdempotency,
  IdempotencyConflictError,
  IdempotencyInProgressError,
  recordIdempotency,
} from "../journey-activities";

// 2026-10-02 (W10-B2): idempotency namespace for merchant payouts.
const PAYOUT_IDEM_JOURNEY = "merchant-payout";

/** Map the F-02 idempotency signals onto tRPC codes (replay-safety surface). */
function asIdempotencyTrpcError(error: unknown): TRPCError | null {
  if (error instanceof IdempotencyConflictError) {
    return new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof IdempotencyInProgressError) {
    return new TRPCError({
      code: "CONFLICT",
      message:
        "A payout with this idempotency key is currently in progress; retry after backoff",
    });
  }
  return null;
}

// ─── Merchant identity binding (2026-11-28 merge — ported from ip H2-wave) ──
// Same contract as premiumTopUp.assertCallerOwnsPolicy: privileged ops roles
// (admin/supervisor) may initiate payouts for any merchant; EVERY other
// caller (financialProcedure's matrix is the outer gate, this is
// defense-in-depth against a matrix widening) must be bound to the merchant
// they pay out from via merchants.keycloakSub — a caller-supplied merchantId
// for someone else's merchant is 403, never an instruction. Fail-closed: no
// principal → 401, no bound merchant → 403, suspended merchant → 403, DB
// unavailable → 503-class. (ip note retained: ip's getDb() returned a truthy
// NO-OP chain on outage, so the port double-checks getPool(); root's getDb()
// honestly returns null — both checks are kept, fail-closed either way.)
async function getBoundMerchant(ctx: {
  user: { id: number; role?: string | null; keycloakSub?: string | null } | null;
}): Promise<{ id: number; merchantCode: string; businessName: string }> {
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
    // ip H2 port parity: a truthy db handle is not proof of availability —
    // confirm the real pool (root getDb() returns null honestly; this is
    // belt-and-suspenders, fail-closed).
    const { getPool } = await import("../db");
    const pool = await getPool();
    if (!pool) db = null;
  } catch (err) {
    // FAIL-CLOSED (503-class): never degrade to unbound access.
    logger.error(
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

// 2026-11-28 (merge): admin/supervisor bypass the H2 binding (ops-initiated
// payouts — root's tested contract); all other callers must own the merchant.
async function assertCallerBoundToMerchant(
  ctx: { user: { id: number; role?: string | null; keycloakSub?: string | null } | null },
  merchantId: number
): Promise<void> {
  const role = ctx.user?.role;
  if (role === "admin" || role === "supervisor" || role === "super_admin") return;
  const bound = await getBoundMerchant(ctx);
  if (merchantId !== bound.id) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Payouts can only be initiated for your own merchant account",
    });
  }
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
        // 2026-10-02 (W10-B2): client-supplied idempotency key (or the
        // Idempotency-Key / X-Idempotency-Key header, resolved below). A
        // retried request MUST replay the original payout, never double-pay.
        idempotencyKey: z.string().min(8).max(64).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // 2026-10-02 (W10-B2): key from input or the standard headers
      // (financialAttackPrevention.ts honors "idempotency-key";
      // connectivityResilience.ts honors "x-idempotency-key").
      const headerKey =
        ((ctx.req?.headers?.["idempotency-key"] ??
          ctx.req?.headers?.["x-idempotency-key"]) as string | undefined) ||
        undefined;
      const idempotencyKey = input.idempotencyKey ?? headerKey;
      // Fail-closed: a funds mutation with NO idempotency key is refused.
      if (!idempotencyKey)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "An idempotency key is required to initiate a payout (idempotencyKey input or Idempotency-Key header)",
        });
      // The payload fingerprint binds the key to THESE funds parameters —
      // key reuse with a different amount/merchant is a CONFLICT (F-02).
      const idemPayload = {
        merchantId: input.merchantId,
        amount: input.amount,
        settlementCycle: input.settlementCycle,
      };
      try {
        // Reserve/replay BEFORE any side effect. A completed record replays
        // the ORIGINAL payout row verbatim — no second insert, no double-pay.
        const replay = await checkIdempotency(
          idempotencyKey,
          PAYOUT_IDEM_JOURNEY,
          idemPayload
        );
        if (replay !== null && replay !== undefined) {
          return { payout: (replay as { payout: unknown }).payout, idempotent: true };
        }
      } catch (error) {
        // Store failure → refuse the payout (fail-closed); conflict signals
        // surface as CONFLICT.
        const idemError = asIdempotencyTrpcError(error);
        if (idemError) throw idemError;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Idempotency store unavailable — payout refused (fail-closed): " +
            (error instanceof Error ? error.message : String(error)),
        });
      }

      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");

        // 2026-11-28 (merge, ip H2-wave): caller→merchant binding — ops roles
        // (admin/supervisor) bypass; every other caller must be bound to THIS
        // merchant via merchants.keycloakSub, else FORBIDDEN. Runs after the
        // idempotency reservation (so replays of an authorized call are not
        // re-authorized) and BEFORE any payout side effect.
        await assertCallerBoundToMerchant(ctx, input.merchantId);

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

        const settlementDate = new Date();
        const cycleMap = { T0: 0, T1: 1, T2: 2, weekly: 7 };
        settlementDate.setDate(
          settlementDate.getDate() + cycleMap[input.settlementCycle]
        );
        // 2026-10-02 (W10-B2): the reference is DERIVED from the idempotency
        // key (not Date.now()), so a crash between the payout insert and the
        // idempotency-record write is recoverable: the retried execution
        // finds the already-inserted row below and adopts it instead of
        // paying out twice.
        const reference = `PO-${merchant.merchantCode}-${idempotencyKey}`;
        const [priorPayout] = await db
          .select()
          .from(merchantPayouts)
          .where(eq(merchantPayouts.reference, reference))
          .limit(1);
        if (priorPayout) {
          await recordIdempotency(
            idempotencyKey,
            PAYOUT_IDEM_JOURNEY,
            { payout: priorPayout },
            idemPayload
          );
          return { payout: priorPayout, idempotent: true };
        }
        // 2026-11-28 (merge, ip H2-wave): ATOMIC wallet debit + payout
        // initiation in ONE transaction, replacing the check-then-act
        // balance gate. The debit is a guarded UPDATE
        // (WHERE walletBalance >= amount) — no read-then-write window; if
        // the balance moved concurrently the guard trips, zero rows come
        // back, and the whole transaction (including the payout row) rolls
        // back. The funds are held from this point; the payout lifecycle
        // owns any reversal.
        const payout = await db.transaction(async (tx) => {
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
          const [row] = await tx
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
          return row!;
        });
        // 2026-10-02 (W10-B2): persist the result under the reserved key so
        // any retry replays THIS row. A record failure is fatal (fail-closed)
        // — we refuse to leave an unprotected payout: mark the key failed and
        // surface the error rather than return success.
        await recordIdempotency(
          idempotencyKey,
          PAYOUT_IDEM_JOURNEY,
          { payout },
          idemPayload
        );
        return { payout };
      } catch (error) {
        // 2026-10-02 (W10-B2): release the reservation so an explicit client
        // retry can re-execute (failed reservations are reclaimable per F-02).
        try {
          await failIdempotency(
            idempotencyKey,
            PAYOUT_IDEM_JOURNEY,
            error instanceof Error ? error.message : String(error)
          );
        } catch {
          /* best-effort release; the stale-reservation takeover covers crashes */
        }
        const idemError = asIdempotencyTrpcError(error);
        if (idemError) throw idemError;
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
        // 2026-11-28 (merge, ip J-wave): the guarded claim AND the
        // actor-attributed audit row are ONE transaction — an approval
        // without its audit entry (or vice versa) must be impossible.
        const claimed = await db.transaction(async (tx) => {
          const rows = await tx
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
            .returning({
              id: merchantPayouts.id,
              merchantId: merchantPayouts.merchantId,
              amount: merchantPayouts.amount,
              initiatedBy: merchantPayouts.initiatedBy,
            });
          if (rows.length > 0) {
            await tx.insert(auditLog).values({
              action: "MERCHANT_PAYOUT_APPROVED",
              resource: "merchant_payouts",
              resourceId: String(rows[0]!.id),
              status: "success",
              metadata: {
                merchantId: rows[0]!.merchantId,
                amount: String(rows[0]!.amount),
                initiatedBy: rows[0]!.initiatedBy,
                approvedBy: ctx.user.id,
              },
            });
          }
          return rows;
        });
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

  // 2026-11-28 (merge): ip's DD-LEGACY fail-loud disposition wins over
  // root's fabricated execution. Root previously flipped a payout to
  // "processing" on the strength of a caller-supplied transferRef, with no
  // bank/rail call in the path. No payout rail is integrated in this
  // service, so execution is refused; the payout is left untouched
  // (maker-checker and state guards remain enforced inside the lifecycle
  // owner that eventually integrates a rail).
  processPayout: financialProcedure
    .input(z.object({ payoutId: z.number(), transferRef: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
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

  // 2026-11-28 (merge): same fail-loud disposition as processPayout — a
  // terminal 'completed' status must only be written by a real rail
  // callback, which does not exist in this service; refuse loudly instead
  // of marking any payout completed on the caller's say-so.
  completePayout: financialProcedure
    .input(z.object({ payoutId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
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
