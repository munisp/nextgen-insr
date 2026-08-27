// @ts-check
import { TRPCError } from "@trpc/server";
import { eq, sql, count } from "drizzle-orm";
import { z } from "zod";

import { auditLog, systemConfig } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


// MOCKWARE FIX: getHistorical previously fabricated a sine wave and labelled
// it "frankfurter/ecb"; refresh was a no-op success. Both now call the real
// Frankfurter (ECB data) API with a timeout and fail loudly on any error.

// Base URL is configurable so official test environments (or protocol-faithful
// test doubles in the test suite) can be targeted; production default is the
// real Frankfurter (ECB data) API.
function frankfurterBase(): string {
  return process.env.FRANKFURTER_BASE_URL ?? "https://api.frankfurter.app";
}
const FX_TIMEOUT_MS = 8000;

async function fetchFrankfurter(path: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`${frankfurterBase()}${path}`, {
      signal: AbortSignal.timeout(FX_TIMEOUT_MS),
    });
  } catch (err) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `FX rate provider unavailable: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  if (!response.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `FX rate provider rejected the request (HTTP ${response.status}). The requested currency pair may not be published by the ECB.`,
    });
  }
  return response.json();
}

/**
 * Fail-closed shape validation for Frankfurter replies. A "rates" object is
 * only accepted when it is a plain object mapping currency codes to finite,
 * positive numbers — anything else (strings, nested junk, negative/zero
 * rates, arrays) is a malformed provider reply and MUST fail loudly rather
 * than poisoning stored FX rates used for money conversion.
 */
export function validateFrankfurterRates(
  rates: unknown
): rates is Record<string, number> {
  if (!rates || typeof rates !== "object" || Array.isArray(rates)) return false;
  for (const [code, value] of Object.entries(rates)) {
    if (!/^[A-Z]{3}$/.test(code)) return false;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return false;
    }
  }
  return true;
}

// ── F13-1 (DD-TSSTATE): ONE rate book, read and written under ONE key ────────
// Previously refresh stored ECB rates under "fx_rates_ecb" while convert/
// getRates/currencies read "fx_rates" (written only by the unvalidated
// updateRates mutation) — refreshed market rates NEVER reached the converter.
export const FX_RATES_CONFIG_KEY = "fx_rates";

/** Stored-rate semantics: units of currency per 1 EUR (Frankfurter/ECB). */
export const FX_RATES_BASE_CURRENCY = "EUR";

/**
 * Sane upper bound for a per-1-EUR rate. Real published rates are ≪ 10^5;
 * 10^7 leaves headroom for high-inflation currencies while rejecting
 * garbage/poisoned books (0, negatives, 1e300, …).
 */
export const FX_MAX_RATE = 10_000_000;

/**
 * Validated rate-book input for updateRates. Keys must be ISO-4217-style
 * 3-letter codes; values finite, positive, and within sane bounds. Zod
 * rejects unknown shapes at the boundary so arbitrary operator input can no
 * longer poison the book the converter reads.
 */
export const fxRateBookSchema = z.record(
  z.string().regex(/^[A-Z]{3}$/, "currency code must be 3 uppercase letters"),
  z.number().positive().max(FX_MAX_RATE)
);

/**
 * Pure conversion over a EUR-base rate book ("units per 1 EUR"):
 *   amount(from) → EUR = amount / rates[from] → to = amount * rates[to] / rates[from]
 * The previous implementation divided by toRate — INVERTED for this rate
 * representation (off by ~6 orders of magnitude on USD→NGN).
 * Throws on unknown currencies — a missing rate is never silently treated
 * as 1 (which would price the currency at par with EUR).
 */
export function computeFxConversion(
  rates: Record<string, number>,
  from: string,
  to: string,
  amount: number
): { convertedAmount: number; rate: number } {
  const fromRate = rates[from];
  if (typeof fromRate !== "number" || !Number.isFinite(fromRate) || fromRate <= 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `convert: no stored FX rate for '${from}' — refresh or update rates first`,
    });
  }
  const toRate = rates[to];
  if (typeof toRate !== "number" || !Number.isFinite(toRate) || toRate <= 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `convert: no stored FX rate for '${to}' — refresh or update rates first`,
    });
  }
  const rate = toRate / fromRate;
  return {
    convertedAmount: Math.round(amount * rate * 100) / 100,
    rate,
  };
}

export const fxRatesRouter = router({
  getRates: protectedProcedure
    .input(z.object({ baseCurrency: z.string().default(FX_RATES_BASE_CURRENCY) }).optional())
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [config] = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, FX_RATES_CONFIG_KEY))
          .limit(1);
        // F-12 (wave-4b): removed the hardcoded fixture fallback rates — when
        // no stored rates exist the honest answer is an empty map + null
        // timestamp, never fabricated financial data.
        const rates: Record<string, number> = config
          ? JSON.parse(String(config.value))
          : {};
        return {
          baseCurrency: input?.baseCurrency ?? FX_RATES_BASE_CURRENCY,
          rates,
          lastUpdated: config?.updatedAt ?? null,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  convert: protectedProcedure
    .input(
      z.object({
        from: z.string().regex(/^[A-Z]{3}$/, "from must be a 3-letter currency code"),
        to: z.string().regex(/^[A-Z]{3}$/, "to must be a 3-letter currency code"),
        amount: z.number().positive(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [config] = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, FX_RATES_CONFIG_KEY))
          .limit(1);
        const rates: Record<string, number> | null = config
          ? JSON.parse(String(config.value))
          : null;
        if (!rates) {
          // F-12 (wave-4b): no stored rates — fail loud, never fixture rates.
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "convert: no FX rates are stored; refresh rates first",
          });
        }
        if (!validateFrankfurterRates(rates)) {
          // Fail closed on a poisoned rate book — never quote from garbage.
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "convert: stored FX rates are malformed; refresh rates before converting",
          });
        }
        const { convertedAmount, rate } = computeFxConversion(
          rates,
          input.from,
          input.to,
          input.amount
        );
        return {
          from: input.from,
          to: input.to,
          amount: input.amount,
          convertedAmount,
          rate,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  updateRates: protectedProcedure
    // F13-1: validated rate book — 3-letter codes, finite positive rates
    // within sane bounds (fxRateBookSchema); empty books rejected below.
    .input(z.object({ rates: fxRateBookSchema }))
    .mutation(async ({ input }) => {
      try {
        if (Object.keys(input.rates).length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "updateRates: refusing to store an empty rate book",
          });
        }
        const db = (await getDb())!;
        await db
          .insert(systemConfig)
          .values({ key: FX_RATES_CONFIG_KEY, value: JSON.stringify(input.rates) })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: { value: JSON.stringify(input.rates), updatedAt: new Date() },
          });
        await db.insert(auditLog).values({
          action: "fx_rates_updated",
          resource: "fx_rates",
          resourceId: "rates",
          status: "success",
          metadata: { rates: input.rates },
        });
        return { success: true, updatedAt: new Date().toISOString() };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [total] = await db
      .select({ value: count() })
      .from(auditLog)
      .where(eq(auditLog.action, "fx_rates_updated"))
      .limit(100);
    return {
      totalUpdates: Number(total.value),
      lastUpdated: new Date().toISOString(),
    };
  }),
  // Historical rates — real Frankfurter (ECB) time-series. Fails loudly when
  // the provider is unreachable or the pair is not published by the ECB.
  getHistorical: protectedProcedure
    .input(
      z
        .object({
          base: z.string().default("NGN"),
          target: z.string().default("USD"),
          days: z.number().default(30),
        })
        .default({ base: "NGN", target: "USD", days: 30 })
    )
    .query(async ({ input }) => {
      const end = new Date();
      const start = new Date(end.getTime() - input.days * 86400000);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const data = await fetchFrankfurter(
        `/${fmt(start)}..${fmt(end)}?from=${encodeURIComponent(input.base)}&to=${encodeURIComponent(input.target)}`
      );
      const rawRates: unknown = data?.rates;
      if (!rawRates || typeof rawRates !== "object" || Array.isArray(rawRates)) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "FX rate provider returned a malformed time-series (no rates object)",
        });
      }
      const timeseries: Array<{ date: string; rate: number }> = [];
      for (const date of Object.keys(rawRates as Record<string, unknown>).sort()) {
        const dayRates = (rawRates as Record<string, unknown>)[date];
        if (!validateFrankfurterRates(dayRates)) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `FX rate provider returned malformed rates for ${date}`,
          });
        }
        timeseries.push({ date, rate: Number(dayRates[input.target] ?? 0) });
      }
      return {
        base: input.base,
        target: input.target,
        timeseries,
        source: "frankfurter/ecb",
      };
    }),
  // F-12 (wave-4b): was a zero-payload stub — derive the real currency list
  // from the stored fx_rates config (code + rate only; display names/symbols
  // have no delivered source).
  currencies: protectedProcedure.query(async () => {
    const db = await getDb();
    const empty = { currencies: [] as Array<{ code: string; rate: number }>, baseCurrency: FX_RATES_BASE_CURRENCY };
    if (!db) return empty;
    const [config] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, FX_RATES_CONFIG_KEY))
      .limit(1);
    const rates: Record<string, number> = config
      ? JSON.parse(String(config.value))
      : {};
    return {
      currencies: Object.entries(rates).map(([code, rate]) => ({ code, rate })),
      baseCurrency: FX_RATES_BASE_CURRENCY,
    };
  }),
  // Refresh pulls the latest published rates from Frankfurter (ECB) and
  // persists them; it throws if the provider call fails.
  refresh: protectedProcedure.mutation(async () => {
    const data = await fetchFrankfurter(`/latest?from=EUR`);
    // Malformed provider reply -> loud failure; never persist garbage rates.
    if (!validateFrankfurterRates(data?.rates)) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "FX rate provider returned malformed rates (shape validation failed)",
      });
    }
    const rates: Record<string, number> = {
      EUR: 1,
      ...data.rates,
    };
    const rateCount = Object.keys(rates).length;
    if (rateCount <= 1) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "FX rate provider returned no rates",
      });
    }
    const db = (await getDb())!;
    // F13-1: persist under the SAME key the converter reads — previously
    // "fx_rates_ecb", which convert/getRates never looked at.
    await db
      .insert(systemConfig)
      .values({ key: FX_RATES_CONFIG_KEY, value: JSON.stringify(rates) })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value: JSON.stringify(rates), updatedAt: new Date() },
      });
    await db.insert(auditLog).values({
      action: "fx_rates_updated",
      resource: "fx_rates",
      resourceId: "ecb_rates",
      status: "success",
      metadata: { source: "frankfurter/ecb", rateCount },
    });
    return {
      success: true,
      refreshedAt: new Date().toISOString(),
      ratesUpdated: rateCount,
    };
  }),
});
