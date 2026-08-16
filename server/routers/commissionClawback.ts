/**
 * Commission Clawback — DB-backed clawback management
 * Sprint 54: Full PostgreSQL + middleware integration
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, count, sql } from "drizzle-orm";
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

  list: protectedProcedure
    .input(
      z.object({
        page: z.number().optional(),
        status: z.string().optional(),
        limit: z.number().min(1).max(100).optional(),
      })
    )
    .query(async ({ input }) => {
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
      const limit = input?.limit ?? 50;
      const offset = ((input?.page ?? 1) - 1) * limit;
      const where = input?.status
        ? eq(commissionClawbacks.status, input.status)
        : undefined;
      const rows = where
        ? await db
            .select()
            .from(commissionClawbacks)
            .where(where)
            .orderBy(desc(commissionClawbacks.createdAt))
            .limit(limit)
            .offset(offset)
        : await db
            .select()
            .from(commissionClawbacks)
            .orderBy(desc(commissionClawbacks.createdAt))
            .limit(limit)
            .offset(offset);
      const [totalRow] = await db
        .select({ cnt: count() })
        .from(commissionClawbacks)
        .limit(100);
      return { items: rows, total: totalRow?.cnt ?? 0 };
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

  approve: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        const [updated] = await db
          .update(commissionClawbacks)
          .set({ status: "applied", appliedAt: new Date() } as any)
          .where(eq(commissionClawbacks.id, input.id))
          .returning();
        if (!updated)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Clawback not found",
          });
        await db.insert(commissionAuditTrail).values({
          action: "clawback_approved",
          entityType: "clawback",
          entityId: String(input.id),
          performedBy: ctx.user?.name ?? "system",
          details: JSON.stringify({
            appliedAt: new Date().toISOString(),
          } as any),
        } as any);
        try {
          await publishCommissionEvent({
            eventType: "commission.clawback.applied" as any,
          } as any);
        } catch (e) {
          logger.warn(
            `[CommissionClawback] Middleware event failed: ${e instanceof Error ? e.message : String(e)}`
          );
        }
        return { success: true, message: "Clawback approved and applied" };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
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
