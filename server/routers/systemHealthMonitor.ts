import fs from "node:fs";
import os from "node:os";

import { TRPCError } from "@trpc/server";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { z } from "zod";

import { auditLog, transactions } from "../../drizzle/schema";
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
  // F-12 (wave-4b): was a zero-payload stub — no APM/request-timing source is
  // delivered. Fail loud instead of returning empty telemetry.
  apiLatency: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "apiLatency: no request-timing (APM) source is delivered on this platform",
    });
  }),
  // F-12 (wave-4b): was a zero-payload stub — no application error-aggregation
  // source is delivered. Fail loud instead of returning empty telemetry.
  errorTracking: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "errorTracking: no application error-aggregation source is delivered on this platform",
    });
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
  // F-12 (wave-4b): no user-session/page-view source is delivered (audit_log
  // tracks agent/admin actions, not user sessions) — fail loud, never zeros.
  userActivity: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "userActivity: no user-session telemetry source is delivered on this platform",
    });
  }),
});
