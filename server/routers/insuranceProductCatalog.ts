/**
 * insuranceProductCatalog.ts — Insurance Product Catalog Router
 *
 * Manages the catalog of insurance products available for purchase:
 *   - Life insurance (term, whole life, endowment)
 *   - Health insurance (individual, family, group)
 *   - Motor insurance (comprehensive, third-party)
 *   - Property insurance (fire, burglary, all-risks)
 *   - Agricultural insurance (crop, livestock)
 *   - Micro-insurance products (NAICOM-compliant)
 *
 * All products are NAICOM-registered with valid product codes.
 */
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { insuranceProducts, insuranceProductTypes } from "../../drizzle/schema";
import { eq, desc, count, sql, and, gte, ilike, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const insuranceProductCatalogRouter = router({
  // List all available insurance products
  listProducts: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      productType: z.enum(["life", "health", "motor", "property", "agriculture", "micro", "all"]).default("all"),
      search: z.string().optional(),
      minPremium: z.number().optional(),
      maxPremium: z.number().optional(),
      isActive: z.boolean().default(true),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };

      const conditions = [];
      if (input.isActive) conditions.push(eq(insuranceProducts.isActive, true));
      if (input.productType !== "all") conditions.push(eq(insuranceProducts.coverageType, input.productType));
      if (input.search) {
        conditions.push(or(
          ilike(insuranceProducts.name, `%${input.search}%`),
          ilike(insuranceProducts.description, `%${input.search}%`),
          ilike(insuranceProducts.naicomProductCode, `%${input.search}%`)
        ));
      }
      if (input.minPremium) conditions.push(gte(insuranceProducts.minPremium, String(input.minPremium)));

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const results = await db.select().from(insuranceProducts)
        .where(where)
        .orderBy(desc(insuranceProducts.createdAt))
        .limit(input.limit).offset(input.offset);

      const [{ total }] = await db.select({ total: count() }).from(insuranceProducts).where(where);
      return { data: results, total: Number(total) };
    }),

  // Get single product with full details
  getProduct: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [product] = await db.select().from(insuranceProducts)
        .where(eq(insuranceProducts.id, input.id)).limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Insurance product not found" });
      return product;
    }),

  // List product types / categories
  listCategories: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(insuranceProductTypes).where(eq(insuranceProductTypes.isActive, true));
  }),

  // Get products with low availability (for agent alerts)
  lowStockAlerts: protectedProcedure
    .input(z.object({ threshold: z.number().default(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      // insurance_products has no available_slots column; slot tracking is not
      // implemented, so there are no low-slot products to report.
      void input.threshold;
      return db.select().from(insuranceProducts)
        .where(sql`1 = 0`)
        .orderBy(desc(insuranceProducts.createdAt));
    }),

  // Get featured/recommended products
  getFeatured: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    // insurance_products has no is_featured column; surface the newest active products.
    return db.select().from(insuranceProducts)
      .where(eq(insuranceProducts.isActive, true))
      .orderBy(desc(insuranceProducts.createdAt)).limit(6);
  }),

  // Get product premium calculator
  calculatePremium: protectedProcedure
    .input(z.object({
      productId: z.number(),
      sumInsured: z.number().positive(),
      durationMonths: z.number().min(1).max(120).default(12),
      age: z.number().min(18).max(70).optional(),
      coverageType: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [product] = await db.select().from(insuranceProducts)
        .where(eq(insuranceProducts.id, input.productId)).limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });

      // Actuarial premium calculation
      const baseRate = 0.02; // insurance_products has no base_rate column; 2% default
      let loadingFactor = 1.0;

      // Age loading (life/health products)
      if (input.age) {
        if (input.age >= 60) loadingFactor += 0.5;
        else if (input.age >= 50) loadingFactor += 0.3;
        else if (input.age >= 40) loadingFactor += 0.15;
      }

      // Duration adjustment
      const durationFactor = input.durationMonths / 12;
      const annualPremium = input.sumInsured * baseRate * loadingFactor;
      const premiumNGN = Math.round(annualPremium * durationFactor * 100) / 100;
      const stampDuty = Math.round(premiumNGN * 0.005 * 100) / 100; // 0.5% stamp duty
      const totalPayable = premiumNGN + stampDuty;

      return {
        productId: input.productId,
        productName: product.name,
        sumInsured: input.sumInsured,
        durationMonths: input.durationMonths,
        baseRate,
        loadingFactor,
        annualPremium,
        premiumNGN,
        stampDuty,
        totalPayable,
        currency: "NGN",
        validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
    }),
});
