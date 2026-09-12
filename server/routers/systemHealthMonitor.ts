import fs from "node:fs";
import os from "node:os";

import { TRPCError } from "@trpc/server";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { z } from "zod";

import { auditLog, transactions, users } from "../../drizzle/schema";
import { errorEvents, requestMetrics } from "../../drizzle/schema.additions";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

export const systemHealthMonitorRouter = router({
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
      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const results = await database
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.id))
        .limit(input.limit);

      return results;
    }),
  // B8 (zero-undelivered-scope wave-2): REAL APM latency percentiles from the
  // request_metrics table, populated by the observability middleware's
  // batched best-effort recorder (server/lib/telemetryStore.ts). Percentiles
  // are nearest-rank over the sorted real durations per procedure path.
  // Honest cold start: an empty scope fails loud NO_METRICS_YET — never zeros.
  apiLatency: protectedProcedure
    .input(
      z.object({
        hours: z.number().min(1).max(720).default(24),
        path: z.string().max(255).optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "NO_METRICS_YET: request_metrics store unavailable (no database connection)",
        });
      }
      const since = new Date(Date.now() - input.hours * 3_600_000);
      const scope = input.path
        ? and(gte(requestMetrics.createdAt, since), eq(requestMetrics.path, input.path))
        : gte(requestMetrics.createdAt, since);
      const rows = await database
        .select({
          path: requestMetrics.path,
          durationMs: requestMetrics.durationMs,
          success: requestMetrics.success,
        })
        .from(requestMetrics)
        .where(scope)
        .orderBy(requestMetrics.path, requestMetrics.durationMs)
        .limit(100_000);
      if (rows.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: input.path
            ? `NO_METRICS_YET: no request_metrics rows recorded for path '${input.path}' in the last ${input.hours}h — the middleware records real traffic only, cold start is honest`
            : `NO_METRICS_YET: request_metrics is empty for the last ${input.hours}h — the middleware records real traffic only, cold start is honest`,
        });
      }
      // Nearest-rank percentile over sorted real samples: rank = ceil(p/100*n).
      const nearestRank = (sorted: number[], p: number): number => {
        const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
        return sorted[rank - 1];
      };
      const byPath = new Map<string, { durations: number[]; errors: number }>();
      for (const r of rows) {
        let bucket = byPath.get(r.path);
        if (!bucket) {
          bucket = { durations: [], errors: 0 };
          byPath.set(r.path, bucket);
        }
        bucket.durations.push(r.durationMs); // rows arrive duration-sorted per path
        if (!r.success) bucket.errors++;
      }
      const routes = Array.from(byPath.entries())
        .map(([path, b]) => ({
          path,
          sampleCount: b.durations.length,
          errorCount: b.errors,
          p50Ms: nearestRank(b.durations, 50),
          p90Ms: nearestRank(b.durations, 90),
          p99Ms: nearestRank(b.durations, 99),
          maxMs: b.durations[b.durations.length - 1],
        }))
        .sort((a, b) => b.sampleCount - a.sampleCount);
      const all = rows.map(r => r.durationMs).sort((a, b) => a - b);
      return {
        windowHours: input.hours,
        since: since.toISOString(),
        totalSamples: rows.length,
        overall: {
          p50Ms: nearestRank(all, 50),
          p90Ms: nearestRank(all, 90),
          p99Ms: nearestRank(all, 99),
        },
        routes,
      };
    }),
  // B9 (zero-undelivered-scope wave-2): REAL error aggregation from the
  // error_events table — one row per fingerprint (path + message + stack
  // hash), upserted by the middleware on genuine thrown errors only.
  // Empty scope fails loud NO_ERROR_EVENTS_YET.
  errorTracking: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        path: z.string().max(255).optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "NO_ERROR_EVENTS_YET: error_events store unavailable (no database connection)",
        });
      }
      const grouped = await database
        .select()
        .from(errorEvents)
        .where(input.path ? eq(errorEvents.path, input.path) : undefined)
        .orderBy(desc(errorEvents.count), desc(errorEvents.lastSeen))
        .limit(input.limit);
      const [totals] = await database
        .select({
          totalOccurrences: sql<number>`COALESCE(SUM(${errorEvents.count}), 0)`,
          distinctFingerprints: count(),
        })
        .from(errorEvents)
        .where(input.path ? eq(errorEvents.path, input.path) : undefined);
      if (!totals || Number(totals.distinctFingerprints) === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: input.path
            ? `NO_ERROR_EVENTS_YET: no error_events recorded for path '${input.path}' — only genuine thrown errors are captured`
            : "NO_ERROR_EVENTS_YET: error_events is empty — only genuine thrown errors are captured, cold start is honest",
        });
      }
      return {
        totalOccurrences: Number(totals.totalOccurrences),
        distinctFingerprints: Number(totals.distinctFingerprints),
        errors: grouped.map(e => ({
          fingerprint: e.fingerprint,
          message: e.message,
          stackHash: e.stackHash ?? null,
          path: e.path,
          count: e.count,
          firstSeen: e.firstSeen instanceof Date ? e.firstSeen.toISOString() : String(e.firstSeen),
          lastSeen: e.lastSeen instanceof Date ? e.lastSeen.toISOString() : String(e.lastSeen),
        })),
      };
    }),
  // F-12 (wave-4b): was a zero-payload stub. Real host/process metrics from
  // node:os + fs.statfs — labelled host metrics, not fabricated APM telemetry.
  // activeConnections/requestsPerMin had no source and were dropped.
  overview: protectedProcedure.query(async () => {
    const cpus = os.cpus().length || 1;
    const loadPct = Math.min(100, (os.loadavg()[0] / cpus) * 100);
    const memPct = ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;
    let diskPct = 0;
    try {
      const st = fs.statfsSync("/");
      diskPct = st.blocks > 0 ? ((st.blocks - st.bavail) / st.blocks) * 100 : 0;
    } catch {
      diskPct = 0; // statfs unsupported on this host — 0 renders as "no data" downstream
    }
    return {
      hostCpuLoadPercent: Math.round(loadPct * 10) / 10,
      hostMemoryUsedPercent: Math.round(memPct * 10) / 10,
      hostDiskUsedPercent: Math.round(diskPct * 10) / 10,
      processUptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
    };
  }),
  // F-12 (wave-4b): was a zero-payload stub. Real events from audit_log —
  // severity has no schema source so it is not fabricated; consumers must not
  // expect it.
  securityEvents: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { events: [] as Array<{ id: string; type: string; resource: string | null; status: string | null; actor: number | null; timestamp: string }>, total: 0 };
    const rows = await database
      .select()
      .from(auditLog)
      .orderBy(desc(auditLog.id))
      .limit(50);
    return {
      events: rows.map(r => ({
        id: String(r.id),
        type: r.action,
        resource: r.resource ?? null,
        status: r.status ?? null,
        actor: r.agentId ?? null,
        timestamp: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      })),
      total: rows.length,
    };
  }),
  // F-12 (wave-4b): was a zero-payload stub. Real buckets from transactions.
  transactionVolume: protectedProcedure.query(async () => {
    const database = await getDb();
    const empty = {
      current: 0,
      hourly: [] as Array<{ hour: string; count: number; amount: number }>,
      byType: [] as Array<{ type: string; count: number }>,
      byStatus: [] as Array<{ status: string; count: number }>,
    };
    if (!database) return empty;
    const window = gte(transactions.createdAt, sql`now() - interval '24 hours'`);
    const [hourly, byType, byStatus] = await Promise.all([
      database
        .select({
          hour: sql<string>`date_trunc('hour', created_at)::text`,
          count: count(),
          amount: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)::text`,
        })
        .from(transactions)
        .where(window)
        .groupBy(sql`date_trunc('hour', created_at)`)
        .orderBy(sql`date_trunc('hour', created_at)`),
      database
        .select({ type: transactions.type, count: count() })
        .from(transactions)
        .where(window)
        .groupBy(transactions.type),
      database
        .select({ status: transactions.status, count: count() })
        .from(transactions)
        .where(window)
        .groupBy(transactions.status),
    ]);
    const current = hourly.length > 0 ? Number(hourly[hourly.length - 1].count) : 0;
    return {
      current,
      hourly: hourly.map(h => ({
        hour: h.hour,
        count: Number(h.count),
        amount: Number(h.amount),
      })),
      byType: byType.map(t => ({ type: t.type, count: Number(t.count) })),
      byStatus: byStatus.map(t => ({ status: t.status, count: Number(t.count) })),
    };
  }),
  // B10 (zero-undelivered-scope wave-2): REAL user-activity analytics.
  // SOURCE (documented, honest): the platform has NO sessions table — the
  // runtime schema was verified at build time (drizzle/0050 is column-level
  // only; no session store is delivered). We therefore aggregate
  // users.lastSignedIn (same precedent as analyticsDashboard.activeUsers):
  // recency buckets (24h/7d/30d actives = DAU/WAU/MAU-style) and per-UTC-day
  // counts of users whose most recent sign-in fell on that day. These are
  // last-sign-in recency metrics, NOT live session counts — the payload is
  // labelled accordingly. Empty users table fails loud NO_USER_ACTIVITY_YET.
  userActivity: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "NO_USER_ACTIVITY_YET: users store unavailable (no database connection)",
      });
    }
    const now = Date.now();
    const [buckets] = await database
      .select({
        total: count(),
        active24h: sql<number>`SUM(CASE WHEN ${users.lastSignedIn} >= ${new Date(now - 86_400_000)} THEN 1 ELSE 0 END)`,
        active7d: sql<number>`SUM(CASE WHEN ${users.lastSignedIn} >= ${new Date(now - 7 * 86_400_000)} THEN 1 ELSE 0 END)`,
        active30d: sql<number>`SUM(CASE WHEN ${users.lastSignedIn} >= ${new Date(now - 30 * 86_400_000)} THEN 1 ELSE 0 END)`,
        new7d: sql<number>`SUM(CASE WHEN ${users.createdAt} >= ${new Date(now - 7 * 86_400_000)} THEN 1 ELSE 0 END)`,
      })
      .from(users);
    const totalUsers = Number(buckets?.total ?? 0);
    if (totalUsers === 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "NO_USER_ACTIVITY_YET: users table is empty — no sign-in activity to aggregate, cold start is honest",
      });
    }
    // Per-UTC-day counts for the trailing 7 days (users whose LAST sign-in
    // was that day — labelled last-sign-in counts, not daily session counts).
    const perDay = await database
      .select({
        day: sql<string>`to_char(date_trunc('day', ${users.lastSignedIn}), 'YYYY-MM-DD')`,
        activeUsers: count(),
      })
      .from(users)
      .where(gte(users.lastSignedIn, new Date(now - 7 * 86_400_000)))
      .groupBy(sql`date_trunc('day', ${users.lastSignedIn})`)
      .orderBy(sql`date_trunc('day', ${users.lastSignedIn})`);
    return {
      source:
        "users.lastSignedIn (no sessions table is delivered on this platform — recency of most recent sign-in, not live sessions)",
      generatedAt: new Date(now).toISOString(),
      totalUsers,
      active24h: Number(buckets?.active24h ?? 0),
      active7d: Number(buckets?.active7d ?? 0),
      active30d: Number(buckets?.active30d ?? 0),
      newUsers7d: Number(buckets?.new7d ?? 0),
      dailyLastSignIns: perDay.map(d => ({
        day: d.day,
        users: Number(d.activeUsers),
      })),
    };
  }),
});
