// @ts-check
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { eq, sql, count } from "drizzle-orm";
import { auditLog, systemConfig } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

// MOCKWARE FIX: getHistorical previously fabricated a sine wave and labelled
// it "frankfurter/ecb"; refresh was a no-op success. Both now call the real
// Frankfurter (ECB data) API with a timeout and fail loudly on any error.

const FRANKFURTER_BASE = "https://api.frankfurter.app";
const FX_TIMEOUT_MS = 8000;

async function fetchFrankfurter(path: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`${FRANKFURTER_BASE}${path}`, {
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

export const fxRatesRouter = router({
  getRates: protectedProcedure
    .input(z.object({ baseCurrency: z.string().default("NGN") }).optional())
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [config] = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, "fx_rates"))
          .limit(1);
        const rates = config
          ? JSON.parse(String(config.value))
          : { USD: 1550.0, EUR: 1680.0, GBP: 1950.0, GHS: 95.0, KES: 12.0 };
        return {
          baseCurrency: input?.baseCurrency ?? "NGN",
          rates,
          lastUpdated: config?.updatedAt ?? new Date(),
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
        from: z.string(),
        to: z.string(),
        amount: z.number().positive(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [config] = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, "fx_rates"))
          .limit(1);
        const rates: Record<string, number> = config
          ? JSON.parse(String(config.value))
          : { USD: 1550.0, EUR: 1680.0, GBP: 1950.0 };
        const fromRate = input.from === "NGN" ? 1 : (rates[input.from] ?? 1);
        const toRate = input.to === "NGN" ? 1 : (rates[input.to] ?? 1);
        const converted = (input.amount * fromRate) / toRate;
        return {
          from: input.from,
          to: input.to,
          amount: input.amount,
          convertedAmount: Math.round(converted * 100) / 100,
          rate: fromRate / toRate,
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
    .input(z.object({ rates: z.record(z.string(), z.number()) }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .insert(systemConfig)
          .values({ key: "fx_rates", value: JSON.stringify(input.rates) })
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
        .default({})
    )
    .query(async ({ input }) => {
      const end = new Date();
      const start = new Date(end.getTime() - input.days * 86400000);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const data = await fetchFrankfurter(
        `/${fmt(start)}..${fmt(end)}?from=${encodeURIComponent(input.base)}&to=${encodeURIComponent(input.target)}`
      );
      const rawRates: Record<string, Record<string, number>> = data?.rates ?? {};
      const timeseries = Object.keys(rawRates)
        .sort()
        .map(date => ({ date, rate: Number(rawRates[date]?.[input.target] ?? 0) }));
      return {
        base: input.base,
        target: input.target,
        timeseries,
        source: "frankfurter/ecb",
      };
    }),
  currencies: protectedProcedure.query(async () => {
    return {
      currencies: [] as Array<{
        code: string;
        name: string;
        symbol: string;
        rate: number;
      }>,
      baseCurrency: "NGN",
    };
  }),
  // Refresh pulls the latest published rates from Frankfurter (ECB) and
  // persists them; it throws if the provider call fails.
  refresh: protectedProcedure.mutation(async () => {
    const data = await fetchFrankfurter(`/latest?from=EUR`);
    const rates: Record<string, number> = {
      EUR: 1,
      ...(data?.rates ?? {}),
    };
    const rateCount = Object.keys(rates).length;
    if (rateCount <= 1) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "FX rate provider returned no rates",
      });
    }
    const db = (await getDb())!;
    await db
      .insert(systemConfig)
      .values({ key: "fx_rates_ecb", value: JSON.stringify(rates) })
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
