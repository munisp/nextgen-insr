// @ts-check
import { TRPCError } from "@trpc/server";
import {
  eq,
  desc,
  and,
  sql,
  count,
  sum,
  isNull,
  gte,
  lte,
  or,
  asc,
} from "drizzle-orm";
import { z } from "zod";

import { auditLog, systemConfig } from "../../drizzle/schema";
import {
  router,
  publicProcedure as openProcedure,
  protectedProcedure,
} from "../_core/trpc";
import { getDb } from "../db";



// F-12 (full sweep): the inline carrier-rate fixtures were replaced with
// reads from the REAL system_config carrier_rate_% store (written by
// updateRate). Returns null when no rate is stored for a carrier.
async function readCarrierRate(carrierId: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(systemConfig)
    .where(sql`${systemConfig.key} = ${"carrier_rate_" + carrierId}`)
    .limit(1);
  if (!row) return null;
  return { carrierId, ...(JSON.parse(String(row.value ?? "{}")) as Record<string, unknown>) };
}

export const carrierLivePricingRouter = router({
  dashboard: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return {
        totalCarriers: 0,
        avgSmsRate: 0,
        avgUssdRate: 0,
        lastUpdated: null,
      };
    const rows = await db
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} LIKE 'carrier_rate_%'`)
      .limit(100);
    const rates = rows.map(r => JSON.parse(String(r.value ?? "{}")));
    const avgSms =
      rates.length > 0
        ? rates.reduce((a: number, r: any) => a + (r.smsRate ?? 0), 0) /
          rates.length
        : 0;
    return {
      totalCarriers: rates.length,
      avgSmsRate: Math.round(avgSms * 100) / 100,
      avgUssdRate: 0,
      lastUpdated: new Date().toISOString(),
    };
  }),
  listRates: protectedProcedure
    .input(
      z
        .object({
          country: z.string().optional(),
          limit: z.number().default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { rates: [], total: 0 };
        const rows = await db
          .select()
          .from(systemConfig)
          .where(sql`${systemConfig.key} LIKE 'carrier_rate_%'`)
          .limit(input?.limit ?? 20);
        let rates = rows.map(r => ({
          id: r.key.replace("carrier_rate_", ""),
          ...JSON.parse(String(r.value ?? "{}")),
        }));
        if (input?.country)
          rates = rates.filter((r: any) => r.country === input.country);
        return { rates, total: rates.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  updateRate: protectedProcedure
    .input(
      z.object({
        carrierId: z.string(),
        smsRate: z.number().optional(),
        ussdRate: z.number().optional(),
        dataRatePerMb: z.number().optional(),
        voiceRatePerMin: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const { carrierId, ...rateUpdates } = input;
        const rows = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, "carrier_rate_" + carrierId))
          .limit(1);
        const existing =
          rows.length > 0 ? JSON.parse(String(rows[0].value ?? "{}")) : {};
        const updated = {
          ...existing,
          ...rateUpdates,
          updatedAt: new Date().toISOString(),
        };
        await db
          .insert(systemConfig)
          .values({
            key: "carrier_rate_" + carrierId,
            value: JSON.stringify(updated),
          })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: { value: JSON.stringify(updated), updatedAt: new Date() },
          });
        await db.insert(auditLog).values({
          action: "carrier_rate_updated",
          resource: "carrier_pricing",
          resourceId: carrierId,
          status: "success",
          metadata: rateUpdates,
        });
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  compareRates: protectedProcedure
    .input(
      z.object({
        country: z.string(),
        serviceType: z.enum(["sms", "ussd", "data", "voice"]),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { comparison: [] };
        const rows = await db
          .select()
          .from(systemConfig)
          .where(sql`${systemConfig.key} LIKE 'carrier_rate_%'`)
          .limit(100);
        const rates = rows.map(r => ({
          id: r.key.replace("carrier_rate_", ""),
          ...JSON.parse(String(r.value ?? "{}")),
        }));
        const filtered = rates.filter((r: any) => r.country === input.country);
        return {
          comparison: filtered
            .map((r: any) => ({
              carrier: r.carrierName ?? r.id,
              rate: r[input.serviceType + "Rate"] ?? 0,
            }))
            .sort((a: any, b: any) => a.rate - b.rate),
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

  // ── Sprint 78 domain-specific procedures ──────────────────────────────────
  getAllRates: openProcedure
    .input(z.object({ country: z.string().optional() }).optional())
    .query(async ({ input }) => {
      // F-12 (full sweep): was an inline carrier-rate fixture (mtn_ng 3.8,
      // vodacom_tz 50, "2024-06-01" timestamps) presented as live pricing —
      // REAL rates from the system_config carrier_rate_% store (the same
      // store updateRate writes).
      const db = await getDb();
      if (!db) return { carriers: [], total: 0 };
      const rows = await db
        .select()
        .from(systemConfig)
        .where(sql`${systemConfig.key} LIKE 'carrier_rate_%'`)
        .limit(200);
      let carriers = rows.map(r => ({
        carrierId: r.key.replace("carrier_rate_", ""),
        ...JSON.parse(String(r.value ?? "{}")),
      }));
      if (input?.country)
        carriers = carriers.filter((c: any) => c.country === input.country);
      return { carriers, count: carriers.length };
    }),

  getCarrierRate: openProcedure
    .input(z.object({ carrierId: z.string() }))
    .query(async ({ input }) => {
      // F-12: inline rate Record fixture -> REAL store read.
      const rate = await readCarrierRate(input.carrierId);
      if (!rate)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `no live rate is stored for carrier ${input.carrierId}`,
        });
      return rate;
    }),

  compareCarriers: openProcedure
    .input(z.object({ carrierIds: z.array(z.string()) }))
    .query(async ({ input }) => {
      // F-12: inline rate Record fixture -> REAL store reads; carriers with
      // no stored rate keep the original zeroed fallback shape.
      const comparison = [];
      for (const id of input.carrierIds) {
        const rate = await readCarrierRate(id);
        comparison.push(
          rate ?? {
            carrierId: id,
            carrierName: id,
            smsRate: 0,
            ussdRate: 0,
            dataRatePerMb: 0,
            currency: null,
          }
        );
      }
      return { comparison };
    }),

  estimateCost: openProcedure
    .input(
      z.object({
        carrierId: z.string(),
        smsCount: z.number(),
        ussdSessions: z.number(),
        dataMb: z.number(),
      })
    )
    .query(async ({ input }) => {
      // F-12: inline rate Record fixture -> REAL store read; estimation
      // requires a stored rate.
      const rate = await readCarrierRate(input.carrierId);
      if (!rate)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `no live rate is stored for carrier ${input.carrierId}`,
        });
      const r = rate as {
        carrierName?: string; smsRate?: number; ussdRate?: number; dataRatePerMb?: number;
      };
      const smsCost = input.smsCount * Number(r.smsRate ?? 0);
      const ussdCost = input.ussdSessions * Number(r.ussdRate ?? 0);
      const dataCost = input.dataMb * Number(r.dataRatePerMb ?? 0);
      return {
        carrier: r.carrierName ?? input.carrierId,
        smsCost,
        ussdCost,
        dataCost,
        total: smsCost + ussdCost + dataCost,
      };
    }),

  getCountries: openProcedure.query(async () => {
    // F-12 (full sweep): was a static country list with fabricated
    // carrierCounts — derived from the REAL carrier_rate_% store.
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} LIKE 'carrier_rate_%'`)
      .limit(500);
    // Country display names are static ISO reference data (not metrics).
    const NAMES: Record<string, string> = {
      NG: "Nigeria", KE: "Kenya", TZ: "Tanzania",
      GH: "Ghana", UG: "Uganda", ZA: "South Africa",
    };
    const byCountry = new Map<string, { code: string; name: string; carrierCount: number; currency: string | null }>();
    for (const row of rows) {
      const v = JSON.parse(String(row.value ?? "{}")) as { country?: string; currency?: string };
      const code = v.country ?? "unknown";
      const cur =
        byCountry.get(code) ??
        { code, name: NAMES[code] ?? code, carrierCount: 0, currency: v.currency ?? null };
      cur.carrierCount += 1;
      byCountry.set(code, cur);
    }
    return [...byCountry.values()];
  }),
});
