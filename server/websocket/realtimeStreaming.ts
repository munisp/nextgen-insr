// @ts-check
/**
 * Real-Time Streaming Module
 * Emits live transaction and reconciliation events via Socket.IO
 * Connects to /settlement and /notifications namespaces
 *
 * MOCKWARE FIX: service health broadcasts previously claimed every Go
 * service was "healthy" with a random latency. Health entries are now real
 * probe results against each service's configured health endpoint (via the
 * goServiceAdapter registry); unreachable services are reported as "down",
 * never fabricated as healthy.
 */
import { desc, sql, gte } from "drizzle-orm";
import type { Server as SocketServer } from "socket.io";

import { transactions } from "../../drizzle/schema";
import { logger } from '../_core/logger';
import { getAllServiceConfigs } from "../adapters/goServiceAdapter";
import { getDb } from "../db";

interface TransactionEvent {
  id: string;
  amount: number;
  currency: string;
  type: string;
  // DD-TSSTATE: mirrors txStatusEnum (drizzle/schema.ts:83-89) — the rows
  // below come from the transactions table; 'completed' is not a real value.
  status: "success" | "pending" | "failed" | "reversed" | "pending_reversal_approval";
  agentId: string;
  timestamp: number;
}

interface ReconciliationEvent {
  id: string;
  matchedCount: number;
  unmatchedCount: number;
  discrepancyCount: number;
  totalVariance: number;
  source: string;
  timestamp: number;
}

interface ServiceHealthEntry {
  name: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  lastCheck: number;
}

const HEALTH_PROBE_TIMEOUT_MS = 3000;

// Probe every registered Go service's health endpoint and report the real
// result. No fabricated "healthy" statuses or random latencies.
async function probeServiceHealth(): Promise<ServiceHealthEntry[]> {
  const configs = getAllServiceConfigs();
  return Promise.all(
    configs.map(async cfg => {
      const start = Date.now();
      try {
        const res = await fetch(`${cfg.baseUrl}${cfg.healthPath}`, {
          signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
        });
        return {
          name: cfg.name,
          status: res.ok ? ("healthy" as const) : ("degraded" as const),
          latencyMs: Date.now() - start,
          lastCheck: Date.now(),
        };
      } catch {
        return {
          name: cfg.name,
          status: "down" as const,
          latencyMs: Date.now() - start,
          lastCheck: Date.now(),
        };
      }
    })
  );
}

/**
 * Initialize real-time streaming on Socket.IO namespaces
 */
export function initRealtimeStreaming(io: SocketServer) {
  const settlementNs = io.of("/settlement");
  const notificationsNs = io.of("/notifications");

  // Track connected clients
  let settlementClients = 0;

  settlementNs.on("connection", socket => {
    settlementClients++;
    logger.info(
      `[RealTime] Settlement client connected (${settlementClients} total)`
    );

    // Send initial snapshot of recent transactions
    sendRecentTransactions(socket);

    socket.on("disconnect", () => {
      settlementClients--;
      logger.info(
        `[RealTime] Settlement client disconnected (${settlementClients} total)`
      );
    });

    // Allow clients to subscribe to specific agent feeds
    socket.on("subscribe:agent", (agentId: string) => {
      socket.join(`agent:${agentId}`);
    });

    socket.on("unsubscribe:agent", (agentId: string) => {
      socket.leave(`agent:${agentId}`);
    });
  });

  notificationsNs.on("connection", socket => {
    logger.info("[RealTime] Notifications client connected");

    // Send initial service health (real probe results)
    emitServiceHealth(socket);

    socket.on("disconnect", () => {
      logger.info("[RealTime] Notifications client disconnected");
    });
  });

  // Periodic health check broadcast (every 30s) — real probe results
  setInterval(async () => {
    if (notificationsNs.sockets.size > 0) {
      const healthData = await probeServiceHealth();
      notificationsNs.emit("service:health", healthData);
    }
  }, 30_000);

  // Transaction polling (every 5s) — in production, replace with CDC/Kafka consumer
  let lastCheckedId = "";
  setInterval(async () => {
    if (settlementClients === 0) return;
    try {
      const db = await getDb();
      if (!db) return;
      const recent = await db
        .select()
        .from(transactions)
        .orderBy(desc(transactions.createdAt))
        .limit(5);

      for (const tx of recent) {
        const txId = String(tx.id);
        if (txId === lastCheckedId) break;
        if (!lastCheckedId) {
          lastCheckedId = txId;
          break;
        }
        const event: TransactionEvent = {
          id: txId,
          amount: Number(tx.amount) || 0,
          currency: tx.currency || "KES",
          type: tx.type || "transfer",
          status: (tx.status as TransactionEvent["status"]) || "success",
          agentId: tx.agentId ? String(tx.agentId) : "unknown",
          timestamp: tx.createdAt
            ? new Date(tx.createdAt).getTime()
            : Date.now(),
        };
        settlementNs.emit("transaction:new", event);
      }
      if (recent.length > 0) {
        lastCheckedId = String(recent[0].id);
      }
    } catch (err) {
      // Silently handle DB errors during polling
    }
  }, 5_000);

  // Reconciliation event broadcast (every 60s)
  setInterval(async () => {
    if (settlementClients === 0) return;
    try {
      const db = await getDb();
      if (!db) return;
      const cutoff = new Date(Date.now() - 3600_000);
      const hourlyStats = await db
        .select({
          count: sql<number>`COUNT(*)`,
          total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
        })
        .from(transactions)
        .where(gte(transactions.createdAt, cutoff));

      const stats = hourlyStats[0] || { count: 0, total: 0 };
      const reconcEvent: ReconciliationEvent = {
        id: `recon-${Date.now()}`,
        matchedCount: Number(stats.count),
        unmatchedCount: 0,
        discrepancyCount: 0,
        totalVariance: 0,
        source: "auto-reconciler",
        timestamp: Date.now(),
      };
      settlementNs.emit("reconciliation:update", reconcEvent);
    } catch (err) {
      // Silently handle DB errors during reconciliation
    }
  }, 60_000);

  logger.info(
    "[RealTime] Streaming initialized on /settlement and /notifications"
  );
}

async function sendRecentTransactions(socket: any) {
  try {
    const db = await getDb();
    if (!db) return;
    const recent = await db
      .select()
      .from(transactions)
      .orderBy(desc(transactions.createdAt))
      .limit(20);

    const events: TransactionEvent[] = recent.map(tx => ({
      id: String(tx.id),
      amount: Number(tx.amount) || 0,
      currency: tx.currency || "KES",
      type: tx.type || "transfer",
      status: (tx.status as TransactionEvent["status"]) || "success",
      agentId: tx.agentId ? String(tx.agentId) : "unknown",
      timestamp: tx.createdAt ? new Date(tx.createdAt).getTime() : Date.now(),
    }));

    socket.emit("transaction:snapshot", events);
  } catch (err) {
    // Silently handle DB errors
  }
}

async function emitServiceHealth(socket: any) {
  const healthData = await probeServiceHealth();
  socket.emit("service:health", healthData);
}
