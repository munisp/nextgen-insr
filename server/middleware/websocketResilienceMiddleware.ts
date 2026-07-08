// @ts-check

// WebSocket Resilience Middleware — Sprint 77
// Adaptive protocol selection, offline queue, reconnection with backoff
// Designed for unreliable connectivity in rural African environments

export type ConnectionProtocol =
  | "websocket"
  | "sse"
  | "long-poll"
  | "offline-queue";

export interface BandwidthTier {
  name: string;
  minKbps: number;
  maxKbps: number;
  recommendedProtocol: ConnectionProtocol;
  compressionLevel: number;
  maxPayloadBytes: number;
  heartbeatIntervalMs: number;
  timeoutMs: number;
}

export const BANDWIDTH_TIERS: BandwidthTier[] = [
  {
    name: "high",
    minKbps: 1000,
    maxKbps: Infinity,
    recommendedProtocol: "websocket",
    compressionLevel: 0,
    maxPayloadBytes: 1048576,
    heartbeatIntervalMs: 30000,
    timeoutMs: 5000,
  },
  {
    name: "medium",
    minKbps: 256,
    maxKbps: 999,
    recommendedProtocol: "websocket",
    compressionLevel: 6,
    maxPayloadBytes: 262144,
    heartbeatIntervalMs: 15000,
    timeoutMs: 10000,
  },
  {
    name: "low",
    minKbps: 64,
    maxKbps: 255,
    recommendedProtocol: "sse",
    compressionLevel: 9,
    maxPayloadBytes: 65536,
    heartbeatIntervalMs: 10000,
    timeoutMs: 20000,
  },
  {
    name: "very-low",
    minKbps: 16,
    maxKbps: 63,
    recommendedProtocol: "long-poll",
    compressionLevel: 9,
    maxPayloadBytes: 16384,
    heartbeatIntervalMs: 5000,
    timeoutMs: 30000,
  },
  {
    name: "offline",
    minKbps: 0,
    maxKbps: 15,
    recommendedProtocol: "offline-queue",
    compressionLevel: 9,
    maxPayloadBytes: 4096,
    heartbeatIntervalMs: 0,
    timeoutMs: 60000,
  },
];

export function detectBandwidthTier(bandwidthKbps: number): BandwidthTier {
  return (
    BANDWIDTH_TIERS.find(
      t => bandwidthKbps >= t.minKbps && bandwidthKbps <= t.maxKbps
    ) || BANDWIDTH_TIERS[4]
  );
}

// Exponential backoff with jitter for reconnection
export function calculateBackoff(
  attempt: number,
  baseMs: number = 1000,
  maxMs: number = 60000
): number {
  const exponential = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const jitter =
    (parseInt(crypto.randomUUID().slice(0, 8), 16) / 0xffffffff) *
    exponential *
    0.3;
  return Math.floor(exponential + jitter);
}

// Offline transaction queue
export interface QueuedTransaction {
  id: string;
  type: string;
  payload: Record<string, any>;
  timestamp: number;
  retryCount: number;
  priority: "critical" | "high" | "normal" | "low";
  maxRetries: number;
  expiresAt: number;
}

export class OfflineTransactionQueue {
  private queue: QueuedTransaction[] = [];
  private maxSize: number;
  private processingLock: boolean = false;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  enqueue(tx: Omit<QueuedTransaction, "retryCount">): boolean {
    if (this.queue.length >= this.maxSize) {
      // Evict lowest priority expired items
      const now = Date.now();
      this.queue = this.queue.filter(t => t.expiresAt > now);
      if (this.queue.length >= this.maxSize) {
        const lowestPriority = this.queue.filter(t => t.priority === "low");
        if (lowestPriority.length > 0) {
          this.queue = this.queue.filter(t => t.id !== lowestPriority[0].id);
        } else {
          return false;
        }
      }
    }
    this.queue.push({ ...tx, retryCount: 0 });
    this.sortByPriority();
    return true;
  }

  dequeue(): QueuedTransaction | undefined {
    return this.queue.shift();
  }

  peek(): QueuedTransaction | undefined {
    return this.queue[0];
  }

  size(): number {
    return this.queue.length;
  }

  getByPriority(priority: string): QueuedTransaction[] {
    return this.queue.filter(t => t.priority === priority);
  }

  removeExpired(): number {
    const now = Date.now();
    const before = this.queue.length;
    this.queue = this.queue.filter(t => t.expiresAt > now);
    return before - this.queue.length;
  }

  private sortByPriority(): void {
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
    this.queue.sort((a, b) => {
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      return a.timestamp - b.timestamp;
    });
  }

  drain(): QueuedTransaction[] {
    const items = [...this.queue];
    this.queue = [];
    return items;
  }

  getStats(): {
    total: number;
    critical: number;
    high: number;
    normal: number;
    low: number;
    expired: number;
  } {
    const now = Date.now();
    return {
      total: this.queue.length,
      critical: this.queue.filter(t => t.priority === "critical").length,
      high: this.queue.filter(t => t.priority === "high").length,
      normal: this.queue.filter(t => t.priority === "normal").length,
      low: this.queue.filter(t => t.priority === "low").length,
      expired: this.queue.filter(t => t.expiresAt <= now).length,
    };
  }
}

// Connection state machine for protocol fallback
export type ConnectionState =
  | "connected"
  | "degraded"
  | "reconnecting"
  | "offline";

export interface ConnectionContext {
  state: ConnectionState;
  protocol: ConnectionProtocol;
  bandwidthTier: BandwidthTier;
  reconnectAttempts: number;
  lastHeartbeat: number;
  offlineQueue: OfflineTransactionQueue;
  lastBandwidthMeasurement: number;
  consecutiveFailures: number;
}

export function createConnectionContext(): ConnectionContext {
  return {
    state: "connected",
    protocol: "websocket",
    bandwidthTier: BANDWIDTH_TIERS[0],
    reconnectAttempts: 0,
    lastHeartbeat: Date.now(),
    offlineQueue: new OfflineTransactionQueue(),
    lastBandwidthMeasurement: 1000,
    consecutiveFailures: 0,
  };
}

export function handleConnectionFailure(
  ctx: ConnectionContext
): ConnectionContext {
  ctx.consecutiveFailures++;
  ctx.reconnectAttempts++;

  if (ctx.consecutiveFailures >= 5) {
    ctx.state = "offline";
    ctx.protocol = "offline-queue";
  } else if (ctx.consecutiveFailures >= 3) {
    ctx.state = "degraded";
    // Fall back to simpler protocol
    if (ctx.protocol === "websocket") ctx.protocol = "sse";
    else if (ctx.protocol === "sse") ctx.protocol = "long-poll";
    else ctx.protocol = "offline-queue";
  } else {
    ctx.state = "reconnecting";
  }

  return ctx;
}

export function handleConnectionSuccess(
  ctx: ConnectionContext
): ConnectionContext {
  ctx.state = "connected";
  ctx.consecutiveFailures = 0;
  ctx.reconnectAttempts = 0;
  ctx.lastHeartbeat = Date.now();
  // Re-evaluate protocol based on bandwidth
  ctx.bandwidthTier = detectBandwidthTier(ctx.lastBandwidthMeasurement);
  ctx.protocol = ctx.bandwidthTier.recommendedProtocol;
  return ctx;
}

// Data compression for low-bandwidth
export function compressPayload(data: string, level: number): string {
  if (level === 0) return data;
  // Remove whitespace for basic compression
  let compressed = data.replace(/\s+/g, " ").trim();
  // Remove null values
  if (level >= 3) {
    try {
      const obj = JSON.parse(compressed);
      compressed = JSON.stringify(obj, (_, v) => (v === null ? undefined : v));
    } catch {
      /* not JSON */
    }
  }
  return compressed;
}

// African carrier-specific optimizations
export const AFRICAN_CARRIER_CONFIGS: Record<
  string,
  { avgBandwidthKbps: number; maxPayload: number; ussdFallback: boolean }
> = {
  MTN_NG: { avgBandwidthKbps: 256, maxPayload: 65536, ussdFallback: true },
  Airtel_NG: { avgBandwidthKbps: 192, maxPayload: 32768, ussdFallback: true },
  Glo_NG: { avgBandwidthKbps: 128, maxPayload: 16384, ussdFallback: true },
  "9Mobile_NG": { avgBandwidthKbps: 96, maxPayload: 16384, ussdFallback: true },
  Safaricom_KE: {
    avgBandwidthKbps: 384,
    maxPayload: 131072,
    ussdFallback: true,
  },
  MTN_GH: { avgBandwidthKbps: 192, maxPayload: 32768, ussdFallback: true },
  Vodafone_GH: { avgBandwidthKbps: 256, maxPayload: 65536, ussdFallback: true },
  Orange_SN: { avgBandwidthKbps: 128, maxPayload: 16384, ussdFallback: true },
  MTN_ZA: { avgBandwidthKbps: 512, maxPayload: 262144, ussdFallback: false },
  Vodacom_ZA: {
    avgBandwidthKbps: 512,
    maxPayload: 262144,
    ussdFallback: false,
  },
};

console.log(
  "[websocketResilienceMiddleware] Sprint 77 WebSocket resilience middleware loaded"
);
