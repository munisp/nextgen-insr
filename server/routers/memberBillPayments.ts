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
 * Fail-closed: both procs are protectedProcedure (authentication required);
 * no DB is needed for the static registry, so no DB access is performed.
 */
import { z } from "zod";

import { protectedProcedure, router } from "../_core/trpc";

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
});
