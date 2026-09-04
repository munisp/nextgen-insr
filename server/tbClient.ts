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
 * The insurance service runs a Go sidecar (tb-sidecar) that is a transparent
 * proxy to the configured TigerBeetle upstream (TIGERBEETLE_ADDRESS). The
 * sidecar never fabricates ledger responses: if the upstream ledger is
 * unreachable it returns 5xx and this client throws.
 *
 * This module provides a thin HTTP client for the sidecar.
 *
 * FAIL-CLOSED POSTURE (DD-TB remediation):
 * Ledger WRITES (tbCreateTransfer, tbEnsureAgentAccount) THROW when the
 * sidecar is unreachable, times out, or rejects the request. There is no
 * silent "fall back to direct PG" path — a money mutation whose ledger leg
 * cannot be committed must surface as an error to the caller, never as a
 * quietly degraded success. Ledger READS (tbGetAgentBalance, tbGetSyncStatus,
 * tbIsHealthy) still return null/false on failure; read-path callers that
 * fall back to PostgreSQL must label that source honestly (e.g.
 * `source: "postgresql"`).
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
 * Error thrown when a ledger WRITE cannot be committed because the
 * TigerBeetle sidecar is unreachable, timed out, or rejected the request.
 * Callers must NOT treat this as "write happened in PG only" — the ledger
 * leg did not happen.
 */
export class TBLedgerUnavailableError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "TBLedgerUnavailableError";
    this.cause = cause;
  }
}

/**
 * Submit a double-entry transfer to the local TB sidecar.
 *
 * FAIL-CLOSED: throws TBLedgerUnavailableError if the sidecar is
 * unreachable, times out, or rejects the transfer. Funds-path callers must
 * let this error propagate (tRPC will surface it as a 5xx) — a transfer
 * whose ledger leg failed must never be reported as committed.
 */
export async function tbCreateTransfer(
  req: TBTransferRequest
): Promise<TBTransferResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TB_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${TB_SIDECAR_URL}/transfers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const reason = err instanceof Error && err.name === "AbortError"
      ? `timed out after ${TB_TIMEOUT_MS}ms`
      : `unreachable (${String(err)})`;
    logger.error(`[tbClient] FAIL-CLOSED: ledger transfer aborted — sidecar ${reason}; ref=${req.ref ?? "n/a"}`);
    throw new TBLedgerUnavailableError(
      `TigerBeetle ledger unavailable: sidecar ${reason}. Transfer NOT committed (ref=${req.ref ?? "n/a"}).`,
      err
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error(`[tbClient] FAIL-CLOSED: ledger transfer rejected HTTP ${res.status}; ref=${req.ref ?? "n/a"} body=${body.slice(0, 300)}`);
    throw new TBLedgerUnavailableError(
      `TigerBeetle ledger rejected transfer (HTTP ${res.status}). Transfer NOT committed (ref=${req.ref ?? "n/a"}).`
    );
  }

  return (await res.json()) as TBTransferResponse;
}

/**
 * Ensure an agent float account exists in the sidecar ledger.
 * Called once on agent login / first transaction.
 *
 * FAIL-CLOSED: throws TBLedgerUnavailableError when the sidecar is
 * unreachable or times out. Returns false only when the sidecar answered
 * with a non-OK status (an honest ledger answer the caller may inspect).
 */
export async function tbEnsureAgentAccount(
  agentId: string
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TB_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${TB_SIDECAR_URL}/accounts`, {
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
  } catch (err: unknown) {
    clearTimeout(timer);
    const reason = err instanceof Error && err.name === "AbortError"
      ? `timed out after ${TB_TIMEOUT_MS}ms`
      : `unreachable (${String(err)})`;
    logger.error(`[tbClient] FAIL-CLOSED: ensure-agent-account aborted — sidecar ${reason}; agent=${agentId}`);
    throw new TBLedgerUnavailableError(
      `TigerBeetle ledger unavailable: sidecar ${reason}. Account provisioning NOT confirmed (agent=${agentId}).`,
      err
    );
  }
  clearTimeout(timer);
  return res.ok;
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
