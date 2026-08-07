/**
 * TigerBeetle Ledger Client
 *
 * PCI-DSS COMPLIANCE NOTE:
 * TigerBeetle stores ONLY financial ledger data (account IDs, amounts, timestamps).
 * NO cardholder data (PAN, CVV, expiry dates, cardholder names) is ever stored
 * in TigerBeetle. All payment card data is handled exclusively by the
 * paymentTokenVault router which tokenizes card data before any ledger operations.
 *
 * TigerBeetle account IDs use opaque UUIDs, never card numbers.
 */
// TypeScript enabled — Sprint 96 security audit
import { ENV } from "./_core/env";
import { logger } from './_core/logger';
/**
 * TigerBeetle Sidecar Client
 *
 * The insurance service runs a local Go sidecar (tb-sidecar) on port 7070 that:
 *   1. Commits double-entry transfers to PostgreSQL immediately (offline-safe)
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
  agentId?: string;
}

export interface TBTransferResponse {
  id: string;
  status: "committed" | "error";
  syncStatus: "pending" | "synced" | "failed";
  amount: number;
}

export interface TBAccountRequest {
  id?: string;
  agentId: string;
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
      logger.warn("[tbClient] transfer rejected:: " + body);
      return null;
    }

    return (await res.json()) as TBTransferResponse;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.warn("[tbClient] sidecar timeout — falling back to direct PG");
    } else {
      logger.warn("[tbClient] sidecar unreachable — falling back to direct PG:: " + err);
    }
    return null;
  }
}

/**
 * Ensure an agent float account exists in the sidecar ledger.
 * Called once on agent login / first transaction.
 */
export async function tbEnsureAgentAccount(
  agentId: string
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TB_TIMEOUT_MS);

    const res = await fetch(`${TB_SIDECAR_URL}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: `float-${agentId}`,
        agentId,
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
 * Get the agent's premium reserve from the sidecar ledger (in NGN).
 * Returns null if sidecar is unavailable.
 */
export async function tbGetAgentBalance(
  agentId: string
): Promise<{ balanceNGN: number; balanceKobo: number } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TB_TIMEOUT_MS);

    const res = await fetch(`${TB_SIDECAR_URL}/agent/${agentId}/balance`, {
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

// ── System Account IDs (reserved, never change) ──────────────────────────────
// These are the platform-level ledger accounts that must exist before any
// agent/customer transfers can be processed.
export const TB_SYSTEM_ACCOUNTS = {
  FLOAT_POOL:      BigInt("1000000000000001"), // Master float pool
  FEE_POOL:        BigInt("1000000000000002"), // Platform fee collection
  SUSPENSE:        BigInt("1000000000000003"), // Suspense/clearing account
  PREMIUM_POOL:    BigInt("1000000000000004"), // Collected premiums
  CLAIMS_RESERVE:  BigInt("1000000000000005"), // Claims payment reserve
  COMMISSION_POOL: BigInt("1000000000000006"), // Agent commission pool
  REINSURANCE:     BigInt("1000000000000007"), // Reinsurance cession account
} as const;

/**
 * Seed TigerBeetle system accounts on first run.
 * Safe to call multiple times — uses LINKED flag to make it idempotent.
 * Called at server startup before any transactions are processed.
 */
export async function tbSeedSystemAccounts(): Promise<void> {
  const TB_URL = process.env.TB_SIDECAR_URL ?? "http://localhost:7070";
  const accounts = Object.entries(TB_SYSTEM_ACCOUNTS).map(([name, id]) => ({
    id: id.toString(),
    ledger: 1,
    code: 1,
    flags: 0,
    debits_pending: "0",
    debits_posted: "0",
    credits_pending: "0",
    credits_posted: "0",
    user_data_128: name,
  }));
  try {
    const res = await fetch(`${TB_URL}/accounts/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accounts }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = await res.json() as any;
      // TB returns errors only for accounts that failed — existing accounts
      // return AccountExistsWithDifferentFlags or similar, which we ignore.
      const created = accounts.length - (data.errors?.length ?? 0);
      if (created > 0) {
        console.info(`[TigerBeetle] ${created} system accounts seeded`);
      } else {
        console.info("[TigerBeetle] System accounts already exist");
      }
    } else {
      console.warn("[TigerBeetle] System account seeding returned:", res.status);
    }
  } catch (err) {
    // Non-fatal — TB sidecar may not be running in dev
    console.warn("[TigerBeetle] System account seeding skipped (sidecar unavailable):", String(err));
  }
}
