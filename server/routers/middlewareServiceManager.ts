// @ts-check
/**
 * middlewareServiceManager.ts — Middleware Service Manager Router (F-12)
 *
 * Reports and manages the REAL middleware service registry owned by
 * server/middleware/serviceOrchestrator.ts (13 registered platform services).
 * No fabricated status: connection state comes from the registry's own
 * heartbeat/status fields, and testConnection performs a real HTTP probe of
 * the service's registered health endpoint (fail-closed: unreachable =>
 * connected:false, never a fabricated "healthy").
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  publicProcedure as openProcedure,
  protectedProcedure,
  router,
} from "../_core/trpc";
import {
  getRegisteredServices,
  registerService,
  type ServiceRegistration,
} from "../middleware/serviceOrchestrator";

/** Real health probe of a registered service's health endpoint. */
async function probeServiceHealth(
  svc: ServiceRegistration,
  timeoutMs = 2500
): Promise<{ reachable: boolean; latencyMs: number; httpStatus?: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `http://${svc.host}:${svc.port}${svc.healthEndpoint}`,
      { signal: controller.signal }
    );
    return {
      reachable: res.ok,
      latencyMs: Date.now() - started,
      httpStatus: res.status,
    };
  } catch {
    return { reachable: false, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function toServiceView(svc: ServiceRegistration, index: number) {
  return {
    id: index + 1,
    serviceId: svc.name,
    name: svc.name,
    version: svc.version,
    host: svc.host,
    port: svc.port,
    healthEndpoint: svc.healthEndpoint,
    capabilities: svc.capabilities,
    status: svc.status,
    connected: svc.status === "active",
    registeredAt: new Date(svc.registeredAt).toISOString(),
    lastHeartbeat: new Date(svc.lastHeartbeat).toISOString(),
  };
}

export const middlewareServiceManagerRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().default(20),
          offset: z.number().default(0),
        })
        .default({ limit: 20, offset: 0 })
    )
    .query(async ({ input }) => {
      const services = getRegisteredServices().map(toServiceView);
      return {
        items: services.slice(input.offset, input.offset + input.limit),
        total: services.length,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const services = getRegisteredServices();
      const svc = services[input.id - 1];
      if (!svc) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Middleware service with id ${input.id} not found`,
        });
      }
      return toServiceView(svc, input.id - 1);
    }),

  getStats: openProcedure.query(async () => {
    const services = getRegisteredServices();
    const connected = services.filter(s => s.status === "active").length;
    const degraded = services.filter(s => s.status === "degraded").length;
    const disconnected = services.filter(s => s.status === "offline").length;
    return {
      total: services.length,
      connected,
      degraded,
      disconnected,
      totalServices: services.length,
      healthy: connected,
      down: disconnected,
      services: services.map(toServiceView),
    };
  }),

  testConnection: protectedProcedure
    .input(z.object({ serviceId: z.string() }))
    .mutation(async ({ input }) => {
      const svc = getRegisteredServices().find(s => s.name === input.serviceId);
      if (!svc) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Middleware service '${input.serviceId}' not found in registry`,
        });
      }
      const probe = await probeServiceHealth(svc);
      return {
        serviceId: svc.name,
        connected: probe.reachable,
        latencyMs: probe.latencyMs,
        httpStatus: probe.httpStatus ?? null,
        checkedAt: new Date().toISOString(),
      };
    }),

  updateUrl: protectedProcedure
    .input(z.object({ serviceId: z.string(), url: z.string().url() }))
    .mutation(async ({ input }) => {
      const svc = getRegisteredServices().find(s => s.name === input.serviceId);
      if (!svc) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Middleware service '${input.serviceId}' not found in registry`,
        });
      }
      const parsed = new URL(input.url);
      const port = parsed.port
        ? Number(parsed.port)
        : parsed.protocol === "https:"
          ? 443
          : 80;
      registerService({
        name: svc.name,
        version: svc.version,
        host: parsed.hostname,
        port,
        healthEndpoint: svc.healthEndpoint,
        capabilities: svc.capabilities,
      });
      return {
        success: true,
        serviceId: svc.name,
        host: parsed.hostname,
        port,
      };
    }),
});
