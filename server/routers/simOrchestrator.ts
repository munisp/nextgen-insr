/**
 * simOrchestrator.ts — SIM Orchestrator stub.
 *
 * 2026-11-27 (W32-C): added `getConfig` and `getCarrierSummary`, ported
 * from main's server/routers/simOrchestrator.ts (the same procedures the
 * SimOrchestratorDashboard client calls). Port deltas vs main (documented):
 *   - Imports adapted to portal conventions ("@schema", ../db, ../_core/trpc).
 *   - main's file carries `// @ts-nocheck`; the port does NOT. Under that
 *     suppression main's getCarrierSummary/getHistory/getLatestReadings
 *     query `simProbeLog.agentCode` — a property that does NOT exist on the
 *     sim_probe_log table in EITHER schema (both main's and the portal's
 *     drizzle schemas name the column `agentId`, varchar(32)). That is a
 *     latent main-side bug masked by ts-nocheck (eq(undefined, …) would
 *     throw at runtime). The port keeps main's INPUT contract
 *     (`agentCode`) but queries the real column `simProbeLog.agentId`.
 *   - Null-db arms kept verbatim from main (fail-closed TRPCError), the
 *     house fail-closed posture.
 * The pre-existing stub `list` is unchanged (out of scope; no client caller
 * in the W32-C sites depends on it).
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";

import { simOrchestratorConfig, simProbeLog } from "@schema";

import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";

export const simOrchestratorRouter = router({
  list: protectedProcedure.query(async () => {
    return { items: [], total: 0 };
  }),

  /**
   * Called by the Rust daemon on startup and every 5 minutes.
   * (Ported from main's simOrchestrator.getConfig.)
   */
  getConfig: protectedProcedure
    .input(
      z.object({
        terminalId: z.string().max(32),
        apiKey: z.string().max(128),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        const config = await db
          .select()
          .from(simOrchestratorConfig)
          .where(eq(simOrchestratorConfig.terminalId, input.terminalId))
          .limit(1);

        if (!config[0]) {
          return {
            probeIntervalMs: 30000,
            relayEndpoint:
              "https://api.insureportal.io/api/trpc/simOrchestrator.ingestProbe",
            enabled: true,
          };
        }

        if (input.apiKey !== config[0].apiKey) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid API key",
          });
        }

        return {
          probeIntervalMs: config[0].probeIntervalMs,
          relayEndpoint: config[0].relayEndpoint,
          enabled: config[0].enabled,
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

  /**
   * Returns per-carrier summary stats for a given agent.
   * (Ported from main's simOrchestrator.getCarrierSummary; main's ts-nocheck
   * `simProbeLog.agentCode` corrected to the real `agentId` column — see
   * header delta note.)
   */
  getCarrierSummary: protectedProcedure
    .input(
      z.object({
        agentCode: z.string().max(32),
        hours: z.number().int().min(1).max(168).default(24),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        const since = new Date(Date.now() - input.hours * 60 * 60 * 1000);

        return db
          .select({
            slot: simProbeLog.slot,
            carrier: simProbeLog.carrier,
            avgScore: sql<number>`ROUND(AVG(${simProbeLog.score}), 1)`,
            avgRssi: sql<number>`ROUND(AVG(${simProbeLog.rssi}), 1)`,
            avgLatencyMs: sql<number>`ROUND(AVG(${simProbeLog.latencyMs}), 0)`,
            selectedCount: sql<number>`SUM(CASE WHEN ${simProbeLog.selected} THEN 1 ELSE 0 END)`,
            totalCount: sql<number>`COUNT(*)`,
            registeredPct: sql<number>`ROUND(100.0 * SUM(CASE WHEN ${simProbeLog.regStatus} IN (1, 5) THEN 1 ELSE 0 END) / COUNT(*), 1)`,
          })
          .from(simProbeLog)
          .where(
            and(
              eq(simProbeLog.agentId, input.agentCode),
              gte(simProbeLog.probedAt, since)
            )
          )
          .groupBy(simProbeLog.slot, simProbeLog.carrier)
          .orderBy(desc(sql`AVG(${simProbeLog.score})`));
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
});
