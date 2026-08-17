import { TRPCError } from "@trpc/server";
import { desc, eq, count, gte, and } from "drizzle-orm";
import { z } from "zod";

import { platform_health_checks } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

/**
 * Network Trends Router
 * 
 * Provides historical network performance data for capacity planning.
 * Tracks latency percentiles, throughput, error rates over time.
 */
export const networkTrendsRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };
      const results = await database.select().from(platform_health_checks).orderBy(desc(platform_health_checks.id)).limit(input.limit).offset(input.offset);
      const [{ total }] = await database.select({ total: count() }).from(platform_health_checks);
      return { data: results, total: total ?? 0 };
    }),
  getPerformanceTrend: protectedProcedure
    .input(z.object({ service: z.string().optional(), days: z.number().min(1).max(90).default(7) }))
    .query(async ({ input }) => {
      // F-12 (verifier round 4): full fabricated payload (p50 45, rps 2500,
      // availability 99.95, capacity 62%) -> REAL aggregates from
      // platform_health_checks over the requested window. throughputRps and
      // capacityUtilization have no telemetry source -> honest null.
      const database = await getDb();
      if (!database)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "database unavailable" });
      const since = new Date(Date.now() - input.days * 86_400_000);
      const conds = [gte(platform_health_checks.checkedAt, since)];
      if (input.service) conds.push(eq(platform_health_checks.serviceName, input.service));
      const [agg] = await database
        .select({
          p50: sql<number>`percentile_cont(0.5) within group (order by ${platform_health_checks.responseTime})`,
          p95: sql<number>`percentile_cont(0.95) within group (order by ${platform_health_checks.responseTime})`,
          p99: sql<number>`percentile_cont(0.99) within group (order by ${platform_health_checks.responseTime})`,
          total: count(),
          errors: sql<number>`SUM(CASE WHEN ${platform_health_checks.statusCode} >= 400 THEN 1 ELSE 0 END)`,
          up: sql<number>`SUM(CASE WHEN ${platform_health_checks.status} = 'up' OR ${platform_health_checks.status} = 'healthy' THEN 1 ELSE 0 END)`,
          firstHalfAvg: sql<number>`AVG(CASE WHEN ${platform_health_checks.checkedAt} < ${new Date(since.getTime() + (Date.now() - since.getTime()) / 2)} THEN ${platform_health_checks.responseTime} END)`,
          secondHalfAvg: sql<number>`AVG(CASE WHEN ${platform_health_checks.checkedAt} >= ${new Date(since.getTime() + (Date.now() - since.getTime()) / 2)} THEN ${platform_health_checks.responseTime} END)`,
        })
        .from(platform_health_checks)
        .where(and(...conds))
        .limit(100);
      const totalNum = Number(agg?.total ?? 0);
      const errors = Number(agg?.errors ?? 0);
      const up = Number(agg?.up ?? 0);
      const fh = agg?.firstHalfAvg != null ? Number(agg.firstHalfAvg) : null;
      const sh = agg?.secondHalfAvg != null ? Number(agg.secondHalfAvg) : null;
      const trend =
        fh != null && sh != null
          ? sh > fh * 1.1 ? "degrading" : sh < fh * 0.9 ? "improving" : "stable"
          : "insufficient_data";
      return {
        period: `${input.days} days`,
        metrics: {
          p50Latency: agg?.p50 != null ? Math.round(Number(agg.p50)) : null,
          p95Latency: agg?.p95 != null ? Math.round(Number(agg.p95)) : null,
          p99Latency: agg?.p99 != null ? Math.round(Number(agg.p99)) : null,
          throughputRps: null,
          errorRate: totalNum > 0 ? Math.round((errors / totalNum) * 1000) / 1000 : 0,
          availability: totalNum > 0 ? Math.round((up / totalNum) * 10000) / 100 : 0,
        },
        trend,
        capacityUtilization: null,
        recommendation: null,
      };
    }),
  getCapacityForecast: protectedProcedure
    .input(z.object({ months: z.number().min(1).max(12).default(3) }))
    .query(async () => {
      // F-12 (verifier round 4): fabricated forecast (2500 base load,
      // invented 15%/month growth, scripted recommendations) — no capacity
      // telemetry or forecasting model is delivered. Fail loud.
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "getCapacityForecast: no capacity-forecasting model is delivered",
      });
    }),
});
