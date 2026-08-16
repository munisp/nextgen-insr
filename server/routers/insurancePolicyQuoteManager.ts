/**
 * insurancePolicyQuoteCart.ts — Insurance Policy Quote Cart Router
 *
 * Manages the policy quote cart — a temporary holding area where customers
 * can compare insurance products and build their coverage package before
 * committing to purchase. This is the insurance equivalent of a shopping cart,
 * but specifically for insurance policy quotes.
 *
 * Flow: Browse products → Add to quote cart → Compare → Proceed to underwriting → Bind
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, count, sql, and } from "drizzle-orm";
import { z } from "zod";

import { policyQuotes, insuranceProducts, customers } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

export const insurancePolicyQuoteCartRouter = router({
  // Get active quote cart for customer/session
  getCart: protectedProcedure
    .input(z.object({
      customerId: z.number().optional(),
      sessionId: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], subTotal: 0, totalPremium: 0 };

      // Get pending quotes for this customer/session
      const conditions = [eq(policyQuotes.status, "pending")];
      if (input.customerId) conditions.push(eq(policyQuotes.customerId, input.customerId));

      const quotes = await db.select().from(policyQuotes)
        .where(and(...conditions))
        .orderBy(desc(policyQuotes.createdAt))
        .limit(20);

      const totalPremium = quotes.reduce((sum, q) => sum + Number(q.premiumAmount ?? 0), 0);
      return { items: quotes, subTotal: totalPremium, totalPremium, count: quotes.length };
    }),

  // Add product to quote cart
  addToCart: protectedProcedure
    .input(z.object({
      customerId: z.number().optional(),
      productId: z.number(),
      sumInsured: z.number().positive(),
      durationMonths: z.number().min(1).max(120).default(12),
      coverageType: z.string().optional(),
      agentId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [product] = await db.select().from(insuranceProducts)
        .where(eq(insuranceProducts.id, input.productId)).limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Insurance product not found" });

      // Calculate premium
      // insurance_products has no baseRate column; derive from minPremium / maxCoverageAmount
      const maxCov = Number(product.maxCoverageAmount ?? 0);
      const baseRate = maxCov > 0 ? Number(product.minPremium ?? 0) / maxCov : 0.02;
      const premiumAmount = Math.round(input.sumInsured * baseRate * (input.durationMonths / 12) * 100) / 100;
      const stampDuty = Math.round(premiumAmount * 0.005 * 100) / 100;

      const [quote] = await db.insert(policyQuotes).values({
        customerId: input.customerId ?? null,
        agentId: input.agentId ?? null,
        productId: input.productId,
        productName: product.name,
        productType: product.coverageType,
        sumInsured: String(input.sumInsured),
        premiumAmount: String(premiumAmount),
        stampDuty: String(stampDuty),
        totalPayable: String(premiumAmount + stampDuty),
        durationMonths: input.durationMonths,
        coverageType: input.coverageType ?? null,
        status: "pending",
        validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }).returning();

      return { quote, premiumAmount, stampDuty, totalPayable: premiumAmount + stampDuty };
    }),

  // Remove quote from cart
  removeItem: protectedProcedure
    .input(z.object({ quoteId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.update(policyQuotes).set({ status: "cancelled" }).where(eq(policyQuotes.id, input.quoteId));
      return { removed: true, quoteId: input.quoteId };
    }),

  // Clear all pending quotes
  clearCart: protectedProcedure
    .input(z.object({ customerId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.update(policyQuotes)
        .set({ status: "cancelled" })
        .where(and(eq(policyQuotes.customerId, input.customerId), eq(policyQuotes.status, "pending")));
      return { cleared: true };
    }),

  // Get cart summary
  getSummary: protectedProcedure
    .input(z.object({ customerId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { count: 0, totalPremium: 0 };
      const [stats] = await db.select({
        count: count(),
        totalPremium: sql<string>`COALESCE(SUM(CAST(premium_amount AS NUMERIC)), 0)`,
      }).from(policyQuotes).where(and(
        eq(policyQuotes.customerId, input.customerId),
        eq(policyQuotes.status, "pending")
      ));
      return { count: Number(stats?.count ?? 0), totalPremium: Number(stats?.totalPremium ?? 0) };
    }),
});

// Alias: server/routers.ts imports this router as insurancePolicyQuoteManagerRouter.
export const insurancePolicyQuoteManagerRouter = insurancePolicyQuoteCartRouter;
