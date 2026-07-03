// TypeScript enabled — Sprint 96 security audit
import { Server } from "http";
import { Server } from "http";
import { logger } from './_core/logger';

let isShuttingDown = false;

export function isServerShuttingDown(): boolean {
  return isShuttingDown;
}

export function setupGracefulShutdown(server: Server) {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(
      `[Shutdown] ${signal} received — starting graceful shutdown...`
    );

    // 1. Stop accepting new connections
    server.close(() => {
      logger.info("[Shutdown] HTTP server closed");
    });

    // 2. Close database connections
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (db && (db as any).end) {
        await (db as any).end();
        logger.info("[Shutdown] Database connections closed");
      }
    } catch (e) {
      logger.error("[Shutdown] DB close error:", (e as Error).message);
    }

    // 3. Close Redis
    try {
      const redisModule = await import("../redisClient").catch(() => null);
      if (redisModule && "closeRedis" in redisModule) {
        await (redisModule as any).closeRedis?.();
        logger.info("[Shutdown] Redis connection closed");
      }
    } catch {
      /* Redis may not be available */
    }

    // 4. Close Kafka producer
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

    // 5. Force exit after 10s if graceful shutdown stalls
    setTimeout(() => {
      logger.error("[Shutdown] Forced exit after 10s timeout");
      process.exit(1);
    }, 10000).unref();

    logger.info("[Shutdown] Graceful shutdown complete");
    process.exit(0);
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
