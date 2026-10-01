/**
 * walletApi.ts — R3 batch 1 (2026-10-01, R3)
 *
 * Typed tRPC-over-HTTP bindings for the member wallet surface:
 * `customerWalletSystem` (server/routers/customerWalletSystem.ts, mounted
 * server/routers.ts:922 as `customerWalletSystem`).
 *
 * Verified against the server source (2026-10-01, R3) — the router is
 * ALREADY member-safe (F14-4 hardened): the wallet owner is resolved
 * server-side via customers.keycloakSub = ctx.user.id, a client-supplied
 * customerId is never trusted. No new server procedures were required for
 * this slice.
 *
 * Procedure contracts consumed (verified verbatim):
 *  - getBalance      query     input: none
 *      → { customerId: number; balance: number; currency: "NGN" }
 *        (settled-only: Cash In − Cash Out rows with status 'success')
 *  - getTransactions query     input: { limit?: number /* int, 1..200, default 50 *\/ } (optional)
 *      → { transactions: WalletTransactionRow[]; total: number }
 *        (session customer's full history, every status shown — honest)
 *  - topUp           mutation  input: { amount: number (>0); source: string (min 1);
 *                                       railReference: string (8..64);
 *                                       idempotencyKey: string (8..64) }
 *      → { success: true; idempotent: boolean; transactionId: number; amount: number }
 *        Fail-closed (PAY-4): railReference must be an ALREADY-SETTLED rail
 *        record (status 'success', matching amount); otherwise
 *        PRECONDITION_FAILED. Idempotency-key payload mismatch → CONFLICT.
 *        The UI must surface these errors verbatim — never a fake success.
 *
 * Transport: same-origin /api/trpc with credentials: "include" (member
 * session cookie — no tokens stored here), superjson envelope
 * ({ json: ... } in / result.data.json out). Follows the
 * innovationApi.ts conventions (self-contained copy of the envelope
 * handling — that module's trpcCall helper is not exported, and per R3
 * discipline this file is additive-only).
 *
 * getBalance / getTransactions degrade NOT_FOUND/FORBIDDEN/404/403 → null so
 * the page can render a disclosed "not available" state on older
 * deployments. topUp NEVER degrades: every rail/config failure throws so
 * the page can render the honest error (funds path = fail-closed).
 * No number shown from this module is ever fabricated.
 */

const TRPC_BASE = "/api/trpc";

/** Thrown for genuine failures (network, 5xx, UNAUTHORIZED, rail rejections). */
export class WalletApiError extends Error {
  constructor(
    message: string,
    readonly trpcCode?: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "WalletApiError";
  }
}

interface TrpcEnvelope<T> {
  result?: { data?: { json?: T } | T };
  error?: {
    message?: string;
    code?: number | string;
    data?: { code?: string; httpStatus?: number };
  };
}

/** 2026-10-01 (R3): same defensive feature-detection contract as innovationApi. */
function isUnavailableError(error: WalletApiError): boolean {
  return (
    error.trpcCode === "NOT_FOUND" ||
    error.trpcCode === "FORBIDDEN" ||
    error.httpStatus === 404 ||
    error.httpStatus === 403
  );
}

async function trpcCall<T>(
  path: string,
  type: "query" | "mutation",
  input?: unknown,
  { unavailableAsNull = false }: { unavailableAsNull?: boolean } = {}
): Promise<T | null> {
  let response: Response;
  try {
    if (type === "query") {
      const qs =
        input === undefined
          ? ""
          : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
      response = await fetch(`${TRPC_BASE}/${path}${qs}`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
    } else {
      response = await fetch(`${TRPC_BASE}/${path}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ json: input ?? null }),
      });
    }
  } catch (error) {
    throw new WalletApiError(
      `Network error contacting ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let envelope: TrpcEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as TrpcEnvelope<T>;
  } catch {
    envelope = null;
  }

  if (!response.ok || !envelope || envelope.error) {
    const err = new WalletApiError(
      envelope?.error?.message ?? `Request failed (HTTP ${response.status})`,
      envelope?.error?.data?.code ??
        (typeof envelope?.error?.code === "string"
          ? envelope.error.code
          : undefined),
      envelope?.error?.data?.httpStatus ?? response.status
    );
    if (unavailableAsNull && isUnavailableError(err)) return null;
    throw err;
  }
  const data = envelope.result?.data;
  const unwrapped =
    data != null && typeof data === "object" && "json" in data
      ? (data as { json?: T }).json
      : (data as T | undefined);
  return (unwrapped ?? null) as T | null;
}

// ── customerWalletSystem (REAL — 2026-10-01, R3) ──────────────────────────

/** Response of customerWalletSystem.getBalance (verified 2026-10-01, R3). */
export interface WalletBalance {
  customerId: number;
  /** Settled-only balance (Cash In − Cash Out, status 'success'), NGN. */
  balance: number;
  currency: "NGN";
}

/**
 * Row shape of customerWalletSystem.getTransactions — mirrors drizzle
 * `transactions` columns the wallet router selects (select() full row).
 * Amounts arrive as strings (numeric columns) and are rendered verbatim.
 */
export interface WalletTransactionRow {
  id: number;
  ref: string;
  idempotencyKey: string | null;
  agentId: number;
  type: string; // tx_type enum, e.g. "Cash In" | "Cash Out" | "Transfer"
  amount: string;
  fee: string | null;
  currency: string; // default "NGN"
  customerName: string | null;
  channel: string | null;
  status: string; // "success" | "pending" | "failed" | ...
  failureReason: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}

/** Response of customerWalletSystem.getTransactions (verified 2026-10-01, R3). */
export interface WalletTransactionsResult {
  transactions: WalletTransactionRow[];
  total: number;
}

/** Input of customerWalletSystem.topUp (zod-verified 2026-10-01, R3). */
export interface WalletTopUpInput {
  /** NGN amount, > 0; must match the settled rail record exactly. */
  amount: number;
  /** Funding source label (min length 1). */
  source: string;
  /** Reference of an ALREADY-SETTLED inbound rail payment (8..64 chars). */
  railReference: string;
  /** Client-generated unique key (8..64 chars) binding one logical request. */
  idempotencyKey: string;
}

/** Response of customerWalletSystem.topUp (verified 2026-10-01, R3). */
export interface WalletTopUpResult {
  success: true;
  /** true when the call was an idempotent replay of a prior winner. */
  idempotent: boolean;
  transactionId: number;
  amount: number;
}

export const walletApi = {
  getBalance: () =>
    trpcCall<WalletBalance>(
      "customerWalletSystem.getBalance",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
  getTransactions: (params?: { limit?: number }) =>
    trpcCall<WalletTransactionsResult>(
      "customerWalletSystem.getTransactions",
      "query",
      params,
      { unavailableAsNull: true }
    ),
  /**
   * Funds path — fail-closed. No unavailableAsNull here: rail/config/
   * idempotency failures (PRECONDITION_FAILED, CONFLICT, 5xx) must reach
   * the caller so the UI can render the honest server message. The wallet
   * is never credited by this client; the server credits only against a
   * verified settled rail leg.
   */
  topUp: (input: WalletTopUpInput) =>
    trpcCall<WalletTopUpResult>(
      "customerWalletSystem.topUp",
      "mutation",
      input
    ),
};
