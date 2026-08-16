// TypeScript enabled — Sprint 96 security audit
import { logger } from '../_core/logger';
import { getDb } from "../db";

interface PoolStats {
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
  maxConnections: number;
  utilizationPercent: number;
}

export async function getPoolStats(): Promise<PoolStats> {
  try {
    const db = await getDb();
    if (!db)
      return {
        totalConnections: 0,
        idleConnections: 0,
        waitingClients: 0,
        maxConnections: 0,
        utilizationPercent: 0,
      };

    const pool = (db as any)?._.client?.pool ?? (db as any)?.$client?.pool;
    if (pool) {
      return {
        totalConnections: pool.totalCount ?? 0,
        idleConnections: pool.idleCount ?? 0,
        waitingClients: pool.waitingCount ?? 0,
        maxConnections: pool.options?.max ?? 10,
        utilizationPercent: pool.totalCount
          ? Math.round(
              ((pool.totalCount - pool.idleCount) / pool.totalCount) * 100
            )
          : 0,
      };
    }
    return {
      totalConnections: 1,
      idleConnections: 0,
      waitingClients: 0,
      maxConnections: 10,
      utilizationPercent: 10,
    };
  } catch {
    return {
      totalConnections: 0,
      idleConnections: 0,
      waitingClients: 0,
      maxConnections: 0,
      utilizationPercent: 0,
    };
  }
}

// Periodic monitoring — log warnings when pool is stressed
let monitorInterval: NodeJS.Timeout | null = null;

export function startPoolMonitor(intervalMs = 60000) {
  if (monitorInterval) return;
  monitorInterval = setInterval(async () => {
    const stats = await getPoolStats();
    if (stats.utilizationPercent > 80) {
      logger.warn("[DBPool] High utilization:: " + JSON.stringify(stats));
    }
    if (stats.waitingClients > 5) {
      logger.error("[DBPool] Connection queue building up:: " + JSON.stringify(stats)
      );
    }
  }, intervalMs);
  monitorInterval.unref();
}
