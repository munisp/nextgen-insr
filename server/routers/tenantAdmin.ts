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

import { tenants, auditLog, users } from "../../drizzle/schema";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";


// MOCKWARE FIX: inviteUser/removeUser were no-op successes, toggleLive never
// touched state, updateUser was a no-op, and listUsers/activityLog returned
// hardcoded empties. Invitations/removals now fail loudly (no identity or
// email provider is wired), toggleLive/updateUser/listUsers/activityLog are
// backed by the real tenants/users/audit_log tables.

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
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message:
          "User invitation is not configured: no email/identity provider is wired to deliver invitations",
      });
    }),

  listUsers: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { data: [], total: 0 };
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(100);
    return { data: rows, total: rows.length };
  }),

  removeUser: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message:
          "User removal is not configured: identity-provider deprovisioning is not wired in this service",
      });
    }),

  settings: protectedProcedure.query(async () => {
    return { data: [], total: 0 };
  }),

  toggleLive: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async ({ input }) => {
      const tenantPk = Number(input?.id);
      if (!Number.isFinite(tenantPk)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A numeric tenant id is required" });
      }
      const db = await getDb();
      if (!db)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [tenant] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, tenantPk))
        .limit(1);
      if (!tenant) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Tenant ${tenantPk} not found` });
      }
      const [updated] = await db
        .update(tenants)
        .set({ status: tenant.status === "active" ? "suspended" : "active", updatedAt: new Date() })
        .where(eq(tenants.id, tenantPk))
        .returning();
      await db.insert(auditLog).values({
        action: "tenant_live_toggled",
        resource: "tenants",
        resourceId: String(tenantPk),
        status: "success",
        metadata: { status: updated?.status },
      });
      return { success: true, status: updated?.status };
    }),
  // SECURITY (platform-provisioning invariant, THREAT_MODEL.md §7.1):
  // user-management is admin surface. The input schema is .strict() so a
  // `tenantId` key is rejected loudly instead of silently stripped — no
  // caller may ever move a user across the tenant boundary or to platform
  // scope (tenantId NULL) through this procedure. Additionally, a
  // tenant-scoped admin (tenantId non-NULL) may only touch users inside
  // their own tenant: platform-scope users and other tenants are FORBIDDEN.
  updateUser: adminProcedure
    .input(
      z
        .object({
          userId: z.string(),
          role: z.enum(["user", "admin", "supervisor"]).optional(),
          name: z.string().optional(),
        })
        .strict()
    )
    .mutation(async ({ input, ctx }) => {
      const userPk = Number(input.userId);
      if (!Number.isFinite(userPk)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid userId" });
      }
      const db = await getDb();
      if (!db)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [target] = await db
        .select({ id: users.id, tenantId: users.tenantId })
        .from(users)
        .where(eq(users.id, userPk))
        .limit(1);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: `User ${input.userId} not found` });
      }
      const callerTenantId = (ctx.user as { tenantId?: number | null }).tenantId ?? null;
      if (callerTenantId !== null && target.tenantId !== callerTenantId) {
        // Tenant-scoped admin may not edit platform-scope (tenantId NULL) or
        // cross-tenant users — fail closed.
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Tenant-scoped admins may only manage users within their own tenant",
        });
      }
      const setObj: any = { updatedAt: new Date() };
      if (input.role) setObj.role = input.role;
      if (input.name) setObj.name = input.name;
      const [updated] = await db
        .update(users)
        .set(setObj)
        .where(eq(users.id, userPk))
        .returning({ id: users.id });
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: `User ${input.userId} not found` });
      }
      await db.insert(auditLog).values({
        action: "tenant_user_updated",
        resource: "users",
        resourceId: input.userId,
        status: "success",
        metadata: { role: input.role ?? null, name: input.name ?? null },
      });
      return { success: true };
    }),
  activityLog: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).default({ limit: 50 }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { entries: [], total: 0 };
      const rows = await db
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.id))
        .limit(input.limit);
      return { entries: rows, total: rows.length };
    }),
});
