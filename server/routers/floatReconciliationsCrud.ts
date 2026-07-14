// @ts-check
// Sprint 87: Full domain logic — auto-matching, variance detection, exception handling
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { floatReconciliations } from "../../drizzle/schema";
import { eq, desc, and, sql, count, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const VARIANCE_THRESHOLD_PERCENT = 5; // 5% variance triggers escalation
const AUTO_RESOLVE_THRESHOLD = 100; // Auto-resolve discrepancies under ₦100

export const floatReconciliationsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        agentId: z.number().optional(),
        status: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const conditions: any[] = [];
        if (input.agentId)
          conditions.push(eq(floatReconciliations.agentId, input.agentId));
        if (input.status)
          conditions.push(eq(floatReconciliations.status, input.status));
        const rows = await db
          .select()
          .from(floatReconciliations)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(floatReconciliations.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(floatReconciliations)
          .where(conditions.length ? and(...conditions) : undefined)
          .limit(100);
        const enriched = rows.map(r => {
          const expected = Number(r.expectedBalance);
          const actual = Number(r.actualBalance);
          const discrepancy = Number(r.discrepancy);
          const variancePercent =
            expected > 0 ? Math.abs(discrepancy / expected) * 100 : 0;
          return {
            ...r,
            variancePercent: Math.round(variancePercent * 100) / 100,
            severity:
              variancePercent > VARIANCE_THRESHOLD_PERCENT
                ? "critical"
                : variancePercent > 2
                  ? "warning"
                  : "normal",
          };
        });
        return { items: enriched, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .select()
          .from(floatReconciliations)
          .where(eq(floatReconciliations.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Reconciliation record not found",
          });
        return row;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  create: protectedProcedure
    .input(
      z.object({
        agentId: z.number(),
        expectedBalance: z.string(),
        actualBalance: z.string(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const expected = parseFloat(input.expectedBalance);
        const actual = parseFloat(input.actualBalance);
        const discrepancy = actual - expected;
        const variancePercent =
          expected > 0 ? Math.abs(discrepancy / expected) * 100 : 0;
        // Auto-resolve small discrepancies
        const autoResolved = Math.abs(discrepancy) < AUTO_RESOLVE_THRESHOLD;
        const status = autoResolved
          ? "resolved"
          : variancePercent > VARIANCE_THRESHOLD_PERCENT
            ? "escalated"
            : "pending";
        const [row] = await db
          .insert(floatReconciliations)
          .values({
            agentId: input.agentId,
            date: new Date(),
            expectedBalance: input.expectedBalance,
            actualBalance: input.actualBalance,
            discrepancy: discrepancy.toFixed(2),
            status,
            notes: autoResolved
              ? `Auto-resolved: discrepancy ₦${Math.abs(discrepancy).toFixed(2)} below threshold`
              : input.notes || null,
          })
          .returning();
        return {
          ...row,
          autoResolved,
          variancePercent: Math.round(variancePercent * 100) / 100,
          severity:
            variancePercent > VARIANCE_THRESHOLD_PERCENT
              ? "critical"
              : "normal",
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
  resolve: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        resolvedBy: z.number(),
        notes: z.string().min(5),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [existing] = await db
          .select()
          .from(floatReconciliations)
          .where(eq(floatReconciliations.id, input.id))
          .limit(100);
        if (!existing)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Reconciliation not found",
          });
        if (existing.status === "resolved")
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Already resolved",
          });
        const [row] = await db
          .update(floatReconciliations)
          .set({
            status: "resolved",
            resolvedBy: input.resolvedBy,
            resolvedAt: new Date(),
            notes: input.notes,
          })
          .where(eq(floatReconciliations.id, input.id))
          .returning();
        return { ...row, message: "Reconciliation resolved" };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getSummary: protectedProcedure
    .input(z.object({ agentId: z.number().optional() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const conditions = input.agentId
          ? [eq(floatReconciliations.agentId, input.agentId)]
          : [];
        const [stats] = await db
          .select({
            total: count(),
            pending: sql<number>`COUNT(*) FILTER (WHERE status = 'pending')`,
            escalated: sql<number>`COUNT(*) FILTER (WHERE status = 'escalated')`,
            resolved: sql<number>`COUNT(*) FILTER (WHERE status = 'resolved')`,
          })
          .from(floatReconciliations)
          .where(conditions.length ? and(...conditions) : undefined)
          .limit(100);
        return stats;
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
