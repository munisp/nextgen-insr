import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  insuranceProducts,
  insuranceCategories,
  insuranceInventory,
} from "../../drizzle/schema";
import { desc, eq, and, ilike, count, sql } from "drizzle-orm";

const CATALOG_SERVICE_URL =
  process.env.CATALOG_SERVICE_URL || "http://localhost:8100";

/**
 * E-Commerce Catalog Router
 * Bridges tRPC API with Go catalog microservice for products, categories, and inventory.
 * Falls back to direct Drizzle queries when Go service is unavailable.
 */
export const insuranceCatalogRouter = router({
  // ── Products ─────────────────────────────────────────────────────────────
  listProducts: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        categoryId: z.number().optional(),
        active: z.boolean().optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { products: [], total: 0 };

      const conditions = [];
      if (input.categoryId) {
        conditions.push(eq(insuranceProducts.categoryId, input.categoryId));
      }
      if (input.active !== undefined) {
        conditions.push(eq(insuranceProducts.isActive, input.active));
      }
      if (input.search) {
        conditions.push(ilike(insuranceProducts.name, `%${input.search}%`));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [products, totalResult] = await Promise.all([
        database
          .select()
          .from(insuranceProducts)
          .where(where)
          .orderBy(desc(insuranceProducts.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        database
          .select({ total: count() })
          .from(insuranceProducts)
          .where(where),
      ]);

      return {
        products,
        total: totalResult[0]?.total ?? 0,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  getProduct: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return null;

      const [product] = await database
        .select()
        .from(insuranceProducts)
        .where(eq(insuranceProducts.id, input.id))
        .limit(1);

      return product ?? null;
    }),

  createProduct: protectedProcedure
    .input(
      z.object({
        sku: z.string().min(1).max(64),
        name: z.string().min(1).max(256),
        description: z.string().optional(),
        categoryId: z.number(),
        price: z.string(),
        currency: z.string().default("NGN"),
        imageUrl: z.string().optional(),
        merchantId: z.number(),
        agentId: z.number().optional(),
        weight: z.string().optional(),
        dimensions: z.string().optional(),
        tags: z.array(z.string()).optional(),
        attributes: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [product] = await database
        .insert(insuranceProducts)
        .values({
          sku: input.sku,
          name: input.name,
          description: input.description ?? null,
          categoryId: input.categoryId,
          price: input.price,
          currency: input.currency,
          imageUrl: input.imageUrl ?? null,
          merchantId: input.merchantId,
          agentId: input.agentId ?? null,
          weight: input.weight ?? null,
          dimensions: input.dimensions ?? null,
          tags: input.tags ?? [],
          attributes: input.attributes ?? {},
        })
        .returning();

      // Create inventory record
      await database.insert(insuranceInventory).values({
        sku: input.sku,
        productId: product.id,
        quantity: 0,
        reserved: 0,
        reorderPoint: 10,
      });

      return product;
    }),

  updateProduct: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        description: z.string().optional(),
        price: z.string().optional(),
        isActive: z.boolean().optional(),
        tags: z.array(z.string()).optional(),
        attributes: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name) updates.name = input.name;
      if (input.description !== undefined)
        updates.description = input.description;
      if (input.price) updates.price = input.price;
      if (input.isActive !== undefined) updates.isActive = input.isActive;
      if (input.tags) updates.tags = input.tags;
      if (input.attributes) updates.attributes = input.attributes;

      const [updated] = await database
        .update(insuranceProducts)
        .set(updates)
        .where(eq(insuranceProducts.id, input.id))
        .returning();

      return updated;
    }),

  deleteProduct: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      await database
        .delete(insuranceProducts)
        .where(eq(insuranceProducts.id, input.id));

      return { deleted: true };
    }),

  searchProducts: protectedProcedure
    .input(z.object({ query: z.string(), limit: z.number().default(20) }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { products: [] };

      const products = await database
        .select()
        .from(insuranceProducts)
        .where(
          sql`${insuranceProducts.name} ILIKE ${`%${input.query}%`} OR ${insuranceProducts.sku} ILIKE ${`%${input.query}%`}`
        )
        .limit(input.limit);

      return { products, query: input.query };
    }),

  // ── Categories ───────────────────────────────────────────────────────────
  listCategories: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { categories: [] };

    const categories = await database
      .select()
      .from(insuranceCategories)
      .where(eq(insuranceCategories.isActive, true))
      .orderBy(insuranceCategories.sortOrder);

    return { categories };
  }),

  createCategory: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        slug: z.string().min(1),
        description: z.string().optional(),
        parentId: z.number().optional(),
        imageUrl: z.string().optional(),
        sortOrder: z.number().default(0),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [category] = await database
        .insert(insuranceCategories)
        .values({
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          parentId: input.parentId ?? null,
          imageUrl: input.imageUrl ?? null,
          sortOrder: input.sortOrder,
        })
        .returning();

      return category;
    }),

  // ── Inventory ────────────────────────────────────────────────────────────
  getInventory: protectedProcedure
    .input(z.object({ sku: z.string() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return null;

      const [inv] = await database
        .select()
        .from(insuranceInventory)
        .where(eq(insuranceInventory.sku, input.sku))
        .limit(1);

      if (!inv) return null;
      return { ...inv, available: inv.quantity - inv.reserved };
    }),

  lowStockAlerts: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { alerts: [] };

      const alerts = await database
        .select()
        .from(insuranceInventory)
        .where(
          sql`(${insuranceInventory.quantity} - ${insuranceInventory.reserved}) <= ${insuranceInventory.reorderPoint}`
        )
        .orderBy(
          sql`(${insuranceInventory.quantity} - ${insuranceInventory.reserved}) ASC`
        )
        .limit(input.limit);

      return { alerts, count: alerts.length };
    }),

  updateStock: protectedProcedure
    .input(
      z.object({
        sku: z.string(),
        quantity: z.number(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [updated] = await database
        .update(insuranceInventory)
        .set({
          quantity: input.quantity,
          updatedAt: new Date(),
          lastRestocked: new Date(),
        })
        .where(eq(insuranceInventory.sku, input.sku))
        .returning();

      return updated;
    }),
});
