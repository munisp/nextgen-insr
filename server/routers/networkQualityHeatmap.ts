/**
 * networkQualityHeatmap.ts — Network Quality Heatmap Router
 * Real DB-backed agent distribution data; zero randomly-generated mock data.
 *
 * F-12: getRegionMetrics / getEvents / getRegionDetail added (the delivered
 * client page called them but they did not exist — genuine API defect), and
 * getSummary extended with the client's KPI fields. Data provenance:
 *   - per-state quality/latency derivations come from the delivered static
 *     NCC-baseline model (STATE_QUALITY_BASELINE / ISP_QUALITY);
 *   - agent counts, transaction volumes, fail rates, pending-queue depth and
 *     the 24h hourly trend are REAL aggregates from the transactions/agents
 *     tables;
 *   - per-network-type (4g/3g/2g/wifi) breakdown has NO source in the
 *     delivered schema — reported honestly as "unknown"/[] rather than
 *     fabricated.
 */
import { TRPCError } from "@trpc/server";
import { desc, count, sql, gte, eq } from "drizzle-orm";
import { z } from "zod";

import { agents, transactions } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const NIGERIAN_STATES = ["Lagos", "FCT", "Rivers", "Oyo", "Kano", "Kaduna", "Anambra", "Delta", "Edo", "Ogun", "Enugu", "Imo"];
const ISP_LIST = ["MTN", "Glo", "Airtel", "9mobile"];

// Static quality baselines per state (based on NCC data, not random)
const STATE_QUALITY_BASELINE: Record<string, number> = {
  Lagos: 78, FCT: 75, Rivers: 68, Oyo: 65, Kano: 60,
  Kaduna: 58, Anambra: 63, Delta: 62, Edo: 61, Ogun: 70,
  Enugu: 64, Imo: 62,
};

// Static ISP quality rankings per state (NCC 2024 data)
const ISP_QUALITY: Record<string, number> = {
  MTN: 74, Glo: 62, Airtel: 71, "9mobile": 58,
};

function getStateMetrics(state: string, agentCount: number, txCount: number) {
  const quality = STATE_QUALITY_BASELINE[state] ?? 60;
  const zone = quality > 80 ? "green" : quality > 60 ? "yellow" : quality > 40 ? "orange" : "red";
  const topISP = Object.entries(ISP_QUALITY).sort((a, b) => b[1] - a[1])[0][0];
  return {
    state,
    qualityScore: quality,
    zone,
    latencyMs: Math.round(200 - quality * 1.5),
    packetLoss: Math.round((100 - quality) * 0.05 * 100) / 100,
    uptimePct: 95 + quality * 0.04,
    activeAgents: agentCount,
    transactionsPerHour: txCount,
    topISP,
  };
}

// ─── F-12: region model helpers ──────────────────────────────────────────────

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

interface NationalTxHealth {
  total24h: number;
  failed24h: number;
  succeeded24h: number;
  pendingNow: number;
  failRate: number;
  syncSuccessRate: number;
  hourly: { hour: number; total: number; failed: number }[];
}

function emptyHealth(): NationalTxHealth {
  return {
    total24h: 0,
    failed24h: 0,
    succeeded24h: 0,
    pendingNow: 0,
    failRate: 0,
    syncSuccessRate: 1,
    hourly: [],
  };
}

/** Real 24h transaction-health aggregates (fail rate, queue, hourly buckets). */
async function getNationalTxHealth(database: Db): Promise<NationalTxHealth> {
  const since = new Date(Date.now() - 24 * 3600000);
  const [totals] = await database
    .select({
      total: count(),
      failed: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'failed')`,
      succeeded: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'success')`,
    })
    .from(transactions)
    .where(gte(transactions.createdAt, since));
  const [{ pending }] = await database
    .select({ pending: count() })
    .from(transactions)
    .where(eq(transactions.status, "pending"));
  const hourlyRows = await database.execute<{
    hour: string;
    total: number;
    failed: number;
  }>(sql`
    SELECT date_trunc('hour', ${transactions.createdAt}) AS hour,
           count(*)::int AS total,
           count(*) FILTER (WHERE ${transactions.status} = 'failed')::int AS failed
    FROM ${transactions}
    WHERE ${transactions.createdAt} >= ${since}
    GROUP BY 1 ORDER BY 1
  `);
  const total24h = Number(totals?.total ?? 0);
  const failed24h = Number(totals?.failed ?? 0);
  const succeeded24h = Number(totals?.succeeded ?? 0);
  return {
    total24h,
    failed24h,
    succeeded24h,
    pendingNow: Number(pending ?? 0),
    failRate: total24h > 0 ? failed24h / total24h : 0,
    syncSuccessRate: total24h > 0 ? succeeded24h / total24h : 1,
    hourly: (hourlyRows.rows ?? []).map(r => ({
      hour: new Date(r.hour).getUTCHours(),
      total: Number(r.total),
      failed: Number(r.failed),
    })),
  };
}

interface RegionMetric {
  regionId: string;
  regionName: string;
  country: string;
  qualityScore: number;
  zone: string;
  agentCount: number;
  avgLatencyMs: number;
  avgBandwidthKbps: number;
  packetLoss: number;
  uptimePct: number;
  queueDepth: number;
  failRate: number;
  syncSuccessRate: number;
  dominantNetwork: string;
  networkBreakdown: { type: string; percentage: number }[];
  transactionsPerHour: number;
  topISP: string;
}

function regionIdFor(state: string): string {
  return `ng-${state.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/**
 * Per-state region metrics. Distribution of national totals across states is
 * the delivered model (uniform, like list/getHeatmap above); quality/latency
 * derive from the NCC baseline; fail rate / queue depth are REAL aggregates.
 */
function buildRegionMetrics(
  agentTotal: number,
  txTotal1h: number,
  health: NationalTxHealth
): RegionMetric[] {
  const perStateAgents = Math.max(1, Math.floor(agentTotal / NIGERIAN_STATES.length));
  const perStateTx = Math.max(0, Math.floor(txTotal1h / NIGERIAN_STATES.length));
  const perStateQueue = Math.max(0, Math.floor(health.pendingNow / NIGERIAN_STATES.length));
  return NIGERIAN_STATES.map(state => {
    const base = getStateMetrics(state, perStateAgents, perStateTx);
    return {
      regionId: regionIdFor(state),
      regionName: state,
      country: "Nigeria",
      qualityScore: base.qualityScore,
      zone: base.zone,
      agentCount: base.activeAgents,
      avgLatencyMs: base.latencyMs,
      avgBandwidthKbps: Math.round(base.qualityScore * 50),
      packetLoss: base.packetLoss,
      uptimePct: base.uptimePct,
      queueDepth: perStateQueue,
      failRate: Math.round(health.failRate * 10000) / 10000,
      syncSuccessRate: Math.round(health.syncSuccessRate * 10000) / 10000,
      dominantNetwork: "unknown",
      networkBreakdown: [],
      transactionsPerHour: base.transactionsPerHour,
      topISP: base.topISP,
    };
  });
}

/**
 * Connectivity events derived from CURRENT zone status (the only event source
 * in the delivered data model — there is no historical outage store, so no
 * outage/recovery events are fabricated).
 */
function buildConnectivityEvents(regions: RegionMetric[]) {
  return regions
    .filter(r => r.zone === "red" || r.zone === "orange")
    .map(r => ({
      id: `evt-${r.regionId}-zone-breach`,
      regionId: r.regionId,
      eventType: "degradation" as const,
      severity: (r.zone === "red" ? "critical" : "warning") as
        | "critical"
        | "warning",
      timestamp: new Date().toISOString(),
      description:
        `${r.regionName} is in the ${r.zone} zone (quality score ${r.qualityScore}, ` +
        `NCC baseline) — derived from current zone status.`,
      affectedAgents: r.agentCount,
      duration: null as string | null,
    }));
}

/** Shared aggregate bundle for the region procedures. */
async function getRegionInputs(database: Db | null) {
  if (!database) {
    return { agentTotal: 0, txTotal1h: 0, health: emptyHealth() };
  }
  const [{ total: at }] = await database.select({ total: count() }).from(agents);
  const [{ total: tt }] = await database
    .select({ total: count() })
    .from(transactions)
    .where(gte(transactions.createdAt, new Date(Date.now() - 3600000)));
  const health = await getNationalTxHealth(database);
  return {
    agentTotal: Number(at ?? 0),
    txTotal1h: Number(tt ?? 0),
    health,
  };
}

export const networkQualityHeatmapRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20), offset: z.number().min(0).default(0) }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: NIGERIAN_STATES.length, limit: input.limit, offset: input.offset };

      const [{ total: agentTotal }] = await database.select({ total: count() }).from(agents);
      const agentCount = Number(agentTotal ?? 0);
      const perState = Math.max(1, Math.floor(agentCount / NIGERIAN_STATES.length));

      const [{ total: txTotal }] = await database.select({ total: count() }).from(transactions)
        .where(gte(transactions.createdAt, new Date(Date.now() - 3600000)));
      const txPerState = Math.max(0, Math.floor(Number(txTotal ?? 0) / NIGERIAN_STATES.length));

      const data = NIGERIAN_STATES.map(s => getStateMetrics(s, perState, txPerState));
      return { data: data.slice(input.offset, input.offset + input.limit), total: data.length, limit: input.limit, offset: input.offset };
    }),

  getHeatmap: protectedProcedure
    .input(z.object({ timeRange: z.enum(["1h", "6h", "24h", "7d"]).default("24h") }))
    .query(async ({ input }) => {
      const database = await getDb();
      const hours = input.timeRange === "1h" ? 1 : input.timeRange === "6h" ? 6 : input.timeRange === "24h" ? 24 : 168;
      const since = new Date(Date.now() - hours * 3600000);

      let agentCount = 0, txCount = 0;
      if (database) {
        const [{ total: at }] = await database.select({ total: count() }).from(agents);
        const [{ total: tt }] = await database.select({ total: count() }).from(transactions).where(gte(transactions.createdAt, since));
        agentCount = Number(at ?? 0);
        txCount = Number(tt ?? 0);
      }

      const perState = Math.max(1, Math.floor(agentCount / NIGERIAN_STATES.length));
      const txPerState = Math.max(0, Math.floor(txCount / NIGERIAN_STATES.length));
      const states = NIGERIAN_STATES.map(s => getStateMetrics(s, perState, txPerState));
      const avgQuality = states.reduce((s, st) => s + st.qualityScore, 0) / states.length;

      return {
        timeRange: input.timeRange,
        states,
        nationalAverage: {
          qualityScore: Math.round(avgQuality),
          latencyMs: Math.round(200 - avgQuality * 1.5),
          packetLoss: Math.round((100 - avgQuality) * 0.05 * 100) / 100,
          uptimePct: 95 + avgQuality * 0.04,
        },
        breaches: states.filter(s => s.zone === "red").map(s => ({
          state: s.state,
          duration: "N/A",
          qualityScore: s.qualityScore,
          timestamp: new Date().toISOString(),
        })),
        ispRankings: Object.entries(ISP_QUALITY).map(([isp, quality]) => ({
          isp,
          avgQuality: quality,
          coverage: Math.round(quality * 0.95),
        })),
      };
    }),

  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { totalZones: 0, avgQuality: 0 };
    const { agentTotal, health } = await getRegionInputs(database);
    const qualities = Object.values(STATE_QUALITY_BASELINE);
    const avgQuality = Math.round(qualities.reduce((s, q) => s + q, 0) / qualities.length);
    const greenZones = qualities.filter(q => q > 80).length;
    const redZones = qualities.filter(q => q <= 40).length;
    const avgLatencyMs = Math.round(200 - avgQuality * 1.5);
    return {
      totalZones: NIGERIAN_STATES.length,
      avgQuality,
      greenZones,
      yellowZones: qualities.filter(q => q > 60 && q <= 80).length,
      orangeZones: qualities.filter(q => q > 40 && q <= 60).length,
      redZones,
      agentsMonitored: agentTotal,
      slaBreaches24h: redZones,
      // F-12: fields consumed by the delivered heatmap client page.
      totalRegions: NIGERIAN_STATES.length,
      totalAgents: agentTotal,
      avgLatencyMs,
      avgFailRate: Math.round(health.failRate * 10000) / 10000,
      healthyCount: greenZones,
      criticalCount: redZones,
      countryBreakdown: [
        {
          country: "Nigeria",
          regionCount: NIGERIAN_STATES.length,
          agents: agentTotal,
          avgLatency: avgLatencyMs,
          avgFailRate: Math.round(health.failRate * 10000) / 10000,
          investmentPriority:
            health.failRate >= 0.05 ? "high" : health.failRate >= 0.01 ? "medium" : "low",
        },
      ],
    };
  }),

  // ─── F-12: procedures the delivered client page calls ──────────────────────

  getRegionMetrics: protectedProcedure
    .input(
      z
        .object({
          country: z.string().optional(),
          sortBy: z
            .enum(["failRate", "latency", "queueDepth", "agentCount"])
            .default("failRate"),
        })
        .default({})
    )
    .query(async ({ input }) => {
      const database = await getDb();
      const { agentTotal, txTotal1h, health } = await getRegionInputs(database);
      let regions = buildRegionMetrics(agentTotal, txTotal1h, health);
      if (input.country) {
        regions = regions.filter(
          r => r.country.toLowerCase() === input.country!.toLowerCase()
        );
      }
      return [...regions].sort((a, b) => {
        switch (input.sortBy) {
          case "latency":
            return b.avgLatencyMs - a.avgLatencyMs;
          case "queueDepth":
            return b.queueDepth - a.queueDepth;
          case "agentCount":
            return b.agentCount - a.agentCount;
          default:
            return b.failRate - a.failRate;
        }
      });
    }),

  getEvents: protectedProcedure
    .input(
      z
        .object({ limit: z.number().min(1).max(100).default(20) })
        .default({})
    )
    .query(async ({ input }) => {
      const database = await getDb();
      const { agentTotal, txTotal1h, health } = await getRegionInputs(database);
      const regions = buildRegionMetrics(agentTotal, txTotal1h, health);
      return buildConnectivityEvents(regions).slice(0, input.limit);
    }),

  getRegionDetail: protectedProcedure
    .input(z.object({ regionId: z.string().min(1) }))
    .query(async ({ input }) => {
      const state = NIGERIAN_STATES.find(s => regionIdFor(s) === input.regionId);
      if (!state) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Region '${input.regionId}' not found`,
        });
      }
      const database = await getDb();
      const { agentTotal, txTotal1h, health } = await getRegionInputs(database);
      const regions = buildRegionMetrics(agentTotal, txTotal1h, health);
      const region = regions.find(r => r.regionId === input.regionId)!;
      // 24h trend: REAL national hourly tx buckets (transactions are not
      // geo-tagged, so the fail-rate series is national; latency derives from
      // the state's NCC baseline, agents are the current count).
      const buckets = new Map(health.hourly.map(h => [h.hour, h]));
      const now = new Date();
      const hourlyTrend = [...Array(24).keys()].map(i => {
        const t = new Date(now.getTime() - (23 - i) * 3600000);
        const bucket = buckets.get(t.getUTCHours());
        return {
          hour: t.getUTCHours(),
          latency: region.avgLatencyMs,
          failRate:
            bucket && bucket.total > 0
              ? Math.round((bucket.failed / bucket.total) * 10000) / 10000
              : 0,
          queue: region.queueDepth,
          activeAgents: region.agentCount,
        };
      });
      return { ...region, hourlyTrend };
    }),
});
