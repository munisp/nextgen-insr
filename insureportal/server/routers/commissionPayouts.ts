/**
 * Commission Payouts Router
 * Full lifecycle: request → approve/reject → process → complete
 * Integrates with agent commissionBalance and email notifications.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { commissionPayouts, agents } from "@schema";
import { eq, desc, and, count, gte, lte } from "drizzle-orm";
import { dispatchWebhookEvent } from "../lib/webhookDelivery";
import { writeAuditLog } from "../db";

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
          conditions.push(eq(commissionPayouts.agentId, Number(input.agentId)));
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
            agentId: agent.id,
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
    .input(z.object({ id: z.number() }))
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
        if (payout.status !== "approved") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Payout must be in approved state to process (current: ${payout.status})`,
          });
        }

        // FAIL-LOUD (DD-LEGACY): this endpoint previously deducted the agent's
        // commission balance and marked the payout "completed" using a
        // caller-supplied `nubanRef` as "proof" of bank payout — no NIBSS /
        // bank transfer call exists in this service. No real payout rail is
        // integrated here, so refuse loudly BEFORE touching any balance. The
        // payout stays in "approved" state for a real rail to execute.
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message:
            "commissionPayouts.process is not implemented: no bank payout rail (NIBSS/Paystack transfer) is integrated in this service, so a payout cannot be executed and a caller-supplied reference is not accepted as proof of payment. The payout remains in 'approved' state; no balance was changed.",
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
});
