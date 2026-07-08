// @ts-check

/**
 * Commission Payouts Router
 * Full lifecycle: request → approve/reject → process → complete
 * Integrates with agent commissionBalance and email notifications.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { commissionPayouts, agents } from "../../drizzle/schema";
import { eq, desc, and, count, gte, lte, sql } from "drizzle-orm";
import { enqueueEmail, buildAlertEmail } from "../lib/emailQueue";
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
            agentId: agent.id,
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
          agentId: input.agentId,
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
        if (payout.status !== "approved") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payout must be approved first",
          });
        }

        // Deduct from agent commission balance
        await db
          .update(agents)
          .set({
            commissionBalance: sql`${agents.commissionBalance} - ${payout.amount}`,
            updatedAt: new Date(),
          })
          .where(eq(agents.id, payout.agentId));

        const [updated] = await db
          .update(commissionPayouts)
          .set({
            status: "completed",
            nubanRef: input.nubanRef,
            processedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(commissionPayouts.id, input.id))
          .returning();

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
          .where(eq(agents.id, payout.agentId))
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
