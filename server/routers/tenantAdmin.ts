// @ts-check
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
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
import { tenants, auditLog } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export const tenantAdminRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return {
        totalTenants: 0,
        activeTenants: 0,
        suspendedTenants: 0,
        totalAgents: 0,
        totalVolume: "0",
      };
    const [total] = await db
      .select({ value: count() })
      .from(tenants)
      .limit(100);
    const [active] = await db
      .select({ value: count() })
      .from(tenants)
      .where(eq(tenants.status, "active"))
      .limit(100);
    const [suspended] = await db
      .select({ value: count() })
      .from(tenants)
      .where(eq(tenants.status, "suspended"))
      .limit(100);
    const [agentSum] = await db
      .select({ value: sql<number>`COALESCE(SUM(${tenants.agentCount}), 0)` })
      .from(tenants)
      .limit(100);
    const [volSum] = await db
      .select({
        value: sql<string>`COALESCE(SUM(${tenants.monthlyVolume}), 0)`,
      })
      .from(tenants)
      .limit(100);
    return {
      totalTenants: Number(total.value),
      activeTenants: Number(active.value),
      suspendedTenants: Number(suspended.value),
      totalAgents: Number(agentSum.value),
      totalVolume: volSum.value,
    };
  }),
  listTenants: protectedProcedure
    .input(
      z
        .object({
          status: z.string().optional(),
          limit: z.number().default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { tenants: [], total: 0 };
        const rows = await db
          .select()
          .from(tenants)
          .orderBy(desc(tenants.createdAt))
          .limit(input?.limit ?? 20);
        return { tenants: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getTenant: protectedProcedure
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("Database connection unavailable");
        const rows = await db
          .select()
          .from(tenants)
          .where(eq(tenants.id, input.tenantId))
          .limit(1);
        return rows.length > 0 ? rows[0] : null;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  createTenant: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        slug: z.string(),
        contactEmail: z.string().optional(),
        contactPhone: z.string().optional(),
        planId: z.string().optional(),
        country: z.string().default("NGA"),
        currency: z.string().default("NGN"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [tenant] = await db
          .insert(tenants)
          .values({
            name: input.name,
            slug: input.slug,
            contactEmail: input.contactEmail,
            contactPhone: input.contactPhone,
            planId: input.planId,
            country: input.country,
            currency: input.currency,
            status: "trial",
          })
          .returning();
        await db.insert(auditLog).values({
          action: "tenant_created",
          resource: "tenants",
          resourceId: String(tenant.id),
          status: "success",
          metadata: { name: input.name, slug: input.slug },
        });
        return { success: true, tenant };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  updateTenant: protectedProcedure
    .input(
      z.object({
        tenantId: z.number(),
        name: z.string().optional(),
        contactEmail: z.string().optional(),
        contactPhone: z.string().optional(),
        planId: z.string().optional(),
        status: z.enum(["active", "suspended", "trial", "churned"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const { tenantId, ...updates } = input;
        const setObj: any = { ...updates, updatedAt: new Date() };
        Object.keys(setObj).forEach(k => {
          if (setObj[k] === undefined) delete setObj[k];
        });
        const [updated] = await db
          .update(tenants)
          .set(setObj)
          .where(eq(tenants.id, tenantId))
          .returning();
        await db.insert(auditLog).values({
          action: "tenant_updated",
          resource: "tenants",
          resourceId: String(tenantId),
          status: "success",
          metadata: updates,
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
  suspendTenant: protectedProcedure
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
          action: "tenant_suspended",
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

  dashboard: protectedProcedure.query(async () => {
    return {
      totalItems: 0,
      activeItems: 0,
      recentActivity: [],
      lastUpdated: new Date().toISOString(),
    };
  }),

  inviteUser: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      return { success: true };
    }),

  listUsers: protectedProcedure.query(async () => {
    return { data: [], total: 0 };
  }),

  removeUser: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      return { success: true };
    }),

  settings: protectedProcedure.query(async () => {
    return { data: [], total: 0 };
  }),

  toggleLive: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      return { success: true };
    }),
  updateUser: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        role: z.string().optional(),
        name: z.string().optional(),
      })
    )
    .mutation(async () => ({ success: true })),
  activityLog: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).default({}))
    .query(async () => ({ entries: [], total: 0 })),
});
