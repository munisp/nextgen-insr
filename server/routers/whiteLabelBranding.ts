// @ts-nocheck
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
import { tenants, auditLog, systemConfig } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export const whiteLabelBrandingRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { totalBrands: 0, activeBrands: 0, customDomains: 0 };
    const [total] = await db
      .select({ value: count() })
      .from(tenants)
      .limit(100);
    return {
      totalBrands: Number(total.value),
      activeBrands: Number(total.value),
      customDomains: 0,
    };
  }),
  getBranding: protectedProcedure
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("Database connection unavailable");
        const rows = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, "branding_" + input.tenantId))
          .limit(1);
        if (rows.length > 0 && rows[0].value)
          return JSON.parse(String(rows[0].value));
        return {
          primaryColor: "#1a56db",
          secondaryColor: "#6b7280",
          logo: null,
          appName: "InsurePortal",
          domain: null,
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
  updateBranding: protectedProcedure
    .input(
      z.object({
        tenantId: z.number(),
        primaryColor: z.string().optional(),
        secondaryColor: z.string().optional(),
        logo: z.string().optional(),
        appName: z.string().optional(),
        domain: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const { tenantId, ...branding } = input;
        await db
          .insert(systemConfig)
          .values({
            key: "branding_" + tenantId,
            value: JSON.stringify({
              ...branding,
              updatedAt: new Date().toISOString(),
            }),
          })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: {
              value: JSON.stringify({
                ...branding,
                updatedAt: new Date().toISOString(),
              }),
              updatedAt: new Date(),
            },
          });
        await db.insert(auditLog).values({
          action: "branding_updated",
          resource: "tenants",
          resourceId: String(tenantId),
          status: "success",
          metadata: branding,
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
  listBrands: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { brands: [], total: 0 };
        const rows = await db
          .select()
          .from(tenants)
          .orderBy(desc(tenants.createdAt))
          .limit(input?.limit ?? 20);
        return {
          brands: rows.map(t => ({
            tenantId: t.id,
            name: t.name,
            status: t.status,
          })),
          total: rows.length,
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
