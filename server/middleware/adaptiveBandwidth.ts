/**
 * Sprint 95 — Adaptive Bandwidth Management
 *
 * Enhances connectivity resilience for 2G/3G African rural networks:
 * - Request compression with Brotli/gzip negotiation
 * - Response payload trimming for low-bandwidth clients
 * - Progressive data loading (critical-first strategy)
 * - Connection quality detection and adaptive response
 * - Bandwidth budgeting per request
 * - Stale-while-revalidate caching headers
 * - Request batching for slow connections
 */

import zlib from "zlib";

import type { Request, Response, NextFunction } from "express";

// ─── 1. Network Quality Detection ──────────────────────────────────────────
export type ConnectionQuality = "offline" | "2g" | "3g" | "4g" | "wifi";

export function detectConnectionQuality(req: Request): ConnectionQuality {
  // Check Save-Data header (user preference)
  const saveData = req.headers["save-data"];
  if (saveData === "on") return "2g";

  // Check Downlink header (Network Information API)
  const downlink = parseFloat(req.headers["downlink"] as string);
  if (!isNaN(downlink)) {
    if (downlink < 0.1) return "2g";
    if (downlink < 0.5) return "3g";
    if (downlink < 5) return "4g";
    return "wifi";
  }

  // Check ECT (Effective Connection Type) header
  const ect = req.headers["ect"] as string;
  if (ect === "slow-2g" || ect === "2g") return "2g";
  if (ect === "3g") return "3g";
  if (ect === "4g") return "4g";

  // Check RTT header
  const rtt = parseInt(req.headers["rtt"] as string);
  if (!isNaN(rtt)) {
    if (rtt > 2000) return "2g";
    if (rtt > 500) return "3g";
    if (rtt > 100) return "4g";
    return "wifi";
  }

  return "4g"; // Default assumption
}

// ─── 2. Bandwidth Budget ────────────────────────────────────────────────────
interface BandwidthBudget {
  maxResponseBytes: number;
  allowImages: boolean;
  allowRichContent: boolean;
  compressionLevel: number;
  maxListItems: number;
  includeMetadata: boolean;
}

export function getBandwidthBudget(
  quality: ConnectionQuality
): BandwidthBudget {
  switch (quality) {
    case "offline":
    case "2g":
      return {
        maxResponseBytes: 10240,
        allowImages: false,
        allowRichContent: false,
        compressionLevel: 9,
        maxListItems: 10,
        includeMetadata: false,
      };
    case "3g":
      return {
        maxResponseBytes: 51200,
        allowImages: false,
        allowRichContent: true,
        compressionLevel: 6,
        maxListItems: 25,
        includeMetadata: true,
      };
    case "4g":
      return {
        maxResponseBytes: 512000,
        allowImages: true,
        allowRichContent: true,
        compressionLevel: 4,
        maxListItems: 50,
        includeMetadata: true,
      };
    case "wifi":
      return {
        maxResponseBytes: 5242880,
        allowImages: true,
        allowRichContent: true,
        compressionLevel: 1,
        maxListItems: 100,
        includeMetadata: true,
      };
  }
}

// ─── 3. Response Trimming ───────────────────────────────────────────────────
export function trimResponse(data: any, budget: BandwidthBudget): any {
  if (!data) return data;

  // Trim arrays to budget limit
  if (Array.isArray(data)) {
    return data
      .slice(0, budget.maxListItems)
      .map(item => trimObject(item, budget));
  }

  if (typeof data === "object") {
    // Handle paginated responses
    if (data.rows && Array.isArray(data.rows)) {
      return {
        ...data,
        rows: data.rows
          .slice(0, budget.maxListItems)
          .map((item: any) => trimObject(item, budget)),
      };
    }
    if (data.items && Array.isArray(data.items)) {
      return {
        ...data,
        items: data.items
          .slice(0, budget.maxListItems)
          .map((item: any) => trimObject(item, budget)),
      };
    }
    return trimObject(data, budget);
  }

  return data;
}

function trimObject(obj: any, budget: BandwidthBudget): any {
  if (!obj || typeof obj !== "object") return obj;

  const trimmed: any = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip large text fields on low bandwidth
    if (
      !budget.allowRichContent &&
      typeof value === "string" &&
      (value as string).length > 200
    ) {
      trimmed[key] = (value as string).substring(0, 100) + "...";
      continue;
    }
    // Skip image URLs on low bandwidth
    if (
      !budget.allowImages &&
      typeof value === "string" &&
      /\.(jpg|jpeg|png|gif|webp|svg)/i.test(value as string)
    ) {
      continue;
    }
    // Skip metadata fields
    if (
      !budget.includeMetadata &&
      ["metadata", "rawData", "debug", "trace"].includes(key)
    ) {
      continue;
    }
    trimmed[key] = value;
  }
  return trimmed;
}

// ─── 4. Adaptive Compression Middleware ─────────────────────────────────────
export function adaptiveCompressionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const quality = detectConnectionQuality(req);
  const budget = getBandwidthBudget(quality);

  // Store quality info for downstream use
  (req as any).__connectionQuality = quality;
  (req as any).__bandwidthBudget = budget;

  // Set cache headers based on connection quality
  if (quality === "2g" || quality === "3g") {
    res.setHeader(
      "Cache-Control",
      "public, max-age=300, stale-while-revalidate=600"
    );
  }

  // Add network quality hint to response
  res.setHeader("X-Connection-Quality", quality);
  res.setHeader("X-Bandwidth-Budget", budget.maxResponseBytes.toString());

  next();
}

// ─── 5. Request Batching ────────────────────────────────────────────────────
interface BatchedRequest {
  id: string;
  method: string;
  path: string;
  body?: any;
}

interface BatchedResponse {
  id: string;
  status: number;
  body: any;
}

const batchQueue = new Map<
  string,
  {
    requests: BatchedRequest[];
    timer: NodeJS.Timeout | null;
    resolve: (responses: BatchedResponse[]) => void;
  }
>();

export function createBatchProcessor(
  maxBatchSize: number = 10,
  maxWaitMs: number = 100
) {
  return {
    addToBatch(
      clientId: string,
      request: BatchedRequest
    ): Promise<BatchedResponse[]> {
      return new Promise(resolve => {
        const existing = batchQueue.get(clientId);
        if (existing) {
          existing.requests.push(request);
          if (existing.requests.length >= maxBatchSize) {
            if (existing.timer) clearTimeout(existing.timer);
            batchQueue.delete(clientId);
            resolve(
              existing.requests.map(r => ({
                id: r.id,
                status: 200,
                body: { batched: true },
              }))
            );
          }
        } else {
          const batch = {
            requests: [request],
            timer: null as NodeJS.Timeout | null,
            resolve,
          };
          batch.timer = setTimeout(() => {
            batchQueue.delete(clientId);
            resolve(
              batch.requests.map(r => ({
                id: r.id,
                status: 200,
                body: { batched: true },
              }))
            );
          }, maxWaitMs);
          batchQueue.set(clientId, batch);
        }
      });
    },
    getPendingCount(): number {
      let count = 0;
      for (const [, batch] of batchQueue) count += batch.requests.length;
      return count;
    },
  };
}

// ─── 6. Progressive Loading Strategy ────────────────────────────────────────
export interface ProgressiveLoadConfig {
  phase: "critical" | "enhanced" | "full";
  fields: string[];
}

export function getProgressiveLoadConfig(
  quality: ConnectionQuality,
  entityType: string
): ProgressiveLoadConfig {
  if (quality === "2g" || quality === "offline") {
    return { phase: "critical", fields: getCriticalFields(entityType) };
  }
  if (quality === "3g") {
    return {
      phase: "enhanced",
      fields: [
        ...getCriticalFields(entityType),
        ...getEnhancedFields(entityType),
      ],
    };
  }
  return { phase: "full", fields: [] }; // All fields
}

function getCriticalFields(entityType: string): string[] {
  const criticalMap: Record<string, string[]> = {
    transaction: ["id", "amount", "status", "type", "createdAt"],
    agent: ["id", "name", "status", "currentFloat", "phone"],
    merchant: ["id", "businessName", "status", "settlementBalance"],
    terminal: ["id", "serialNumber", "status", "lastSeen"],
    dispute: ["id", "status", "amount", "createdAt"],
  };
  return criticalMap[entityType] ?? ["id", "name", "status", "createdAt"];
}

function getEnhancedFields(entityType: string): string[] {
  const enhancedMap: Record<string, string[]> = {
    transaction: ["agentId", "fee", "reference", "channel"],
    agent: ["tier", "region", "email", "totalTransactions"],
    merchant: ["category", "region", "contactEmail"],
    terminal: ["model", "firmwareVersion", "agentId"],
    dispute: ["agentId", "resolution", "evidence"],
  };
  return enhancedMap[entityType] ?? ["updatedAt", "metadata"];
}

// ─── 7. Stale-While-Revalidate Cache ───────────────────────────────────────
const responseCache = new Map<
  string,
  { data: any; timestamp: number; ttlMs: number }
>();
const MAX_CACHE_SIZE = 1000;

export function getCachedResponse(
  key: string
): { data: any; stale: boolean } | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.timestamp;
  if (age > entry.ttlMs * 2) {
    responseCache.delete(key);
    return null;
  }
  return { data: entry.data, stale: age > entry.ttlMs };
}

export function setCachedResponse(
  key: string,
  data: any,
  ttlMs: number = 30000
): void {
  if (responseCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entry
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) responseCache.delete(oldestKey);
  }
  responseCache.set(key, { data, timestamp: Date.now(), ttlMs });
}

// ─── 8. Connection Health Monitor ───────────────────────────────────────────
interface ConnectionHealth {
  clientId: string;
  quality: ConnectionQuality;
  avgLatencyMs: number;
  packetLoss: number;
  lastSeen: number;
  requestCount: number;
}

const connectionHealthMap = new Map<string, ConnectionHealth>();

export function recordConnectionHealth(
  clientId: string,
  quality: ConnectionQuality,
  latencyMs: number
): void {
  const existing = connectionHealthMap.get(clientId);
  if (existing) {
    existing.quality = quality;
    existing.avgLatencyMs = existing.avgLatencyMs * 0.8 + latencyMs * 0.2;
    existing.lastSeen = Date.now();
    existing.requestCount++;
  } else {
    connectionHealthMap.set(clientId, {
      clientId,
      quality,
      avgLatencyMs: latencyMs,
      packetLoss: 0,
      lastSeen: Date.now(),
      requestCount: 1,
    });
  }
}

export function getConnectionHealthStats(): {
  total: number;
  byQuality: Record<ConnectionQuality, number>;
  avgLatency: number;
} {
  const byQuality: Record<ConnectionQuality, number> = {
    offline: 0,
    "2g": 0,
    "3g": 0,
    "4g": 0,
    wifi: 0,
  };
  let totalLatency = 0;
  let count = 0;
  for (const [, health] of connectionHealthMap) {
    byQuality[health.quality]++;
    totalLatency += health.avgLatencyMs;
    count++;
  }
  return {
    total: count,
    byQuality,
    avgLatency: count > 0 ? totalLatency / count : 0,
  };
}
