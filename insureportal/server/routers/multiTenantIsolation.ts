import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { eq, desc, sql, count } from "drizzle-orm";
import {
  tenants,
  tenantUsers,
  tenantBranding,
  auditLog,
} from "@schema";
import { TRPCError } from "@trpc/server";

export const multiTenantIsolationRouter = router({
  listTenants: protectedProcedure
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
  getTenant: protectedProcedure
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
  createTenant: protectedProcedure
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
        const [tenant] = await db
          .insert(tenants)
          .values({
            name: input.name,
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
  suspendTenant: protectedProcedure
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
  getStats: protectedProcedure.query(async () => {
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
