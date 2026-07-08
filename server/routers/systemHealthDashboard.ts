// @ts-check

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { platform_health_checks } from "../../drizzle/schema";
import { desc, eq, sql, and, count, gte } from "drizzle-orm";

/**
 * System Health Dashboard Router
 * 
 * Real-time platform health monitoring. Tracks service availability,
 * response times, error rates, and dependency health.
 * 
 * Monitored Services: API Gateway, tRPC, Postgres, Redis, Kafka,
 * Keycloak, OpenSearch, TigerBeetle, APISIX, Temporal
 */
export const systemHealthDashboardRouter = router({
  // Get current health status of all services
  getStatus: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { services: [], overallStatus: "unknown" };

    const checks = await database
      .select()
      .from(platform_health_checks)
      .orderBy(desc(platform_health_checks.id))
      .limit(50);

    // Group by service, take latest check per service
    const serviceMap = new Map<string, any>();
    for (const check of checks) {
      if (!serviceMap.has(check.serviceName)) {
        serviceMap.set(check.serviceName, check);
      }
    }

    const services = Array.from(serviceMap.values()).map((s) => ({
      name: s.serviceName,
      status: s.checkType,
      lastChecked: s.id,
    }));

    const unhealthy = services.filter((s) => s.status === "error").length;
    const overallStatus = unhealthy === 0 ? "healthy" : unhealthy <= 2 ? "degraded" : "critical";

    return { services, overallStatus, unhealthyCount: unhealthy };
  }),

  // Get health check history for a specific service
  getServiceHistory: protectedProcedure
    .input(
      z.object({
        serviceName: z.string(),
        limit: z.number().min(1).max(100).default(24),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [];

      const results = await database
        .select()
        .from(platform_health_checks)
        .where(eq(platform_health_checks.serviceName, input.serviceName))
        .orderBy(desc(platform_health_checks.id))
        .limit(input.limit);

      return results;
    }),

  // Record a health check result
  recordCheck: protectedProcedure
    .input(
      z.object({
        serviceName: z.string(),
        checkType: z.enum(["healthy", "degraded", "error", "timeout"]),
        responseTimeMs: z.number().min(0).optional(),
        details: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [record] = await database
        .insert(platform_health_checks)
        .values({
          serviceName: input.serviceName,
          checkType: input.checkType,
        })
        .returning();

      return record;
    }),

  // Get uptime statistics
  getUptimeStats: protectedProcedure
    .input(
      z.object({ days: z.number().min(1).max(90).default(30) })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return null;

      const [total] = await database.select({ total: count() }).from(platform_health_checks);
      const [healthy] = await database
        .select({ total: count() })
        .from(platform_health_checks)
        .where(eq(platform_health_checks.checkType, "healthy"));

      const uptimePercent = (total?.total ?? 0) > 0
        ? (((healthy?.total ?? 0) / total.total) * 100).toFixed(2)
        : "0.00";

      return {
        totalChecks: total?.total ?? 0,
        healthyChecks: healthy?.total ?? 0,
        uptimePercent,
        period: `${input.days} days`,
        lastUpdated: new Date().toISOString(),
      };
    }),
});
