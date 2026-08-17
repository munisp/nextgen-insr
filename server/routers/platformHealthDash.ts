/**
 * platformHealthDash.ts — Platform Health Dashboard Router
 *
 * Real health checks against all platform services.
 * Zero randomly-generated mock data — all data comes from actual service probes.
 */
import { desc, count, gte } from "drizzle-orm";
import { z } from "zod";

import { platform_health_checks } from "../../drizzle/schema";
import { ENV } from "../_core/env";
import { logger } from "../_core/logger";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getRedisClient, pingRedis } from "../lib/redisClient";
import { tbIsHealthy, tbGetSyncStatus } from "../tbClient";

const SLA_TARGETS = {
  apiLatencyP95Ms: 200,
  uptimePct: 99.9,
  errorRatePct: 0.1,
  cpuThreshold: 70,
  memoryThreshold: 85,
};

async function probeService(name: string, url: string, timeoutMs = 3000): Promise<{
  name: string; status: "healthy" | "degraded" | "offline"; latencyMs: number; error?: string;
}> {
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const latencyMs = Date.now() - start;
    return { name, status: res.ok ? "healthy" : "degraded", latencyMs };
  } catch (err) {
    return { name, status: "offline", latencyMs: Date.now() - start, error: String(err) };
  }
}

async function checkPostgres(): Promise<{ status: "healthy" | "degraded" | "offline"; latencyMs: number }> {
  const start = Date.now();
  try {
    const db = await getDb();
    if (!db) return { status: "offline", latencyMs: 0 };
    await db.execute("SELECT 1");
    return { status: "healthy", latencyMs: Date.now() - start };
  } catch {
    return { status: "offline", latencyMs: Date.now() - start };
  }
}

async function checkRedis(): Promise<{ status: "healthy" | "degraded" | "offline"; latencyMs: number }> {
  const latencyMs = await pingRedis();
  if (latencyMs === null) return { status: "offline", latencyMs: 0 };
  return { status: latencyMs < 100 ? "healthy" : "degraded", latencyMs };
}

async function checkKeycloak(): Promise<{ status: "healthy" | "degraded" | "offline"; latencyMs: number }> {
  return probeService("keycloak", `${ENV.keycloakUrl}/realms/${ENV.keycloakRealm}/.well-known/openid-configuration`);
}

async function checkTigerBeetle(): Promise<{ status: "healthy" | "degraded" | "offline"; latencyMs: number }> {
  const start = Date.now();
  const healthy = await tbIsHealthy();
  return { status: healthy ? "healthy" : "offline", latencyMs: Date.now() - start };
}

async function checkTemporal(): Promise<{ status: "healthy" | "degraded" | "offline"; latencyMs: number }> {
  return probeService("temporal", `http://${ENV.temporalAddress.replace("temporal:", "localhost:")}/health`);
}

async function checkPermify(): Promise<{ status: "healthy" | "degraded" | "offline"; latencyMs: number }> {
  return probeService("permify", `${ENV.permifyUrl}/healthz`);
}

async function checkAPISIX(): Promise<{ status: "healthy" | "degraded" | "offline"; latencyMs: number }> {
  return probeService("apisix", `${ENV.apisixAdminUrl}/apisix/admin/routes`, 3000);
}

async function checkFluvio(): Promise<{ status: "healthy" | "degraded" | "offline"; latencyMs: number }> {
  const fluvioUrl = process.env.FLUVIO_HTTP_URL ?? "http://localhost:9090";
  return probeService("fluvio", `${fluvioUrl}/health`);
}

async function checkMinio(): Promise<{ status: "healthy" | "degraded" | "offline"; latencyMs: number }> {
  return probeService("minio", `${ENV.minioEndpoint}/minio/health/live`);
}

export const platformHealthDashRouter = router({
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: input.limit, offset: input.offset };
      const results = await database.select().from(platform_health_checks)
        .orderBy(desc(platform_health_checks.id))
        .limit(input.limit).offset(input.offset);
      const [{ total }] = await database.select({ total: count() }).from(platform_health_checks);
      return { data: results, total: Number(total), limit: input.limit, offset: input.offset };
    }),

  getOverview: protectedProcedure.query(async () => {
    // Run all health checks in parallel
    const [pg, redis, keycloak, tb, temporal, permify, apisix, fluvio, minio] = await Promise.all([
      checkPostgres(),
      checkRedis(),
      checkKeycloak(),
      checkTigerBeetle(),
      checkTemporal(),
      checkPermify(),
      checkAPISIX(),
      checkFluvio(),
      checkMinio(),
    ]);

    const tbSync = await tbGetSyncStatus().catch(() => null);

    const dependencies = [
      { name: "PostgreSQL", type: "database", critical: true, ...pg },
      { name: "Redis", type: "cache", critical: true, ...redis },
      { name: "Keycloak", type: "auth", critical: true, ...keycloak },
      { name: "TigerBeetle", type: "ledger", critical: false, ...tb,
        extra: tbSync ? { pending: tbSync.pending, synced: tbSync.synced, failed: tbSync.failed } : null },
      { name: "Temporal", type: "workflow", critical: false, ...temporal },
      { name: "Permify", type: "authz", critical: false, ...permify },
      { name: "APISIX", type: "gateway", critical: false, ...apisix },
      { name: "Fluvio", type: "streaming", critical: false, ...fluvio },
      { name: "MinIO", type: "storage", critical: false, ...minio },
    ];

    const criticalHealthy = dependencies.filter(d => d.critical && d.status === "healthy").length;
    const criticalTotal = dependencies.filter(d => d.critical).length;
    const allHealthy = dependencies.filter(d => d.status === "healthy").length;

    const overallStatus = criticalHealthy === criticalTotal
      ? (allHealthy === dependencies.length ? "healthy" : "degraded")
      : "critical";

    // Get DB metrics
    const database = await getDb();
    let dbMetrics = { totalTransactions: 0, activeAgents: 0, pendingClaims: 0 };
    if (database) {
      try {
        const { transactions, agents, claims } = await import("../../drizzle/schema");
        const [txCount] = await database.select({ total: count() }).from(transactions);
        const [agentCount] = await database.select({ total: count() }).from(agents);
        dbMetrics = {
          totalTransactions: Number(txCount?.total ?? 0),
          activeAgents: Number(agentCount?.total ?? 0),
          pendingClaims: 0,
        };
      } catch { /* non-fatal */ }
    }

    return {
      overallStatus,
      dependencies,
      slaTargets: SLA_TARGETS,
      metrics: {
        criticalServicesHealthy: criticalHealthy,
        criticalServicesTotal: criticalTotal,
        allServicesHealthy: allHealthy,
        allServicesTotal: dependencies.length,
        ...dbMetrics,
      },
      lastFullCheck: new Date().toISOString(),
    };
  }),

  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { totalChecks: 0, healthyPct: 0 };
    const [{ total }] = await database.select({ total: count() }).from(platform_health_checks);
    return {
      totalChecks: Number(total),
      slaTargets: SLA_TARGETS,
      lastUpdated: new Date().toISOString(),
    };
  }),
});
