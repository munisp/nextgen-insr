// @ts-nocheck
/**
 * SIM Orchestrator tRPC Router
 *
 * Provides endpoints for the Rust daemon to:
 *   1. POST probe payloads (ingestProbe)
 *   2. GET its config (getConfig)
 *
 * And for the Admin Panel to:
 *   3. Query per-agent, per-carrier signal history (getHistory)
 *   4. Query carrier summary stats (getCarrierSummary)
 *   5. Upsert terminal config (upsertConfig)
 *   6. List all terminal configs (listConfigs)
 */

import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";

import {
  simFailoverLog,
  simOrchestratorConfig,
  simProbeLog,
} from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { publishEvent } from "../kafkaClient";

// ── Zod schemas ───────────────────────────────────────────────────────────────

const SimSlotSchema = z.enum(["Phys1", "Phys2", "ESim1", "ESim2"]);

const SimReadingSchema = z.object({
  slot: SimSlotSchema,
  carrier: z.string().max(32),
  mccMnc: z.number().int(),
  rssi: z.number().int().min(0).max(99),
  regStatus: z.number().int().min(0).max(10),
  latencyMs: z.number().int().min(0).max(65535),
  packetLossX10: z.number().int().min(0).max(1000),
  score: z.number().int().min(0).max(1000),
  selected: z.boolean(),
});

const ProbePayloadSchema = z.object({
  agentCode: z.string().max(32),
  terminalId: z.string().max(32),
  timestampUtc: z.number().int(),
  latE6: z.number().int().optional(),
  lonE6: z.number().int().optional(),
  readings: z.array(SimReadingSchema).length(4),
  selectedSlot: z.number().int().min(0).max(3),
  fwVersion: z.string().max(16).optional(),
  apiKey: z.string().max(128),
});

// ── Router ────────────────────────────────────────────────────────────────────

export const simOrchestratorRouter = router({
  /**
   * Called by the Rust daemon every probe interval.
   * Validates the API key, then bulk-inserts all 4 SIM readings.
   */
  ingestProbe: protectedProcedure
    .input(ProbePayloadSchema)
    .mutation(async ({ input }) => {
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

        const expectedKey =
          config[0]?.apiKey ?? "insureportal-sim-orchestrator-default-key";
        if (input.apiKey !== expectedKey) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid SIM orchestrator API key",
          });
        }

        if (config[0] && !config[0].enabled) {
          return { accepted: false, reason: "Terminal orchestrator disabled" };
        }

        const probedAt = new Date(input.timestampUtc * 1000);

        const rows = input.readings.map((r: any) => ({
          agentCode: input.agentCode,
          terminalId: input.terminalId,
          slot: r.slot,
          carrier: r.carrier,
          mccMnc: r.mccMnc,
          rssi: r.rssi,
          regStatus: r.regStatus,
          latencyMs: r.latencyMs,
          packetLossX10: r.packetLossX10,
          score: r.score,
          selected: r.selected,
          latE6: input.latE6 ?? null,
          lonE6: input.lonE6 ?? null,
          fwVersion: input.fwVersion ?? null,
          probedAt,
        }));

        await db.insert(simProbeLog).values(rows as any);
        return { accepted: true, ingested: rows.length };
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
   * Called by the Rust daemon on startup and every 5 minutes.
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
   * Returns the last N probe readings for a given agent.
   */
  getHistory: protectedProcedure
    .input(
      z.object({
        agentCode: z.string().max(32),
        hours: z.number().int().min(1).max(168).default(24),
        slot: SimSlotSchema.optional(),
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

        const conditions: ReturnType<typeof eq>[] = [
          eq(simProbeLog.agentCode, input.agentCode),
          gte(simProbeLog.probedAt, since),
        ];
        if (input.slot) {
          conditions.push(eq(simProbeLog.slot, input.slot));
        }

        return db
          .select()
          .from(simProbeLog)
          .where(and(...conditions))
          .orderBy(desc(simProbeLog.probedAt))
          .limit(500);
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
              eq(simProbeLog.agentCode, input.agentCode),
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

  /**
   * Returns the latest probe reading for each slot for a given agent.
   */
  getLatestReadings: protectedProcedure
    .input(z.object({ agentCode: z.string().max(32) }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        const latestResult = await db
          .select({ maxProbedAt: sql<Date>`MAX(${simProbeLog.probedAt})` })
          .from(simProbeLog)
          .where(eq(simProbeLog.agentCode, input.agentCode));

        const maxProbedAt = latestResult[0]?.maxProbedAt;
        if (!maxProbedAt) return [];

        return db
          .select()
          .from(simProbeLog)
          .where(
            and(
              eq(simProbeLog.agentCode, input.agentCode),
              eq(simProbeLog.probedAt, maxProbedAt)
            )
          )
          .orderBy(simProbeLog.slot);
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
   * Upsert terminal orchestrator config (admin/supervisor only).
   */
  upsertConfig: protectedProcedure
    .input(
      z.object({
        terminalId: z.string().max(32),
        probeIntervalMs: z.number().int().min(5000).max(300000).default(30000),
        relayEndpoint: z
          .string()
          .url()
          .max(256)
          .default(
            "https://api.insureportal.io/api/trpc/simOrchestrator.ingestProbe"
          ),
        apiKey: z
          .string()
          .min(8)
          .max(128)
          .default("insureportal-sim-orchestrator-default-key"),
        enabled: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (ctx.user.role !== "admin" && ctx.user.role !== "supervisor") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Admin or supervisor required",
          });
        }
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        await db
          .insert(simOrchestratorConfig)
          .values({
            terminalId: input.terminalId,
            probeIntervalMs: input.probeIntervalMs,
            relayEndpoint: input.relayEndpoint,
            apiKey: input.apiKey,
            enabled: input.enabled,
          })
          .onConflictDoUpdate({
            target: simOrchestratorConfig.terminalId,
            set: {
              probeIntervalMs: input.probeIntervalMs,
              relayEndpoint: input.relayEndpoint,
              apiKey: input.apiKey,
              enabled: input.enabled,
              updatedAt: new Date(),
            },
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

  /**
   * Returns probe GPS coordinates with RSSI and carrier data for the coverage map.
   * Returns all probes with non-null lat/lon from the last N hours.
   */
  getProbeGeoData: protectedProcedure
    .input(
      z.object({
        hours: z.number().int().min(1).max(720).default(168), // default 7 days
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

        const rows = await db
          .select({
            id: simProbeLog.id,
            agentCode: simProbeLog.agentCode,
            terminalId: simProbeLog.terminalId,
            slot: simProbeLog.slot,
            carrier: simProbeLog.carrier,
            rssi: simProbeLog.rssi,
            latencyMs: simProbeLog.latencyMs,
            score: simProbeLog.score,
            selected: simProbeLog.selected,
            latE6: simProbeLog.latE6,
            lonE6: simProbeLog.lonE6,
            probedAt: simProbeLog.probedAt,
          })
          .from(simProbeLog)
          .where(
            and(
              gte(simProbeLog.probedAt, since),
              sql`${simProbeLog.latE6} IS NOT NULL AND ${simProbeLog.latE6} != 0`
            )
          )
          .orderBy(desc(simProbeLog.probedAt))
          .limit(2000);

        // Convert latE6/lonE6 to decimal degrees
        return rows.map((r: any) => ({
          ...r,
          lat: (r.latE6 ?? 0) / 1_000_000,
          lon: (r.lonE6 ?? 0) / 1_000_000,
          rssiDbm: r.rssi === 99 ? null : -113 + r.rssi * 2,
        }));
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
   * List all terminal configs (admin/supervisor only).
   */
  listConfigs: protectedProcedure.query(async ({ ctx }) => {
    try {
      if (ctx.user.role !== "admin" && ctx.user.role !== "supervisor") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin or supervisor required",
        });
      }
      const db = (await getDb())!;
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB unavailable",
        });
      return db
        .select()
        .from(simOrchestratorConfig)
        .orderBy(simOrchestratorConfig.terminalId);
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
   * Called by the Rust daemon after each emergency SIM switch.
   * Logs the failover event and sends a VAPID push notification to the admin.
   */
  reportFailover: protectedProcedure
    .input(
      z.object({
        terminalId: z.string().max(32),
        agentCode: z.string().max(32),
        fromSlot: z.number().int().min(0).max(3),
        toSlot: z.number().int().min(0).max(3),
        reason: z.enum(["high_latency", "high_packet_loss"]),
        latencyMs: z.number().int().min(0),
        lossX10: z.number().int().min(0).max(1000),
        txRef: z.string().max(64).optional(),
        apiKey: z.string().max(128),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        // Validate API key against terminal config
        const [cfg] = await db
          .select({ apiKey: simOrchestratorConfig.apiKey })
          .from(simOrchestratorConfig)
          .where(eq(simOrchestratorConfig.terminalId, input.terminalId))
          .limit(1);

        const defaultKey = "insureportal-sim-orchestrator-default-key";
        const expectedKey = cfg?.apiKey ?? defaultKey;
        if (input.apiKey !== expectedKey) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid API key",
          });
        }

        const slotNames = ["Phys1", "Phys2", "ESim1", "ESim2"];
        const fromName = slotNames[input.fromSlot] ?? `Slot${input.fromSlot}`;
        const toName = slotNames[input.toSlot] ?? `Slot${input.toSlot}`;

        // Insert failover log
        await db.insert(simFailoverLog).values({
          terminalId: input.terminalId,
          agentCode: input.agentCode,
          fromSlot: input.fromSlot,
          toSlot: input.toSlot,
          reason: input.reason,
          latencyMs: input.latencyMs,
          lossX10: input.lossX10,
          txRef: input.txRef ?? null,
          switchedAt: new Date(),
        });

        // Send admin notification (non-blocking)
        const reasonLabel =
          input.reason === "high_latency"
            ? `latency ${input.latencyMs}ms > 3000ms`
            : `packet loss ${(input.lossX10 / 10).toFixed(1)}% > 20%`;
        notifyOwner({
          title: `⚠️ SIM Failover: ${input.terminalId}`,
          content: `Terminal ${input.terminalId} (agent ${input.agentCode}) switched from ${fromName} to ${toName}. Reason: ${reasonLabel}${input.txRef ? `. TX: ${input.txRef}` : ""}.`,
        }).catch(() => {
          /* non-critical */
        });

        // Publish to Kafka (non-blocking, fail-open)
        publishEvent(
          "pos.fraud.alert_raised",
          input.terminalId,
          {
            eventType: "sim.failover",
            terminalId: input.terminalId,
            agentCode: input.agentCode,
            fromSlot: input.fromSlot,
            toSlot: input.toSlot,
            reason: input.reason,
            latencyMs: input.latencyMs,
            lossX10: input.lossX10,
            txRef: input.txRef,
          },
          { agentCode: input.agentCode }
        ).catch(() => {
          /* non-critical */
        });

        // ── VAPID push notification to agent (fire-and-forget) ──────────────────
        import("../push.js")
          .then(({ notifySimFailover }) =>
            notifySimFailover({
              agentCode: input.agentCode,
              fromSlot: input.fromSlot,
              toSlot: input.toSlot,
              reason: reasonLabel,
              transactionRef: input.txRef,
            })
          )
          .catch(() => {
            /* non-critical */
          });

        return {
          ok: true,
          terminalId: input.terminalId,
          fromSlot: fromName,
          toSlot: toName,
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
   * Get failover history for admin panel (last 100 events, optionally filtered by terminal).
   */
  getFailoverHistory: protectedProcedure
    .input(
      z.object({
        terminalId: z.string().max(32).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        if (ctx.user.role !== "admin" && ctx.user.role !== "supervisor") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Admin or supervisor required",
          });
        }
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        const conditions = input.terminalId
          ? [eq(simFailoverLog.terminalId, input.terminalId)]
          : [];

        const rows = await db
          .select()
          .from(simFailoverLog)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(simFailoverLog.switchedAt))
          .limit(input.limit);

        const slotNames = ["Phys1", "Phys2", "ESim1", "ESim2"];
        return rows.map(r => ({
          ...r,
          fromSlotName: slotNames[r.fromSlot] ?? `Slot${r.fromSlot}`,
          toSlotName: slotNames[r.toSlot] ?? `Slot${r.toSlot}`,
          lossPercent: r.lossX10 / 10,
        }));
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
