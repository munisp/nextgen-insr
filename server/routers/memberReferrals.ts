/**
 * memberReferrals.ts — R3 batch 1 member surface (2026-10-01, R3)
 *
 * Member-scoped referral views for the PWA
 * (customer-portal-full/client/src/services/loyaltyApi.ts → referralsApi).
 *
 * Why this router exists: the monolith `referrals` router
 * (server/routers/referrals.ts) is an AGENT-referral program (agent cookie
 * or admin identity). `referralProgramDedicated` (server/routers/
 * referralProgram.ts) has an UNSCOPED platform-wide `list` (IDOR) and a
 * `generateLink` that takes an arbitrary caller-supplied `referrerId` and
 * returns a fabricated, never-persisted link string. This router is the
 * member-safe variant: identity is ALWAYS resolved server-side from the
 * session (`customers.keycloakSub = String(ctx.user.id)`); no referrerId /
 * customerId is ever accepted from input.
 *
 * Party key: referrals.referrer_agent_id is the schema's party column for
 * the referrer — and it carries an ENFORCED FK to agents.id
 * (drizzle/schema.ts:2486-2489; migration 0026_overconfident_stardust.sql:108
 * adds referrals_referrer_agent_id_agents_id_fk). agents and customers are
 * independent serial id spaces.
 *
 * 2026-10-01 (R3-fix): myCode is now READ-ONLY. The previous version
 * INSERTed a referrals row with referrerAgentId = customers.id, which (a)
 * threw PG 23503 → 500 for any customer whose id has no coinciding agents
 * row, and (b) where ids coincided, mis-attributed a member's code into the
 * AGENT referral program with bonusPoints/bonusCash persisted (funds-
 * adjacent). Member-context minting is REMOVED entirely and deferred until
 * a member-space referral-codes table exists. myCode now only returns the
 * caller's existing still-valid pending code when the caller's resolved
 * customer id coincides with an existing agents.id row (the agents table
 * has NO member identity link — no keycloakSub/userId column — verified
 * against drizzle/schema.ts:317-389), and returns null otherwise; the PWA
 * discloses the unavailable state on null (MyReferrals.tsx
 * UnavailableStateGuard). Nothing is ever inserted from a member context.
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; no customer profile →
 * NOT_FOUND (non-enumerating). No reward-calculation proc is exposed —
 * referralProgramDedicated.calculateRewards is honestly NOT_IMPLEMENTED.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import { agents, customers, referrals } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

type DrizzleDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function db(): Promise<DrizzleDb> {
  const d = await getDb();
  if (!d) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable",
    });
  }
  return d;
}

/**
 * Resolve the session user's customer profile (2026-10-01, R3 — copied from
 * customerWalletSystem.resolveSessionCustomer). NOT_FOUND is non-enumerating.
 */
async function resolveSessionCustomer(d: DrizzleDb, userId: number | string) {
  const [customer] = await d
    .select()
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

export const memberReferralsRouter = router({
  /**
   * Caller's referrals (as referrer), newest first, paginated. Read-only.
   */
  myReferrals: protectedProcedure
    .input(
      z
        .object({
          status: z
            .enum(["pending", "activated", "rewarded", "expired"])
            .optional(),
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
        eq(referrals.referrerAgentId, customer.id),
        input?.status ? eq(referrals.status, input.status) : undefined
      );

      const rows = await d
        .select({
          id: referrals.id,
          referralCode: referrals.referralCode,
          refereeCode: referrals.refereeCode,
          status: referrals.status,
          bonusPoints: referrals.bonusPoints,
          bonusCash: referrals.bonusCash,
          activatedAt: referrals.activatedAt,
          rewardedAt: referrals.rewardedAt,
          expiresAt: referrals.expiresAt,
          createdAt: referrals.createdAt,
        })
        .from(referrals)
        .where(scope)
        .orderBy(desc(referrals.id))
        .limit(limit)
        .offset(offset);

      const [countRow] = await d
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(referrals)
        .where(scope);

      return {
        referrals: rows,
        total: Number(countRow?.count ?? 0),
        limit,
        offset,
      };
    }),

  /**
   * Caller's active referral code — READ-ONLY (2026-10-01, R3-fix).
   *
   * referrals.referrer_agent_id has an enforced FK to agents.id
   * (drizzle/schema.ts:2486-2489; migration 0026), so a member-context
   * INSERT either violates the FK (23503 → 500) or, where the customers.id
   * coincides with an agents.id, mis-attributes the row into the AGENT
   * referral program with bonusPoints/bonusCash persisted. Minting is
   * therefore removed entirely, deferred until a member-space referral
   * codes table exists.
   *
   * The agents table has NO member identity link (no keycloakSub/userId
   * column — verified against drizzle/schema.ts:317-389), so the only
   * available binding is the id-space coincidence: the caller is treated
   * as having an agent identity iff an agents row exists with
   * agents.id = the resolved customers.id. If so, the caller's existing
   * still-valid pending code is returned; otherwise null (the PWA
   * discloses the unavailable state — MyReferrals.tsx). Never inserts.
   */
  myCode: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const customer = await resolveSessionCustomer(d, ctx.user.id);

    const [agent] = await d
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, customer.id))
      .limit(1);
    if (!agent) {
      return null;
    }

    const [existing] = await d
      .select({
        id: referrals.id,
        referralCode: referrals.referralCode,
        expiresAt: referrals.expiresAt,
      })
      .from(referrals)
      .where(
        and(
          eq(referrals.referrerAgentId, customer.id),
          eq(referrals.status, "pending"),
          // Still-valid codes only; expired ones must not be re-handed out.
          gt(referrals.expiresAt, new Date())
        )
      )
      .orderBy(desc(referrals.id))
      .limit(1);

    if (!existing) {
      return null;
    }
    return {
      referralCode: existing.referralCode,
      expiresAt: existing.expiresAt,
      existing: true,
    };
  }),
});
