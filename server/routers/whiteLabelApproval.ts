// @ts-check
import { TRPCError } from "@trpc/server";
import {
  eq,
  desc,
  and,
  sql,
  count,
  sum,
  isNull,
  gte,
  lte,
  or,
  asc,
} from "drizzle-orm";
import { z } from "zod";

import { tenants, auditLog } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const whiteLabelApprovalRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return {
        totalApplications: 0,
        pendingApproval: 0,
        approved: 0,
        rejected: 0,
      };
    const [total] = await db
      .select({ value: count() })
      .from(tenants)
      .limit(100);
    const statusCounts = await db
      .select({ status: tenants.status, cnt: count() })
      .from(tenants)
      .groupBy(tenants.status)
      .limit(100);
    const byStatus: Record<string, number> = {};
    statusCounts.forEach(r => {
      byStatus[r.status ?? "unknown"] = Number(r.cnt);
    });
    return {
      totalApplications: Number(total.value),
      pendingApproval: byStatus["pending"] ?? 0,
      approved: byStatus["active"] ?? 0,
      rejected: byStatus["suspended"] ?? 0,
    };
  }),
  listPending: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { applications: [], total: 0 };
        const rows = await db
          .select()
          .from(tenants)
          .where(eq(tenants.status, "trial"))
          .orderBy(desc(tenants.createdAt))
          .limit(input?.limit ?? 20);
        return { applications: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  approve: protectedProcedure
    .input(z.object({ tenantId: z.number(), notes: z.string().optional() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [updated] = await db
          .update(tenants)
          .set({ status: "active", updatedAt: new Date() })
          .where(eq(tenants.id, input.tenantId))
          .returning();
        await db.insert(auditLog).values({
          action: "whitelabel_approved",
          resource: "tenants",
          resourceId: String(input.tenantId),
          status: "success",
          metadata: { notes: input.notes },
        });
        return { success: true, tenant: updated };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  reject: protectedProcedure
    .input(z.object({ tenantId: z.number(), reason: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [updated] = await db
          .update(tenants)
          .set({ status: "suspended", updatedAt: new Date() })
          .where(eq(tenants.id, input.tenantId))
          .returning();
        await db.insert(auditLog).values({
          action: "whitelabel_rejected",
          resource: "tenants",
          resourceId: String(input.tenantId),
          status: "success",
          metadata: { reason: input.reason },
        });
        return { success: true, tenant: updated };
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
