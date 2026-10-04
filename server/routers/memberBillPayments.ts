/**
 * memberBillPayments.ts — R3 batch 3 member surface (2026-10-01, R3-b3)
 *
 * READ-ONLY member bill-payments surface over the billPayments domain
 * (server/routers/billPayments.ts). Deliberately NO mutation proc and no
 * history proc:
 *
 *   - billPayments.pay is a funds mutation behind financialProcedure; the
 *     `billPayments.pay` op maps to `transfer` and ROLE_PERMISSIONS grants
 *     role `user` NO transfer permission (server/_core/permifyMiddleware.ts)
 *     — it is NEVER exposed here. Member-initiated bill pay is deferred to
 *     the reviewed funds wave.
 *   - Member bill history (myPayments) is NOT honestly scopable today: bill
 *     transaction rows store `customerAccount`/`metadata.customerNumber`
 *     (the biller's meter/smartcard number), not a member-bound identity
 *     column, so no query can prove a bill row belongs to the caller. It is
 *     omitted (not proxied, not guessed); the PWA page discloses this
 *     verbatim ("payment history appears here once member-initiated bill
 *     pay ships").
 *   - billPayments.getHistory/getSummary are agent views scoped to
 *     `ctx.user.id` AS agentId and `list` is unscoped (IDOR) — never
 *     exposed to members.
 *
 * What ships (catalog data only, no funds, no personal data):
 *   - billers:          the BILLER_COMMISSION registry (copied verbatim from
 *                       billPayments.ts — per worklist §3.3, do NOT import,
 *                       keep the commission table in one audited copy here)
 *                       with min/max/daily limits + an honest `configured`
 *                       flag from the four bill-provider env vars (also
 *                       copied locally per worklist).
 *   - validateCustomer: the same customer-number regex rules as
 *                       billPayments.validateCustomer (electricity 10-13
 *                       digits, TV 10-12 digits, else >= 5 chars). Pure
 *                       format check — no provider lookup exists.
 *
 * Fail-closed: all procs are protectedProcedure (authentication required).
 *
 * 2026-10-03 (W10-B2): the member-safe funds mutation `pay` (+ `confirmPay`)
 * now ships, composed on server/lib/memberFunds.ts: the member is charged via
 * the REAL Paystack capture rail (env-gated, fail-closed) and fulfillment is
 * dispatched to BILL_PROVIDER_URL ONLY after a server-side verified capture
 * (kobo-exact). The quarantined billPayments.pay (client-supplied agentId,
 * agent float) is never delegated to. Amounts: member-chosen within the
 * registry MIN/MAX (design §6.1 — the biller registry carries limits, not
 * prices) + a server-side DAILY limit over the caller's OWN rows; identity
 * is session-derived only (metadata.memberUserId/memberCustomerId); F-02
 * idempotency with payload-hash binding and derived BP- references
 * (crash-adoptable). Fulfillment is NEVER synchronous success: the row is
 * INSERT-first PENDING ("awaiting_payment" → capture → "submitted" /
 * "unknown_outcome" / "rejected"+failed_refund_pending).
 */
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { transactions } from "../../drizzle/schema";
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

// ── Registry copy (billPayments.ts:31-36, 2026-10-01 R3-b3) ────────────────
// Keep in sync with billPayments.ts; the member surface must disclose the
// exact commission the agent rail applies.
const BILLER_COMMISSION: Record<string, number> = {
  EKEDC: 0.005, IKEDC: 0.005, AEDC: 0.005, PHED: 0.005, BEDC: 0.005, EEDC: 0.005, JED: 0.005, KEDCO: 0.005,
  DSTV: 0.01, GOtv: 0.01, Startimes: 0.01, Showmax: 0.01,
  WAEC: 0.02, JAMB: 0.02, NECO: 0.02, NABTEB: 0.02,
  LCC: 0.005, LASG: 0.005, FIRS: 0.005, CAC: 0.005,
};
const MIN_AMOUNT = 100, MAX_AMOUNT = 500_000, DAILY_LIMIT = 2_000_000;

const ELECTRICITY_BILLERS = ["EKEDC", "IKEDC", "AEDC", "PHED", "BEDC", "EEDC", "JED", "KEDCO"];
const TV_BILLERS = ["DSTV", "GOtv", "Startimes", "Showmax"];

/**
 * Bill-provider configuration probe — local copy of billPayments.ts's
 * isBillProviderConfigured (the four env vars, per worklist §3.3; the base
 * module's helper is not exported). Honest availability disclosure only —
 * it never enables a pay button (there is none on the member surface).
 */
function isBillProviderConfigured(): boolean {
  return !!(
    process.env.BILL_PROVIDER_URL ||
    process.env.BILL_PROVIDER_API_KEY ||
    process.env.VTPASS_API_KEY ||
    process.env.BAXI_API_KEY
  );
}

// ── W10-B2 (2026-10-03): member bill-pay funds rail ─────────────────────────
// Real provider client (billProviderClient pattern, billPayments.ts:50-58):
// only a configured base URL enables fulfillment dispatch; anything less
// fails closed in initiateMemberCapture BEFORE any charge.
function billProviderClient(): ProviderClientConfig | null {
  const baseUrl = process.env.BILL_PROVIDER_URL;
  if (!baseUrl) return null;
  return {
    baseUrl,
    apiKey: process.env.BILL_PROVIDER_API_KEY,
    timeoutMs: Number(process.env.BILL_PROVIDER_TIMEOUT_MS ?? 10_000),
  };
}

const BILL_PAY_KIND: MemberFundsKind = {
  journey: "member-bill-pay", // F-02 idempotency namespace
  refPrefix: "BP",
  txType: "Bill Payment",
  providerClient: billProviderClient,
  dispatchPath: "/pay",
  label: "bill payment",
};

async function fundsDb() {
  const d = await getDb();
  if (!d)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable",
    });
  return d;
}

/** Caller-scoped daily-limit condition: the member's OWN bill rows only. */
function billDailyScope(customerId: number) {
  return sql`${transactions.metadata}->>'memberCustomerId' = ${String(customerId)} AND ${transactions.type} = 'Bill Payment'`;
}

export const memberBillPaymentsRouter = router({
  /**
   * Biller catalog: name, commission rate (+ percentage label) and the
   * platform-wide bill-payment limits, plus the honest provider
   * configuration flag. No personal data, no DB access.
   */
  billers: protectedProcedure.query(() => ({
    billers: Object.keys(BILLER_COMMISSION).map(name => ({
      name,
      commissionRate: BILLER_COMMISSION[name],
      commissionPct: `${((BILLER_COMMISSION[name] ?? 0.01) * 100).toFixed(1)}%`,
    })),
    limits: {
      minAmountNGN: MIN_AMOUNT,
      maxAmountNGN: MAX_AMOUNT,
      dailyLimitNGN: DAILY_LIMIT,
    },
    configured: isBillProviderConfigured(),
  })),

  /**
   * Customer-number format validation — identical rules to
   * billPayments.validateCustomer (format only; there is no provider-side
   * lookup to call, and the result never authorises a payment).
   */
  validateCustomer: protectedProcedure
    .input(z.object({ biller: z.string().min(2), customerNumber: z.string().min(1) }))
    .query(({ input }) => {
      const isElectricity = ELECTRICITY_BILLERS.includes(input.biller);
      const isTV = TV_BILLERS.includes(input.biller);
      let valid = false;
      if (isElectricity) valid = /^\d{10,13}$/.test(input.customerNumber);
      else if (isTV) valid = /^\d{10,12}$/.test(input.customerNumber);
      else valid = input.customerNumber.length >= 5;
      return {
        valid,
        customerNumber: input.customerNumber,
        biller: input.biller,
        message: valid ? "Valid" : "Invalid customer number",
      };
    }),

  /**
   * W10-B2 (2026-10-03): member-initiated bill payment — capture phase.
   *
   * - Identity: session-derived customer ONLY (no client customerId/agentId).
   * - Amount: member-chosen within registry MIN/MAX at the input boundary
   *   (design §6.1 — prepaid-style billers carry no server price) PLUS the
   *   server-side daily limit over the caller's own rows; nothing else about
   *   the amount is client-trusted.
   * - Idempotency: mandatory key, payload-hash bound to {biller,
   *   customerNumber, amountNGN, meterType}; derived BP- reference.
   * - Rail: Paystack initialize (fail-closed when unconfigured) AND the bill
   *   provider must be configured BEFORE charge; fulfillment is dispatched
   *   only by confirmPay after a verified capture.
   */
  pay: protectedProcedure
    .input(
      z.object({
        biller: z.enum(
          Object.keys(BILLER_COMMISSION) as [string, ...string[]]
        ),
        customerNumber: z.string().min(5).max(20),
        meterType: z.enum(["prepaid", "postpaid"]).optional(),
        amountNGN: z.number().int().min(MIN_AMOUNT).max(MAX_AMOUNT),
        idempotencyKey: z
          .string()
          .regex(/^[A-Za-z0-9_-]{8,20}$/)
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const d = await fundsDb();
      const customer = await resolveMemberCustomer(d, ctx.user.id);
      if (!customer) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No member profile is bound to this session — bill payment is unavailable (fail-closed)",
        });
      }
      const idempotencyKey = requireIdempotencyKey(input.idempotencyKey, ctx);
      return initiateMemberCapture({
        d,
        ctx,
        kind: BILL_PAY_KIND,
        customer,
        idempotencyKey,
        amountNGN: input.amountNGN,
        idemPayload: {
          biller: input.biller,
          customerNumber: input.customerNumber,
          meterType: input.meterType ?? null,
          amountNGN: input.amountNGN,
        },
        dailyScope: billDailyScope(customer.id),
        dailyLimitNGN: DAILY_LIMIT,
        row: { customerAccount: input.customerNumber },
        metadata: {
          biller: input.biller,
          customerNumber: input.customerNumber,
          meterType: input.meterType ?? null,
        },
        dispatchPayload: {
          biller: input.biller,
          customerNumber: input.customerNumber,
          meterType: input.meterType ?? null,
          amountNGN: input.amountNGN,
        },
      });
    }),

  /**
   * W10-B2: verify the member's Paystack capture for a BP- reference and, on
   * a kobo-exact "success", dispatch fulfillment to the bill provider.
   * Replay-safe (guarded transitions + provider status lookup; never a blind
   * re-dispatch). Ownership-gated; foreign references → NOT_FOUND.
   */
  confirmPay: protectedProcedure
    .input(z.object({ reference: z.string().min(8).max(32) }))
    .mutation(async ({ input, ctx }) => {
      const d = await fundsDb();
      return confirmMemberCapture({ d, ctx, kind: BILL_PAY_KIND, reference: input.reference });
    }),
});
