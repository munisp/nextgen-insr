// @ts-check

/**
 * Offline Queue Middleware — Sprint 78
 * Enhanced offline transaction queuing with priority-based processing,
 * conflict resolution, and automatic retry with exponential backoff.
 * Designed for African low-bandwidth and intermittent connectivity environments.
 */

interface QueuedTransaction {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  priority: number; // 1 = highest, 5 = lowest
  createdAt: number;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: number;
  status: "pending" | "processing" | "completed" | "failed" | "conflict";
  conflictResolution: "client_wins" | "server_wins" | "manual" | null;
  checksum: string;
  agentId: string;
  deviceId: string;
  networkTier: "4g" | "3g" | "2g" | "edge" | "offline";
}

interface QueueStats {
  totalQueued: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  conflicts: number;
  avgRetryCount: number;
  oldestPendingAge: number;
  throughputPerMinute: number;
}

// Priority levels for different transaction types
const TX_PRIORITY: Record<string, number> = {
  cash_in: 1,
  cash_out: 1,
  transfer: 1,
  reversal: 1,
  bill_payment: 2,
  airtime: 2,
  balance_check: 3,
  statement: 4,
  notification: 5,
};

// Retry backoff configuration per network tier
const BACKOFF_CONFIG: Record<
  string,
  { baseMs: number; maxMs: number; factor: number }
> = {
  "4g": { baseMs: 1000, maxMs: 30000, factor: 2 },
  "3g": { baseMs: 2000, maxMs: 60000, factor: 2 },
  "2g": { baseMs: 5000, maxMs: 120000, factor: 2.5 },
  edge: { baseMs: 10000, maxMs: 300000, factor: 3 },
  offline: { baseMs: 30000, maxMs: 600000, factor: 3 },
};

export function calculateBackoff(
  retryCount: number,
  networkTier: string
): number {
  const config = BACKOFF_CONFIG[networkTier] || BACKOFF_CONFIG["3g"];
  const delay = Math.min(
    config.baseMs * Math.pow(config.factor, retryCount),
    config.maxMs
  );
  // Add jitter (±20%)
  const jitter =
    delay *
    0.2 *
    ((parseInt(crypto.randomUUID().slice(0, 8), 16) / 0xffffffff) * 2 - 1);
  return Math.round(delay + jitter);
}

export function generateChecksum(payload: Record<string, unknown>): string {
  const str = JSON.stringify(payload, Object.keys(payload).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36).padStart(8, "0");
}

export function detectConflict(
  local: QueuedTransaction,
  remote: { checksum: string; updatedAt: number }
): boolean {
  return local.checksum !== remote.checksum;
}

export function resolveConflict(
  local: QueuedTransaction,
  remote: { payload: Record<string, unknown>; updatedAt: number },
  strategy: "client_wins" | "server_wins" | "manual"
): Record<string, unknown> {
  switch (strategy) {
    case "client_wins":
      return local.payload;
    case "server_wins":
      return remote.payload;
    case "manual":
      return {
        ...remote.payload,
        _conflict: true,
        _localPayload: local.payload,
        _remotePayload: remote.payload,
      };
    default:
      return remote.payload;
  }
}

export function createQueueEntry(
  type: string,
  payload: Record<string, unknown>,
  agentId: string,
  deviceId: string,
  networkTier: QueuedTransaction["networkTier"]
): QueuedTransaction {
  const priority = TX_PRIORITY[type] || 3;
  return {
    id: `Q-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`,
    type,
    payload,
    priority,
    createdAt: Date.now(),
    retryCount: 0,
    maxRetries: networkTier === "offline" ? 20 : 10,
    nextRetryAt: Date.now(),
    status: "pending",
    conflictResolution: null,
    checksum: generateChecksum(payload),
    agentId,
    deviceId,
    networkTier,
  };
}

export function getQueueStats(queue: QueuedTransaction[]): QueueStats {
  const now = Date.now();
  const pending = queue.filter(q => q.status === "pending");
  const processing = queue.filter(q => q.status === "processing");
  const completed = queue.filter(q => q.status === "completed");
  const failed = queue.filter(q => q.status === "failed");
  const conflicts = queue.filter(q => q.status === "conflict");
  const totalRetries = queue.reduce((sum, q) => sum + q.retryCount, 0);
  const oldestPending =
    pending.length > 0 ? Math.min(...pending.map(q => q.createdAt)) : now;
  const recentCompleted = completed.filter(
    q => q.createdAt > now - 60000
  ).length;

  return {
    totalQueued: queue.length,
    pending: pending.length,
    processing: processing.length,
    completed: completed.length,
    failed: failed.length,
    conflicts: conflicts.length,
    avgRetryCount:
      queue.length > 0
        ? Math.round((totalRetries / queue.length) * 100) / 100
        : 0,
    oldestPendingAge: now - oldestPending,
    throughputPerMinute: recentCompleted,
  };
}

// Batch compression for low-bandwidth environments
export function compressBatch(transactions: QueuedTransaction[]): {
  compressed: string;
  originalSize: number;
  compressedSize: number;
  ratio: number;
} {
  const json = JSON.stringify(
    transactions.map(t => ({
      i: t.id,
      t: t.type,
      p: t.payload,
      a: t.agentId,
      c: t.checksum,
    }))
  );
  // Simple dedup + minification (real impl would use gzip/brotli)
  const compressed = json.replace(/"([a-z])"/g, "$1");
  return {
    compressed,
    originalSize: json.length,
    compressedSize: compressed.length,
    ratio: Math.round((compressed.length / json.length) * 100),
  };
}
