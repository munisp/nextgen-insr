import { TRPCError } from "@trpc/server";
import { desc, eq, sql, and, gte, isNotNull, count } from "drizzle-orm";
import { z } from "zod";

import { auditLog, simProbeLog } from "../../drizzle/schema";
import { networkAlertResolutions } from "../../drizzle/schema.additions";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

/**
 * Network Status Dashboard — B14 (zero-undelivered-scope, Wave 2d).
 *
 * Carrier-level views are REAL aggregates over `sim_probe_log` — the
 * carrier-attributed telemetry table written by the actual capture path
 * (SIM orchestrator daemon -> simOrchestrator.ingestProbe; one row per SIM
 * slot per probe cycle with carrier, RSSI, latency, packet loss and score).
 * platform_health_checks was evaluated as a source first: it carries no
 * carrier/network attribution (service_name/check_type only), so it cannot
 * honestly back carrier views.
 *
 * Fail-loud grammar: when NO carrier-attributed rows exist in the requested
 * window, every view fails with PRECONDITION_FAILED NO_CARRIER_DATA instead
 * of returning empty-but-plausible payloads. getRegions additionally fails
 * with NO_GEO_DATA when probes carry no lat/lon.
 */

const windowInput = z.object({
  days: z.number().min(1).max(90).default(7),
});

const NO_CARRIER_DATA =
  "NO_CARRIER_DATA: no carrier-attributed probe telemetry exists in this window. sim_probe_log is populated by the SIM orchestrator daemon (simOrchestrator.ingestProbe); deploy/enable field terminals with the orchestrator agent to produce carrier telemetry.";

async function requireDb() {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "database unavailable" });
  }
  return database;
}

type Db = Awaited<ReturnType<typeof requireDb>>;

/** Fail loud unless at least one carrier-attributed probe exists in the window. */
async function requireCarrierData(db: Db, since: Date): Promise<void> {
  const [row] = await db
    .select({ total: count() })
    .from(simProbeLog)
    .where(gte(simProbeLog.probedAt, since));
  if (Number(row?.total ?? 0) === 0) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: NO_CARRIER_DATA });
  }
}

export const networkStatusDashboardRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const database = await getDb();
        if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
        const results = await database
          .select()
          .from(auditLog)
          .orderBy(desc(auditLog.id))
          .limit(input.limit)
          .offset(input.offset);

        const _totalRows = await database
          .select({ total: count() })
          .from(auditLog);
        const totalResult = Array.isArray(_totalRows)
          ? _totalRows[0]
          : _totalRows;

        return {
          data: results,
          total: totalResult?.total ?? 0,
          limit: input.limit,
          offset: input.offset,
        };
      } catch {
        return { data: [], total: 0, limit: 0, offset: 0 };
      }
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const [record] = await database
        .select()
        .from(auditLog)
        .where(eq(auditLog.id, input.id))
        .limit(1);

      if (!record) {
        throw new Error(`Record with id ${input.id} not found`);
      }
      return record;
    }),

  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
    const _totalRows = await database.select({ total: count() }).from(auditLog);
    const totalResult = Array.isArray(_totalRows) ? _totalRows[0] : _totalRows;

    return {
      totalRecords: totalResult?.total ?? 0,
      lastUpdated: new Date().toISOString(),
    };
  }),

  getRecent: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(7),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };

      const results = await database
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.id))
        .limit(input.limit);

      return results;
    }),

  // ── B14: real carrier telemetry views over sim_probe_log ──────────────────

  /** Per-carrier aggregates for the window: REAL percentiles and means. */
  getCarrierSummary: protectedProcedure
    .input(windowInput)
    .query(async ({ input }) => {
      const db = await requireDb();
      const since = new Date(Date.now() - input.days * 86_400_000);
      await requireCarrierData(db, since);
      const rows = await db
        .select({
          carrier: simProbeLog.carrier,
          probes: count(),
          terminals: sql<number>`COUNT(DISTINCT ${simProbeLog.terminalId})`,
          avgRssi: sql<number>`ROUND(AVG(${simProbeLog.rssi})::numeric, 1)`,
          avgLatencyMs: sql<number>`ROUND(AVG(${simProbeLog.latencyMs})::numeric, 1)`,
          p95LatencyMs: sql<number>`percentile_cont(0.95) within group (order by ${simProbeLog.latencyMs})`,
          avgPacketLossPct: sql<number>`ROUND((AVG(${simProbeLog.packetLossX10}) / 10)::numeric, 2)`,
          avgScore: sql<number>`ROUND(AVG(${simProbeLog.score})::numeric, 1)`,
          lastProbedAt: sql<Date>`MAX(${simProbeLog.probedAt})`,
        })
        .from(simProbeLog)
        .where(gte(simProbeLog.probedAt, since))
        .groupBy(simProbeLog.carrier)
        .orderBy(desc(sql`AVG(${simProbeLog.score})`));
      return {
        windowDays: input.days,
        carriers: rows.map(r => ({
          carrier: r.carrier,
          probes: Number(r.probes),
          terminals: Number(r.terminals),
          avgRssi: r.avgRssi != null ? Number(r.avgRssi) : null,
          avgLatencyMs: r.avgLatencyMs != null ? Number(r.avgLatencyMs) : null,
          p95LatencyMs: r.p95LatencyMs != null ? Number(r.p95LatencyMs) : null,
          avgPacketLossPct: r.avgPacketLossPct != null ? Number(r.avgPacketLossPct) : null,
          avgScore: r.avgScore != null ? Number(r.avgScore) : null,
          lastProbedAt: r.lastProbedAt,
        })),
      };
    }),

  /** Carrier x day heatmap of mean link score (0-100) — REAL daily buckets. */
  getCarrierHeatmap: protectedProcedure
    .input(windowInput)
    .query(async ({ input }) => {
      const db = await requireDb();
      const since = new Date(Date.now() - input.days * 86_400_000);
      await requireCarrierData(db, since);
      const rows = await db
        .select({
          carrier: simProbeLog.carrier,
          day: sql<string>`to_char(date_trunc('day', ${simProbeLog.probedAt}), 'YYYY-MM-DD')`,
          probes: count(),
          avgScore: sql<number>`ROUND(AVG(${simProbeLog.score})::numeric, 1)`,
          avgLatencyMs: sql<number>`ROUND(AVG(${simProbeLog.latencyMs})::numeric, 1)`,
          avgPacketLossPct: sql<number>`ROUND((AVG(${simProbeLog.packetLossX10}) / 10)::numeric, 2)`,
        })
        .from(simProbeLog)
        .where(gte(simProbeLog.probedAt, since))
        .groupBy(simProbeLog.carrier, sql`date_trunc('day', ${simProbeLog.probedAt})`)
        .orderBy(simProbeLog.carrier, sql`date_trunc('day', ${simProbeLog.probedAt})`);
      return {
        windowDays: input.days,
        cells: rows.map(r => ({
          carrier: r.carrier,
          day: r.day,
          probes: Number(r.probes),
          avgScore: r.avgScore != null ? Number(r.avgScore) : null,
          avgLatencyMs: r.avgLatencyMs != null ? Number(r.avgLatencyMs) : null,
          avgPacketLossPct: r.avgPacketLossPct != null ? Number(r.avgPacketLossPct) : null,
        })),
      };
    }),

  /** Fleet-wide totals plus per-carrier extremes for the window. */
  getOverview: protectedProcedure
    .input(windowInput)
    .query(async ({ input }) => {
      const db = await requireDb();
      const since = new Date(Date.now() - input.days * 86_400_000);
      await requireCarrierData(db, since);
      const [totals] = await db
        .select({
          probes: count(),
          carriers: sql<number>`COUNT(DISTINCT ${simProbeLog.carrier})`,
          terminals: sql<number>`COUNT(DISTINCT ${simProbeLog.terminalId})`,
          avgLatencyMs: sql<number>`ROUND(AVG(${simProbeLog.latencyMs})::numeric, 1)`,
          avgPacketLossPct: sql<number>`ROUND((AVG(${simProbeLog.packetLossX10}) / 10)::numeric, 2)`,
          avgScore: sql<number>`ROUND(AVG(${simProbeLog.score})::numeric, 1)`,
        })
        .from(simProbeLog)
        .where(gte(simProbeLog.probedAt, since));
      const perCarrier = await db
        .select({
          carrier: simProbeLog.carrier,
          avgScore: sql<number>`AVG(${simProbeLog.score})`,
        })
        .from(simProbeLog)
        .where(gte(simProbeLog.probedAt, since))
        .groupBy(simProbeLog.carrier)
        .orderBy(sql`AVG(${simProbeLog.score})`);
      return {
        windowDays: input.days,
        probes: Number(totals?.probes ?? 0),
        carriers: Number(totals?.carriers ?? 0),
        terminals: Number(totals?.terminals ?? 0),
        avgLatencyMs: totals?.avgLatencyMs != null ? Number(totals.avgLatencyMs) : null,
        avgPacketLossPct: totals?.avgPacketLossPct != null ? Number(totals.avgPacketLossPct) : null,
        avgScore: totals?.avgScore != null ? Number(totals.avgScore) : null,
        worstCarrier: perCarrier[0]?.carrier ?? null,
        bestCarrier: perCarrier[perCarrier.length - 1]?.carrier ?? null,
      };
    }),

  /**
   * Geo view: ~1.1km grid buckets from the probes' real lat/lon (E6).
   * Fails loud NO_GEO_DATA when no geo-tagged probes exist — coordinates are
   * optional on ingest and older rows may lack them.
   */
  getRegions: protectedProcedure
    .input(windowInput)
    .query(async ({ input }) => {
      const db = await requireDb();
      const since = new Date(Date.now() - input.days * 86_400_000);
      await requireCarrierData(db, since);
      const rows = await db
        .select({
          latBucket: sql<number>`ROUND((${simProbeLog.latE6} / 1000000.0)::numeric, 2)`,
          lonBucket: sql<number>`ROUND((${simProbeLog.lonE6} / 1000000.0)::numeric, 2)`,
          probes: count(),
          carriers: sql<number>`COUNT(DISTINCT ${simProbeLog.carrier})`,
          avgScore: sql<number>`ROUND(AVG(${simProbeLog.score})::numeric, 1)`,
          avgLatencyMs: sql<number>`ROUND(AVG(${simProbeLog.latencyMs})::numeric, 1)`,
        })
        .from(simProbeLog)
        .where(and(gte(simProbeLog.probedAt, since), isNotNull(simProbeLog.latE6), isNotNull(simProbeLog.lonE6)))
        .groupBy(sql`1`, sql`2`)
        .orderBy(desc(count()))
        .limit(200);
      if (rows.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "NO_GEO_DATA: carrier probes exist in this window but none carry lat/lon coordinates (latE6/lonE6 are optional on simOrchestrator.ingestProbe).",
        });
      }
      return {
        windowDays: input.days,
        regions: rows.map(r => ({
          lat: Number(r.latBucket),
          lon: Number(r.lonBucket),
          probes: Number(r.probes),
          carriers: Number(r.carriers),
          avgScore: r.avgScore != null ? Number(r.avgScore) : null,
          avgLatencyMs: r.avgLatencyMs != null ? Number(r.avgLatencyMs) : null,
        })),
      };
    }),

  /** Hourly time series of real link quality, optionally per carrier. */
  getTimeSeries: protectedProcedure
    .input(windowInput.extend({ carrier: z.string().optional() }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const since = new Date(Date.now() - input.days * 86_400_000);
      await requireCarrierData(db, since);
      const conds = [gte(simProbeLog.probedAt, since)];
      if (input.carrier) conds.push(eq(simProbeLog.carrier, input.carrier));
      const rows = await db
        .select({
          hour: sql<string>`to_char(date_trunc('hour', ${simProbeLog.probedAt}), 'YYYY-MM-DD"T"HH24:00')`,
          probes: count(),
          avgLatencyMs: sql<number>`ROUND(AVG(${simProbeLog.latencyMs})::numeric, 1)`,
          avgPacketLossPct: sql<number>`ROUND((AVG(${simProbeLog.packetLossX10}) / 10)::numeric, 2)`,
          avgScore: sql<number>`ROUND(AVG(${simProbeLog.score})::numeric, 1)`,
        })
        .from(simProbeLog)
        .where(and(...conds))
        .groupBy(sql`date_trunc('hour', ${simProbeLog.probedAt})`)
        .orderBy(sql`date_trunc('hour', ${simProbeLog.probedAt})`);
      return {
        windowDays: input.days,
        carrier: input.carrier ?? null,
        points: rows.map(r => ({
          hour: r.hour,
          probes: Number(r.probes),
          avgLatencyMs: r.avgLatencyMs != null ? Number(r.avgLatencyMs) : null,
          avgPacketLossPct: r.avgPacketLossPct != null ? Number(r.avgPacketLossPct) : null,
          avgScore: r.avgScore != null ? Number(r.avgScore) : null,
        })),
      };
    }),

  /**
   * Derived alerts from the last 24h of REAL probes: a carrier/terminal pair
   * alerts when its mean packet loss exceeds 5% or its mean link score falls
   * below 40 over at least 3 probes. alertKey is deterministic
   * (`<type>|<carrier>|<terminalId>`) so a resolution persists across
   * queries; resolutions are stored in network_alert_resolutions.
   */
  getAlerts: protectedProcedure.query(async () => {
    const db = await requireDb();
    const since = new Date(Date.now() - 24 * 3_600_000);
    await requireCarrierData(db, since);
    const offenders = await db
      .select({
        carrier: simProbeLog.carrier,
        terminalId: simProbeLog.terminalId,
        probes: count(),
        avgLossX10: sql<number>`AVG(${simProbeLog.packetLossX10})`,
        avgScore: sql<number>`AVG(${simProbeLog.score})`,
        lastProbedAt: sql<Date>`MAX(${simProbeLog.probedAt})`,
      })
      .from(simProbeLog)
      .where(gte(simProbeLog.probedAt, since))
      .groupBy(simProbeLog.carrier, simProbeLog.terminalId)
      .having(sql`COUNT(*) >= 3 AND (AVG(${simProbeLog.packetLossX10}) > 50 OR AVG(${simProbeLog.score}) < 40)`);
    const resolutions = await db.select().from(networkAlertResolutions);
    const resolvedByKey = new Map(resolutions.map(r => [r.alertKey, r]));
    const alerts: {
      alertKey: string;
      type: "packet_loss" | "low_link_score";
      carrier: string;
      terminalId: string;
      probes: number;
      measuredValue: number;
      threshold: number;
      lastProbedAt: Date;
      resolved: boolean;
      resolution: string | null;
      resolvedAt: Date | null;
    }[] = [];
    for (const o of offenders) {
      const base = { carrier: o.carrier, terminalId: o.terminalId, probes: Number(o.probes), lastProbedAt: new Date(o.lastProbedAt) };
      if (Number(o.avgLossX10) > 50) {
        const alertKey = `packet_loss|${o.carrier}|${o.terminalId}`;
        const res = resolvedByKey.get(alertKey);
        alerts.push({ ...base, alertKey, type: "packet_loss", measuredValue: Math.round(Number(o.avgLossX10)) / 10, threshold: 5, resolved: !!res, resolution: res?.resolution ?? null, resolvedAt: res?.resolvedAt ?? null });
      }
      if (Number(o.avgScore) < 40) {
        const alertKey = `low_link_score|${o.carrier}|${o.terminalId}`;
        const res = resolvedByKey.get(alertKey);
        alerts.push({ ...base, alertKey, type: "low_link_score", measuredValue: Math.round(Number(o.avgScore) * 10) / 10, threshold: 40, resolved: !!res, resolution: res?.resolution ?? null, resolvedAt: res?.resolvedAt ?? null });
      }
    }
    return { generatedAt: new Date().toISOString(), alerts };
  }),

  /** Persist a resolution for a derived alert (keyed by its deterministic alertKey). */
  resolveAlert: protectedProcedure
    .input(z.object({ alertId: z.string(), resolution: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [row] = await db
        .insert(networkAlertResolutions)
        .values({
          alertKey: input.alertId,
          resolution: input.resolution ?? null,
          resolvedBy: ctx.user?.email ?? (ctx.user?.id != null ? String(ctx.user.id) : null),
        })
        .returning();
      return { success: true as const, resolution: row };
    }),
});
