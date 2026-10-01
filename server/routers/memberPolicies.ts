/**
 * memberPolicies.ts — R3 batch 1 member surface (2026-10-01, R3)
 *
 * Member-scoped views over the policies/products domain for the PWA
 * (customer-portal-full/client/src/services/memberPoliciesApi.ts). The admin
 * `insuranceProducts` router and the catalog `insuranceProductCatalog` router
 * stay untouched; this router gives members an honest, caller-scoped view:
 *
 *   - myPolicies: the caller's policies, joined to insuranceProducts for
 *     the product name. 2026-10-01 (R3-fix): policies.customerId is written
 *     in TWO identity spaces — portal-filed policies pin customerId =
 *     ctx.user.id (users.id; insuranceWorkflows.ts ~line 337, and the
 *     fileClaim ownership check at ~line 669), while customer-wallet-era
 *     rows use the resolved customers.id (customers.keycloakSub =
 *     String(ctx.user.id)). Both are the caller's OWN identities, so the
 *     scope matches BOTH (OR) — this is not an IDOR, and a missing customer
 *     profile no longer blocks the users.id match (myClaims works without
 *     one). A client-supplied customerId is never trusted.
 *   - myPolicy:   one policy by id, ownership-checked under the same
 *     dual-space rule (policies.id = input.id AND customerId IN the
 *     caller's two identities); NOT_FOUND on any miss — foreign ids are
 *     not enumerable.
 *   - quote:      anonymous premium quote (same actuarial math as
 *     insuranceProductCatalog.calculatePremium) WITHOUT policyId, so the
 *     telematics rating factor is never applied to a quote that has not
 *     proven policy ownership (the guarded variant is
 *     memberGuards.assertPolicyOwnership, wired into calculatePremium at
 *     integration).
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; ownership miss → NOT_FOUND.
 * No mutations exist here — bind/pay/cancel stay on the staff workflows.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";

import { customers, insuranceProducts, policies } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import type { DrizzleDb } from "../lib/memberGuards";

const policyStatusInput = z.enum([
  "draft",
  "quoted",
  "bound",
  "active",
  "endorsed",
  "renewed",
  "cancelled",
  "lapsed",
  "expired",
  "suspended",
]);

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
 * Resolve the session customer: customers.keycloakSub = String(ctx.user.id)
 * (customerWalletSystem.resolveSessionCustomer pattern, 2026-10-01 R3 copy).
 * Projects only the id so the query surface stays minimal.
 *
 * 2026-10-01 (R3-fix): returns NULL instead of throwing NOT_FOUND when no
 * customer profile exists — the caller's users.id identity remains valid
 * for scoping (portal-filed policies pin customerId = ctx.user.id), and
 * memberClaims.myClaims already works without a customer row.
 */
async function resolveSessionCustomer(d: DrizzleDb, userId: number | string) {
  const [customer] = await d
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.keycloakSub, String(userId)))
    .limit(1);
  return customer ?? null;
}

/**
 * 2026-10-01 (R3-fix): the caller-bound dual-space ownership scope.
 * policies.customerId has no FK (schema.ts:4919) and is written in two
 * spaces by two writers:
 *   - users.id      — portal journey (insuranceWorkflows.ts ~337, ~669);
 *   - customers.id  — customer-wallet-era rows (keycloakSub resolution).
 * Both spaces are the caller's OWN identity (one is the session id, the
 * other is resolved from it server-side), so OR-ing them is fail-closed —
 * no foreign row can enter the scope.
 */
function callerPolicyScope(
  userId: number,
  customer: { id: number } | null
) {
  return or(
    eq(policies.customerId, userId),
    customer ? eq(policies.customerId, customer.id) : undefined
  );
}

export const memberPoliciesRouter = router({
  /** Caller's policies, newest first, optionally filtered by status. */
  myPolicies: protectedProcedure
    .input(
      z
        .object({
          status: policyStatusInput.optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const d = await db();
      const customer = await resolveSessionCustomer(d, ctx.user.id);
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      const scope = and(
        callerPolicyScope(ctx.user.id, customer),
        input?.status ? eq(policies.status, input.status) : undefined
      );
      const rows = await d
        .select({
          id: policies.id,
          policyNumber: policies.policyNumber,
          status: policies.status,
          coverageType: policies.coverageType,
          sumInsured: policies.sumInsured,
          annualPremium: policies.annualPremium,
          startDate: policies.startDate,
          endDate: policies.endDate,
          renewalDate: policies.renewalDate,
          createdAt: policies.createdAt,
          productId: policies.productId,
          productName: insuranceProducts.name,
        })
        .from(policies)
        .leftJoin(insuranceProducts, eq(insuranceProducts.id, policies.productId))
        .where(scope)
        .orderBy(desc(policies.id))
        .limit(limit)
        .offset(offset);

      const [countRow] = await d
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(policies)
        .where(scope);

      return {
        policies: rows.map((r) => ({
          ...r,
          productName: r.productName ?? null,
          // Platform settlement currency (NGN) — same convention as the Q1/Q6
          // member surfaces (parametricMember, freemiumTiers).
          currency: "NGN",
        })),
        count: countRow?.count ?? 0,
      };
    }),

  /**
   * One of the caller's policies by id. NOT_FOUND on miss or foreign
   * ownership (non-enumerating).
   */
  myPolicy: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const d = await db();
      const customer = await resolveSessionCustomer(d, ctx.user.id);
      const [row] = await d
        .select({
          id: policies.id,
          policyNumber: policies.policyNumber,
          status: policies.status,
          coverageType: policies.coverageType,
          sumInsured: policies.sumInsured,
          annualPremium: policies.annualPremium,
          startDate: policies.startDate,
          endDate: policies.endDate,
          renewalDate: policies.renewalDate,
          certificateNumber: policies.certificateNumber,
          createdAt: policies.createdAt,
          productId: policies.productId,
          productName: insuranceProducts.name,
          productDescription: insuranceProducts.description,
        })
        .from(policies)
        .leftJoin(insuranceProducts, eq(insuranceProducts.id, policies.productId))
        .where(
          and(
            eq(policies.id, input.id),
            callerPolicyScope(ctx.user.id, customer)
          )
        )
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      }
      return { ...row, productName: row.productName ?? null, currency: "NGN" };
    }),

  /**
   * Anonymous premium quote (no policyId): the catalog's actuarial math
   * (insuranceProductCatalog.calculatePremium) with the telematics UBI factor
   * excluded — telematics is policy-linked member data and requires the
   * assertPolicyOwnership guard, so unauthenticated-ownership quotes never
   * receive it (factor pinned to 1.00 — neither a discount nor a loading).
   */
  quote: protectedProcedure
    .input(
      z.object({
        productId: z.number().int().positive(),
        sumInsured: z.number().positive(),
        durationMonths: z.number().min(1).max(120).default(12),
        age: z.number().min(18).max(70).optional(),
      })
    )
    .query(async ({ input }) => {
      const d = await db();
      const [product] = await d
        .select({ id: insuranceProducts.id, name: insuranceProducts.name })
        .from(insuranceProducts)
        .where(eq(insuranceProducts.id, input.productId))
        .limit(1);
      if (!product)
        throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });

      // Same math as insuranceProductCatalog.calculatePremium (2026-10-01, R3):
      // insurance_products has no base_rate column; 2% default.
      const baseRate = 0.02;
      let loadingFactor = 1.0;
      if (input.age) {
        if (input.age >= 60) loadingFactor += 0.5;
        else if (input.age >= 50) loadingFactor += 0.3;
        else if (input.age >= 40) loadingFactor += 0.15;
      }
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
        // 2026-10-01 (R3): telematics deliberately excluded for anonymous quotes.
        telematicsRatingFactor: 1.0,
        telematicsScore: null,
        annualPremium,
        premiumNGN,
        stampDuty,
        totalPayable,
        currency: "NGN",
        validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
    }),
});
