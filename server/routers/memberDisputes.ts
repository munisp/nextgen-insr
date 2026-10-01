/**
 * memberDisputes.ts — R3 batch 2 member surface (2026-10-01, R3-b2)
 *
 * Member-scoped disputes surface for the PWA
 * (customer-portal-full/client/src/services/memberDisputesApi.ts → mounted as
 * `memberDisputes`). This REPLACES the broken member procs on
 * customerDisputePortal (server/routers/customerDisputePortal.ts):
 *
 *   - fileDispute there inserts `{ customerId: ctx.user.id, ... } as any` and
 *     sets NEITHER `ref` (varchar(32) NOT NULL UNIQUE) NOR `agentId`
 *     (integer NOT NULL) — the disputes table has NO customerId column
 *     (drizzle/schema.ts:779) — so it can only fail at runtime. It is not
 *     copied here.
 *   - getStats there returns hardcoded fabricated constants — never consumed
 *     by this router or the PWA.
 *
 * Party rule (per the one already-hardened proc,
 * customerDisputePortal.listMyDisputes): `disputes.agentId = ctx.user.id`
 * DIRECTLY — disputes are keyed in the users.id space, no keycloakSub
 * resolution needed for scoping.
 *
 *   - myDisputes:   caller's disputes, optional status filter, paginated.
 *   - myDispute:    single dispute + disputeMessages + disputeEvidence,
 *                   `id AND agentId = ctx.user.id`; NOT_FOUND on miss
 *                   (non-enumerating — a foreign dispute id is
 *                   indistinguishable from a nonexistent one).
 *   - fileDispute:  verifies the disputed transaction belongs to the caller
 *                   FIRST (dual identity-space, memberPolicies 2026-10-01
 *                   precedent: transactions.agentId IN (ctx.user.id,
 *                   resolved customers.id)) → NOT_FOUND otherwise; mints a
 *                   UNIQUE ref ("DSP-" + 12 chars of a UUID), forces
 *                   agentId = ctx.user.id, status "open", priority "medium",
 *                   type "customer"; auditLog.
 *   - replyDispute: ownership re-check → NOT_FOUND; PRECONDITION_FAILED when
 *                   the dispute is resolved/closed; disputeMessages insert
 *                   with senderType FORCED "customer" and both the legacy
 *                   `message` and canonical `content` columns set.
 *
 * NO member escalate/resolve/status-change procs (staff workflow);
 * disputeRefund is a separate funds path, out of scope.
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; no fabricated dispute data.
 */
import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  auditLog,
  customers,
  disputeEvidence,
  disputeMessages,
  disputes,
  transactions,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

type DrizzleDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function db(): Promise<DrizzleDb> {
  const d = await getDb();
  if (!d) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable",
    });
  }
  return d;
}

/**
 * Resolve the caller's customer profile id (customers.keycloakSub =
 * String(ctx.user.id)) — memberPolicies.resolveSessionCustomer pattern,
 * 2026-10-01 R3 copy. Used ONLY for the dual identity-space transaction
 * ownership check in fileDispute (transactions.agentId is written in both
 * the users.id and customers.id spaces by different writers); the disputes
 * party column itself is always users.id. Returns null when no profile.
 */
async function resolveSessionCustomer(d: DrizzleDb, userId: number | string) {
  const [customer] = await d
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.keycloakSub, String(userId)))
    .limit(1);
  return customer ?? null;
}

// 2026-10-01 (R3-b2): member-facing filter subset of dispute statuses. The
// disputes.status column is a free varchar(32) (no pgEnum) with these values
// written by the real staff workflows (disputeResolution/dashboard +
// customerDisputePortal). Closed/resolved disputes stay visible to members.
const DISPUTE_STATUSES = [
  "open",
  "investigating",
  "escalated",
  "resolved",
  "closed",
] as const;

export const memberDisputesRouter = router({
  /**
   * Caller's disputes, newest first. Read-only, caller-scoped via
   * disputes.agentId = ctx.user.id (users.id space — correction 2 of the
   * batch-2 worklist).
   */
  myDisputes: protectedProcedure
    .input(
      z
        .object({
          status: z.enum(DISPUTE_STATUSES).optional(),
          limit: z.number().int().min(1).max(50).default(20),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const d = await db();
      const scope = and(
        eq(disputes.agentId, ctx.user.id),
        input?.status ? eq(disputes.status, input.status) : undefined
      );
      const rows = await d
        .select({
          id: disputes.id,
          ref: disputes.ref,
          transactionId: disputes.transactionId,
          transactionRef: disputes.transactionRef,
          status: disputes.status,
          priority: disputes.priority,
          type: disputes.type,
          reason: disputes.reason,
          amount: disputes.amount,
          createdAt: disputes.createdAt,
        })
        .from(disputes)
        .where(scope)
        .orderBy(desc(disputes.id))
        .limit(input?.limit ?? 20)
        .offset(input?.offset ?? 0);

      const [countRow] = await d
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(disputes)
        .where(scope);

      return { disputes: rows, count: countRow?.count ?? 0 };
    }),

  /**
   * Single dispute detail (status + messages + evidence) for the caller's
   * own dispute. NOT_FOUND for foreign ids — non-enumerating.
   */
  myDispute: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const d = await db();
      const [dispute] = await d
        .select({
          id: disputes.id,
          ref: disputes.ref,
          transactionId: disputes.transactionId,
          transactionRef: disputes.transactionRef,
          status: disputes.status,
          priority: disputes.priority,
          type: disputes.type,
          reason: disputes.reason,
          description: disputes.description,
          amount: disputes.amount,
          resolution: disputes.resolution,
          resolvedAt: disputes.resolvedAt,
          createdAt: disputes.createdAt,
          updatedAt: disputes.updatedAt,
        })
        .from(disputes)
        .where(and(eq(disputes.id, input.id), eq(disputes.agentId, ctx.user.id)))
        .limit(1);
      if (!dispute) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });
      }

      const messages = await d
        .select({
          id: disputeMessages.id,
          senderType: disputeMessages.senderType,
          senderName: disputeMessages.senderName,
          content: disputeMessages.content,
          createdAt: disputeMessages.createdAt,
        })
        .from(disputeMessages)
        .where(eq(disputeMessages.disputeId, dispute.id))
        .orderBy(disputeMessages.id)
        .limit(200);

      const evidence = await d
        .select({
          id: disputeEvidence.id,
          fileName: disputeEvidence.fileName,
          fileUrl: disputeEvidence.fileUrl,
          mimeType: disputeEvidence.mimeType,
          fileSize: disputeEvidence.fileSize,
          createdAt: disputeEvidence.createdAt,
        })
        .from(disputeEvidence)
        .where(eq(disputeEvidence.disputeId, dispute.id))
        .orderBy(disputeEvidence.id)
        .limit(100);

      return { dispute, messages, evidence };
    }),

  /**
   * File a dispute against one of the CALLER'S transactions. The disputed
   * transaction's ownership is verified FIRST (dual identity-space:
   * transactions.agentId IN (ctx.user.id, resolved customers.id) —
   * memberPolicies 2026-10-01 precedent); foreign/nonexistent transactions
   * answer NOT_FOUND (never FORBIDDEN) so the member surface does not
   * enumerate other members' transactions. Caller identity is forced
   * server-side: agentId = ctx.user.id, a UNIQUE ref is minted here, status
   * "open" — no client-controlled party/ref/status.
   */
  fileDispute: protectedProcedure
    .input(
      z.object({
        transactionId: z.number().int().positive(),
        reason: z.string().min(1).max(256),
        description: z.string().min(1).max(4000),
        amount: z.number().positive().max(100_000_000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const customer = await resolveSessionCustomer(d, ctx.user.id);
      const ownerIds = customer ? [ctx.user.id, customer.id] : [ctx.user.id];
      const [tx] = await d
        .select({
          id: transactions.id,
          ref: transactions.ref,
          agentId: transactions.agentId,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.id, input.transactionId),
            inArray(transactions.agentId, ownerIds)
          )
        )
        .limit(1);
      // Fail-closed + non-enumerating: a member cannot distinguish (or probe)
      // transactions they do not own.
      if (!tx) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Transaction not found",
        });
      }

      // Mint the NOT NULL UNIQUE ref here — the broken portal proc set
      // neither ref nor agentId (worklist correction 1).
      const ref = `DSP-${randomUUID().slice(0, 12).toUpperCase()}`;
      const [created] = await d
        .insert(disputes)
        .values({
          ref,
          transactionId: tx.id,
          transactionRef: tx.ref,
          agentId: ctx.user.id,
          reason: input.reason,
          description: input.description,
          amount: input.amount.toFixed(2),
          type: "customer",
          status: "open",
          priority: "medium",
          createdBy: ctx.user.name ?? null,
        })
        .returning({ id: disputes.id, ref: disputes.ref, status: disputes.status });

      await d.insert(auditLog).values({
        agentId: ctx.user.id,
        action: "member_dispute_filed",
        resource: "disputes",
        resourceId: String(created.id),
        status: "success",
        metadata: {
          ref: created.ref,
          transactionId: tx.id,
          reason: input.reason,
        },
      });

      return created;
    }),

  /**
   * Append a member reply to one of the caller's own disputes. Ownership is
   * re-verified here (NOT_FOUND — non-enumerating — for foreign disputes).
   * senderType is FORCED "customer" and both the legacy `message` and the
   * canonical `content` columns are set (schema comment: "'message' is the
   * legacy field name; 'content' is the canonical name"). Resolved/closed
   * disputes no longer accept replies → PRECONDITION_FAILED.
   */
  replyDispute: protectedProcedure
    .input(
      z.object({
        disputeId: z.number().int().positive(),
        content: z.string().min(1).max(4000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const [dispute] = await d
        .select({ id: disputes.id, status: disputes.status })
        .from(disputes)
        .where(
          and(eq(disputes.id, input.disputeId), eq(disputes.agentId, ctx.user.id))
        )
        .limit(1);
      if (!dispute) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });
      }
      if (dispute.status === "resolved" || dispute.status === "closed") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Dispute is ${dispute.status} and no longer accepts replies`,
        });
      }

      const [message] = await d
        .insert(disputeMessages)
        .values({
          disputeId: dispute.id,
          authorId: ctx.user.id,
          authorName: ctx.user.name ?? null,
          authorRole: "member",
          senderType: "customer",
          senderName: ctx.user.name ?? null,
          message: input.content,
          content: input.content,
        })
        .returning({ id: disputeMessages.id });

      return { id: message.id, senderType: "customer" as const };
    }),
});
