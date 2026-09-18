// TypeScript enabled — Sprint 96 security audit
import type { Server } from "http";

import { logger } from '../_core/logger';

let isShuttingDown = false;

/** Consistent drain timeout for the unified shutdown path (OPS-10). */
export const SHUTDOWN_TIMEOUT_MS = 30_000;

// OPS-10: process-wide marker so auxiliary shutdown registrars
// (highAvailability.ts, middleware/index.ts) do NOT attach competing
// SIGTERM/SIGINT handlers when the unified path is active.
const GLOBAL_FLAG = "__insureportalUnifiedShutdownActive";
(globalThis as any)[GLOBAL_FLAG] = true;

export function isUnifiedShutdownActive(): boolean {
  return Boolean((globalThis as any)[GLOBAL_FLAG]);
}

export function isServerShuttingDown(): boolean {
  return isShuttingDown;
}

/**
 * THE single graceful-shutdown path for the server process (OPS-10).
 *
 * Previously TWO competing SIGTERM handlers existed (this module with a 10s
 * force-exit + immediate process.exit, and a second one in _core/index.ts
 * with 30s) — one path could kill the process before the other finished
 * draining. There is now exactly one handler set:
 *
 *   1. stop background workers (archival cron)
 *   2. server.close() — stop accepting, drain in-flight HTTP
 *   3. inside the close callback: flush DDoS telemetry, close DB pool,
 *      Redis, Kafka producer — THEN process.exit(0)
 *   4. single 30s force-exit backstop (exit code 1) if drain stalls
 */
export function setupGracefulShutdown(server: Server) {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    const startedAt = Date.now();
    logger.info(
      `[Shutdown] ${signal} received — starting graceful shutdown (timeout ${SHUTDOWN_TIMEOUT_MS}ms)...`
    );

    // Single force-exit backstop, armed once.
    setTimeout(() => {
      logger.error(
        `[Shutdown] Forced exit after ${Date.now() - startedAt}ms (drain timeout ${SHUTDOWN_TIMEOUT_MS}ms)`
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    // 1. Stop background workers
    try {
      const { stopArchivalCronWorker } = await import("./archivalCronWorker");
      stopArchivalCronWorker();
    } catch {
      /* archival cron may not be running */
    }

    // 2. Drain HTTP; cleanup runs ONLY after in-flight requests complete.
    server.close(async () => {
      logger.info("[Shutdown] HTTP server closed (in-flight drained)");

      // 3a. Flush DDoS telemetry windows (best-effort)
      try {
        const { flushDdosTelemetry } = await import("./ddosTelemetry");
        flushDdosTelemetry();
      } catch {
        /* telemetry flush is best-effort */
      }

      // 3b. Close database connection pool
      try {
        const { getPool } = await import("../db");
        const pool = await getPool();
        if (pool) {
          await pool.end();
          logger.info("[Shutdown] Database pool closed");
        }
      } catch (e) {
        logger.error("[Shutdown] DB close error:: " + (e as Error).message);
      }

      // 3c. Close Redis
      try {
        const redisModule = await import("../redisClient").catch(() => null);
        if (redisModule && "closeRedis" in redisModule) {
          await (redisModule as any).closeRedis?.();
          logger.info("[Shutdown] Redis connection closed");
        }
      } catch {
        /* Redis may not be available */
      }

      // 3d. Close Kafka producer
      try {
        const kafkaModule = await import("../kafka-event-consumer").catch(
          () => null
        );
        if (kafkaModule && "closeKafka" in kafkaModule) {
          await (kafkaModule as any).closeKafka?.();
          logger.info("[Shutdown] Kafka producer closed");
        }
      } catch {
        /* Kafka may not be available */
      }

      logger.info(
        `[Shutdown] Graceful shutdown complete in ${Date.now() - startedAt}ms`
      );
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Health check middleware — reject new requests during shutdown
  return (req: any, res: any, next: any) => {
    if (isShuttingDown) {
      res.status(503).json({ error: "Server is shutting down", retryAfter: 5 });
      return;
    }
    next();
  };
}
