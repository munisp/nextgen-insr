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

import { policyQuotes, insuranceProducts, customers, claims } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
// 2026-10-01 (A1b): filed rate-table resolver (stage A1) — fail-closed.
import {
  RatingUnavailableError,
  resolveRating,
} from "../lib/ratingEngine";

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
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [product] = await db.select().from(insuranceProducts)
        .where(eq(insuranceProducts.id, input.productId)).limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Insurance product not found" });

      // 2026-10-01 (A1b): HONEST REWRITE — the third divergent premium
      // formula (baseRate derived from minPremium/maxCoverageAmount with a
      // hardcoded 0.02 fallback) is REMOVED. Pricing now resolves through
      // the filed rating tables (server/lib/ratingEngine.ts, stage A1)
      // under the approved strict fail-closed policy: no active rating
      // table for this product → PRECONDITION_FAILED, NO quote row is
      // written — a fabricated constant premium is worse than no quote.
      //
      // Input mapping (honest):
      //   - productCode: the product's own productCode (coverageClass falls
      //     back to the product's coverageType).
      //   - age: OMITTED — this proc's input schema carries no age, and
      //     none is invented (age_band factors simply do not apply).
      //   - claimsCount: the caller's REAL claims count from the DB
      //     (claims.claimantId = ctx.user.id, the memberClaims scoping
      //     rule) — never a client input.
      //   - ncdEligible: OMITTED — the repo has no NCD semantics outside
      //     the engine's `ncd` factor type (documented omission).
      //   - telematicsFactor: OMITTED — the cart is pre-bind, no policy is
      //     linked, so no telematics factor can honestly apply.
      const [{ n: claimsCount }] = await db
        .select({ n: count() })
        .from(claims)
        .where(eq(claims.claimantId, ctx.user.id));
      let premiumAfterFloor: number;
      let annualStampDuty: number;
      try {
        const rating = await resolveRating(db, {
          productCode: product.productCode,
          coverageClass: product.coverageType,
          sumInsured: input.sumInsured,
          claimsCount: Number(claimsCount),
        });
        premiumAfterFloor = rating.premiumAfterFloor;
        annualStampDuty = rating.stampDuty;
      } catch (err) {
        if (err instanceof RatingUnavailableError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
        }
        throw err;
      }

      // Duration adjustment: rating tables hold ANNUAL rates; pro-rated by
      // durationMonths/12, same as the pre-A1b contract.
      const premiumAmount = Math.round(premiumAfterFloor * (input.durationMonths / 12) * 100) / 100;
      const stampDuty = Math.round(annualStampDuty * (input.durationMonths / 12) * 100) / 100;

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
