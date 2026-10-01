/**
 * memberAirtime.ts — R3 batch 3 member surface (2026-10-01, R3-b3)
 *
 * READ-ONLY member-scoped view of the airtime-vending domain
 * (server/routers/airtimeVending.ts), mounted as `memberAirtime`. The
 * funds mutation `vend` is a rail-backed `financialProcedure` gated behind
 * the `transfer` op, which role `user` does NOT hold
 * (permifyMiddleware.ts ROLE_PERMISSIONS) — deferred to the reviewed
 * funds wave and deliberately NOT exposed here. The base router's
 * `getHistory` is an AGENT view (`agentId = ctx.user.id`, not a member
 * view) and its `getSummary` is GLOBAL/unscoped — neither is proxied.
 *
 * Caller scoping (IDOR-safe): the caller's phone is derived SERVER-SIDE
 * from the session — `customers.keycloakSub = String(ctx.user.id)` →
 * `customers.phone` — and rows are scoped
 * `transactions.customerPhone = <caller phone> AND type = 'Airtime'`
 * (vend writes customerPhone = vend phoneNumber, airtimeVending.ts:157).
 * A phone number is NEVER accepted from input as identity proof. No
 * customer profile → empty result (not an error; non-enumerating).
 *
 * Fail-closed: getDb() null → INTERNAL_SERVER_ERROR. All statuses
 * reported verbatim (pending_provider / unknown_outcome disclosed, never
 * filtered). No mutations.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";

import { customers, transactions } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

type DrizzleDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

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
 * The caller's registered phone, resolved from the session only
 * (customers.keycloakSub = String(ctx.user.id)). Sole caller scope; no
 * phone is ever taken from input. null → no customer profile → empty
 * caller scope.
 */
async function resolveCallerPhone(
  d: DrizzleDb,
  userId: number
): Promise<string | null> {
  const [customer] = await d
    .select({ phone: customers.phone })
    .from(customers)
    .where(eq(customers.keycloakSub, String(userId)))
    .limit(1);
  return customer?.phone ?? null;
}

interface AirtimeMetadata {
  network?: string;
  phoneNumber?: string;
  providerStatus?: string;
}

export const memberAirtimeRouter = router({
  /**
   * Caller's airtime history, newest first, paginated. Network/phoneNumber
   * come from the vend metadata verbatim; ALL statuses returned verbatim.
   */
  myHistory: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(20),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const d = await db();
      const phone = await resolveCallerPhone(d, ctx.user.id);
      if (!phone) return { history: [], total: 0 };
      const scope = and(
        eq(transactions.customerPhone, phone),
        eq(transactions.type, "Airtime")
      );
      const rows = await d
        .select({
          ref: transactions.ref,
          amount: transactions.amount,
          status: transactions.status,
          failureReason: transactions.failureReason,
          metadata: transactions.metadata,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .where(scope)
        .orderBy(desc(transactions.createdAt))
        .limit(input?.limit ?? 20)
        .offset(input?.offset ?? 0);
      const [countRow] = await d
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(transactions)
        .where(scope);
      return {
        history: rows.map(t => ({
          ref: t.ref,
          network: (t.metadata as AirtimeMetadata | null)?.network ?? null,
          phoneNumber:
            (t.metadata as AirtimeMetadata | null)?.phoneNumber ?? null,
          amount: t.amount,
          status: t.status,
          providerStatus:
            (t.metadata as AirtimeMetadata | null)?.providerStatus ?? null,
          failureReason: t.failureReason,
          createdAt: t.createdAt,
        })),
        total: countRow?.count ?? 0,
      };
    }),

  /**
   * Caller's airtime summary over `periodDays` (default 30), per status —
   * the base airtimeVending.getSummary is GLOBAL; this caller-scoped
   * variant never proxies it. Pending/failed rows are disclosed per status.
   */
  mySummary: protectedProcedure
    .input(
      z
        .object({ periodDays: z.number().int().min(1).max(365).default(30) })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const d = await db();
      const periodDays = input?.periodDays ?? 30;
      const phone = await resolveCallerPhone(d, ctx.user.id);
      if (!phone)
        return {
          periodDays,
          totalTransactions: 0,
          byStatus: [] as Array<{
            status: string;
            count: number;
            volumeNGN: number;
          }>,
        };
      const since = new Date(Date.now() - periodDays * 86400000);
      const rows = await d
        .select({
          status: transactions.status,
          count: sql<number>`COUNT(*)::int`,
          volume: sql<string>`COALESCE(SUM(CAST(${transactions.amount} AS NUMERIC)), 0)`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.customerPhone, phone),
            eq(transactions.type, "Airtime"),
            gte(transactions.createdAt, since)
          )
        )
        .groupBy(transactions.status);
      const byStatus = rows.map(r => ({
        status: r.status,
        count: r.count,
        volumeNGN: Number(r.volume),
      }));
      return {
        periodDays,
        totalTransactions: byStatus.reduce((n, s) => n + s.count, 0),
        byStatus,
      };
    }),
});
