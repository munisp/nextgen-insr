/**
 * Sprint 91 — Connectivity Resilience for Rural Africa
 *
 * Server-side counterpart to client offlineResilience.ts:
 * - WebSocket with automatic HTTP long-polling fallback
 * - Adaptive response compression (gzip/brotli based on bandwidth)
 * - Request deduplication for retry storms
 * - Batch endpoint for low-bandwidth sync
 * - Connection quality monitoring
 * - Graceful degradation under load
 */
import type { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { logger } from './_core/logger';

// ─── Request Deduplication ───────────────────────────────────────────────────
interface DedupeEntry {
  hash: string;
  response: any;
  timestamp: number;
}

const dedupeStore = new Map<string, DedupeEntry>();
const DEDUPE_WINDOW_MS = 30_000; // 30 seconds

function computeRequestHash(req: Request): string {
  const payload = JSON.stringify({
    method: req.method,
    path: req.path,
    body: req.body,
    userId: (req as any).userId,
  });
  return createHash("md5").update(payload).digest("hex");
}

export function requestDeduplication(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Only deduplicate POST/PUT mutations
  if (req.method === "GET" || req.method === "OPTIONS") return next();

  const idempotencyKey = req.headers["x-idempotency-key"] as string;
  const hash = idempotencyKey || computeRequestHash(req);
  const now = Date.now();

  const existing = dedupeStore.get(hash);
  if (existing && now - existing.timestamp < DEDUPE_WINDOW_MS) {
    logger.info(
      `[Dedupe] Returning cached response for ${req.method} ${req.path}`
    );
    return res.status(200).json(existing.response);
  }

  // Monkey-patch res.json to capture response
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    dedupeStore.set(hash, { hash, response: body, timestamp: now });
    return originalJson(body);
  };

  next();
}

// Cleanup stale entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of dedupeStore) {
    if (now - entry.timestamp > DEDUPE_WINDOW_MS * 2) dedupeStore.delete(key);
  }
}, 60_000);

// ─── Adaptive Compression ────────────────────────────────────────────────────
export function adaptiveCompression(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const acceptEncoding = req.headers["accept-encoding"] ?? "";
  const networkQuality = req.headers["x-network-quality"] as string; // Client sends this

  // For 2G/3G, always compress aggressively
  if (networkQuality === "2g" || networkQuality === "3g") {
    res.setHeader("X-Compression-Strategy", "aggressive");
    // Express compression middleware will handle actual encoding
  }

  // Set cache headers for low-bandwidth clients
  if (networkQuality === "2g" || networkQuality === "3g") {
    if (req.method === "GET") {
      res.setHeader("Cache-Control", "public, max-age=300"); // 5 min cache for slow networks
    }
  }

  next();
}

// ─── Batch Sync Endpoint ─────────────────────────────────────────────────────
export interface BatchOperation {
  id: string;
  type: string;
  method: "create" | "update" | "delete";
  resource: string;
  payload: any;
  timestamp: number;
}

export interface BatchResult {
  id: string;
  success: boolean;
  result?: any;
  error?: string;
}

/**
 * Process a batch of operations in a single request.
 * Designed for low-bandwidth environments where multiple round-trips are expensive.
 */
export function createBatchSyncHandler(
  handlers: Map<string, (op: BatchOperation) => Promise<any>>
) {
  return async (req: Request, res: Response) => {
    const operations: BatchOperation[] = req.body?.operations;

    if (!Array.isArray(operations) || operations.length === 0) {
      return res.status(400).json({ error: "No operations provided" });
    }

    if (operations.length > 100) {
      return res
        .status(400)
        .json({ error: "Maximum 100 operations per batch" });
    }

    const results: BatchResult[] = [];

    for (const op of operations) {
      const handler = handlers.get(op.type);
      if (!handler) {
        results.push({
          id: op.id,
          success: false,
          error: `Unknown operation type: ${op.type}`,
        });
        continue;
      }

      try {
        const result = await handler(op);
        results.push({ id: op.id, success: true, result });
      } catch (err: any) {
        results.push({ id: op.id, success: false, error: err.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
      total: operations.length,
      succeeded: successCount,
      failed: operations.length - successCount,
      results,
    });
  };
}

// ─── Connection Quality Monitor ──────────────────────────────────────────────
interface ConnectionMetrics {
  ip: string;
  avgLatencyMs: number;
  samples: number[];
  lastSeen: number;
  quality: "good" | "fair" | "poor" | "critical";
}

const connectionMetrics = new Map<string, ConnectionMetrics>();

export function trackConnectionQuality(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const requestStart = Date.now();

  // Capture response time
  res.on("finish", () => {
    const latency = Date.now() - requestStart;
    let metrics = connectionMetrics.get(ip);

    if (!metrics) {
      metrics = {
        ip,
        avgLatencyMs: latency,
        samples: [],
        lastSeen: Date.now(),
        quality: "good",
      };
      connectionMetrics.set(ip, metrics);
    }

    metrics.samples.push(latency);
    if (metrics.samples.length > 20) metrics.samples.shift();
    metrics.avgLatencyMs =
      metrics.samples.reduce((a, b) => a + b, 0) / metrics.samples.length;
    metrics.lastSeen = Date.now();

    // Classify quality
    if (metrics.avgLatencyMs < 200) metrics.quality = "good";
    else if (metrics.avgLatencyMs < 1000) metrics.quality = "fair";
    else if (metrics.avgLatencyMs < 5000) metrics.quality = "poor";
    else metrics.quality = "critical";
  });

  next();
}

export function getConnectionMetrics(): ConnectionMetrics[] {
  return Array.from(connectionMetrics.values());
}

// ─── Graceful Degradation ────────────────────────────────────────────────────
let currentLoad = 0;
const MAX_LOAD = 1000; // concurrent requests

export function loadShedding(req: Request, res: Response, next: NextFunction) {
  currentLoad++;

  res.on("finish", () => {
    currentLoad--;
  });
  res.on("close", () => {
    currentLoad--;
  });

  // Shed non-critical requests under heavy load
  if (currentLoad > MAX_LOAD * 0.9) {
    // Only allow critical paths
    const criticalPaths = [
      "/api/trpc/auth",
      "/api/trpc/transaction",
      "/api/stripe/webhook",
      "/health",
    ];
    const isCritical = criticalPaths.some(p => req.path.startsWith(p));

    if (!isCritical) {
      currentLoad--;
      return res.status(503).json({
        error: "Service temporarily overloaded",
        retryAfter: 5,
        message: "Non-critical requests are being shed. Please retry shortly.",
      });
    }
  }

  next();
}

export function getCurrentLoad(): {
  current: number;
  max: number;
  percentage: number;
} {
  return {
    current: currentLoad,
    max: MAX_LOAD,
    percentage: Math.round((currentLoad / MAX_LOAD) * 100),
  };
}

// ─── WebSocket Fallback Manager ──────────────────────────────────────────────
export interface WebSocketConfig {
  heartbeatInterval: number;
  reconnectDelay: number;
  maxReconnectAttempts: number;
  fallbackToPolling: boolean;
  pollingInterval: number;
}

export const DEFAULT_WS_CONFIG: WebSocketConfig = {
  heartbeatInterval: 30_000,
  reconnectDelay: 5_000,
  maxReconnectAttempts: 10,
  fallbackToPolling: true,
  pollingInterval: 5_000,
};

export function getAdaptiveWSConfig(quality: string): WebSocketConfig {
  switch (quality) {
    case "2g":
      return {
        heartbeatInterval: 60_000,
        reconnectDelay: 15_000,
        maxReconnectAttempts: 20,
        fallbackToPolling: true,
        pollingInterval: 30_000,
      };
    case "3g":
      return {
        heartbeatInterval: 45_000,
        reconnectDelay: 10_000,
        maxReconnectAttempts: 15,
        fallbackToPolling: true,
        pollingInterval: 15_000,
      };
    default:
      return DEFAULT_WS_CONFIG;
  }
}
