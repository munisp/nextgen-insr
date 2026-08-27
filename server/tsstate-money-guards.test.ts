/**
 * tsstate-money-guards.test.ts — DD-TSSTATE unit coverage for the pure
 * state-machine / money-math guards extracted during the F11/F13/F14
 * remediation:
 *
 *   F13-1  computeFxConversion — correct direction over a EUR-base
 *          ("units per 1 EUR") rate book; unknown/bad rates fail loudly.
 *   F13-1  fxRateBookSchema — updateRates input validation (> 0, sane
 *          bounds, 3-letter codes).
 *   F11-1  ADJUDICATABLE_FROM_STATUSES — terminal/decided claim states are
 *          not re-adjudicatable.
 *   F11-3  SETTLEABLE_CLAIM_STATUSES — settlement only from approved
 *          decision states.
 *
 * These are pure functions/constants — no DB, no mocks.
 */
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";

import {
  computeFxConversion,
  fxRateBookSchema,
  validateFrankfurterRates,
  FX_RATES_CONFIG_KEY,
  FX_RATES_BASE_CURRENCY,
  FX_MAX_RATE,
} from "./routers/fxRates";
import {
  ADJUDICATABLE_FROM_STATUSES,
  SETTLEABLE_CLAIM_STATUSES,
} from "./routers/insuranceWorkflows";

describe("F13-1: FX conversion over a EUR-base rate book", () => {
  // Frankfurter/ECB semantics: units of currency per 1 EUR.
  const rates = { EUR: 1, USD: 1.08, NGN: 1700 };

  it("converts in the correct direction (not inverted)", () => {
    // 100 USD -> NGN: 100 / 1.08 EUR * 1700 = 157,407.41 NGN.
    // The pre-fix inverted formula returned ~0.06 NGN.
    const r = computeFxConversion(rates, "USD", "NGN", 100);
    expect(r.convertedAmount).toBeCloseTo(157407.41, 2);
    expect(r.rate).toBeCloseTo(1700 / 1.08, 6);
  });

  it("is internally consistent across the base currency", () => {
    expect(computeFxConversion(rates, "EUR", "USD", 100).convertedAmount).toBeCloseTo(108, 2);
    expect(computeFxConversion(rates, "USD", "EUR", 108).convertedAmount).toBeCloseTo(100, 2);
    expect(computeFxConversion(rates, "NGN", "USD", 170000).convertedAmount).toBeCloseTo(108, 2);
  });

  it("throws PRECONDITION_FAILED for unknown currencies (never silently rate 1)", () => {
    for (const [from, to] of [["ZZZ", "NGN"], ["USD", "ZZZ"]] as const) {
      try {
        computeFxConversion(rates, from, to, 100);
        expect.unreachable(`expected ${from}->${to} to throw`);
      } catch (err) {
        expect(err).toBeInstanceOf(TRPCError);
        expect((err as TRPCError).code).toBe("PRECONDITION_FAILED");
      }
    }
  });

  it("throws for non-positive stored rates", () => {
    expect(() => computeFxConversion({ EUR: 1, USD: 0 }, "USD", "EUR", 1)).toThrow(TRPCError);
    expect(() => computeFxConversion({ EUR: 1, USD: -2 }, "USD", "EUR", 1)).toThrow(TRPCError);
  });

  it("uses ONE config key for the rate book and labels it EUR-base", () => {
    expect(FX_RATES_CONFIG_KEY).toBe("fx_rates");
    expect(FX_RATES_BASE_CURRENCY).toBe("EUR");
  });
});

describe("F13-1: updateRates rate-book validation", () => {
  it("accepts a well-formed book", () => {
    expect(fxRateBookSchema.safeParse({ USD: 1.0932, NGN: 1699.5, EUR: 1 }).success).toBe(true);
  });

  it("rejects zero, negative, out-of-bounds and non-finite rates", () => {
    expect(fxRateBookSchema.safeParse({ USD: 0 }).success).toBe(false);
    expect(fxRateBookSchema.safeParse({ USD: -1 }).success).toBe(false);
    expect(fxRateBookSchema.safeParse({ USD: FX_MAX_RATE + 1 }).success).toBe(false);
    expect(fxRateBookSchema.safeParse({ USD: Number.NaN }).success).toBe(false);
    expect(fxRateBookSchema.safeParse({ USD: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it("rejects malformed currency codes", () => {
    expect(fxRateBookSchema.safeParse({ usd: 1 }).success).toBe(false);
    expect(fxRateBookSchema.safeParse({ US: 1 }).success).toBe(false);
    expect(fxRateBookSchema.safeParse({ USDT: 1 }).success).toBe(false);
  });

  it("validateFrankfurterRates still rejects malformed provider payloads", () => {
    expect(validateFrankfurterRates({ USD: 1.09 })).toBe(true);
    expect(validateFrankfurterRates({ USD: "1.09" })).toBe(false);
    expect(validateFrankfurterRates({ USD: -5 })).toBe(false);
    expect(validateFrankfurterRates(null)).toBe(false);
    expect(validateFrankfurterRates([1.09])).toBe(false);
  });
});

describe("F11-1/F11-3: claim state-machine guard sets", () => {
  it("adjudication is reachable only from pre-decision states", () => {
    for (const s of ["submitted", "under_review", "investigation", "appealed", "escalated"]) {
      expect(ADJUDICATABLE_FROM_STATUSES).toContain(s);
    }
    for (const s of ["approved", "partially_approved", "rejected", "paid", "closed"]) {
      expect(ADJUDICATABLE_FROM_STATUSES).not.toContain(s);
    }
  });

  it("settlement is reachable only from approved decision states", () => {
    expect(SETTLEABLE_CLAIM_STATUSES).toContain("approved");
    expect(SETTLEABLE_CLAIM_STATUSES).toContain("partially_approved");
    for (const s of ["submitted", "under_review", "investigation", "rejected", "paid", "closed"]) {
      expect(SETTLEABLE_CLAIM_STATUSES).not.toContain(s);
    }
  });

  it("a settled claim cannot re-enter adjudication (paid/closed are terminal for adjudication)", () => {
    // The composition that closed F11-3's multi-pay chain:
    // settle requires approved/partially_approved AND flips to 'paid';
    // adjudication excludes 'paid' — so settle -> re-adjudicate -> re-settle
    // is no longer a reachable path.
    expect(ADJUDICATABLE_FROM_STATUSES).not.toContain("paid");
    expect(SETTLEABLE_CLAIM_STATUSES).not.toContain("paid");
  });
});
