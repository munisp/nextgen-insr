import { logger } from '../_core/logger.js';
// @ts-check

// Network Resilience Middleware — Sprint 76
// Adaptive compression, request coalescing, graceful degradation for African networks
// Handles: WebSocket → SSE → Long-Poll → Offline queue transitions

export interface ResilienceConfig {
  compressionThresholdBytes: number;
  maxPayloadBytes: number;
  lowBandwidthThresholdKbps: number;
  offlineQueueMaxItems: number;
  adaptiveCompressionEnabled: boolean;
  requestCoalescingWindowMs: number;
  gracefulDegradationEnabled: boolean;
  retryBackoffBaseMs: number;
  retryBackoffMaxMs: number;
  retryMaxAttempts: number;
}

export const DEFAULT_RESILIENCE_CONFIG: ResilienceConfig = {
  compressionThresholdBytes: 1024,
  maxPayloadBytes: 50 * 1024, // 50KB max for low-bandwidth
  lowBandwidthThresholdKbps: 200,
  offlineQueueMaxItems: 500,
  adaptiveCompressionEnabled: true,
  requestCoalescingWindowMs: 100,
  gracefulDegradationEnabled: true,
  retryBackoffBaseMs: 1000,
  retryBackoffMaxMs: 60000,
  retryMaxAttempts: 10,
};

// Bandwidth tier determination
export function determineBandwidthTier(
  kbps: number
): "high" | "medium" | "low" | "minimal" | "offline" {
  if (kbps <= 0) return "offline";
  if (kbps < 50) return "minimal";
  if (kbps < 200) return "low";
  if (kbps < 2000) return "medium";
  return "high";
}

// Adaptive payload sizing based on bandwidth
export function getMaxPayloadForBandwidth(kbps: number): number {
  const tier = determineBandwidthTier(kbps);
  switch (tier) {
    case "high":
      return 500 * 1024; // 500KB
    case "medium":
      return 100 * 1024; // 100KB
    case "low":
      return 25 * 1024; // 25KB
    case "minimal":
      return 5 * 1024; // 5KB
    case "offline":
      return 0;
  }
}

// Protocol selection based on network conditions
export function selectProtocol(
  latencyMs: number,
  lossPercent: number,
  bandwidthKbps: number
): "websocket" | "sse" | "long-poll" | "offline" {
  if (bandwidthKbps < 50 || lossPercent > 30) return "offline";
  if (bandwidthKbps < 100 || lossPercent > 15 || latencyMs > 800)
    return "long-poll";
  if (bandwidthKbps < 500 || lossPercent > 5 || latencyMs > 400) return "sse";
  return "websocket";
}

// Exponential backoff with jitter
export function calculateBackoff(
  attempt: number,
  baseMs: number = 1000,
  maxMs: number = 60000
): number {
  const exponential = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const jitter =
    exponential *
    0.5 *
    (parseInt(crypto.randomUUID().slice(0, 8), 16) / 0xffffffff);
  return Math.round(exponential + jitter);
}

// Request priority for offline queue
export type RequestPriority = "critical" | "high" | "normal" | "low";
export function getRequestPriority(
  path: string,
  method: string
): RequestPriority {
  if (path.includes("transaction") && method === "POST") return "critical";
  if (path.includes("float") || path.includes("settlement")) return "high";
  if (path.includes("audit") || path.includes("telemetry")) return "low";
  return "normal";
}

// Compression ratio estimation
export function estimateCompressionRatio(contentType: string): number {
  if (contentType.includes("json")) return 0.3;
  if (contentType.includes("text")) return 0.25;
  if (contentType.includes("csv")) return 0.2;
  return 0.8; // binary content doesn't compress well
}

console.log(
  "[networkResilienceMiddleware] Sprint 76 resilience middleware loaded"
);
