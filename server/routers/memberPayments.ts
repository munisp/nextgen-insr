/**
 * memberPayments.ts — R3 batch 2 member surface (2026-10-01, R3-b2)
 *
 * READ-ONLY member payments surface over the premiumTopUp domain
 * (server/routers/premiumTopUp.ts). Deliberately NO mutation proc:
 * premiumTopUp.topUp is a financialProcedure gated by role `premium_collect`,
 * and members (users.role "user") hold no ROLE_PERMISSIONS entry
 * (server/_core/permifyMiddleware.ts:51-83) — delegating to it still 403s
 * fail-closed. The member funds path (payPremium) is deferred to a dedicated
 * reviewed wave that also adds the caller→policy ownership check topUp lacks;
 * this router ships the honest read surface only. premiumTopUp.getHistory is
 * an IDOR (arbitrary policyId → full history) and is never exposed here.
 * recurringPayments is an agent-cookie tool — internal-skip, no member
 * variant.
 *
 * Procedures:
 *   - myPremiums:    the caller's premium ledger rows (premiums table,
 *                    drizzle/schema.additions.ts:303), EVERY status shown
 *                    verbatim (paid/due/failed — no cosmetic filtering).
 *                    Caller scoping is dual-identity (memberPolicies
 *                    callerPolicyScope precedent, 2026-10-01 R3): a premium
 *                    row is the caller's iff premiums.customerId IN
 *                    (ctx.user.id, resolved customers.id) OR premiums.policyId
 *                    is one of the caller's own policies (policies.customerId
 *                    under the same dual-space rule). Optional policyId filter
 *                    is ownership-checked first — foreign/nonexistent →
 *                    NOT_FOUND, non-enumerating.
 *   - myPremiumDue:  server-derived payable view, two honest sections:
 *                    (a) duePremiums — real premiums ledger rows with
 *                        status "due" (amount + dueDate are recorded columns);
 *                    (b) policies — the caller's bound/active/lapsed policies
 *                        with their recorded annualPremium + renewalDate as a
 *                        REFERENCE amount (never a computed "amount due":
 *                        no real column records a per-policy outstanding
 *                        balance, so none is invented). The `disclosure`
 *                        string states this verbatim for the UI.
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; ownership miss → NOT_FOUND.
 * Amounts are numeric columns — returned verbatim as strings (never rounded,
 * never fabricated).
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { customers, insuranceProducts, policies } from "../../drizzle/schema";
import { premiums } from "../../drizzle/schema.additions";
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
 * customers.keycloakSub = String(ctx.user.id) (memberPolicies
 * resolveSessionCustomer pattern, 2026-10-01 R3 copy). NULL when no customer
 * profile exists — the caller's users.id identity remains valid for scoping.
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
 * Dual-identity caller scope on policies (memberPolicies callerPolicyScope,
 * 2026-10-01 R3 copy): policies.customerId is written in users.id space by
 * the portal journey and in customers.id space by customer-wallet-era rows;
 * both are the caller's OWN identities, so OR-ing them is fail-closed.
 */
function callerPolicyScope(userId: number, customer: { id: number } | null) {
  return or(
    eq(policies.customerId, userId),
    customer ? eq(policies.customerId, customer.id) : undefined
  );
}

export const memberPaymentsRouter = router({
  /**
   * The caller's premium payment history, newest first, every status shown
   * verbatim. Optional policyId filter (ownership-checked, NOT_FOUND on miss).
   */
  myPremiums: protectedProcedure
    .input(
      z
        .object({
          policyId: z.number().int().positive().optional(),
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

      const policyScope = callerPolicyScope(ctx.user.id, customer);
      const callerPolicyIds = d
        .select({ id: policies.id })
        .from(policies)
        .where(policyScope);

      if (input?.policyId !== undefined) {
        // Ownership check, non-enumerating: the policy must exist AND be in
        // the caller's dual-space scope; a miss throws NOT_FOUND either way.
        const [owned] = await d
          .select({ id: policies.id })
          .from(policies)
          .where(and(eq(policies.id, input.policyId), policyScope))
          .limit(1);
        if (!owned) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Policy not found",
          });
        }
      }

      const scope = and(
        or(
          eq(premiums.customerId, ctx.user.id),
          customer ? eq(premiums.customerId, customer.id) : undefined,
          inArray(premiums.policyId, callerPolicyIds)
        ),
        input?.policyId !== undefined
          ? eq(premiums.policyId, input.policyId)
          : undefined
      );

      const rows = await d
        .select({
          id: premiums.id,
          policyId: premiums.policyId,
          premiumRef: premiums.premiumRef,
          amount: premiums.amount,
          currency: premiums.currency,
          dueDate: premiums.dueDate,
          paidDate: premiums.paidDate,
          status: premiums.status,
          paymentMethod: premiums.paymentMethod,
          paymentRef: premiums.paymentRef,
          createdAt: premiums.createdAt,
          policyNumber: policies.policyNumber,
        })
        .from(premiums)
        .leftJoin(policies, eq(policies.id, premiums.policyId))
        .where(scope)
        .orderBy(desc(premiums.id))
        .limit(limit)
        .offset(offset);

      const [countRow] = await d
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(premiums)
        .where(scope);

      return {
        premiums: rows.map(r => ({
          ...r,
          policyNumber: r.policyNumber ?? null,
        })),
        count: countRow?.count ?? 0,
      };
    }),

  /**
   * Server-derived payable view. duePremiums = real ledger rows with status
   * "due" (recorded amount + dueDate). policies = the caller's
   * bound/active/lapsed policies with their RECORDED annualPremium as a
   * reference amount only — no outstanding-balance column exists on policies,
   * so no due amount is synthesized. Never client-entered amounts.
   */
  myPremiumDue: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const customer = await resolveSessionCustomer(d, ctx.user.id);
    const policyScope = callerPolicyScope(ctx.user.id, customer);
    const callerPolicyIds = d
      .select({ id: policies.id })
      .from(policies)
      .where(policyScope);

    const premiumScope = or(
      eq(premiums.customerId, ctx.user.id),
      customer ? eq(premiums.customerId, customer.id) : undefined,
      inArray(premiums.policyId, callerPolicyIds)
    );

    const dueRows = await d
      .select({
        id: premiums.id,
        policyId: premiums.policyId,
        premiumRef: premiums.premiumRef,
        amount: premiums.amount,
        currency: premiums.currency,
        dueDate: premiums.dueDate,
        gracePeriodDays: premiums.gracePeriodDays,
        status: premiums.status,
        policyNumber: policies.policyNumber,
      })
      .from(premiums)
      .leftJoin(policies, eq(policies.id, premiums.policyId))
      .where(and(premiumScope, eq(premiums.status, "due")))
      .orderBy(desc(premiums.dueDate))
      .limit(100);

    const payablePolicies = await d
      .select({
        id: policies.id,
        policyNumber: policies.policyNumber,
        status: policies.status,
        annualPremium: policies.annualPremium,
        renewalDate: policies.renewalDate,
        productId: policies.productId,
        productName: insuranceProducts.name,
      })
      .from(policies)
      .leftJoin(insuranceProducts, eq(insuranceProducts.id, policies.productId))
      .where(
        and(policyScope, inArray(policies.status, ["bound", "active", "lapsed"]))
      )
      .orderBy(desc(policies.id))
      .limit(100);

    return {
      duePremiums: dueRows.map(r => ({
        ...r,
        policyNumber: r.policyNumber ?? null,
      })),
      policies: payablePolicies.map(r => ({
        ...r,
        productName: r.productName ?? null,
        // Platform settlement currency — same convention as memberPolicies.
        currency: "NGN",
      })),
      disclosure:
        "Annual premium figures are the recorded policy amounts. " +
        "Outstanding balances are shown only where a due premium entry " +
        "exists on the ledger; no other due amount is calculated.",
    };
  }),
});
