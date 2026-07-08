// @ts-check

// Adapt response payload size based on detected bandwidth tier
/**
 * connectionAware — Connection-Aware Middleware
 *
 * Adapts server responses based on client network quality.
 * Strips optional fields, compresses responses, and adjusts
 * polling intervals for low-bandwidth clients.
 *
 * Client sends network tier via X-Network-Tier header.
 * Server adapts response accordingly.
 */

import { Request, Response, NextFunction } from "express";

// ── Network Tier Detection ───────────────────────────────────────────────────

export type NetworkTier =
  | "2g_gprs"
  | "2g_edge"
  | "3g"
  | "4g_lte"
  | "5g_wifi"
  | "unknown";

export interface ConnectionInfo {
  tier: NetworkTier;
  effectiveType: string;
  downlink: number;
  rtt: number;
  saveData: boolean;
}

export function detectNetworkTier(req: Request): ConnectionInfo {
  // Client can send network info via headers
  const tier = (req.headers["x-network-tier"] as NetworkTier) || "unknown";
  const effectiveType = (req.headers["x-effective-type"] as string) || "4g";
  const downlink = parseFloat(req.headers["x-downlink"] as string) || 10;
  const rtt = parseInt(req.headers["x-rtt"] as string) || 50;
  const saveData = req.headers["save-data"] === "on";

  // If no explicit tier, infer from effective type
  let detectedTier = tier;
  if (detectedTier === "unknown") {
    switch (effectiveType) {
      case "slow-2g":
        detectedTier = "2g_gprs";
        break;
      case "2g":
        detectedTier = "2g_edge";
        break;
      case "3g":
        detectedTier = "3g";
        break;
      case "4g":
        detectedTier = rtt > 100 ? "3g" : "4g_lte";
        break;
      default:
        detectedTier = downlink > 50 ? "5g_wifi" : "4g_lte";
    }
  }

  return {
    tier: detectedTier,
    effectiveType,
    downlink,
    rtt,
    saveData,
  };
}

// ── Response Adaptation ──────────────────────────────────────────────────────

export interface AdaptationConfig {
  stripNulls: boolean;
  stripMetadata: boolean;
  abbreviateFields: boolean;
  maxListItems: number;
  includeTimestamps: boolean;
  includeAuditTrail: boolean;
  compressionLevel: string;
  maxPayloadBytes: number;
}

const TIER_CONFIGS: Record<NetworkTier, AdaptationConfig> = {
  "2g_gprs": {
    stripNulls: true,
    stripMetadata: true,
    abbreviateFields: true,
    maxListItems: 5,
    includeTimestamps: false,
    includeAuditTrail: false,
    compressionLevel: "max",
    maxPayloadBytes: 1024,
  },
  "2g_edge": {
    stripNulls: true,
    stripMetadata: true,
    abbreviateFields: false,
    maxListItems: 10,
    includeTimestamps: true,
    includeAuditTrail: false,
    compressionLevel: "high",
    maxPayloadBytes: 4096,
  },
  "3g": {
    stripNulls: true,
    stripMetadata: false,
    abbreviateFields: false,
    maxListItems: 25,
    includeTimestamps: true,
    includeAuditTrail: false,
    compressionLevel: "medium",
    maxPayloadBytes: 16384,
  },
  "4g_lte": {
    stripNulls: false,
    stripMetadata: false,
    abbreviateFields: false,
    maxListItems: 50,
    includeTimestamps: true,
    includeAuditTrail: true,
    compressionLevel: "light",
    maxPayloadBytes: 65536,
  },
  "5g_wifi": {
    stripNulls: false,
    stripMetadata: false,
    abbreviateFields: false,
    maxListItems: 100,
    includeTimestamps: true,
    includeAuditTrail: true,
    compressionLevel: "none",
    maxPayloadBytes: 1048576,
  },
  unknown: {
    stripNulls: false,
    stripMetadata: false,
    abbreviateFields: false,
    maxListItems: 50,
    includeTimestamps: true,
    includeAuditTrail: true,
    compressionLevel: "light",
    maxPayloadBytes: 65536,
  },
};

// ── Field Abbreviation Map ───────────────────────────────────────────────────

const FIELD_ABBREVIATIONS: Record<string, string> = {
  transactionId: "tid",
  transactionType: "tt",
  amount: "a",
  currency: "c",
  agentId: "ag",
  customerId: "ci",
  customerPhone: "cp",
  timestamp: "ts",
  status: "s",
  description: "d",
  reference: "r",
  commission: "cm",
  balance: "b",
  firstName: "fn",
  lastName: "ln",
  phoneNumber: "pn",
  email: "e",
  createdAt: "ca",
  updatedAt: "ua",
};

const METADATA_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "deletedAt",
  "__v",
  "_rev",
  "metadata",
  "auditTrail",
  "version",
  "lastModifiedBy",
]);

// ── Adaptation Functions ─────────────────────────────────────────────────────

export function adaptResponse(
  data: unknown,
  config: AdaptationConfig
): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;

  if (Array.isArray(data)) {
    const limited = data.slice(0, config.maxListItems);
    return limited.map(item => adaptResponse(item, config));
  }

  const obj = data as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Strip nulls
    if (config.stripNulls && (value === null || value === undefined)) continue;

    // Strip metadata
    if (config.stripMetadata && METADATA_FIELDS.has(key)) continue;

    // Strip timestamps if not needed
    if (
      !config.includeTimestamps &&
      (key === "createdAt" || key === "updatedAt")
    )
      continue;

    // Strip audit trail
    if (!config.includeAuditTrail && key === "auditTrail") continue;

    // Abbreviate field names
    const outputKey = config.abbreviateFields
      ? FIELD_ABBREVIATIONS[key] || key
      : key;

    // Recurse for nested objects
    result[outputKey] =
      typeof value === "object" && value !== null
        ? adaptResponse(value, config)
        : value;
  }

  return result;
}

// ── Express Middleware ────────────────────────────────────────────────────────

export function connectionAwareMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const connectionInfo = detectNetworkTier(req);
    const config = TIER_CONFIGS[connectionInfo.tier];

    // Attach to request for use in handlers
    (req as any).connectionInfo = connectionInfo;
    (req as any).adaptationConfig = config;

    // Set response headers
    res.setHeader("X-Network-Tier", connectionInfo.tier);
    res.setHeader("X-Compression-Level", config.compressionLevel);
    res.setHeader("X-Max-List-Items", config.maxListItems.toString());

    // Override res.json to adapt response
    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
      // Only adapt for low-bandwidth tiers
      if (
        connectionInfo.tier === "2g_gprs" ||
        connectionInfo.tier === "2g_edge" ||
        connectionInfo.saveData
      ) {
        body = adaptResponse(body, config);
      }
      return originalJson(body);
    };

    next();
  };
}

// ── Retry-After Header Helper ────────────────────────────────────────────────

export function getRetryAfter(tier: NetworkTier): number {
  const retrySeconds: Record<NetworkTier, number> = {
    "2g_gprs": 120,
    "2g_edge": 60,
    "3g": 30,
    "4g_lte": 10,
    "5g_wifi": 5,
    unknown: 30,
  };
  return retrySeconds[tier];
}

// ── Polling Interval Recommendation ──────────────────────────────────────────

export function getPollingInterval(tier: NetworkTier): number {
  const intervals: Record<NetworkTier, number> = {
    "2g_gprs": 120000, // 2 min
    "2g_edge": 60000, // 1 min
    "3g": 30000, // 30s
    "4g_lte": 10000, // 10s
    "5g_wifi": 3000, // 3s
    unknown: 30000,
  };
  return intervals[tier];
}

// ── WebSocket Recommendation ─────────────────────────────────────────────────

export function shouldUseWebSocket(tier: NetworkTier): boolean {
  return tier === "4g_lte" || tier === "5g_wifi";
}

export function shouldUsePolling(tier: NetworkTier): boolean {
  return tier === "2g_gprs" || tier === "2g_edge" || tier === "3g";
}
