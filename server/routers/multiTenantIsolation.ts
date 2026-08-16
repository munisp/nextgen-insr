/**
 * Multi-tenant isolation router — PLATFORM-ADMIN surface.
 *
 * SECURITY (F-05 residual, THREAT_MODEL.md §7.3): every procedure here is
 * gated behind adminProcedure (JWT role=admin + Permify admin_access).
 * Previously mounted on plain protectedProcedure, which let ANY authenticated
 * user enumerate, create and suspend tenants. Tenant CRUD and the platform
 * tenant directory are platform-admin operations only.
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, sql, count } from "drizzle-orm";
import { z } from "zod";

import {
  tenants,
  tenantUsers,
  tenantBranding,
  auditLog,
} from "../../drizzle/schema";
import { router, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const multiTenantIsolationRouter = router({
  listTenants: adminProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(tenants)
          .orderBy(desc(tenants.createdAt))
          .limit(input?.limit ?? 50);
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
  getTenant: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [tenant] = await db
          .select()
          .from(tenants)
          .where(eq(tenants.id, input.id))
          .limit(1);
        if (!tenant) return null;
        const [userCount] = await db
          .select({ value: count() })
          .from(tenantUsers)
          .where(eq(tenantUsers.tenantId, input.id))
          .limit(100);
        return { ...tenant, userCount: Number(userCount.value) };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  createTenant: adminProcedure
    .input(
      z.object({
        name: z.string(),
        domain: z.string().optional(),
        plan: z.string().default("standard"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        // tenants.slug is NOT NULL/unique — derive one from the name with a
        // uniqueness suffix (previously unset, so every insert failed).
        const slug =
          input.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48) +
          "-" +
          Date.now().toString(36);
        const [tenant] = await db
          .insert(tenants)
          .values({
            name: input.name,
            slug,
            domain: input.domain,
            status: "active",
          } as any)
          .returning();
        await db.insert(auditLog).values({
          action: "tenant_created",
          resource: "tenants",
          resourceId: String(tenant.id),
          status: "success",
          metadata: { name: input.name },
        } as any);
        return tenant;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  suspendTenant: adminProcedure
    .input(z.object({ id: z.number(), reason: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .update(tenants)
          .set({ status: "suspended" })
          .where(eq(tenants.id, input.id));
        await db.insert(auditLog).values({
          action: "tenant_suspended",
          resource: "tenants",
          resourceId: String(input.id),
          status: "warning",
          metadata: { reason: input.reason },
        });
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getStats: adminProcedure.query(async () => {
    const db = (await getDb())!;
    const [total] = await db
      .select({ value: count() })
      .from(tenants)
      .limit(100);
    const [active] = await db
      .select({ value: count() })
      .from(tenants)
      .where(eq(tenants.status, "active"))
      .limit(100);
    return {
      totalTenants: Number(total.value),
      activeTenants: Number(active.value),
    };
  }),
});
