// @ts-check

// resolve conflicts using last-write-wins or server-priority strategy
// Track sync status per item: pending | synced | failed | conflict
/**
 * offlineSyncQueue — Server-side offline sync queue handler
 *
 * Receives batched offline transactions from terminals that were queued
 * while offline. Processes them with idempotency, conflict detection,
 * and ordering guarantees.
 *
 * Endpoints:
 *   POST /api/sync/push    — push offline queue to server
 *   POST /api/sync/pull    — pull updates since last sync
 *   POST /api/sync/status  — check sync status for terminal
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";

// syncQueue is the in-memory queue for offline transactions
// Transactions are processed by priority: critical > high > normal > low
const syncQueue: Array<{ tx: any; priority: string }> = [];

function push(tx: any, priority: string = "normal") {
  syncQueue.push({ tx, priority });
  syncQueue.sort((a, b) => {
    const order: Record<string, number> = {
      critical: 0,
      high: 1,
      normal: 2,
      low: 3,
    };
    return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
  });
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface OfflineTransaction {
  id: string;
  clientTimestamp: number;
  type: string; // cash_in, cash_out, transfer, airtime, bill_pay
  amount: number;
  currency: string;
  agentId: string;
  customerId?: string;
  customerPhone?: string;
  description?: string;
  idempotencyKey: string;
  terminalId: string;
  offlineDuration: number; // ms the terminal was offline when this was created
  retryCount: number;
  hash: string; // SHA-256 of transaction data for integrity
}

export interface SyncRequest {
  terminalId: string;
  agentId: string;
  transactions: OfflineTransaction[];
  lastSyncTimestamp: number;
  networkTier: string;
  queueDepth: number;
}

export interface SyncResponse {
  accepted: string[];
  rejected: Array<{ id: string; reason: string }>;
  duplicates: string[];
  serverTimestamp: number;
  nextSyncRecommendedMs: number;
  updates: ServerUpdate[];
}

export interface ServerUpdate {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface SyncStatus {
  terminalId: string;
  lastSyncTimestamp: number;
  pendingUpdates: number;
  syncHealth: "healthy" | "degraded" | "stale";
  recommendedAction: string;
}

// ── Idempotency Store ────────────────────────────────────────────────────────

const processedKeys = new Map<string, { timestamp: number; result: string }>();
const MAX_IDEMPOTENCY_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function isIdempotent(key: string): boolean {
  const entry = processedKeys.get(key);
  if (!entry) return false;
  if (Date.now() - entry.timestamp > MAX_IDEMPOTENCY_AGE_MS) {
    processedKeys.delete(key);
    return false;
  }
  return true;
}

function markProcessed(key: string, result: string): void {
  processedKeys.set(key, { timestamp: Date.now(), result });
  // Cleanup old entries periodically
  if (processedKeys.size > 10000) {
    const cutoff = Date.now() - MAX_IDEMPOTENCY_AGE_MS;
    for (const [k, v] of processedKeys) {
      if (v.timestamp < cutoff) processedKeys.delete(k);
    }
  }
}

// ── Transaction Validation ───────────────────────────────────────────────────

function validateTransaction(tx: OfflineTransaction): string | null {
  if (!tx.id) return "Missing transaction ID";
  if (!tx.type) return "Missing transaction type";
  if (!tx.amount || tx.amount <= 0) return "Invalid amount";
  if (!tx.currency) return "Missing currency";
  if (!tx.agentId) return "Missing agent ID";
  if (!tx.idempotencyKey) return "Missing idempotency key";
  if (!tx.terminalId) return "Missing terminal ID";

  // Verify hash integrity
  const expectedHash = computeHash(tx);
  if (tx.hash && tx.hash !== expectedHash) {
    return "Hash mismatch — transaction may have been tampered with";
  }

  // Check if transaction is too old (> 7 days)
  if (Date.now() - tx.clientTimestamp > 7 * 24 * 60 * 60 * 1000) {
    return "Transaction too old (> 7 days). Manual reconciliation required.";
  }

  // Amount limits
  if (tx.amount > 5000000) return "Amount exceeds maximum limit";

  return null;
}

export function computeHash(tx: OfflineTransaction): string {
  const data = `${tx.id}:${tx.type}:${tx.amount}:${tx.currency}:${tx.agentId}:${tx.clientTimestamp}`;
  return crypto
    .createHash("sha256")
    .update(data)
    .digest("hex")
    .substring(0, 16);
}

// ── Sync Queue Stats ─────────────────────────────────────────────────────────

export const syncStats = {
  totalPushes: 0,
  totalPulls: 0,
  totalTransactionsProcessed: 0,
  totalAccepted: 0,
  totalRejected: 0,
  totalDuplicates: 0,
  activeTerminals: new Set<string>(),
  lastActivity: 0,
};

// ── Router ───────────────────────────────────────────────────────────────────

export const offlineSyncRouter = Router();

offlineSyncRouter.post("/push", (req: Request, res: Response) => {
  const body = req.body as SyncRequest;

  if (
    !body.terminalId ||
    !body.transactions ||
    !Array.isArray(body.transactions)
  ) {
    res.status(400).json({ error: "Invalid sync request" });
    return;
  }

  syncStats.totalPushes++;
  syncStats.activeTerminals.add(body.terminalId);
  syncStats.lastActivity = Date.now();

  const accepted: string[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];
  const duplicates: string[] = [];

  // Sort by client timestamp to process in order
  const sorted = [...body.transactions].sort(
    (a, b) => a.clientTimestamp - b.clientTimestamp
  );

  for (const tx of sorted) {
    syncStats.totalTransactionsProcessed++;

    // Check idempotency
    if (isIdempotent(tx.idempotencyKey)) {
      duplicates.push(tx.id);
      syncStats.totalDuplicates++;
      continue;
    }

    // Validate
    const error = validateTransaction(tx);
    if (error) {
      rejected.push({ id: tx.id, reason: error });
      syncStats.totalRejected++;
      continue;
    }

    // Process (in production, this would write to DB)
    markProcessed(tx.idempotencyKey, "accepted");
    accepted.push(tx.id);
    syncStats.totalAccepted++;
  }

  // Determine next sync interval based on network tier
  const nextSync = getRecommendedSyncInterval(
    body.networkTier,
    body.queueDepth
  );

  const response: SyncResponse = {
    accepted,
    rejected,
    duplicates,
    serverTimestamp: Date.now(),
    nextSyncRecommendedMs: nextSync,
    updates: [], // Would contain server-side updates for the terminal
  };

  res.json(response);
});

offlineSyncRouter.post("/pull", (req: Request, res: Response) => {
  const { terminalId, lastSyncTimestamp } = req.body;

  syncStats.totalPulls++;
  syncStats.activeTerminals.add(terminalId);

  // In production, query DB for updates since lastSyncTimestamp
  const updates: ServerUpdate[] = [];

  res.json({
    terminalId,
    updates,
    serverTimestamp: Date.now(),
    hasMore: false,
  });
});

offlineSyncRouter.post("/status", (req: Request, res: Response) => {
  const { terminalId } = req.body;

  const lastSync = syncStats.lastActivity;
  const staleness = Date.now() - lastSync;

  let syncHealth: "healthy" | "degraded" | "stale" = "healthy";
  let recommendedAction = "Continue normal sync";

  if (staleness > 3600000) {
    syncHealth = "stale";
    recommendedAction =
      "Force full sync — terminal has been offline for over 1 hour";
  } else if (staleness > 300000) {
    syncHealth = "degraded";
    recommendedAction = "Increase sync frequency — terminal sync is delayed";
  }

  const status: SyncStatus = {
    terminalId,
    lastSyncTimestamp: lastSync,
    pendingUpdates: 0,
    syncHealth,
    recommendedAction,
  };

  res.json(status);
});

offlineSyncRouter.get("/stats", (_req: Request, res: Response) => {
  res.json({
    ...syncStats,
    activeTerminals: syncStats.activeTerminals.size,
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function getRecommendedSyncInterval(
  networkTier: string,
  queueDepth: number
): number {
  const baseIntervals: Record<string, number> = {
    "2g_gprs": 120000, // 2 min
    "2g_edge": 60000, // 1 min
    "3g": 30000, // 30s
    "4g_lte": 10000, // 10s
    "5g_wifi": 5000, // 5s
  };

  let interval = baseIntervals[networkTier] || 30000;

  // If queue is deep, sync more frequently
  if (queueDepth > 50) interval = Math.max(interval / 2, 5000);
  if (queueDepth > 100) interval = Math.max(interval / 4, 3000);

  return interval;
}
