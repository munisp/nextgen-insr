/**
 * memberLoyalty.ts — R3 batch 1 member surface (2026-10-01, R3)
 *
 * Member-scoped READ-ONLY loyalty views for the PWA
 * (customer-portal-full/client/src/services/loyaltyApi.ts → loyaltyApi).
 *
 * Why this router exists: the monolith `loyalty` router
 * (server/routers/loyalty.ts) is an AGENT program — identity comes from the
 * agent-session cookie, so members get UNAUTHORIZED. The member-plausible
 * `customerLoyaltyProgram` router takes an arbitrary caller-supplied
 * `customerId` on getBalance/getHistory (IDOR). This router is the
 * member-safe variant: identity is ALWAYS resolved server-side from the
 * session (`customers.keycloakSub = String(ctx.user.id)` — same convention
 * as customerWalletSystem.resolveSessionCustomer); no client-supplied id is
 * ever accepted.
 *
 * Party key: loyalty_history rows are keyed by the owning party's id in
 * `agentId` (the schema's only integer party column on that table — same
 * convention as wallet transactions). The id here is the resolved CUSTOMER
 * id, never an agent id and never caller input.
 *
 * Scope: READ-ONLY. There is deliberately NO redeem mutation in batch 1 —
 * points are funds-adjacent (1pt = ₦1 per the AB-12 note in
 * customerLoyaltyProgram.ts) and no member-safe reward catalog is delivered;
 * fail-closed rather than expose a funds mutation.
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; no customer profile for the
 * session → NOT_FOUND (non-enumerating, same message everywhere).
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql, sum } from "drizzle-orm";
import { z } from "zod";

import { customers, loyaltyHistory } from "../../drizzle/schema";
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
 * customerWalletSystem.resolveSessionCustomer). NOT_FOUND is non-enumerating:
 * it reveals nothing about whether any particular customer id exists.
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

export const memberLoyaltyRouter = router({
  /**
   * Caller's loyalty points balance: earned − redeemed over
   * loyalty_history.agentId = resolved customer.id. Read-only.
   */
  myBalance: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const customer = await resolveSessionCustomer(d, ctx.user.id);

    const [earned] = await d
      .select({ total: sum(loyaltyHistory.points) })
      .from(loyaltyHistory)
      .where(
        and(
          eq(loyaltyHistory.agentId, customer.id),
          eq(loyaltyHistory.type, "earned")
        )
      )
      .limit(1);
    // Redeemed rows store NEGATIVE points (see customerLoyaltyProgram
    // .redeemPoints), so take the absolute sum regardless of sign convention.
    const [redeemed] = await d
      .select({
        total: sql<string>`COALESCE(SUM(ABS(${loyaltyHistory.points})), 0)`,
      })
      .from(loyaltyHistory)
      .where(
        and(
          eq(loyaltyHistory.agentId, customer.id),
          eq(loyaltyHistory.type, "redeemed")
        )
      )
      .limit(1);

    const earnedTotal = Number(earned?.total ?? 0);
    const redeemedTotal = Number(redeemed?.total ?? 0);
    return {
      customerId: customer.id,
      earned: earnedTotal,
      redeemed: redeemedTotal,
      balance: earnedTotal - redeemedTotal,
    };
  }),

  /**
   * Caller's loyalty ledger, newest first, paginated. Read-only.
   */
  myHistory: protectedProcedure
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
      const customer = await resolveSessionCustomer(d, ctx.user.id);
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      const scope = eq(loyaltyHistory.agentId, customer.id);
      const rows = await d
        .select({
          id: loyaltyHistory.id,
          type: loyaltyHistory.type,
          points: loyaltyHistory.points,
          description: loyaltyHistory.description,
          balanceAfter: loyaltyHistory.balanceAfter,
          createdAt: loyaltyHistory.createdAt,
        })
        .from(loyaltyHistory)
        .where(scope)
        .orderBy(desc(loyaltyHistory.createdAt))
        .limit(limit)
        .offset(offset);

      const [countRow] = await d
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(loyaltyHistory)
        .where(scope);

      return {
        history: rows,
        total: Number(countRow?.count ?? 0),
        limit,
        offset,
      };
    }),
});
