// TypeScript enabled — Sprint 96 security audit
import { ENV } from "./_core/env";
/**
 * TigerBeetle Sidecar Client
 *
 * The service node runs a local Go sidecar (tb-sidecar) on port 7070 that:
 *   1. Commits double-entry transfers to SQLite immediately (offline-safe)
 *   2. Syncs those transfers to the TigerBeetle Zig cluster when online
 *   3. Writes metadata to PostgreSQL as a secondary record
 *
 * This module provides a thin HTTP client for the sidecar.
 * All calls are wrapped with a 2-second timeout and fall back gracefully
 * when the sidecar is not running (e.g., in CI or cloud deployments).
 */

const TB_SIDECAR_URL = ENV.tbSidecarUrl;
const TB_TIMEOUT_MS = 2000;

export interface TBTransferRequest {
  id?: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: number; // in kobo (NGN × 100)
  ledger?: number;
  code?: number;
  ref?: string;
  txType?: string;
  agentCode?: string;
}

export interface TBTransferResponse {
  id: string;
  status: "committed" | "error";
  syncStatus: "pending" | "synced" | "failed";
  amount: number;
}

export interface TBAccountRequest {
  id?: string;
  agentCode: string;
  ledger: number;
  code: number;
}

export interface TBSyncStatus {
  pending: number;
  synced: number;
  failed: number;
  postgres: "connected" | "disconnected";
}

/**
 * Submit a double-entry transfer to the local TB sidecar.
 * Returns null if the sidecar is unreachable (caller should fall back to direct PG write).
 */
export async function tbCreateTransfer(
  req: TBTransferRequest
): Promise<TBTransferResponse | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TB_TIMEOUT_MS);

    const res = await fetch(`${TB_SIDECAR_URL}/transfers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn("[tbClient] transfer rejected:", body);
      return null;
    }

    return (await res.json()) as TBTransferResponse;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn("[tbClient] sidecar timeout — falling back to direct PG");
    } else {
      console.warn(
        "[tbClient] sidecar unreachable — falling back to direct PG:",
        err
      );
    }
    return null;
  }
}

/**
 * Ensure an agent float account exists in the sidecar ledger.
 * Called once on agent login / first transaction.
 */
export async function tbEnsureAgentAccount(
  agentCode: string
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TB_TIMEOUT_MS);

    const res = await fetch(`${TB_SIDECAR_URL}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: `float-${agentCode}`,
        agentCode,
        ledger: 2000, // LedgerAgentAccounts
        code: 300, // CodeAgentFloat
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get the agent's float balance from the sidecar ledger (in NGN).
 * Returns null if sidecar is unavailable.
 */
export async function tbGetAgentBalance(
  agentCode: string
): Promise<{ balanceNGN: number; balanceKobo: number } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TB_TIMEOUT_MS);

    const res = await fetch(`${TB_SIDECAR_URL}/agent/${agentCode}/balance`, {
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Get the current sync status from the sidecar.
 * Used by the Admin Panel to show pending/synced/failed counts.
 */
export async function tbGetSyncStatus(): Promise<TBSyncStatus | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TB_TIMEOUT_MS);

    const res = await fetch(`${TB_SIDECAR_URL}/sync/status`, {
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Health check — returns true if the sidecar is running.
 */
export async function tbIsHealthy(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`${TB_SIDECAR_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
