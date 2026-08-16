/**
 * Commission Payouts Router
 * Full lifecycle: request → approve/reject → process → complete
 * Integrates with agent commissionBalance and email notifications.
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, and, count, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { commissionPayouts, agents } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb , writeAuditLog } from "../db";
import { enqueueEmail, buildAlertEmail } from "../lib/emailQueue";
import { dispatchWebhookEvent } from "../lib/webhookDelivery";

export const commissionPayoutsRouter = router({
  // ── List payouts (admin/supervisor) ──────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        status: z
          .enum([
            "pending",
            "approved",
            "processing",
            "completed",
            "failed",
            "rejected",
          ])
          .optional(),
        agentId: z.string().optional(),
        from: z.string().optional(), // ISO date
        to: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const offset = (input.page - 1) * input.limit;
        const conditions = [];
        if (input.status)
          conditions.push(eq(commissionPayouts.status, input.status));
        if (input.agentId)
          conditions.push(eq(commissionPayouts.agentId, input.agentId));
        if (input.from)
          conditions.push(
            gte(commissionPayouts.createdAt, new Date(input.from))
          );
        if (input.to)
          conditions.push(lte(commissionPayouts.createdAt, new Date(input.to)));

        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const [items, [{ c: total }]] = await Promise.all([
          db
            .select()
            .from(commissionPayouts)
            .where(where)
            .orderBy(desc(commissionPayouts.createdAt))
            .limit(input.limit)
            .offset(offset),
          db.select({ c: count() }).from(commissionPayouts).where(where),
        ]);
        return { items, total: Number(total) };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Get payout summary stats ──────────────────────────────────────────────
  stats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    if (!db) return { pending: 0, approved: 0, completed: 0, totalPaid: "0" };
    const rows = await db.select().from(commissionPayouts).limit(100);
    const pending = rows.filter((r: any) => r.status === "pending").length;
    const approved = rows.filter((r: any) => r.status === "approved").length;
    const completed = rows.filter((r: any) => r.status === "completed").length;
    const totalPaid = rows
      .filter((r: any) => r.status === "completed")
      .reduce((sum: any, r: any) => sum + parseFloat(r.amount as string), 0)
      .toFixed(2);
    return { pending, approved, completed, totalPaid };
  }),

  // ── Request a payout (agent self-service) ────────────────────────────────
  request: protectedProcedure
    .input(
      z.object({
        agentId: z.string(),
        amount: z.number().positive(),
        bankCode: z.string().max(10).optional(),
        accountNumber: z.string().max(20).optional(),
        accountName: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        // Verify agent and check commission balance
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentId, input.agentId))
          .limit(1);
        if (!agent)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Agent not found",
          });

        const balance = parseFloat(agent.commissionBalance as string);
        if (balance < input.amount) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Insufficient commission balance. Available: ₦${balance.toFixed(2)}`,
          });
        }
        if (input.amount < 500) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Minimum payout is ₦500",
          });
        }

        const [payout] = await db
          .insert(commissionPayouts)
          .values({
            agentId: input.agentId,
            amount: String(input.amount),
            bankCode: input.bankCode,
            accountNumber: input.accountNumber,
            accountName: input.accountName,
            requestedBy: ctx.user.id,
            status: "pending",
          })
          .returning();

        await writeAuditLog({
          agentId: agent.id,
          metadata: { agentCode: input.agentId },
          action: "commission_payout_requested",
          resource: "commission_payout",
          resourceId: String(payout.id),
          status: "success",
        });

        return payout;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Approve a payout (supervisor/admin) ──────────────────────────────────
  approve: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [payout] = await db
          .select()
          .from(commissionPayouts)
          .where(eq(commissionPayouts.id, input.id))
          .limit(1);
        if (!payout) throw new TRPCError({ code: "NOT_FOUND" });
        if (payout.status !== "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payout is not in pending state",
          });
        }

        const [updated] = await db
          .update(commissionPayouts)
          .set({
            status: "approved",
            approvedBy: ctx.user.id,
            updatedAt: new Date(),
          })
          .where(eq(commissionPayouts.id, input.id))
          .returning();

        await dispatchWebhookEvent("commission.payout.approved", {
          payoutId: updated.id,
          agentId: updated.agentId,
          amount: updated.amount,
        });

        return updated;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Reject a payout ───────────────────────────────────────────────────────
  reject: protectedProcedure
    .input(z.object({ id: z.number(), reason: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [updated] = await db
          .update(commissionPayouts)
          .set({
            status: "rejected",
            rejectedBy: ctx.user.id,
            rejectionReason: input.reason,
            updatedAt: new Date(),
          })
          .where(eq(commissionPayouts.id, input.id))
          .returning();

        return updated;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Process a payout (deduct from agent balance + mark completed) ────────
  process: protectedProcedure
    .input(z.object({ id: z.number(), nubanRef: z.string().optional() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [payout] = await db
          .select()
          .from(commissionPayouts)
          .where(eq(commissionPayouts.id, input.id))
          .limit(1);
        if (!payout) throw new TRPCError({ code: "NOT_FOUND" });
        // Idempotency: already completed — replay the durable row, no re-deduction
        if (payout.status === "completed") return payout;
        if (payout.status !== "approved") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payout must be approved first",
          });
        }

        // Distributed lock to prevent double-processing (optimization only —
        // the DB transaction below enforces single-effect even when Redis is
        // down and this lock fails open).
        const { acquireLock, releaseLock } = await import("../lib/redisClient");
        const { tbCreateTransfer } = await import("../tbClient");
        const lockKey = `commission-payout:${input.id}`;
        const locked = await acquireLock(lockKey, 30_000);
        if (!locked) throw new TRPCError({ code: "CONFLICT", message: "Payout already being processed" });

        let updated: typeof payout;
        try {
          // F-02: deterministic ledger reference (no Date.now()) so a worker
          // retry after a timeout re-submits the SAME ref and the sidecar can
          // deduplicate it instead of double-posting.
          const payRef = input.nubanRef ?? `COMM-PAYOUT-${input.id}`;
          // TigerBeetle: commissions-pool → agent-commission (COMMISSIONS ledger)
          const tbResult = await tbCreateTransfer({
            debitAccountId: "commissions-pool",
            creditAccountId: `agent-commission-${payout.agentId}`,
            amount: Math.round(Number(payout.amount) * 100),
            ledger: 5000,
            code: 500,
            ref: payRef,
            txType: "commission_payout",
            agentId: String(payout.agentId),
          });

          // F-02: status transition + balance deduction commit or roll back as
          // ONE unit. Previously these were two independent writes: a crash
          // (or any error) between them left the balance deducted while the
          // payout stayed "approved", and the status-based idempotency check
          // then allowed a retry to deduct AGAIN (double payout).
          type ProcessOutcome = { replay: true } | { replay: false; row: typeof payout };
          const outcome = await db.transaction(async (tx): Promise<ProcessOutcome> => {
            // Atomic claim: exactly one concurrent processor transitions
            // approved → completed. Everyone else gets zero rows and replays.
            const claimed = await tx
              .update(commissionPayouts)
              .set({
                status: "completed",
                nubanRef: payRef,
                processedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(and(
                eq(commissionPayouts.id, input.id),
                eq(commissionPayouts.status, "approved"),
              ))
              .returning();
            if (claimed.length === 0) return { replay: true };

            // Guarded atomic deduction — the no-negative-balance invariant is
            // enforced by the database, not by the earlier request-time read.
            const debited = await tx
              .update(agents)
              .set({
                commissionBalance: sql`CAST("commissionBalance" AS NUMERIC) - CAST(${payout.amount} AS NUMERIC)`,
                updatedAt: new Date(),
              })
              .where(and(
                eq(agents.agentId, payout.agentId),
                sql`CAST("commissionBalance" AS NUMERIC) - CAST(${payout.amount} AS NUMERIC) >= 0`,
              ))
              .returning({ balance: agents.commissionBalance });
            if (debited.length === 0) {
              // Rolls back the status claim — no partial durable state.
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "Insufficient commission balance at processing time",
              });
            }
            return { replay: false, row: claimed[0]! };
          });

          if (outcome.replay) {
            const [winner] = await db
              .select()
              .from(commissionPayouts)
              .where(eq(commissionPayouts.id, input.id))
              .limit(1);
            if (winner?.status === "completed") return winner; // idempotent replay
            throw new TRPCError({ code: "BAD_REQUEST", message: "Payout must be approved first" });
          }
          updated = outcome.row;
        } finally {
          await releaseLock(lockKey);
        }

        await dispatchWebhookEvent("commission.payout.completed", {
          payoutId: updated.id,
          agentId: updated.agentId,
          amount: updated.amount,
          nubanRef: updated.nubanRef,
        });

        // Send email notification
        const [agent] = await db
          .select({ email: agents.email, name: agents.name })
          .from(agents)
          .where(eq(agents.agentId, payout.agentId))
          .limit(1);
        if (agent?.email) {
          const { subject, html, text } = buildAlertEmail({
            title: "Commission Payout Processed",
            message: `Your commission payout of ₦${parseFloat(payout.amount as string).toLocaleString("en-NG", { minimumFractionDigits: 2 })} has been processed successfully.${input.nubanRef ? ` Reference: ${input.nubanRef}` : ""}`,
            severity: "low",
          });
          enqueueEmail({ to: agent.email, subject, html, text });
        }

        return updated;
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
