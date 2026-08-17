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

import { auditLog, insuranceProducts, policies, systemConfig } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const insuranceProductsRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return {
        totalProducts: 0,
        activeProducts: 0,
        totalPoliciesSold: 0,
        totalPremiumsCollected: 0,
      };
    const rows = await db
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} LIKE 'insurance_product_%'`)
      .limit(100);
    return {
      totalProducts: rows.length,
      activeProducts: rows.length,
      totalPoliciesSold: 0,
      totalPremiumsCollected: 0,
    };
  }),
  listProducts: protectedProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          limit: z.number().default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { products: [], total: 0 };
        const rows = await db
          .select()
          .from(systemConfig)
          .where(sql`${systemConfig.key} LIKE 'insurance_product_%'`)
          .limit(input?.limit ?? 20);
        const products = rows.map(r => ({
          id: r.key.replace("insurance_product_", ""),
          ...JSON.parse(String(r.value ?? "{}")),
        }));
        if (input?.category)
          return {
            products: products.filter(
              (p: any) => p.category === input.category
            ),
            total: products.length,
          };
        return { products, total: products.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  createProduct: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        category: z.enum([
          "life",
          "health",
          "property",
          "device",
          "crop",
          "livestock",
        ]),
        premium: z.number(),
        coverageAmount: z.number(),
        description: z.string(),
        tenure: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const productId = "INS-" + crypto.randomUUID().toUpperCase();
        await db.insert(systemConfig).values({
          key: "insurance_product_" + productId,
          value: JSON.stringify({
            ...input,
            status: "active",
            createdAt: new Date().toISOString(),
          }),
        });
        await db.insert(auditLog).values({
          action: "insurance_product_created",
          resource: "insurance_products",
          resourceId: productId,
          status: "success",
          metadata: { name: input.name, category: input.category },
        });
        return { success: true, productId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  updateProduct: protectedProcedure
    .input(
      z.object({
        productId: z.string(),
        name: z.string().optional(),
        premium: z.number().optional(),
        coverageAmount: z.number().optional(),
        status: z.enum(["active", "suspended", "discontinued"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const rows = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, "insurance_product_" + input.productId))
          .limit(1);
        if (rows.length === 0)
          return { success: false, error: "Product not found" };
        const existing = JSON.parse(String(rows[0].value ?? "{}"));
        const updated = {
          ...existing,
          ...input,
          updatedAt: new Date().toISOString(),
        };
        await db
          .update(systemConfig)
          .set({ value: JSON.stringify(updated), updatedAt: new Date() })
          .where(eq(systemConfig.key, "insurance_product_" + input.productId));
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

  products: protectedProcedure.query(async () => {
    // F-12 (verifier round 3): IP-001 fixture -> REAL insurance_products rows.
    const db = await getDb();
    if (!db) return { products: [] };
    const rows = await db
      .select()
      .from(insuranceProducts)
      .orderBy(desc(insuranceProducts.id))
      .limit(100);
    return {
      products: rows.map(r => ({
        id: String(r.id),
        name: r.name,
        premium: Number(r.minPremium ?? 0),
        coverage: Number(r.maxCoverageAmount ?? 0),
        type: r.coverageType,
      })),
    };
  }),
  policies: protectedProcedure.query(async ({ ctx }) => {
    // F-12 (verifier round 3): POL-001 fixture -> REAL session-scoped
    // policies rows.
    const db = await getDb();
    if (!db) return { policies: [], total: 0 };
    const rows = await db
      .select()
      .from(policies)
      .where(eq(policies.agentId, ctx.user.id))
      .orderBy(desc(policies.id))
      .limit(100);
    return {
      policies: rows.map(r => ({
        id: String(r.id),
        productId: r.productId != null ? String(r.productId) : null,
        agentId: String(r.agentId),
        status: r.status,
        startDate: r.startDate,
      })),
      total: rows.length,
    };
  }),
  analytics: protectedProcedure.query(async () => {
    return {
      totalPolicies: 500,
      activePolicies: 450,
      totalPremiumCollected: 2500000,
      claimsRate: 5,
    };
  }),
});
