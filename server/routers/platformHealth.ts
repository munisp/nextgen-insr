// @ts-check

/**
 * Item 17: Unified Platform Health Monitoring Dashboard
 * Aggregates health checks from all microservices into a single endpoint.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { logger } from "../_core/logger";
import { TRPCError } from "@trpc/server";

interface ServiceHealth {
  name: string;
  url: string;
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  latency?: number;
  version?: string;
  lastChecked: string;
  error?: string;
}

const SERVICE_REGISTRY = [
  {
    name: "kyb-engine",
    url: process.env.KYB_ENGINE_URL ?? "http://localhost:8130",
    path: "/health",
  },
  {
    name: "kyb-risk-engine",
    url: process.env.KYB_RISK_ENGINE_URL ?? "http://localhost:8131",
    path: "/health",
  },
  {
    name: "kyb-analytics",
    url: process.env.KYB_ANALYTICS_URL ?? "http://localhost:8132",
    path: "/health",
  },
  {
    name: "deepface",
    url: process.env.DEEPFACE_URL ?? "http://localhost:8133",
    path: "/health",
  },
  {
    name: "service-auth",
    url: process.env.SERVICE_AUTH_URL ?? "http://localhost:8140",
    path: "/health",
  },
  {
    name: "circuit-breaker",
    url: process.env.CIRCUIT_BREAKER_URL ?? "http://localhost:8141",
    path: "/health",
  },
  {
    name: "sanctions-etl",
    url: process.env.SANCTIONS_ETL_URL ?? "http://localhost:8142",
    path: "/health",
  },
  {
    name: "webhook-delivery",
    url: process.env.WEBHOOK_DELIVERY_URL ?? "http://localhost:8143",
    path: "/health",
  },
  {
    name: "ml-model-registry",
    url: process.env.ML_MODEL_REGISTRY_URL ?? "http://localhost:8144",
    path: "/health",
  },
  {
    name: "data-archival",
    url: process.env.DATA_ARCHIVAL_URL ?? "http://localhost:8145",
    path: "/health",
  },
  {
    name: "backup-manager",
    url: process.env.BACKUP_MANAGER_URL ?? "http://localhost:8146",
    path: "/health",
  },
] as const;

async function checkService(svc: {
  name: string;
  url: string;
  path: string;
}): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${svc.url}${svc.path}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latency = Date.now() - start;
    const body = await res.json().catch(() => ({}));
    return {
      name: svc.name,
      url: svc.url,
      status: res.ok ? "healthy" : "degraded",
      latency,
      version: (body as Record<string, string>).version,
      lastChecked: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name: svc.name,
      url: svc.url,
      status: "unhealthy",
      latency: Date.now() - start,
      lastChecked: new Date().toISOString(),
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export const platformHealthRouter = router({
  overview: protectedProcedure.query(async () => {
    const results = await Promise.allSettled(
      SERVICE_REGISTRY.map(checkService)
    );
    const services = results.map(r =>
      r.status === "fulfilled"
        ? r.value
        : {
            name: "unknown",
            url: "",
            status: "unknown" as const,
            lastChecked: new Date().toISOString(),
          }
    );

    const healthy = services.filter(s => s.status === "healthy").length;
    const degraded = services.filter(s => s.status === "degraded").length;
    const unhealthy = services.filter(s => s.status === "unhealthy").length;

    const overall =
      unhealthy > 0
        ? "degraded"
        : degraded > 0
          ? "partially_healthy"
          : "healthy";

    logger.info(
      { healthCheck: true, overall, healthy, degraded, unhealthy },
      "Platform health check completed"
    );

    return {
      overall,
      timestamp: new Date().toISOString(),
      summary: { total: services.length, healthy, degraded, unhealthy },
      services,
    };
  }),

  checkService: protectedProcedure
    .input(z.object({ serviceName: z.string() }))
    .query(async ({ input }) => {
      try {
        const svc = SERVICE_REGISTRY.find(s => s.name === input.serviceName);
        if (!svc)
          return {
            error: `Service '${input.serviceName}' not found in registry`,
          };
        return checkService(svc);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  serviceRegistry: protectedProcedure.query(() => {
    return SERVICE_REGISTRY.map(s => ({ name: s.name, url: s.url }));
  }),

  dashboard: protectedProcedure.query(async () => {
    return {
      totalRecords: 0,
      activeRecords: 0,
      lastUpdated: new Date().toISOString(),
      uptime: 99.9,
      version: "1.0.0",
    };
  }),

  getStats: protectedProcedure.query(async () => {
    return {
      totalRecords: 0,
      activeRecords: 0,
      lastUpdated: new Date().toISOString(),
      uptime: 99.9,
      version: "1.0.0",
    };
  }),
});
