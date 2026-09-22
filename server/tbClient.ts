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
import crypto from "crypto";

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
 * Thrown when a transfer `ref` was already committed/indeterminate with a
 * DIFFERENT payload (accounts/amount/ledger/code). This is a client bug or a
 * replay attack — it must surface loudly, never silently re-execute.
 */
export class TBIdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TBIdempotencyConflictError";
  }
}

// ─── Ref-dedup registry (F-04 / PAY-3) ───────────────────────────────────────
// The tb-sidecar is a TRANSPARENT proxy to the upstream TigerBeetle gateway
// (tb-sidecar/main.go: "Everything else is a transparent proxy to the
// upstream") — it performs NO ref/id deduplication itself. Retry safety after
// the 2s timeout is therefore established HERE, in the client:
//
//   1. Every transfer with a `ref` gets a DETERMINISTIC transfer id derived
//      from the ref + full payload. TigerBeetle deduplicates re-created
//      transfers by id (exists semantics), so a retry-after-timeout reposts
//      the SAME id and cannot double-post at the upstream.
//   2. A durable PostgreSQL registry (tb_transfer_registry) records
//      ref → (payloadHash, transferId, status, response) so a retry with the
//      same ref + payload replays the recorded outcome, and the same ref with
//      a different payload is rejected with TBIdempotencyConflictError.
//
// The registry is best-effort when the DB handle is unavailable (unit paths):
// the deterministic id still provides upstream-level dedup.

/** Canonical payload fingerprint bound to a transfer ref. */
export function tbPayloadHash(req: TBTransferRequest): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        debitAccountId: req.debitAccountId,
        creditAccountId: req.creditAccountId,
        amount: req.amount,
        ledger: req.ledger ?? null,
        code: req.code ?? null,
        ref: req.ref ?? null,
      })
    )
    .digest("hex");
}

/** Deterministic transfer id for a ref-bound request (upstream dedup key). */
export function tbDeterministicTransferId(req: TBTransferRequest): string {
  return `tb-${tbPayloadHash(req).slice(0, 48)}`;
}

interface RegistryRow {
  ref: string;
  payloadHash: string;
  transferId: string | null;
  status: string;
  response: string | null;
}

/**
 * The registry needs a live PostgreSQL. Under the test runner (VITEST /
 * NODE_ENV=test) it is OFF by default so unit suites with module-level fetch
 * mocks stay hermetic (a registry replay would short-circuit the mocked
 * transport); dedup in tests is still exercised for real by the mini
 * TigerBeetle ledger's ref/id idempotency. Tests that specifically cover the
 * registry set TB_REGISTRY_FORCE=1 (see auditFixPayments.integration.test.ts).
 * Production/staging behavior is unaffected.
 */
function registryEnabled(): boolean {
  if (process.env.TB_REGISTRY_FORCE === "1") return true;
  if (process.env.VITEST || process.env.NODE_ENV === "test") return false;
  return true;
}

// ── P-wave perf (2026-09-19): registry lookup caches ─────────────────────────
// tbCreateTransfer spent up to 3 sequential Postgres RTTs per transfer on
// registry get/reserve/mark-committed. Two lookups are safely cacheable:
//
//   1. COMMITTED registry rows are immutable (terminal state) — a replay
//      returns the recorded response verbatim. Caching them (60s TTL, bounded
//      10k FIFO) removes the registryGet RTT for idempotent replays.
//      'indeterminate' rows are NEVER cached: they must be re-read so a
//      concurrent commit/retry is observed exactly (fail-closed unchanged).
//      Negative (miss) results are NEVER cached either: a first-time ref must
//      always hit the durable registry before posting.
//   2. tbEnsureAgentAccount successes (below) — account creation is
//      idempotent and durable, so a confirmed account stays confirmed.
//
// Multi-replica note: the cache is a read-through accelerator only; the
// durable registry remains the source of truth for every mutation path.
const REGISTRY_CACHE_TTL_MS = 60_000;
const REGISTRY_CACHE_MAX = 10_000;
interface CommittedCacheEntry {
  row: RegistryRow;
  expiresAt: number;
}
const committedRegistryCache = new Map<string, CommittedCacheEntry>();

function committedCacheGet(ref: string): RegistryRow | null {
  const hit = committedRegistryCache.get(ref);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    committedRegistryCache.delete(ref);
    return null;
  }
  // Refresh recency (Map insertion order doubles as LRU order).
  committedRegistryCache.delete(ref);
  committedRegistryCache.set(ref, hit);
  return hit.row;
}

function committedCachePut(ref: string, row: RegistryRow): void {
  committedRegistryCache.delete(ref);
  committedRegistryCache.set(ref, {
    row,
    expiresAt: Date.now() + REGISTRY_CACHE_TTL_MS,
  });
  while (committedRegistryCache.size > REGISTRY_CACHE_MAX) {
    const oldest = committedRegistryCache.keys().next().value;
    if (oldest === undefined) break;
    committedRegistryCache.delete(oldest);
  }
}

/** Test-only handle for the committed-registry cache (P-wave perf). */
export const __tbRegistryCacheForTests = {
  cache: committedRegistryCache,
  get: committedCacheGet,
  put: committedCachePut,
  TTL_MS: REGISTRY_CACHE_TTL_MS,
  MAX: REGISTRY_CACHE_MAX,
};

async function registryGet(ref: string): Promise<RegistryRow | null> {
  try {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return null;
    const { tbTransferRegistry } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select()
      .from(tbTransferRegistry)
      .where(eq(tbTransferRegistry.ref, ref))
      .limit(1);
    return (row as RegistryRow | undefined) ?? null;
  } catch (err) {
    logger.warn(`[tbClient] registry lookup failed (ref=${ref}): ${String(err)}`);
    return null;
  }
}

async function registryReserve(ref: string, payloadHash: string, transferId: string): Promise<void> {
  try {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return;
    const { tbTransferRegistry } = await import("../drizzle/schema");
    await db
      .insert(tbTransferRegistry)
      .values({ ref, payloadHash, transferId, status: "indeterminate" })
      .onConflictDoNothing({ target: tbTransferRegistry.ref });
  } catch (err) {
    logger.warn(`[tbClient] registry reserve failed (ref=${ref}): ${String(err)}`);
  }
}

async function registryMarkCommitted(ref: string, response: TBTransferResponse): Promise<void> {
  try {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return;
    const { tbTransferRegistry } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(tbTransferRegistry)
      .set({ status: "committed", response: JSON.stringify(response), updatedAt: new Date() })
      .where(eq(tbTransferRegistry.ref, ref));
  } catch (err) {
    logger.warn(`[tbClient] registry commit-mark failed (ref=${ref}): ${String(err)}`);
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
  // ── Retry-safety (F-04): deterministic id + durable ref registry ────────
  // The sidecar does NOT dedup (transparent proxy). A retry after a timeout
  // would double-post without these guards.
  if (req.ref) {
    const payloadHash = tbPayloadHash(req);
    if (!req.id) req.id = tbDeterministicTransferId(req);

    // P-wave perf: committed rows are immutable — serve replays from the
    // in-process cache (skips the Postgres RTT). Misses/indeterminate rows
    // always go to the durable registry (fail-closed unchanged).
    const cachedCommitted = registryEnabled()
      ? committedCacheGet(req.ref)
      : null;
    const prior =
      cachedCommitted ??
      (registryEnabled() ? await registryGet(req.ref) : null);
    if (prior) {
      if (prior.payloadHash !== payloadHash) {
        logger.error(`[tbClient] IDEMPOTENCY CONFLICT: ref=${req.ref} reused with a different payload`);
        throw new TBIdempotencyConflictError(
          `Transfer ref '${req.ref}' was already used with a different payload (accounts/amount). Refusing to re-execute.`
        );
      }
      if (prior.status === "committed" && prior.response) {
        // Idempotent replay — the original outcome, no second posting.
        if (!cachedCommitted) committedCachePut(req.ref, prior);
        return JSON.parse(prior.response) as TBTransferResponse;
      }
      // status 'indeterminate': a previous attempt timed out. Repost with the
      // SAME deterministic id — the upstream ledger deduplicates by id, so
      // this converges instead of double-posting.
      req.id = prior.transferId ?? req.id;
      logger.warn(`[tbClient] retrying indeterminate transfer ref=${req.ref} with same deterministic id=${req.id}`);
    } else if (registryEnabled()) {
      await registryReserve(req.ref, payloadHash, req.id);
    }
  }

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
    const timedOut = err instanceof Error && err.name === "AbortError";
    const reason = timedOut
      ? `timed out after ${TB_TIMEOUT_MS}ms`
      : `unreachable (${String(err)})`;
    logger.error(`[tbClient] FAIL-CLOSED: ledger transfer aborted — sidecar ${reason}; ref=${req.ref ?? "n/a"}; commit state ${timedOut ? "UNKNOWN" : "NOT committed"}`);
    if (timedOut) {
      // HONEST semantics (F-04): on TIMEOUT the upstream MAY have committed —
      // we cannot know. The registry row stays 'indeterminate' so a retry
      // with the same ref+payload reposts the same deterministic id (upstream
      // id-dedup makes that safe); a different payload is rejected.
      throw new TBLedgerUnavailableError(
        `TigerBeetle ledger unavailable: sidecar ${reason}. Commit state UNKNOWN (ref=${req.ref ?? "n/a"}) — ` +
        `retry with the SAME ref and payload is safe (deterministic-id dedup); never retry with a different payload.`,
        err
      );
    }
    // Connection refused/reset BEFORE the request was accepted: the transfer
    // was NOT committed (the pinned fail-closed contract).
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

  const out = (await res.json()) as TBTransferResponse;
  if (req.ref && registryEnabled()) {
    await registryMarkCommitted(req.ref, out);
    committedCachePut(req.ref, {
      ref: req.ref,
      payloadHash: tbPayloadHash(req),
      transferId: req.id ?? null,
      status: "committed",
      response: JSON.stringify(out),
    });
  }
  return out;
}

/**
 * Post a COMPENSATING REVERSAL for a previously committed transfer (saga
 * compensation, PAY-1): swaps debit/credit with ref `${original.ref}-REV`.
 *
 * Loud by contract: on success logs an ERROR (a compensation is always an
 * incident); on failure throws TBLedgerUnavailableError after logging a
 * CRITICAL unreconciled-orphan alert so operators/page-duty must intervene.
 * The reversal itself is ref-deduped, so retrying the compensation is safe.
 */
export async function tbReverseTransfer(
  original: TBTransferRequest,
  context: string
): Promise<TBTransferResponse> {
  if (!original.ref) {
    throw new TBLedgerUnavailableError(
      `Cannot compensate ${context}: original transfer has no ref — manual reconciliation required.`
    );
  }
  const reversal: TBTransferRequest = {
    debitAccountId: original.creditAccountId,
    creditAccountId: original.debitAccountId,
    amount: original.amount,
    ledger: original.ledger,
    code: original.code,
    ref: `${original.ref}-REV`,
    txType: `${original.txType ?? "transfer"}_reversal`,
    agentId: original.agentId,
  };
  try {
    const out = await tbCreateTransfer(reversal);
    logger.error(
      `[tbClient] COMPENSATION posted for ${context}: reversal ref=${reversal.ref} amount=${original.amount} ` +
      `(original ref=${original.ref}). Root cause must be investigated.`
    );
    return out;
  } catch (err) {
    logger.error(
      `[tbClient] CRITICAL: UNRECONCILED ORPHAN TRANSFER — compensation FAILED for ${context}; ` +
      `original ref=${original.ref} amount=${original.amount} debit=${original.debitAccountId} credit=${original.creditAccountId}. ` +
      `Manual reconciliation required. Cause: ${err instanceof Error ? err.message : String(err)}`
    );
    throw err instanceof Error ? err : new TBLedgerUnavailableError(String(err));
  }
}

/**
 * Saga helper (PAY-1): run `pgEffect` after a TB transfer has committed; if
 * the PG effect throws, post the compensating reversal and rethrow the
 * original error annotated with the compensation outcome. Never swallow.
 */
export async function withTbCompensation<T>(
  context: string,
  original: TBTransferRequest,
  pgEffect: () => Promise<T>
): Promise<T> {
  try {
    return await pgEffect();
  } catch (err) {
    let compensated: boolean;
    try {
      await tbReverseTransfer(original, context);
      compensated = true;
    } catch {
      compensated = false;
    }
    if (err instanceof Error) {
      err.message = `${err.message} [TB compensation ${compensated ? "posted" : "FAILED — unreconciled orphan"}: ${original.ref}]`;
    }
    throw err;
  }
}

/**
 * Ensure an agent float account exists in the sidecar ledger.
 * Called once on agent login / first transaction.
 *
 * FAIL-CLOSED: throws TBLedgerUnavailableError when the sidecar is
 * unreachable or times out. Returns false only when the sidecar answered
 * with a non-OK status (an honest ledger answer the caller may inspect).
 */
// P-wave perf (2026-09-19): tbEnsureAgentAccount is called on agent login /
// first transaction and previously cost a sidecar RTT every time. Account
// creation is idempotent and durable — a CONFIRMED provisioning stays valid —
// so successes are cached (5min TTL, bounded). Failures are NEVER cached:
// fail-closed behavior (throw on unreachable, honest false on non-OK) is
// unchanged for any uncached agent.
const ENSURED_ACCOUNT_TTL_MS = 300_000;
const ENSURED_ACCOUNT_MAX = 10_000;
const ensuredAccounts = new Map<string, number>(); // agentId → expiresAt

/** Test-only handle for the ensured-account cache (P-wave perf). */
export const __tbEnsuredAccountsForTests = {
  cache: ensuredAccounts,
  TTL_MS: ENSURED_ACCOUNT_TTL_MS,
  MAX: ENSURED_ACCOUNT_MAX,
};

export async function tbEnsureAgentAccount(
  agentId: string
): Promise<boolean> {
  const cachedAt = ensuredAccounts.get(agentId);
  if (cachedAt !== undefined) {
    if (cachedAt > Date.now()) {
      ensuredAccounts.delete(agentId);
      ensuredAccounts.set(agentId, cachedAt); // LRU touch
      return true;
    }
    ensuredAccounts.delete(agentId);
  }
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
  if (res.ok) {
    ensuredAccounts.delete(agentId);
    ensuredAccounts.set(agentId, Date.now() + ENSURED_ACCOUNT_TTL_MS);
    while (ensuredAccounts.size > ENSURED_ACCOUNT_MAX) {
      const oldest = ensuredAccounts.keys().next().value;
      if (oldest === undefined) break;
      ensuredAccounts.delete(oldest);
    }
  }
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
