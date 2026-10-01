/**
 * freemiumTiers.ts — Q-wave Q6 member surface (2026-10-01, R2)
 *
 * Member-facing freemium-ladder bindings for the PWA
 * (customer-portal-full/client/src/services/innovationApi.ts → freemiumApi,
 * mounted as `freemiumTiers`). This router owns NO business logic of its
 * own: reads go straight to the Q1 freemium_tiers / freemium_enrollments
 * tables, and the `upgrade` mutation DELEGATES to the existing Q1
 * procedures on embeddedPartnerFactoryRouter (enrollFreemium /
 * upgradeFreemium) via createCaller — so premium collection stays
 * fail-closed inside the one real implementation
 * (collectMobileMoneyPremium; no paid cover without a collected premium).
 *
 * All procedures are protectedProcedure (member-scoped); admin tier CRUD
 * remains on embeddedFactory.createFreemiumTier (adminProcedure).
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { freemiumEnrollments, freemiumTiers } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { embeddedPartnerFactoryRouter } from "./embeddedPartnerFactory";

async function db() {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  return d;
}

export const freemiumTiersRouter = router({
  /**
   * Caller's current freemium tier. Honest empty state: no active
   * enrollment → { tier: "none", since: null } (the member simply has not
   * enrolled — NOT an error).
   */
  myTier: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const [row] = await d
      .select({
        enrollmentId: freemiumEnrollments.id,
        enrolledAt: freemiumEnrollments.createdAt,
        tierCode: freemiumTiers.tierCode,
        tierName: freemiumTiers.name,
      })
      .from(freemiumEnrollments)
      .innerJoin(freemiumTiers, eq(freemiumTiers.id, freemiumEnrollments.tierId))
      .where(
        and(
          eq(freemiumEnrollments.customerId, ctx.user.id),
          eq(freemiumEnrollments.status, "active")
        )
      )
      .limit(1);
    if (!row) return { tier: "none" as const, since: null };
    return { tier: row.tierCode, tierName: row.tierName, since: row.enrolledAt };
  }),

  /** Active freemium tiers catalogue (member-safe read of the Q1 table). */
  listTiers: protectedProcedure.query(async () => {
    const d = await db();
    const tiers = await d
      .select()
      .from(freemiumTiers)
      .where(eq(freemiumTiers.isActive, true))
      .orderBy(asc(freemiumTiers.sortOrder))
      .limit(100);
    return {
      tiers: tiers.map((t) => ({
        tierId: t.id,
        code: t.tierCode,
        name: t.name,
        coverageType: t.coverageType,
        monthlyPremium: t.monthlyPremium,
        // Platform settlement currency (Q1 premium rail convention — NGN).
        currency: "NGN",
        coverLimit: t.sumInsured,
        isFree: t.isFree,
        sortOrder: t.sortOrder,
      })),
    };
  }),

  /**
   * Enroll onto a FREE tier or upgrade to a PAID tier, by tierCode.
   * Delegates to the Q1 procedures (createCaller) so there is exactly one
   * implementation of the money path. Fail-closed:
   *  - paid tier without an msisdn → BAD_REQUEST (premium cannot be
    *    collected, so no cover is activated);
   *  - paid tier without an existing free enrollment → BAD_REQUEST
   *    (the Q1 ladder requires enrolling on the free tier first);
   *  - collection failure inside upgradeFreemium → upgraded:false, the
   *    enrollment stays on its current tier.
   */
  upgrade: protectedProcedure
    .input(
      z.object({
        tierCode: z.string().min(2).max(32),
        msisdn: z.string().min(8).max(20).optional(),
        channel: z.enum(["airtime", "mobile_money"]).default("mobile_money"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const [targetTier] = await d
        .select()
        .from(freemiumTiers)
        .where(and(eq(freemiumTiers.tierCode, input.tierCode), eq(freemiumTiers.isActive, true)))
        .limit(1);
      if (!targetTier) throw new TRPCError({ code: "NOT_FOUND", message: "Tier not found" });

      const [enrollment] = await d
        .select()
        .from(freemiumEnrollments)
        .where(
          and(
            eq(freemiumEnrollments.customerId, ctx.user.id),
            eq(freemiumEnrollments.status, "active")
          )
        )
        .limit(1);

      const caller = embeddedPartnerFactoryRouter.createCaller(ctx);

      if (!enrollment) {
        if (!targetTier.isFree) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Enroll on the free tier first — paid tiers upgrade an existing freemium enrollment",
          });
        }
        const res = await caller.enrollFreemium({ tierId: targetTier.id });
        return { success: true as const, tier: res.tierCode, enrollmentId: res.enrollmentId };
      }

      if (enrollment.tierId === targetTier.id) {
        // Idempotent replay: already on the requested tier.
        return { success: true as const, tier: targetTier.tierCode, enrollmentId: enrollment.id };
      }
      if (targetTier.isFree) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Already enrolled — the free tier cannot be an upgrade target",
        });
      }
      if (!input.msisdn) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "msisdn is required to collect the premium for a paid tier — no cover is activated without it",
        });
      }
      const res = await caller.upgradeFreemium({
        enrollmentId: enrollment.id,
        targetTierId: targetTier.id,
        msisdn: input.msisdn,
        channel: input.channel,
      });
      if (!res.upgraded) {
        // FAIL-CLOSED passthrough: premium collection declined — surface the
        // honest reason; the enrollment remains on its current tier.
        return { success: false as const, tier: targetTier.tierCode, reason: res.reason, message: res.message };
      }
      return { success: true as const, tier: res.tierCode, policyId: res.policyId };
    }),
});
