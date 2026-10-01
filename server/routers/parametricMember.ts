/**
 * parametricMember.ts — Q-wave Q6 member surface (2026-10-01, R2)
 *
 * Member-scoped READ-ONLY views over the Q2 parametric engine tables
 * (migration 0087: parametric_products / parametric_events /
 * parametric_payout_settlements). The engine router
 * (server/routers/parametricEngine.ts) is deliberately ADMIN-only — trigger
 * CRUD, manual readings and payout evaluation stay there. This router gives
 * the PWA (customer-portal-full/client/src/services/innovationApi.ts →
 * parametricMemberApi) an honest member view:
 *
 *   - myCoverage: the caller's policies riding on an ACTIVE parametric
 *     product mapping (policy → product → trigger), plus the trigger state.
 *   - myPayouts:  parametric_payout_settlements rows whose claim belongs to
 *     the caller (claims.claimantId = ctx.user.id).
 *
 * NO payout-triggering power exists here — there are no mutations at all.
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR, never fabricated coverage.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  claims,
  insuranceProducts,
  policies,
  parametricPayoutSettlements,
  parametricProducts,
  parametricTriggerDefinitions,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

async function db() {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  return d;
}

export const parametricMemberRouter = router({
  /**
   * Caller's parametric coverage: their policies whose productId is mapped
   * to an active parametric product. Read-only.
   */
  myCoverage: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const rows = await d
      .select({
        policyId: policies.id,
        policyStatus: policies.status,
        productName: insuranceProducts.name,
        coveredPeril: parametricProducts.coveredPeril,
        payoutAmount: parametricProducts.payoutAmount,
        productStatus: parametricProducts.status,
        triggerStatus: parametricTriggerDefinitions.status,
      })
      .from(policies)
      .innerJoin(parametricProducts, eq(parametricProducts.productId, policies.productId))
      .innerJoin(insuranceProducts, eq(insuranceProducts.id, policies.productId))
      .leftJoin(
        parametricTriggerDefinitions,
        eq(parametricTriggerDefinitions.id, parametricProducts.triggerId)
      )
      .where(
        and(
          eq(policies.customerId, ctx.user.id),
          eq(parametricProducts.status, "active")
        )
      )
      .orderBy(desc(policies.id))
      .limit(100);

    return {
      coverage: rows.map((r) => ({
        policyId: r.policyId,
        productName: r.productName,
        coveredPeril: r.coveredPeril,
        payoutAmount: r.payoutAmount,
        // Platform settlement currency (same convention as the Q1 freemium
        // premium rail, collectMobileMoneyPremium — NGN).
        currency: "NGN",
        status: r.policyStatus,
        triggerStatus: r.triggerStatus ?? null,
      })),
    };
  }),

  /**
   * Caller's parametric payout settlements (claim-scoped IDOR guard: only
   * settlements whose claim has claimantId = ctx.user.id). Read-only.
   */
  myPayouts: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const d = await db();
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      const scope = eq(claims.claimantId, ctx.user.id);
      const rows = await d
        .select({
          id: parametricPayoutSettlements.id,
          eventId: parametricPayoutSettlements.eventId,
          claimId: parametricPayoutSettlements.claimId,
          policyId: claims.policyId,
          amount: parametricPayoutSettlements.amount,
          status: parametricPayoutSettlements.status,
          createdAt: parametricPayoutSettlements.createdAt,
        })
        .from(parametricPayoutSettlements)
        .innerJoin(claims, eq(claims.id, parametricPayoutSettlements.claimId))
        .where(scope)
        .orderBy(desc(parametricPayoutSettlements.id))
        .limit(limit)
        .offset(offset);

      const [countRow] = await d
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(parametricPayoutSettlements)
        .innerJoin(claims, eq(claims.id, parametricPayoutSettlements.claimId))
        .where(scope);

      return {
        payouts: rows.map((r) => ({
          id: r.id,
          eventId: r.eventId,
          claimId: r.claimId,
          policyId: r.policyId,
          amount: r.amount,
          currency: "NGN",
          status: r.status,
          createdAt: r.createdAt,
        })),
        count: countRow?.count ?? 0,
      };
    }),
});
