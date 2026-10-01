/**
 * memberFxRates.ts — R3 batch 3 member surface (2026-10-01, R3-b3)
 *
 * READ-ONLY member FX surface over the fxRates domain
 * (server/routers/fxRates.ts). Deliberately NO mutation proc:
 *
 *   - fxRates.updateRates and fxRates.refresh are BROKEN AUTHZ in the base
 *     router — plain protectedProcedure, so ANY authenticated user can
 *     overwrite the global rate book the converter quotes from (worklist
 *     §1.12). They are flagged for the funds wave (re-gate to admin) and
 *     are NEVER exposed or delegated to here.
 *   - fxRates.getStats (audit-log counts) is internal-only — omitted.
 *
 * What ships (global published data — no caller scoping needed, per
 * worklist §3.4):
 *   - rates:      the stored rate book from systemConfig key `fx_rates`
 *                 (EUR-base, "units per 1 EUR"). Empty map + null
 *                 lastUpdated when absent — NEVER a hardcoded fixture rate.
 *   - convert:    EUR-base conversion over the stored book via the exported
 *                 computeFxConversion/validateFrankfurterRates helpers from
 *                 ./fxRates; fails LOUD (PRECONDITION_FAILED) on a missing,
 *                 malformed, or poisoned book.
 *   - currencies: code+rate list derived from the stored book (empty when
 *                 no book is stored — the PWA renders a disclosed
 *                 unavailable state, not fabricated rates).
 *   - historical: real Frankfurter/ECB time-series with the same 8s
 *                 timeout and fail-closed shape validation as fxRates
 *                 (fetchFrankfurter is not exported from ./fxRates, so the
 *                 fetch helper is duplicated locally per worklist §3.4).
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR (rates/convert/currencies);
 * no fixture fallbacks anywhere.
 */
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { systemConfig } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import type { DrizzleDb } from "../lib/memberGuards";
import {
  computeFxConversion,
  FX_RATES_BASE_CURRENCY,
  FX_RATES_CONFIG_KEY,
  validateFrankfurterRates,
} from "./fxRates";

async function db(): Promise<DrizzleDb> {
  const d = await getDb();
  if (!d)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable",
    });
  return d;
}

/** The stored rate book, or null when no rates have been published. */
async function readRateBook(
  d: DrizzleDb
): Promise<{ rates: Record<string, number>; lastUpdated: Date } | null> {
  const [config] = await d
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, FX_RATES_CONFIG_KEY))
    .limit(1);
  if (!config) return null;
  return {
    rates: JSON.parse(String(config.value)) as Record<string, number>,
    lastUpdated: config.updatedAt,
  };
}

// ── Frankfurter fetch (duplicated from fxRates.ts:26-50, 2026-10-01 R3-b3) ─
// Base URL configurable so test environments can target a protocol-faithful
// double; production default is the real Frankfurter (ECB data) API.
function frankfurterBase(): string {
  return process.env.FRANKFURTER_BASE_URL ?? "https://api.frankfurter.app";
}
const FX_TIMEOUT_MS = 8000;

async function fetchFrankfurter(path: string): Promise<unknown> {
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

export const memberFxRatesRouter = router({
  /**
   * The published rate book (EUR-base). When no rates are stored the honest
   * answer is an empty map + null timestamp — never fabricated rates.
   */
  rates: protectedProcedure
    .input(
      z
        .object({ baseCurrency: z.string().default(FX_RATES_BASE_CURRENCY) })
        .optional()
    )
    .query(async ({ input }) => {
      const d = await db();
      const book = await readRateBook(d);
      return {
        baseCurrency: input?.baseCurrency ?? FX_RATES_BASE_CURRENCY,
        rates: book?.rates ?? {},
        lastUpdated: book?.lastUpdated ?? null,
      };
    }),

  /**
   * EUR-base conversion over the stored book. Fails loud
   * (PRECONDITION_FAILED) when the book is missing, malformed, or lacks
   * either currency — a missing rate is never silently treated as 1.
   */
  convert: protectedProcedure
    .input(
      z.object({
        from: z.string().regex(/^[A-Z]{3}$/, "from must be a 3-letter currency code"),
        to: z.string().regex(/^[A-Z]{3}$/, "to must be a 3-letter currency code"),
        amount: z.number().positive(),
      })
    )
    .query(async ({ input }) => {
      const d = await db();
      const book = await readRateBook(d);
      if (!book) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "convert: no FX rates are stored; rates not refreshed yet",
        });
      }
      if (!validateFrankfurterRates(book.rates)) {
        // Fail closed on a poisoned rate book — never quote from garbage.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "convert: stored FX rates are malformed; refresh rates before converting",
        });
      }
      const { convertedAmount, rate } = computeFxConversion(
        book.rates,
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
    }),

  /**
   * Currency list derived from the stored book (code + rate only — no
   * display names/symbols have a delivered source). Empty when no book.
   */
  currencies: protectedProcedure.query(async () => {
    const d = await db();
    const book = await readRateBook(d);
    return {
      currencies: Object.entries(book?.rates ?? {}).map(([code, rate]) => ({
        code,
        rate,
      })),
      baseCurrency: FX_RATES_BASE_CURRENCY,
    };
  }),

  /**
   * Historical rates — real Frankfurter (ECB) time-series, fail-loud on
   * provider errors or malformed replies. Days capped at 365.
   */
  historical: protectedProcedure
    .input(
      z
        .object({
          base: z
            .string()
            .regex(/^[A-Z]{3}$/, "base must be a 3-letter currency code")
            .default("NGN"),
          target: z
            .string()
            .regex(/^[A-Z]{3}$/, "target must be a 3-letter currency code")
            .default("USD"),
          days: z.number().int().min(1).max(365).default(30),
        })
        .default({ base: "NGN", target: "USD", days: 30 })
    )
    .query(async ({ input }) => {
      const end = new Date();
      const start = new Date(end.getTime() - input.days * 86400000);
      const fmt = (dte: Date) => dte.toISOString().slice(0, 10);
      const data = (await fetchFrankfurter(
        `/${fmt(start)}..${fmt(end)}?from=${encodeURIComponent(input.base)}&to=${encodeURIComponent(input.target)}`
      )) as { rates?: unknown } | null;
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
});
