/**
 * memberQuotes.ts — R3 batch 5 member surface (2026-10-01, R3-b5)
 *
 * Member-scoped insurance quote cart for the PWA
 * (customer-portal-full/client/src/services/memberQuotesApi.ts → mounted as
 * `memberQuotes`). Source: insurancePolicyQuoteManager
 * (server/routers/insurancePolicyQuoteManager.ts).
 *
 * Worklist claim verification (2026-10-01, R3-b5): the claim that the source
 * cart procs are unbound IDORs is TRUE — getCart/addToCart/clearCart/
 * getSummary all trust a CALLER-SUPPLIED customerId
 * (insurancePolicyQuoteManager.ts:23/32, :46/69, :99/105, :111/118), and
 * removeItem (:88-95) cancels ANY quoteId with no ownership check at all.
 * The source router stays untouched (agents/admins legitimately use the cart
 * with an explicit customerId); this member variant binds
 * policyQuotes.customerId = resolved customers.id
 * (customers.keycloakSub = String(ctx.user.id)) — the id is derived from the
 * session, NEVER from input. The member input schemas carry NO customerId/
 * sessionId fields at all, so there is nothing to smuggle.
 *
 * A customer profile is REQUIRED for every proc (the cart rows key
 * customers.id); without one there is no caller scope at all → NOT_FOUND
 * (fail-closed, non-enumerating — memberSavings requireSessionCustomer
 * pattern).
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; no profile → NOT_FOUND;
 * foreign/missing quote id on remove → NOT_FOUND (the update is scoped
 * id + customerId + status pending, zero rows changed on any miss).
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  customers,
  insuranceProducts,
  policyQuotes,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import type { DrizzleDb } from "../lib/memberGuards";

async function db(): Promise<DrizzleDb> {
  const d = await getDb();
  if (!d)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable",
    });
  return d;
}

/**
 * Resolve + REQUIRE the session customer: customers.keycloakSub =
 * String(ctx.user.id) (memberSavings.requireSessionCustomer pattern,
 * 2026-10-01 R3-b5 copy). The quote cart lives in customers.id space, so
 * without a profile there is no caller scope — NOT_FOUND (non-enumerating).
 */
async function requireSessionCustomer(d: DrizzleDb, userId: number) {
  const [customer] = await d
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.keycloakSub, String(userId)))
    .limit(1);
  if (!customer) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Customer profile not found for session user",
    });
  }
  return customer;
}

export const memberQuotesRouter = router({
  /**
   * Member variant of getCart: the caller's pending quotes, newest first.
   * Scope is policyQuotes.customerId = resolved customers.id — never a
   * client-supplied id. Honest empty cart ({ items: [], count: 0 }) when the
   * caller has none.
   */
  myQuoteCart: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const customer = await requireSessionCustomer(d, ctx.user.id);
    const items = await d
      .select({
        id: policyQuotes.id,
        productId: policyQuotes.productId,
        productName: policyQuotes.productName,
        productType: policyQuotes.productType,
        sumInsured: policyQuotes.sumInsured,
        premiumAmount: policyQuotes.premiumAmount,
        stampDuty: policyQuotes.stampDuty,
        totalPayable: policyQuotes.totalPayable,
        durationMonths: policyQuotes.durationMonths,
        coverageType: policyQuotes.coverageType,
        status: policyQuotes.status,
        validUntil: policyQuotes.validUntil,
        createdAt: policyQuotes.createdAt,
      })
      .from(policyQuotes)
      .where(
        and(
          eq(policyQuotes.customerId, customer.id),
          eq(policyQuotes.status, "pending")
        )
      )
      .orderBy(desc(policyQuotes.createdAt))
      .limit(20);
    const totalPremium = items.reduce(
      (sum, q) => sum + Number(q.premiumAmount ?? 0),
      0
    );
    return {
      items,
      subTotal: totalPremium,
      totalPremium,
      count: items.length,
      // Platform settlement currency (NGN) — member surface convention.
      currency: "NGN",
    };
  }),

  /**
   * Member variant of addToCart: adds a quote pinned to the CALLER's
   * customers.id (input carries no customerId — there is nothing to trust or
   * overwrite). Premium math copied verbatim from the source
   * (insurancePolicyQuoteManager.addToCart, 2026-10-01 R3-b5 copy):
   * insurance_products has no baseRate column; derive from
   * minPremium / maxCoverageAmount, 2% fallback, 0.5% stamp duty.
   */
  addToQuoteCart: protectedProcedure
    .input(
      z.object({
        productId: z.number().int().positive(),
        sumInsured: z.number().positive(),
        durationMonths: z.number().min(1).max(120).default(12),
        coverageType: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const customer = await requireSessionCustomer(d, ctx.user.id);

      const [product] = await d
        .select({
          id: insuranceProducts.id,
          name: insuranceProducts.name,
          coverageType: insuranceProducts.coverageType,
          minPremium: insuranceProducts.minPremium,
          maxCoverageAmount: insuranceProducts.maxCoverageAmount,
        })
        .from(insuranceProducts)
        .where(eq(insuranceProducts.id, input.productId))
        .limit(1);
      if (!product)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Insurance product not found",
        });

      const maxCov = Number(product.maxCoverageAmount ?? 0);
      const baseRate =
        maxCov > 0 ? Number(product.minPremium ?? 0) / maxCov : 0.02;
      const premiumAmount =
        Math.round(
          input.sumInsured * baseRate * (input.durationMonths / 12) * 100
        ) / 100;
      const stampDuty = Math.round(premiumAmount * 0.005 * 100) / 100;

      const [quote] = await d
        .insert(policyQuotes)
        .values({
          // Caller-derived customers.id — NEVER input-derived.
          customerId: customer.id,
          agentId: null,
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
        })
        .returning();

      return {
        quote,
        premiumAmount,
        stampDuty,
        totalPayable: premiumAmount + stampDuty,
        currency: "NGN",
      };
    }),

  /**
   * Member variant of removeItem: cancels a pending quote ONLY when it
   * belongs to the caller. The source removeItem cancels ANY quoteId (IDOR);
   * here the update is scoped id + caller customerId + status "pending" and a
   * zero-row result → NOT_FOUND (non-enumerating — foreign ids are
   * indistinguishable from missing ones).
   */
  removeQuoteItem: protectedProcedure
    .input(z.object({ quoteId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const customer = await requireSessionCustomer(d, ctx.user.id);
      const updated = await d
        .update(policyQuotes)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(policyQuotes.id, input.quoteId),
            eq(policyQuotes.customerId, customer.id),
            eq(policyQuotes.status, "pending")
          )
        )
        .returning({ id: policyQuotes.id });
      if (updated.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Quote not found",
        });
      }
      return { removed: true, quoteId: input.quoteId };
    }),

  /**
   * Member variant of clearCart: cancels the caller's pending quotes only.
   * Returns the REAL number of rows cancelled.
   */
  clearQuoteCart: protectedProcedure.mutation(async ({ ctx }) => {
    const d = await db();
    const customer = await requireSessionCustomer(d, ctx.user.id);
    const updated = await d
      .update(policyQuotes)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(policyQuotes.customerId, customer.id),
          eq(policyQuotes.status, "pending")
        )
      )
      .returning({ id: policyQuotes.id });
    return { cleared: true, cancelled: updated.length };
  }),

  /**
   * Member variant of getSummary: real COUNT/SUM over the caller's pending
   * quotes (COALESCE(0) when empty — an honest zero, never fabricated).
   */
  quoteSummary: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const customer = await requireSessionCustomer(d, ctx.user.id);
    const [stats] = await d
      .select({
        count: sql<number>`COUNT(*)::int`,
        totalPremium: sql<string>`COALESCE(SUM(CAST("premiumAmount" AS NUMERIC)), 0)`,
      })
      .from(policyQuotes)
      .where(
        and(
          eq(policyQuotes.customerId, customer.id),
          eq(policyQuotes.status, "pending")
        )
      );
    return {
      count: Number(stats?.count ?? 0),
      totalPremium: Number(stats?.totalPremium ?? 0),
      currency: "NGN",
    };
  }),
});
