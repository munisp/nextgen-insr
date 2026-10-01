/**
 * memberMobileMoney.ts — R3 batch 3 member surface (2026-10-01, R3-b3)
 *
 * READ-ONLY member-scoped view of the mobile-money domain
 * (server/routers/mobileMoney.ts), mounted as `memberMobileMoney`. The
 * funds mutations `cashIn`/`cashOut` are rail-backed `financialProcedure`s
 * gated behind the `transfer` op, which role `user` does NOT hold
 * (permifyMiddleware.ts ROLE_PERMISSIONS) — they are deferred to the
 * reviewed funds wave and are deliberately NOT exposed here. The base
 * router's reads (`transactions`/`list`/`analytics`/`getSummary`/`wallets`)
 * are UNSCOPED (every caller sees all mobile-money rows / all-customer PII)
 * — never proxied.
 *
 * Caller scoping (IDOR-safe): the caller's phone is derived SERVER-SIDE
 * from the session — `customers.keycloakSub = String(ctx.user.id)` →
 * `customers.phone` — and transactions are scoped
 * `transactions.customerPhone = <caller phone> AND metadata->>'provider'
 * IS NOT NULL` (the mobile-money discriminator, mobileMoney.ts:161-168).
 * A phone number is NEVER accepted from input as identity proof. With no
 * customer profile there is no caller phone at all → empty result (not an
 * error), keeping the surface non-enumerating.
 *
 * Fail-closed: getDb() null → INTERNAL_SERVER_ERROR. Single-row fetch
 * (myTransaction) is NOT_FOUND on ownership miss (non-enumerating). All
 * statuses are reported verbatim (pending_provider / unknown_outcome are
 * disclosed, never filtered or cosmetically renamed). No mutations.
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
 * (customers.keycloakSub = String(ctx.user.id)). This is the SOLE caller
 * scope; no phone is ever taken from input. null → no customer profile →
 * empty caller scope.
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

// Mobile-money provider integration is configured via environment (copy of
// mobileMoney.ts isMobileMoneyProviderConfigured per the R3-b3 worklist —
// the router is not imported).
function isMobileMoneyProviderConfigured(): boolean {
  return !!(
    process.env.MOBILE_MONEY_PROVIDER_URL ||
    process.env.MOBILE_MONEY_PROVIDER_API_KEY ||
    process.env.MOJALOOP_ENDPOINT ||
    process.env.MOJALOOP_URL
  );
}

const PROVIDERS = ["MTN MoMo", "Airtel Money", "Glo Xtra", "9PSB"] as const;
const MIN_AMOUNT = 100,
  MAX_AMOUNT = 300_000,
  DAILY_LIMIT = 1_000_000;
const CASH_IN_COMMISSION = 0.015,
  CASH_OUT_COMMISSION = 0.015;

/** Mobile-money row discriminator (provider key set by cashIn/cashOut). */
const MM_SCOPE = sql`${transactions.metadata}->>'provider' IS NOT NULL`;

interface TxMetadata {
  provider?: string;
  providerStatus?: string;
}

export const memberMobileMoneyRouter = router({
  /**
   * Caller's mobile-money transactions, newest first, paginated. Optional
   * `provider` is a FILTER within the caller's phone scope — it never
   * re-scopes the query. ALL statuses returned verbatim.
   */
  myTransactions: protectedProcedure
    .input(
      z
        .object({
          provider: z.enum(PROVIDERS).optional(),
          limit: z.number().int().min(1).max(100).default(20),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const d = await db();
      const phone = await resolveCallerPhone(d, ctx.user.id);
      if (!phone) return { transactions: [], count: 0 };
      const scope = and(
        eq(transactions.customerPhone, phone),
        MM_SCOPE,
        input?.provider
          ? sql`${transactions.metadata}->>'provider' = ${input.provider}`
          : undefined
      );
      const rows = await d
        .select({
          ref: transactions.ref,
          type: transactions.type,
          amount: transactions.amount,
          fee: transactions.fee,
          status: transactions.status,
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
        transactions: rows.map(t => ({
          ref: t.ref,
          type: t.type,
          amount: t.amount,
          fee: t.fee,
          status: t.status,
          provider: (t.metadata as TxMetadata | null)?.provider ?? null,
          providerStatus:
            (t.metadata as TxMetadata | null)?.providerStatus ?? null,
          createdAt: t.createdAt,
        })),
        count: countRow?.count ?? 0,
      };
    }),

  /**
   * Single mobile-money transaction by ref — ownership = the caller's phone
   * scope. NOT_FOUND on miss (foreign or nonexistent ref alike;
   * non-enumerating).
   */
  myTransaction: protectedProcedure
    .input(z.object({ ref: z.string().min(1).max(32) }))
    .query(async ({ input, ctx }) => {
      const d = await db();
      const phone = await resolveCallerPhone(d, ctx.user.id);
      const scope = phone
        ? and(
            eq(transactions.customerPhone, phone),
            MM_SCOPE,
            eq(transactions.ref, input.ref)
          )
        : eq(transactions.ref, "__no_caller_scope__");
      const [t] = await d
        .select({
          ref: transactions.ref,
          type: transactions.type,
          amount: transactions.amount,
          fee: transactions.fee,
          status: transactions.status,
          failureReason: transactions.failureReason,
          metadata: transactions.metadata,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .where(scope)
        .limit(1);
      if (!t)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Transaction not found",
        });
      return {
        transaction: {
          ref: t.ref,
          type: t.type,
          amount: t.amount,
          fee: t.fee,
          status: t.status,
          failureReason: t.failureReason,
          provider: (t.metadata as TxMetadata | null)?.provider ?? null,
          providerStatus:
            (t.metadata as TxMetadata | null)?.providerStatus ?? null,
          createdAt: t.createdAt,
        },
      };
    }),

  /**
   * Caller's mobile-money summary over `periodDays` (default 30). Every
   * status is reported per status — pending_provider rows are disclosed
   * honestly, not silently excluded or merged into "success".
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
            MM_SCOPE,
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

  /**
   * Static provider registry (copied from mobileMoney.ts per the R3-b3
   * worklist) with the HONEST configuration status — `configured:false`
   * means top-ups/cash-outs are unavailable on this deployment.
   */
  providers: protectedProcedure.query(() => ({
    providers: PROVIDERS.map(name => ({
      name,
      cashInCommission: CASH_IN_COMMISSION,
      cashOutCommission: CASH_OUT_COMMISSION,
    })),
    limits: {
      minAmountNGN: MIN_AMOUNT,
      maxAmountNGN: MAX_AMOUNT,
      dailyLimitNGN: DAILY_LIMIT,
    },
    configured: isMobileMoneyProviderConfigured(),
  })),
});
