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
import { eq, desc, count, sql, and, or, inArray } from "drizzle-orm";
import { z } from "zod";

import { policyQuotes, insuranceProducts, customers, claims } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import type { TrpcContext } from "../_core/context";
import { getDb } from "../db";
// 2026-10-02 (IDOR hardening): caller identity comes from the agent_session
// cookie / admin role — NEVER from caller-supplied customerId/agentId fields.
import { resolveAgentScope } from "../middleware/agentAuth";
// 2026-10-01 (A1b): filed rate-table resolver (stage A1) — fail-closed.
import {
  RatingUnavailableError,
  resolveRating,
} from "../lib/ratingEngine";

/**
 * 2026-10-02 (IDOR hardening): server-side caller scope for this agent-side
 * cart. Identity resolution order (fail-closed):
 *   1. A valid agent_session cookie pins the caller to THAT agents.id
 *      (resolveAgentScope — session wins over everything, isActive/deleted
 *      agents resolve to no session).
 *   2. A Keycloak admin (ctx.user.role === "admin", no agent session) may act
 *      across agents for ops tooling (repo role pattern: apiKeyManagement,
 *      bankAccountManagement).
 *   3. Everything else → FORBIDDEN. Member/customer callers have their own
 *      fail-closed surface (server/routers/memberQuotes.ts); this router is
 *      agent/admin-only.
 *
 * Ownership rule (schema-verified): an agent may touch a quote iff
 *   policyQuotes.agentId = their agents.id  (they created it), OR
 *   policyQuotes.customerId ∈ customers WHERE preferredAgentId = their id
 *   (customers.preferredAgentId is the repo's ONLY agent→customer assignment
 *   link — drizzle/schema.ts:1462; there is no other assignment table).
 * Foreign rows are indistinguishable from missing ones → NOT_FOUND (no
 * existence leak).
 */
type CartScope = { kind: "agent"; agentId: number } | { kind: "admin" };

// protectedProcedure's requireUser middleware narrows ctx.user to non-null;
// the helper signature mirrors that narrowing.
type AuthedCtx = TrpcContext & { user: NonNullable<TrpcContext["user"]> };

async function resolveCartScope(ctx: AuthedCtx): Promise<CartScope> {
  const scope = await resolveAgentScope(ctx.req, ctx.user.role, null);
  if (scope.ok) return { kind: "agent", agentId: scope.agentId };
  if (ctx.user.role === "admin") return { kind: "admin" };
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Agent session required — identity must come from the session",
  });
}

type QuoteDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * Ownership predicate for an agent scope: quotes they created OR quotes of
 * customers assigned to them (customers.preferredAgentId). 2026-10-02.
 */
function agentQuoteFilter(db: QuoteDb, agentId: number) {
  return or(
    eq(policyQuotes.agentId, agentId),
    inArray(
      policyQuotes.customerId,
      db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.preferredAgentId, agentId))
    )
  );
}

export const insurancePolicyQuoteCartRouter = router({
  // Get active quote cart for the caller's scope
  getCart: protectedProcedure
    .input(z.object({
      // 2026-10-02 (IDOR hardening): customerId is honored ONLY for admins
      // (ops filter); for agents it is IGNORED — the scope is derived from
      // the agent_session cookie, never from input. sessionId unused.
      customerId: z.number().optional(),
      sessionId: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { items: [], subTotal: 0, totalPremium: 0 };

      const scope = await resolveCartScope(ctx);
      // Get pending quotes for this caller's scope
      const conditions = [eq(policyQuotes.status, "pending")];
      if (scope.kind === "agent") {
        conditions.push(agentQuoteFilter(db, scope.agentId)!);
      } else if (input.customerId) {
        conditions.push(eq(policyQuotes.customerId, input.customerId));
      }

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
      // 2026-10-02 (IDOR hardening): agentId is GONE from the input — the
      // creating agent is derived from the agent_session cookie server-side.
      // customerId remains so an agent can choose WHICH of their assigned
      // customers the quote is for, but it is VERIFIED server-side
      // (customers.preferredAgentId = caller's agents.id); a foreign or
      // unknown customerId → NOT_FOUND (non-enumerating). Admins may quote
      // for any existing customer.
      customerId: z.number().optional(),
      productId: z.number(),
      sumInsured: z.number().positive(),
      durationMonths: z.number().min(1).max(120).default(12),
      coverageType: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const scope = await resolveCartScope(ctx);

      // Server-side customer verification (2026-10-02): never trust the
      // caller-supplied customerId — an agent may quote ONLY for customers
      // assigned to them; a miss is NOT_FOUND (no existence leak).
      let verifiedCustomerId: number | null = null;
      if (input.customerId != null) {
        const [cust] = await db
          .select({ id: customers.id, preferredAgentId: customers.preferredAgentId })
          .from(customers)
          .where(eq(customers.id, input.customerId))
          .limit(1);
        if (
          !cust ||
          (scope.kind === "agent" && cust.preferredAgentId !== scope.agentId)
        ) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
        }
        verifiedCustomerId = cust.id;
      }

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
        // 2026-10-02: both identity fields are server-derived — the verified
        // customer and the session agent (null for admin-initiated quotes).
        customerId: verifiedCustomerId,
        agentId: scope.kind === "agent" ? scope.agentId : null,
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
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // 2026-10-02 (IDOR hardening): the pre-fix proc cancelled ANY quoteId
      // with no ownership check at all — an agent could cancel quotes
      // belonging to OTHER agents/customers (IDOR). The update is now scoped
      // atomically: id + status pending + caller ownership (agent-created or
      // assigned-customer via customers.preferredAgentId). A zero-row result
      // — missing, foreign, or non-pending — is NOT_FOUND (non-enumerating:
      // no existence leak for foreign rows). Admins bypass the ownership
      // filter (repo role pattern).
      const scope = await resolveCartScope(ctx);
      const conditions = [
        eq(policyQuotes.id, input.quoteId),
        eq(policyQuotes.status, "pending"),
      ];
      if (scope.kind === "agent") {
        conditions.push(agentQuoteFilter(db, scope.agentId)!);
      }
      const updated = await db
        .update(policyQuotes)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(...conditions))
        .returning({ id: policyQuotes.id });
      if (updated.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Quote not found" });
      }
      return { removed: true, quoteId: input.quoteId };
    }),

  // Clear pending quotes in the caller's scope
  clearCart: protectedProcedure
    .input(z.object({
      // 2026-10-02 (IDOR hardening): was a REQUIRED caller-trusted customerId
      // — any agent could mass-cancel ANY customer's pending quotes. Now:
      // agents ignore this field (their scope is session-derived); admins may
      // pass it as an ops filter and MUST (an unscoped mass-cancel of every
      // pending quote is not permitted — fail-closed BAD_REQUEST).
      customerId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const scope = await resolveCartScope(ctx);
      const conditions = [eq(policyQuotes.status, "pending")];
      if (scope.kind === "agent") {
        conditions.push(agentQuoteFilter(db, scope.agentId)!);
      } else if (input.customerId != null) {
        conditions.push(eq(policyQuotes.customerId, input.customerId));
      } else {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "customerId is required for admin-initiated cart clears",
        });
      }
      const updated = await db.update(policyQuotes)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(...conditions))
        .returning({ id: policyQuotes.id });
      return { cleared: true, cancelled: updated.length };
    }),

  // Get cart summary for the caller's scope
  getSummary: protectedProcedure
    .input(z.object({
      // 2026-10-02 (IDOR hardening): see clearCart — admin-only ops filter,
      // ignored for agents (session-derived scope).
      customerId: z.number().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { count: 0, totalPremium: 0 };

      const scope = await resolveCartScope(ctx);
      const conditions = [eq(policyQuotes.status, "pending")];
      if (scope.kind === "agent") {
        conditions.push(agentQuoteFilter(db, scope.agentId)!);
      } else if (input.customerId != null) {
        conditions.push(eq(policyQuotes.customerId, input.customerId));
      }
      const [stats] = await db.select({
        count: count(),
        // 2026-10-02: HONEST FIX — the raw SQL referenced a non-existent
        // snake_case "premium_amount" column (the real column is the quoted
        // camelCase "premiumAmount", schema.additions.ts:480; the member
        // quoteSummary variant already uses it). The old SQL could only ever
        // have 500'd against a real database.
        totalPremium: sql<string>`COALESCE(SUM(CAST("premiumAmount" AS NUMERIC)), 0)`,
      }).from(policyQuotes).where(and(...conditions));
      return { count: Number(stats?.count ?? 0), totalPremium: Number(stats?.totalPremium ?? 0) };
    }),
});

// Alias: server/routers.ts imports this router as insurancePolicyQuoteManagerRouter.
export const insurancePolicyQuoteManagerRouter = insurancePolicyQuoteCartRouter;
