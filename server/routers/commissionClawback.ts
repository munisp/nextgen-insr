/**
 * Commission Clawback — DB-backed clawback management
 * Sprint 54: Full PostgreSQL + middleware integration
 */
import { TRPCError } from "@trpc/server";
import { and, eq, desc, count, sql } from "drizzle-orm";
import { z } from "zod";

import {
  commissionClawbacks,
  commissionAuditTrail,
} from "../../drizzle/schema";
import logger from "../_core/logger";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  publishCommissionEvent,
  tbRecordCommissionCredit,
  streamCommissionEvent,
} from "../middleware/commissionMiddleware";

export const commissionClawbackRouter = router({
  // F-12 (S87-02): the page's review workflow against the REAL
  // commission_clawbacks table (the regenerated revision exposed only getStats).
  list: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        page: z.number().default(1),
        limit: z.number().default(20),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "list: database unavailable",
        });
      const conditions = [];
      if (input.status)
        conditions.push(eq(commissionClawbacks.status, input.status));
      const where = conditions.length ? and(...conditions) : undefined;
      const [items, [{ total }]] = await Promise.all([
        db
          .select()
          .from(commissionClawbacks)
          .where(where)
          .orderBy(desc(commissionClawbacks.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit),
        db.select({ total: count() }).from(commissionClawbacks).where(where),
      ]);
      return { items, total: Number(total ?? 0), page: input.page, limit: input.limit };
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.number(), note: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "approve: database unavailable",
        });
      const [row] = await db
        .update(commissionClawbacks)
        .set({ status: "applied" })
        .where(
          and(
            eq(commissionClawbacks.id, input.id),
            eq(commissionClawbacks.status, "pending")
          )
        )
        .returning({ id: commissionClawbacks.id });
      if (!row)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "approve: no pending clawback with that id",
        });
      return { success: true, id: row.id, status: "applied" as const };
    }),

  reject: protectedProcedure
    .input(z.object({ id: z.number(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "reject: database unavailable",
        });
      const [row] = await db
        .update(commissionClawbacks)
        .set({ status: "rejected" })
        .where(
          and(
            eq(commissionClawbacks.id, input.id),
            eq(commissionClawbacks.status, "pending")
          )
        )
        .returning({ id: commissionClawbacks.id });
      if (!row)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "reject: no pending clawback with that id",
        });
      return { success: true, id: row.id, status: "rejected" as const };
    }),

  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [total] = await db
      .select({ cnt: count() })
      .from(commissionClawbacks)
      .limit(100);
    const [pending] = await db
      .select({ cnt: count() })
      .from(commissionClawbacks)
      .where(eq(commissionClawbacks.status, "pending"))
      .limit(100);
    const [applied] = await db
      .select({ cnt: count() })
      .from(commissionClawbacks)
      .where(eq(commissionClawbacks.status, "applied"))
      .limit(100);
    const [failed] = await db
      .select({ cnt: count() })
      .from(commissionClawbacks)
      .where(eq(commissionClawbacks.status, "failed"))
      .limit(100);
    const [totalAmt] = await db
      .select({
        t: sql<string>`COALESCE(SUM(${commissionClawbacks.clawbackAmount}::numeric),0)`,
      })
      .from(commissionClawbacks)
      .limit(100);
    return {
      total: total?.cnt ?? 0,
      pending: pending?.cnt ?? 0,
      approved: applied?.cnt ?? 0,
      applied: applied?.cnt ?? 0,
      disputed: failed?.cnt ?? 0,
      totalClawedBack: Number(totalAmt?.t ?? 0).toLocaleString(),
    };
  }),

  initiate: protectedProcedure
    .input(
      z.object({
        agentId: z.number(),
        amount: z.number(),
        reason: z.string(),
        transactionId: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
      const db = (await getDb())!;
      const [clawback] = await db
        .insert(commissionClawbacks)
        .values({
          reversalRequestId: input.transactionId ?? 0,
          agentId: input.agentId,
          originalCommission: String(input.amount * 2),
          clawbackAmount: String(input.amount),
          cascadeLevel: "agent",
          status: "pending",
        } as any)
        .returning();
      await db.insert(commissionAuditTrail).values({
        action: "clawback_initiated",
        entityType: "clawback",
        entityId: String(clawback.id),
        performedBy: ctx.user?.name ?? "system",
        details: JSON.stringify({
          reason: input.reason,
          amount: input.amount,
        } as any),
      } as any);
      try {
        await publishCommissionEvent({
          eventType: "commission.clawback.initiated" as any,
          clawbackId: clawback.id,
          agentId: input.agentId,
          amount: input.amount,
        } as any);
        await tbRecordCommissionCredit({
          agentId: input.agentId,
          amount: -input.amount,
          referenceId: `CLB-${clawback.id}`,
        } as any);
      } catch (e) {
        logger.warn(
          `[CommissionClawback] Middleware event failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      return { success: true, id: clawback.id, message: "Clawback initiated" };
    }),

  dispute: protectedProcedure
    .input(z.object({ id: z.number(), reason: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        const [updated] = await db
          .update(commissionClawbacks)
          .set({ status: "failed" } as any)
          .where(eq(commissionClawbacks.id, input.id))
          .returning();
        if (!updated)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Clawback not found",
          });
        await db.insert(commissionAuditTrail).values({
          action: "clawback_disputed",
          entityType: "clawback",
          entityId: String(input.id),
          performedBy: ctx.user?.name ?? "system",
          details: JSON.stringify({ reason: input.reason } as any),
        } as any);
        return { success: true, message: "Dispute filed" };
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
