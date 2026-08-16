// @ts-check
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { router, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";

export const healthCheckRouter = router({
  status: publicProcedure.query(async () => {
    const checks: Record<
      string,
      { status: string; latencyMs?: number; error?: string }
    > = {};

    // Database check
    const dbStart = Date.now();
    try {
      const db = await getDb();
      if (db) {
        // @ts-expect-error auto-fix
        await db.execute({ sql: "SELECT 1" });
        checks.database = {
          status: "healthy",
          latencyMs: Date.now() - dbStart,
        };
      } else {
        checks.database = { status: "unavailable", error: "No DB connection" };
      }
    } catch (e) {
      checks.database = {
        status: "unhealthy",
        latencyMs: Date.now() - dbStart,
        error: (e as Error).message,
      };
    }

    // Redis check
    try {
      // @ts-expect-error auto-fix
      const { cacheGet } = await import("../../redisClient");
      const redisStart = Date.now();
      await cacheGet("health_check_ping");
      checks.redis = { status: "healthy", latencyMs: Date.now() - redisStart };
    } catch (e) {
      checks.redis = { status: "unavailable", error: (e as Error).message };
    }

    // Kafka check
    try {
      const kafkaStart = Date.now();
      // @ts-expect-error auto-fix
      const { getKafkaStatus } = await import("../../kafkaClient");
      const kafkaUp = (await getKafkaStatus?.()) ?? false;
      checks.kafka = kafkaUp
        ? { status: "healthy", latencyMs: Date.now() - kafkaStart }
        : { status: "unavailable" };
    } catch {
      checks.kafka = { status: "unavailable" };
    }

    // TigerBeetle sidecar check
    try {
      const tbStart = Date.now();
      const resp = await fetch(`${process.env.TIGERBEETLE_HEALTH_URL ?? "http://localhost:9090"}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      checks.tigerBeetle = resp.ok
        ? { status: "healthy", latencyMs: Date.now() - tbStart }
        : { status: "unhealthy", error: `HTTP ${resp.status}` };
    } catch {
      checks.tigerBeetle = { status: "unavailable" };
    }

    // Go microservice health checks
    const goServices = [
      { name: "api-gateway", port: 8080 },
      { name: "kyb-engine", port: 8130 },
      { name: "auth-service", port: 8081 },
      { name: "config-service", port: 8082 },
      { name: "health-service", port: 8083 },
      { name: "logging-service", port: 8084 },
      { name: "metrics-service", port: 8085 },
    ];
    for (const svc of goServices) {
      try {
        const start = Date.now();
        const resp = await fetch(`http://localhost:${svc.port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        checks[`go:${svc.name}`] = resp.ok
          ? { status: "healthy", latencyMs: Date.now() - start }
          : { status: "unhealthy", error: `HTTP ${resp.status}` };
      } catch {
        checks[`go:${svc.name}`] = { status: "unavailable" };
      }
    }

    // Python microservice health checks
    const pyServices = [
      { name: "deepface", port: 8133 },
      { name: "paddleocr", port: 8134 },
      { name: "risk-scoring", port: 8140 },
      { name: "fraud-ml", port: 8141 },
    ];
    for (const svc of pyServices) {
      try {
        const start = Date.now();
        const resp = await fetch(`http://localhost:${svc.port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        checks[`py:${svc.name}`] = resp.ok
          ? { status: "healthy", latencyMs: Date.now() - start }
          : { status: "unhealthy", error: `HTTP ${resp.status}` };
      } catch {
        checks[`py:${svc.name}`] = { status: "unavailable" };
      }
    }

    // Rust microservice health checks
    const rustServices = [
      { name: "fluvio-producer", port: 8150 },
      { name: "offline-queue", port: 8151 },
    ];
    for (const svc of rustServices) {
      try {
        const start = Date.now();
        const resp = await fetch(`http://localhost:${svc.port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        checks[`rust:${svc.name}`] = resp.ok
          ? { status: "healthy", latencyMs: Date.now() - start }
          : { status: "unhealthy", error: `HTTP ${resp.status}` };
      } catch {
        checks[`rust:${svc.name}`] = { status: "unavailable" };
      }
    }

    const overallHealthy = checks.database?.status === "healthy";
    const healthyCount = Object.values(checks as any).filter(
      // @ts-expect-error middleware type mismatch
      c => c.status === "healthy"
    ).length;
    const totalCount = Object.keys(checks).length;
    return {
      status: overallHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version ?? "1.0.0",
      healthyServices: healthyCount,
      totalServices: totalCount,
      services: checks,
    };
  }),

  microservices: publicProcedure.query(async () => {
    const services: Array<{
      name: string;
      type: string;
      port: number;
      status: string;
      latencyMs?: number;
    }> = [];
    const allServices = [
      { name: "api-gateway", type: "go", port: 8080 },
      { name: "kyb-engine", type: "go", port: 8130 },
      { name: "auth-service", type: "go", port: 8081 },
      { name: "deepface", type: "python", port: 8133 },
      { name: "paddleocr", type: "python", port: 8134 },
      { name: "risk-scoring", type: "python", port: 8140 },
      { name: "fluvio-producer", type: "rust", port: 8150 },
      { name: "offline-queue", type: "rust", port: 8151 },
    ];
    for (const svc of allServices) {
      try {
        const start = Date.now();
        const resp = await fetch(`http://localhost:${svc.port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        services.push({
          ...svc,
          status: resp.ok ? "healthy" : "unhealthy",
          latencyMs: Date.now() - start,
        });
      } catch {
        services.push({ ...svc, status: "unavailable" });
      }
    }
    return { services, timestamp: new Date().toISOString() };
  }),
});
