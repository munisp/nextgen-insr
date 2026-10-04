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
 * filtered).
 *
 * 2026-10-03 (W10-B2): the member-safe funds mutation `vend` (+ `confirmVend`)
 * now ships on server/lib/memberFunds.ts — REAL Paystack capture of the
 * caller (env-gated, fail-closed) → verified-capture → fulfillment dispatch
 * to AIRTIME_PROVIDER_URL/vend (tri-state; never synchronous success). The
 * quarantined airtimeVending.vend (client-supplied agentId, agent float,
 * `transfer` op the `user` role lacks) is never delegated to. The caller's
 * phone is session-resolved (resolveCallerPhone) and recorded as identity;
 * the beneficiary phone may differ but the row is scoped to the CALLER.
 * Amount is member-chosen within ₦50–₦50,000 (CBN/NCC bounds) + the
 * server-side ₦500,000 daily limit over the caller's own rows. F-02
 * idempotency with payload-hash binding + derived AV- references.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";

import { customers, transactions } from "../../drizzle/schema";
import {
  confirmMemberCapture,
  initiateMemberCapture,
  requireIdempotencyKey,
  resolveMemberCustomer,
  type MemberFundsKind,
} from "../lib/memberFunds";
import type { ProviderClientConfig } from "../lib/providerDispatch";
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

// ── W10-B2 (2026-10-03): member airtime funds rail ──────────────────────────
const NETWORKS = ["MTN", "Glo", "Airtel", "9mobile"] as const;
const VEND_MIN_AMOUNT = 50;
const VEND_MAX_AMOUNT = 50_000;
const VEND_DAILY_LIMIT = 500_000;
const NIGERIAN_PHONE = /^(0|\+234)[789][01]\d{8}$/;

// Real provider client (airtimeProviderClient pattern, airtimeVending.ts:53-61):
// only a configured base URL enables fulfillment dispatch; anything less
// fails closed BEFORE any charge.
function airtimeProviderClient(): ProviderClientConfig | null {
  const baseUrl = process.env.AIRTIME_PROVIDER_URL;
  if (!baseUrl) return null;
  return {
    baseUrl,
    apiKey: process.env.AIRTIME_PROVIDER_API_KEY,
    timeoutMs: Number(process.env.AIRTIME_PROVIDER_TIMEOUT_MS ?? 10_000),
  };
}

const AIRTIME_KIND: MemberFundsKind = {
  journey: "member-airtime-vend", // F-02 idempotency namespace
  refPrefix: "AV",
  txType: "Airtime",
  providerClient: airtimeProviderClient,
  dispatchPath: "/vend",
  label: "airtime vend",
};

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

  /**
   * W10-B2 (2026-10-03): member airtime vend — capture phase. The caller's
   * registered phone is the session-resolved identity (recorded as
   * transactions.customerPhone so myHistory/mySummary scope it); the
   * beneficiary phone defaults to the caller's own and may be a third-party
   * number, but it NEVER re-scopes identity. Amount within ₦50–₦50,000 at
   * the boundary + the server-side daily limit. Paystack capture first;
   * provider fulfillment only via confirmVend after verified capture.
   */
  vend: protectedProcedure
    .input(
      z.object({
        network: z.enum(NETWORKS),
        phoneNumber: z.string().regex(NIGERIAN_PHONE, "Invalid Nigerian phone number").optional(),
        amountNGN: z.number().int().min(VEND_MIN_AMOUNT).max(VEND_MAX_AMOUNT),
        idempotencyKey: z
          .string()
          .regex(/^[A-Za-z0-9_-]{8,20}$/)
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const customer = await resolveMemberCustomer(d, ctx.user.id);
      if (!customer?.phone) {
        // Fail-closed: without the caller's registered phone there is no
        // member identity to bind the vend to.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No registered phone is bound to this member profile — airtime vend is unavailable (fail-closed)",
        });
      }
      const beneficiary = input.phoneNumber ?? customer.phone;
      const idempotencyKey = requireIdempotencyKey(input.idempotencyKey, ctx);
      return initiateMemberCapture({
        d,
        ctx,
        kind: AIRTIME_KIND,
        customer,
        idempotencyKey,
        amountNGN: input.amountNGN,
        idemPayload: {
          network: input.network,
          phoneNumber: beneficiary,
          amountNGN: input.amountNGN,
        },
        dailyScope: and(
          eq(transactions.customerPhone, customer.phone),
          eq(transactions.type, "Airtime")
        ),
        dailyLimitNGN: VEND_DAILY_LIMIT,
        row: { customerPhone: customer.phone },
        metadata: {
          network: input.network,
          phoneNumber: beneficiary,
          callerPhone: customer.phone,
        },
        dispatchPayload: {
          network: input.network,
          phoneNumber: beneficiary,
          amountNGN: input.amountNGN,
        },
      });
    }),

  /**
   * W10-B2: verify the Paystack capture for an AV- reference and dispatch
   * the vend to the airtime provider on a kobo-exact success. Replay-safe;
   * ownership-gated (foreign reference → NOT_FOUND).
   */
  confirmVend: protectedProcedure
    .input(z.object({ reference: z.string().min(8).max(32) }))
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      return confirmMemberCapture({ d, ctx, kind: AIRTIME_KIND, reference: input.reference });
    }),
});
