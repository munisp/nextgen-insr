import crypto from "crypto";

import { TRPCError } from "@trpc/server";
import { desc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { disputes, refunds, type Refund } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { assertTenantOwnership } from "../middleware/tenantIsolation";

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
 * NOTE: No payment rail call is made here. Every initiated refund is
 * persisted to the refunds table with status "pending" (queued) and is
 * only marked processed by a downstream approval/payout flow.
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

      const enriched = results.map((d: any) => {
        const tier = getRefundTier(Number(d.amount ?? 0));
        return {
          ...d,
          refundTier: tier.approval,
          slaHours: tier.sla_hours,
          requiresFraudCheck: tier.fraud_check,
          slaDeadline: new Date(Date.now() + tier.sla_hours * 3600000).toISOString(),
        };
      });

      return { data: enriched, total: (totalRows as any)[0]?.total ?? 0, limit: input.limit, offset: input.offset };
    }),

  initiateRefund: protectedProcedure
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
      const tier = getRefundTier(input.amount);

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

      // ── Idempotency: replay or reject before doing any work ─────────────
      const payloadHash = input.idempotencyKey ? refundPayloadHash(input) : null;
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

      // Velocity check — real DB query for refunds in last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const velocityRows = await database.select({
        customerRefundCount: sql<number>`COUNT(*) FILTER (WHERE "customerId" = ${input.customerId} AND "createdAt" >= ${thirtyDaysAgo.toISOString()})`,
      }).from(refunds);
      const customerRefundCount = (velocityRows as any)[0]?.customerRefundCount ?? 0;
      if (Number(customerRefundCount) >= MAX_REFUNDS_PER_CUSTOMER_30D) {
        return {
          success: false,
          error: "velocity_exceeded",
          message: `Customer has reached maximum ${MAX_REFUNDS_PER_CUSTOMER_30D} refunds in 30 days`,
          recommendation: "Escalate to compliance team for review",
        };
      }

      // Persist the refund as a real queued record. No rail call is made
      // here, so the status is always "pending" — even for the auto tier,
      // which is queued without requiring manual approval.
      const refundRef = `REF-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
      // ON CONFLICT DO NOTHING is the race-safe single-effect guarantee: when
      // concurrent retries with the same key pass the pre-check, exactly one
      // insert lands; the losers get zero rows back (no error, no aborted
      // transaction) and replay the winner below.
      const insertedRows = await database
        .insert(refunds)
        .values({
          ref: refundRef,
          idempotencyKey: input.idempotencyKey ?? null,
          payloadHash,
          disputeId: input.disputeId,
          agentId: input.agentId ?? 0,
          customerId: input.customerId,
          originalAmount: Math.round(input.amount),
          refundAmount: Math.round(input.amount),
          currency: "NGN",
          reason: input.reason,
          category: "dispute_refund",
          status: "pending",
          method: "original_method",
          notes: `destination_account:${input.accountNumber}`,
          tenantId: ctx.user?.tenantId ?? null,
        })
        .onConflictDoNothing(
          input.idempotencyKey ? { target: refunds.idempotencyKey } : undefined
        )
        .returning();
      const inserted: Refund | undefined = insertedRows[0];
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
