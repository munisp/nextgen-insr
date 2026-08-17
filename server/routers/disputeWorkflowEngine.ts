// @ts-check
/**
 * Dispute Workflow Engine — DB-backed multi-step resolution with SLA tracking
 * Sprint 54: Full PostgreSQL + middleware integration
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, count, sql } from "drizzle-orm";
import { z } from "zod";

import { disputes, disputeMessages, sla_breaches } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { publishDisputeEvent } from "../middleware/disputeMiddleware";

export const disputeWorkflowEngineRouter = router({
  createDispute: protectedProcedure
    .input(
      z.object({
        transactionId: z.string(),
        reason: z.string(),
        description: z.string(),
        evidence: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        const ref = `WF-${Date.now()}`;
        const [d] = await db
          .insert(disputes)
          .values({
            ref,
            transactionId:
              parseInt(input.transactionId.replace(/\D/g, "")) || null,
            type: "workflow",
            reason: input.reason,
            description: input.description,
            amount: "0",
            status: "open",
            priority: "medium",
            createdBy: ctx.user?.name ?? "system",
          } as any)
          .returning();
        if (input.evidence?.length) {
          for (const e of input.evidence) {
            await db.insert(disputeMessages).values({
              disputeId: d.id,
              authorName: ctx.user?.name ?? "System",
              authorRole: "customer",
              message: `Evidence: ${e}`,
              content: `Evidence: ${e}`,
              senderType: "customer",
              senderName: ctx.user?.name ?? "System",
            } as any);
          }
        }
        try {
          await publishDisputeEvent({
            eventType: "dispute.workflow.created" as any,
            disputeId: d.id,
          } as any);
        } catch (e) {
          logger.warn("[DisputeWorkflow]: " + e);
        }
        return {
          success: true,
          message: "Dispute case created",
          id: d.id,
          ref: d.ref,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  listDisputes: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        priority: z.string().optional(),
        page: z.number().optional(),
        limit: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const page = input.page ?? 1;
        const limit = input.limit ?? 10;
        let rows;
        if (input.status)
          rows = await db
            .select()
            .from(disputes)
            .where(eq(disputes.status, input.status))
            .orderBy(desc(disputes.createdAt))
            .limit(limit)
            .offset((page - 1) * limit);
        else
          rows = await db
            .select()
            .from(disputes)
            .orderBy(desc(disputes.createdAt))
            .limit(limit)
            .offset((page - 1) * limit);
        const [t] = await db.select({ cnt: count() }).from(disputes).limit(100);
        return {
          items: rows.map(d => ({
            id: d.id,
            ref: d.ref,
            name: d.ref ?? `Dispute ${d.id}`,
            status: d.status,
            value: Number(d.amount),
            reason: d.reason,
            priority: d.priority,
            createdAt: d.createdAt?.toISOString() ?? new Date().toISOString(),
          })),
          total: t?.cnt ?? 0,
          page,
          limit,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        disputeId: z.number(),
        status: z.string(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        const updates: any = { status: input.status, updatedAt: new Date() };
        if (input.status === "resolved") {
          updates.resolvedAt = new Date();
          updates.resolvedBy = ctx.user?.name ?? "admin";
        }
        const [u] = await db
          .update(disputes)
          .set(updates)
          .where(eq(disputes.id, input.disputeId))
          .returning();
        if (!u)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Dispute not found",
          });
        if (input.notes) {
          await db.insert(disputeMessages).values({
            disputeId: input.disputeId,
            authorName: ctx.user?.name ?? "System",
            authorRole: "admin",
            message: input.notes,
            content: input.notes,
            senderType: "admin",
            senderName: ctx.user?.name ?? "System",
          } as any);
        }
        try {
          await publishDisputeEvent({
            eventType: "dispute.workflow.status_changed" as any,
            disputeId: input.disputeId,
          } as any);
        } catch (e) {
          logger.warn("[DisputeWorkflow]: " + e);
        }
        return {
          success: true,
          message: `Status updated to ${input.status}`,
          id: u.id,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  escalate: protectedProcedure
    .input(
      z.object({ disputeId: z.number(), level: z.string(), reason: z.string() })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        const [u] = await db
          .update(disputes)
          .set({
            status: "escalated",
            priority: input.level === "critical" ? "critical" : "high",
            updatedAt: new Date(),
          })
          .where(eq(disputes.id, input.disputeId))
          .returning();
        if (!u)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Dispute not found",
          });
        await db.insert(disputeMessages).values({
          disputeId: input.disputeId,
          authorName: ctx.user?.name ?? "System",
          authorRole: "admin",
          message: `Escalated to ${input.level}: ${input.reason}`,
          content: `Escalated to ${input.level}: ${input.reason}`,
          senderType: "admin",
          senderName: ctx.user?.name ?? "System",
        } as any);
        try {
          await publishDisputeEvent({
            eventType: "dispute.workflow.escalated" as any,
            disputeId: input.disputeId,
          } as any);
        } catch (e) {
          logger.warn("[DisputeWorkflow]: " + e);
        }
        return {
          success: true,
          message: `Escalated to ${input.level}`,
          id: u.id,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  getStats: protectedProcedure.query(async () => {
    // F-12 (full sweep): fixture stats (96.8/1250/850) -> REAL aggregates
    // from disputes. avgResolutionTime derived from resolved rows.
    const db = await getDb();
    if (!db)
      return {
        slaCompliance: 0, totalDisputes: 0, open: 0, inProgress: 0,
        resolved: 0, escalated: 0, avgResolutionTime: null,
      };
    const [tot] = await db.select({ value: count() }).from(disputes).limit(100);
    const statusRows = await db
      .select({ status: disputes.status, cnt: count() })
      .from(disputes)
      .groupBy(disputes.status)
      .limit(20);
    const byStatus: Record<string, number> = {};
    for (const r of statusRows) byStatus[r.status ?? "unknown"] = Number(r.cnt);
    const [sla] = await db
      .select({
        resolved: sql<number>`SUM(CASE WHEN ${disputes.resolvedAt} IS NOT NULL THEN 1 ELSE 0 END)`,
        within: sql<number>`SUM(CASE WHEN ${disputes.resolvedAt} IS NOT NULL AND ${disputes.resolvedAt} <= ${disputes.slaDeadlineAt} THEN 1 ELSE 0 END)`,
        avgDays: sql<number>`AVG(CASE WHEN ${disputes.resolvedAt} IS NOT NULL THEN EXTRACT(EPOCH FROM (${disputes.resolvedAt} - ${disputes.createdAt})) / 86400 END)`,
      })
      .from(disputes)
      .limit(100);
    const resolvedNum = Number(sla?.resolved ?? 0);
    const avgDays = sla?.avgDays != null ? Number(sla.avgDays) : null;
    return {
      slaCompliance:
        resolvedNum > 0
          ? Math.round((Number(sla?.within ?? 0) / resolvedNum) * 1000) / 10
          : 0,
      totalDisputes: Number(tot.value),
      open: byStatus["open"] ?? 0,
      inProgress: byStatus["in_progress"] ?? 0,
      resolved: byStatus["resolved"] ?? 0,
      escalated: byStatus["escalated"] ?? 0,
      avgResolutionTime:
        avgDays != null ? `${Math.round(avgDays * 10) / 10} days` : null,
    };
  }),

  getSlaReport: protectedProcedure
    .input(z.object({ period: z.string().optional() }))
    .query(async () => {
      const db = (await getDb())!;
      let breaches: any[] = [];
      try {
        breaches = await db
          .select()
          .from(sla_breaches)
          .orderBy(desc(sla_breaches.createdAt))
          .limit(20);
      } catch (err) { logger.error("[disputeWorkflowEngine] operation failed:: " + String(err)); }
      return {
        items: breaches.map((b, i) => ({
          id: b.id ?? i + 1,
          name: `SLA Breach ${b.id ?? i + 1}`,
          status: b.resolved ? "resolved" : "active",
          value: 0,
          createdAt: b.breachedAt?.toISOString() ?? new Date().toISOString(),
        })),
        total: breaches.length,
        page: 1,
        limit: 20,
      };
    }),

  autoResolve: protectedProcedure
    .input(z.object({ disputeId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        const [u] = await db
          .update(disputes)
          .set({
            status: "resolved",
            resolvedAt: new Date(),
            resolvedBy: "auto-resolver",
            resolution: "Auto-resolved by system rules",
            updatedAt: new Date(),
          })
          .where(eq(disputes.id, input.disputeId))
          .returning();
        if (!u)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Dispute not found",
          });
        await db.insert(disputeMessages).values({
          disputeId: input.disputeId,
          authorName: "Auto-Resolver",
          authorRole: "system",
          message: "Dispute auto-resolved by system rules engine",
          content: "Dispute auto-resolved by system rules engine",
          senderType: "system",
          senderName: "Auto-Resolver",
        } as any);
        try {
          await publishDisputeEvent({
            eventType: "dispute.workflow.auto_resolved" as any,
            disputeId: input.disputeId,
          } as any);
        } catch (e) {
          logger.warn("[DisputeWorkflow]: " + e);
        }
        return {
          success: true,
          message: "Auto-resolved successfully",
          id: u.id,
          timestamp: new Date().toISOString(),
        };
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
