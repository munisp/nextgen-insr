import crypto from "crypto";

import { TRPCError } from "@trpc/server";
import { desc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { disputes, refunds, transactions, type Refund } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { protectedProcedure, router } from "../_core/trpc";
import { financialProcedure } from "../_core/permifyMiddleware";
import { getDb } from "../db";
import { assertTenantOwnership } from "../middleware/tenantIsolation";
import { tbCreateTransfer, TBLedgerUnavailableError } from "../tbClient";
import { deriveRefundTerms } from "../lib/refundTerms";

/**
 * Dispute Refund Router
 * Manages the full refund lifecycle for disputed transactions.
 * Implements CBN Consumer Protection Framework requirements.
 *
 * Business Rules:
 * - Auto-refund threshold: ≤ ₦5,000 (instant, no approval needed)
 * - Standard refund: ₦5,001 - ₦100,000 (supervisor approval, 48h SLA)
 * - High-value refund: ₦100,001 - ₦500,000 (manager + compliance, 5 business days)
 * - Executive refund: > ₦500,000 (CFO approval, fraud check mandatory)
 * - Daily refund cap per agent: ₦2,000,000
 * - Velocity check: Max 5 refunds per customer per 30 days
 * - Duplicate detection: Same amount ± ₦100 to same account within 24h
 *
 * Processing: `processRefund` (PAY-2) is the real payout path — it
 * atomically claims a queued refund, posts the compensating ledger transfer
 * via TigerBeetle (refund pool → customer), and transitions the refund to
 * "processed". Fail-loud: a ledger failure marks the refund "failed" with the
 * reason and surfaces an error; failed refunds are retryable by re-calling
 * processRefund (the ledger leg is ref-deduped, so retry is safe).
 */

const REFUND_TIERS = [
  { max: 5000, approval: "auto", sla_hours: 1, fraud_check: false },
  { max: 100000, approval: "supervisor", sla_hours: 48, fraud_check: false },
  { max: 500000, approval: "manager", sla_hours: 120, fraud_check: true },
  { max: Infinity, approval: "executive", sla_hours: 240, fraud_check: true },
];

const DAILY_AGENT_CAP = 2000000;
const MAX_REFUNDS_PER_CUSTOMER_30D = 5;

function getRefundTier(amount: number) {
  return REFUND_TIERS.find((t) => amount <= t.max)!;
}

// ─── F-01: Idempotency helpers ───────────────────────────────────────────────
type RefundPayload = {
  disputeId: number;
  amount: number;
  reason: string;
  customerId: number;
  accountNumber: string;
  agentId?: number;
};

/**
 * Canonical SHA-256 fingerprint of the business payload bound to an
 * idempotency key. Key reuse with a different payload is a client bug or a
 * replay attack and must be rejected explicitly — never silently re-executed.
 */
function refundPayloadHash(input: RefundPayload): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        disputeId: input.disputeId,
        amount: input.amount,
        reason: input.reason,
        customerId: input.customerId,
        accountNumber: input.accountNumber,
        agentId: input.agentId ?? null,
      })
    )
    .digest("hex");
}

/** Build the replay response for an already-persisted refund row. */
function idempotentReplay(row: Refund) {
  const amount = Number(row.refundAmount);
  const tier = getRefundTier(amount);
  const base = {
    success: true as const,
    idempotent: true as const,
    refundId: row.ref,
    amount,
  };
  if (tier.approval === "auto") {
    return {
      ...base,
      status: "pending",
      approval: "auto",
      message: `Idempotent replay: refund ${row.ref} already queued. No duplicate funds movement.`,
      sla: "1 hour",
    };
  }
  return {
    ...base,
    status: "pending_approval",
    approval: tier.approval,
    requiresFraudCheck: tier.fraud_check,
    slaDeadline: new Date(Date.now() + tier.sla_hours * 3600000).toISOString(),
    message: `Idempotent replay: refund ${row.ref} already queued for ${tier.approval} approval.`,
    nextAction: tier.fraud_check ? "fraud_screening" : `${tier.approval}_review`,
  };
}

/** Same key + different payload → explicit CONFLICT; same payload → replay. */
function replayOrConflict(row: Refund, payloadHash: string) {
  if (row.payloadHash && row.payloadHash !== payloadHash) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Idempotency key was already used with a different refund payload. " +
        "Refusing to re-execute; submit with a new idempotency key.",
    });
  }
  return idempotentReplay(row);
}

export const disputeRefundRouter = router({
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      status: z.enum(["all", "pending", "approved", "processed", "rejected", "flagged"]).default("all"),
    }))
    .query(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: input.limit, offset: input.offset };

      // Tenant isolation (F-05): tenant users only see their own tenant's
      // disputes. Users without a tenantId (platform staff, tenantId=0
      // sentinel per server/middleware/tenantIsolation.ts) are unscoped.
      const tenantId = ctx.user?.tenantId ?? 0;
      const where = tenantId !== 0 ? eq(disputes.tenantId, tenantId) : undefined;

      const results = await database.select().from(disputes).where(where).orderBy(desc(disputes.id)).limit(input.limit).offset(input.offset);
      const totalRows = await database.select({ total: count() }).from(disputes).where(where);

      const enriched = results.map((d) => {
        const tier = getRefundTier(Number(d.amount ?? 0));
        return {
          ...d,
          refundTier: tier.approval,
          slaHours: tier.sla_hours,
          requiresFraudCheck: tier.fraud_check,
          slaDeadline: new Date(Date.now() + tier.sla_hours * 3600000).toISOString(),
        };
      });

      return { data: enriched, total: totalRows[0]?.total ?? 0, limit: input.limit, offset: input.offset };
    }),

  initiateRefund: financialProcedure
    .input(z.object({
      disputeId: z.number(),
      amount: z.number().positive(),
      reason: z.string().min(10),
      customerId: z.number(),
      accountNumber: z.string(),
      agentId: z.number().optional(),
      // F-01: optional idempotency key. When supplied, the refund is bound to
      // the key (unique constraint) and to the payload hash; retries are
      // replayed, key reuse with a different payload is rejected (CONFLICT).
      idempotencyKey: z.string().min(8).max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Tenant isolation (F-05): when the referenced dispute exists and is
      // tenant-scoped, it must belong to the caller's tenant. Prevents
      // cross-tenant refund initiation (refund abuse via IDOR on disputeId).
      // Disputes that do not exist (legacy/free-form ids) are not blocked
      // here; the refund is still queued as "pending" with no rail call.
      const tenantId = ctx.user?.tenantId ?? 0;
      const [linkedDispute] = await database
        .select()
        .from(disputes)
        .where(eq(disputes.id, input.disputeId))
        .limit(1);
      if (linkedDispute) {
        assertTenantOwnership(linkedDispute.tenantId, tenantId, "Dispute");
      }

      // ── AB-19 (I-wave): refund terms are ALWAYS derived server-side ─────
      // Previously the client-supplied amount/accountNumber/customerId were
      // only reconciled when a dispute with a linked transaction existed —
      // the unlinked fallback trusted the client. Now fail-closed: the
      // dispute AND its original transaction must exist, the amount may not
      // exceed the original, and the destination is the original source
      // account (no client override; no verified settlement-override infra
      // exists for customer refunds).
      if (!linkedDispute) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Dispute not found — refund terms cannot be derived server-side without the disputed transaction",
        });
      }
      if (!linkedDispute.transactionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Dispute has no linked original transaction — client-supplied refund terms are not accepted",
        });
      }
      const [origTx] = await database
        .select()
        .from(transactions)
        .where(eq(transactions.id, linkedDispute.transactionId))
        .limit(1);
      if (!origTx) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Original transaction ${linkedDispute.transactionId} for dispute ${input.disputeId} not found — refusing client-supplied refund terms`,
        });
      }
      const terms = deriveRefundTerms(origTx, input);
      const effectiveAmount = terms.effectiveAmount;
      const effectiveDestination = terms.effectiveDestination;
      const originalTxId = terms.originalTxId;
      const tier = getRefundTier(effectiveAmount);

      // ── Idempotency: replay or reject before doing any work ─────────────
      const payloadHash = input.idempotencyKey
        ? refundPayloadHash({ ...input, amount: effectiveAmount, accountNumber: effectiveDestination })
        : null;
      if (input.idempotencyKey) {
        const [existing] = await database
          .select()
          .from(refunds)
          .where(eq(refunds.idempotencyKey, input.idempotencyKey))
          .limit(1);
        // Cross-tenant replay guard (F-05): a tenant user may not replay or
        // probe another tenant's refund by guessing its idempotency key.
        if (existing && existing.tenantId != null) {
          assertTenantOwnership(existing.tenantId, tenantId, "Refund");
        }
        if (existing) return replayOrConflict(existing, payloadHash!);
      }

      // PAY-2: ALL pre-checks and the queue insert run in ONE transaction
      // behind advisory locks, so velocity/duplicate/daily-cap/per-dispute
      // checks can never TOCTOU-race a concurrent request. AB-19: locks and
      // velocity are keyed on the AUTHENTICATED USER and the refund
      // destination account, never the attacker-chosen customerId.
      const refundRef = `REF-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const today = new Date(); today.setHours(0, 0, 0, 0);

      type QueueOutcome =
        | { blocked: true; response: Record<string, unknown> }
        | { blocked: false; inserted?: Refund };
      const queueOutcome = await database.transaction(async (tx): Promise<QueueOutcome> => {
        // Serialise concurrent refund initiation for this user + destination
        // (velocity TOCTOU fix): locks release automatically at commit/rollback.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`refund-user-${ctx.user?.id ?? 0}`}))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`refund-dest-${effectiveDestination}`}))`);
        if (input.agentId != null) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`refund-agent-${input.agentId}`}))`);
        }

        // Velocity check — AB-19: keyed on the AUTHENTICATED USER and the
        // refund destination account, not the attacker-chosen customerId.
        // Counts refunds in the last 30 days initiated by this user or sent
        // to the same destination account.
        const velocityRows = await tx.select({
          velocityCount: sql<number>`COUNT(*) FILTER (WHERE "createdAt" >= ${thirtyDaysAgo.toISOString()} AND ("initiatedByUserId" = ${ctx.user?.id ?? -1} OR "destinationAccount" = ${effectiveDestination}))`,
        }).from(refunds);
        const velocityCount = Number(velocityRows[0]?.velocityCount ?? 0);
        if (velocityCount >= MAX_REFUNDS_PER_CUSTOMER_30D) {
          return { blocked: true, response: {
            success: false,
            error: "velocity_exceeded",
            message: `Maximum ${MAX_REFUNDS_PER_CUSTOMER_30D} refunds in 30 days reached for this user or destination account`,
            recommendation: "Escalate to compliance team for review",
          } };
        }

        // PAY-2 double-refund block: one ACTIVE refund per dispute (backed by
        // the partial unique index refund_active_dispute_unique, migration
        // 0061 — the DB enforces it even if this pre-check races).
        // A row carrying THIS request's idempotency key is excluded: keyed
        // retries must reach the ON CONFLICT replay path below, not be
        // blocked by their own winner row.
        const [activeForDispute] = await tx.select({ ref: refunds.ref, status: refunds.status })
          .from(refunds)
          .where(sql`"disputeId" = ${input.disputeId} AND status NOT IN ('rejected','failed') AND "deletedAt" IS NULL
                AND (${input.idempotencyKey ?? null}::text IS NULL OR "idempotencyKey" IS NULL OR "idempotencyKey" <> ${input.idempotencyKey ?? ""})`)
          .limit(1);
        if (activeForDispute) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Dispute ${input.disputeId} already has an active refund (${activeForDispute.ref}, status=${activeForDispute.status}). Refusing to queue a second refund for the same dispute.`,
          });
        }

        // PAY-2 duplicate detection: same amount ± ₦100 to the same
        // destination within 24h is a probable duplicate and is refused loudly.
        const dupRows = await tx.select({ ref: refunds.ref, refundAmount: refunds.refundAmount })
          .from(refunds)
          .where(sql`"destinationAccount" = ${effectiveDestination} AND status NOT IN ('rejected','failed') AND "deletedAt" IS NULL AND "createdAt" >= ${oneDayAgo.toISOString()} AND ABS("refundAmount" - ${Math.round(effectiveAmount)}) <= 100
                AND (${input.idempotencyKey ?? null}::text IS NULL OR "idempotencyKey" IS NULL OR "idempotencyKey" <> ${input.idempotencyKey ?? ""})`)
          .limit(1);
        if (dupRows.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Probable duplicate: refund ${dupRows[0]!.ref} of ₦${dupRows[0]!.refundAmount} was already queued to this destination within 24h (±₦100 tolerance). If this is a genuinely separate refund, wait 24h or escalate to compliance.`,
          });
        }

        // PAY-2 daily agent cap (DAILY_AGENT_CAP was declared but never
        // enforced): sum of today's active refunds for this agent + this
        // amount must not exceed ₦2,000,000.
        if (input.agentId != null) {
          const [{ dayTotal }] = await tx.select({
            dayTotal: sql<string>`COALESCE(SUM("refundAmount") FILTER (WHERE status NOT IN ('rejected','failed') AND "deletedAt" IS NULL AND "createdAt" >= ${today.toISOString()}), 0)`,
          }).from(refunds).where(eq(refunds.agentId, input.agentId));
          if (Number(dayTotal ?? 0) + Math.round(effectiveAmount) > DAILY_AGENT_CAP) {
            return { blocked: true, response: {
              success: false,
              error: "daily_agent_cap_exceeded",
              message: `Agent daily refund cap of ₦${DAILY_AGENT_CAP.toLocaleString()} exceeded (today: ₦${Number(dayTotal ?? 0).toLocaleString()}, requested: ₦${effectiveAmount.toLocaleString()})`,
              recommendation: "Escalate to compliance team for review",
            } };
          }
        }

        // Persist the refund as a real queued record. No rail call is made
        // here, so the status is always "pending" — even for the auto tier,
        // which is queued without requiring manual approval.
        // ON CONFLICT DO NOTHING is the race-safe single-effect guarantee for
        // the idempotency key: when concurrent retries with the same key pass
        // the pre-check, exactly one insert lands; losers replay the winner.
        const insertedRows = await tx
          .insert(refunds)
          .values({
            ref: refundRef,
            idempotencyKey: input.idempotencyKey ?? null,
            payloadHash,
            disputeId: input.disputeId,
            transactionId: originalTxId,
            agentId: input.agentId ?? 0,
            customerId: input.customerId,
            originalAmount: Math.round(effectiveAmount),
            refundAmount: Math.round(effectiveAmount),
            currency: "NGN",
            reason: input.reason,
            category: "dispute_refund",
            status: "pending",
            method: "original_method",
            notes: `destination_account:${effectiveDestination}`,
            destinationAccount: effectiveDestination,
            initiatedByUserId: ctx.user?.id ?? null,
            tenantId: ctx.user?.tenantId ?? null,
          })
          .onConflictDoNothing(
            input.idempotencyKey ? { target: refunds.idempotencyKey } : undefined
          )
          .returning();
        return { blocked: false, inserted: insertedRows[0] };
      });

      if (queueOutcome.blocked) return queueOutcome.response as never;
      const inserted: Refund | undefined = queueOutcome.inserted;
      if (!inserted && input.idempotencyKey) {
        // Lost the race: a row with this key already exists — replay it, or
        // reject explicitly if the payload differs.
        const [winner] = await database
          .select()
          .from(refunds)
          .where(eq(refunds.idempotencyKey, input.idempotencyKey))
          .limit(1);
        if (winner) return replayOrConflict(winner, payloadHash!);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Refund insert conflicted but no existing row was found",
        });
      }

      if (tier.approval === "auto") {
        return {
          success: true,
          refundId: inserted?.ref ?? refundRef,
          status: "pending",
          amount: input.amount,
          approval: "auto",
          message: `Auto-tier refund of ₦${input.amount.toLocaleString()} queued for payout (within ₦5,000 threshold). No funds have moved yet.`,
          sla: "1 hour",
        };
      }

      return {
        success: true,
        refundId: inserted?.ref ?? refundRef,
        status: "pending_approval",
        amount: input.amount,
        approval: tier.approval,
        requiresFraudCheck: tier.fraud_check,
        slaDeadline: new Date(Date.now() + tier.sla_hours * 3600000).toISOString(),
        message: `Refund requires ${tier.approval} approval. SLA: ${tier.sla_hours}h`,
        nextAction: tier.fraud_check ? "fraud_screening" : `${tier.approval}_review`,
      };
    }),

  /**
   * PAY-2: the missing refund payout path. Previously refunds were queued
   * with status "pending" and NOTHING ever processed them — customer funds
   * were never returned.
   *
   * Real semantics (fail-closed):
   *   1. Atomically claim the refund (pending/approved/failed → processing).
   *      Exactly one processor wins; everyone else replays or conflicts.
   *   2. Post the compensating ledger transfer via TigerBeetle: the refund
   *      pool is debited and the customer is credited back. The transfer ref
   *      `${refund.ref}-PAYOUT` is ref-deduped by tbClient, so a retry after
   *      a crash/timeout between the ledger leg and the status update cannot
   *      double-pay.
   *   3. Mark the refund "processed" with the ledger transfer id.
   *   On ledger failure the refund is marked "failed" with the reason (loud)
   *   and the error propagates — it is retryable by calling processRefund
   *   again.
   */
  processRefund: protectedProcedure
    .input(z.object({ refundRef: z.string().min(5) }))
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [refund] = await database
        .select()
        .from(refunds)
        .where(eq(refunds.ref, input.refundRef))
        .limit(1);
      if (!refund) throw new TRPCError({ code: "NOT_FOUND", message: "Refund not found" });

      // Tenant isolation (F-05): tenant users may only process their own
      // tenant's refunds.
      const tenantId = ctx.user?.tenantId ?? 0;
      if (refund.tenantId != null) assertTenantOwnership(refund.tenantId, tenantId, "Refund");

      if (refund.status === "processed") {
        // Idempotent replay — the funds already moved; report, never re-pay.
        return { success: true, idempotent: true, refundRef: refund.ref, status: "processed" };
      }
      if (refund.status === "rejected") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Refund ${refund.ref} was rejected and cannot be processed` });
      }

      // Atomic claim: exactly one concurrent processor transitions the row.
      const claimed = await database
        .update(refunds)
        .set({ status: "processing", updatedAt: new Date() })
        .where(sql`ref = ${refund.ref} AND status IN ('pending','approved','failed')`)
        .returning();
      if (claimed.length === 0) {
        const [now] = await database.select().from(refunds).where(eq(refunds.ref, input.refundRef)).limit(1);
        if (now?.status === "processed") {
          return { success: true, idempotent: true, refundRef: refund.ref, status: "processed" };
        }
        throw new TRPCError({ code: "CONFLICT", message: `Refund ${refund.ref} is being processed concurrently` });
      }

      const amountKobo = Math.round(Number(refund.refundAmount) * 100);
      const payoutRef = `${refund.ref}-PAYOUT`;
      try {
        const tbResult = await tbCreateTransfer({
          debitAccountId: "insurer-refund-pool",
          creditAccountId: `customer-${refund.customerId}`,
          amount: amountKobo,
          ledger: 6000,
          code: 900,
          ref: payoutRef,
          txType: "refund_payout",
          agentId: refund.agentId ? String(refund.agentId) : undefined,
        });

        await database
          .update(refunds)
          .set({
            status: "processed",
            processedAt: new Date(),
            updatedAt: new Date(),
            metadata: JSON.stringify({ tbTransferId: tbResult?.id ?? null, payoutRef }),
          })
          .where(eq(refunds.ref, refund.ref));

        logger.info(`[RefundProcessor] processed ${refund.ref} ₦${refund.refundAmount} → customer ${refund.customerId} | TB: ${tbResult?.id ?? "n/a"}`);
        return { success: true, idempotent: false, refundRef: refund.ref, status: "processed", tbTransferId: tbResult?.id ?? null };
      } catch (err) {
        // FAIL-LOUD: mark failed with the reason so it is visible and
        // retryable; never leave a silent "processing" wedge.
        const reason = err instanceof Error ? err.message : String(err);
        await database
          .update(refunds)
          .set({ status: "failed", updatedAt: new Date(), notes: sql`COALESCE(notes,'') || ${" | payout_failed:" + reason.slice(0, 200)}` })
          .where(eq(refunds.ref, refund.ref))
          .catch(() => {});
        logger.error(`[RefundProcessor] payout FAILED for ${refund.ref}: ${reason}`);
        if (err instanceof TBLedgerUnavailableError) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Refund payout failed (ledger): ${reason}. Refund marked failed and is retryable.` });
        }
        throw err;
      }
    }),

  getSummary: protectedProcedure.query(async ({ ctx }) => {
    const database = await getDb();
    if (!database) return { totalDisputes: 0, pendingRefunds: 0, processedToday: 0, totalRefundedAmount: 0, avgProcessingTime: 0 };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Tenant isolation (F-05): aggregate counts are scoped to the caller's
    // tenant; platform users (no tenantId) see global totals.
    const tenantId = ctx.user?.tenantId ?? 0;
    const disputeWhere = tenantId !== 0 ? eq(disputes.tenantId, tenantId) : undefined;
    const refundWhere = tenantId !== 0 ? eq(refunds.tenantId, tenantId) : undefined;

    const [[{ total }], [{ pending }], [{ processedToday }], [{ totalRefunded }]] = await Promise.all([
      database.select({ total: count() }).from(disputes).where(disputeWhere),
      database.select({ pending: sql<number>`COUNT(*) FILTER (WHERE status = 'pending')` }).from(refunds).where(refundWhere),
      database.select({ processedToday: sql<number>`COUNT(*) FILTER (WHERE status = 'processed' AND "processedAt" >= ${today.toISOString()})` }).from(refunds).where(refundWhere),
      database.select({ totalRefunded: sql<string>`COALESCE(SUM("refundAmount") FILTER (WHERE status = 'processed'), 0)` }).from(refunds).where(refundWhere),
    ]);

    const totalCount = Number(total ?? 0);
    const pendingCount = Number(pending ?? 0);

    return {
      totalDisputes: totalCount,
      pendingRefunds: pendingCount,
      processedToday: Number(processedToday ?? 0),
      totalRefundedAmount: Number(totalRefunded ?? 0),
      avgProcessingTime: 0, // unknown — no settled-refund timing data yet
      lastUpdated: new Date().toISOString(),
    };
  }),

  getRefundPolicy: protectedProcedure.query(() => ({
    tiers: REFUND_TIERS.map((t) => ({
      maxAmount: t.max === Infinity ? "Unlimited" : `₦${t.max.toLocaleString()}`,
      approval: t.approval,
      slaHours: t.sla_hours,
      requiresFraudCheck: t.fraud_check,
    })),
    dailyAgentCap: DAILY_AGENT_CAP,
    maxRefundsPerCustomer30d: MAX_REFUNDS_PER_CUSTOMER_30D,
    duplicateWindowHours: 24,
    duplicateToleranceNaira: 100,
  })),
});
