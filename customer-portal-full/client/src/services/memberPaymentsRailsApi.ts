/**
 * memberPaymentsRailsApi.ts — R3 batch 3 (2026-10-01, R3-b3)
 *
 * Typed tRPC-over-HTTP bindings for the member payments-rails surface
 * (this module: memberMobileMoney + memberAirtime). READ-ONLY — the funds
 * mutations (`mobileMoney.cashIn/cashOut`, `airtimeVending.vend`) are
 * `financialProcedure`s gated behind the `transfer` op which member
 * accounts (role "user") do not hold (permifyMiddleware.ts
 * ROLE_PERMISSIONS), and are deferred to the reviewed funds wave. No proc
 * here ever moves money; no number is fabricated.
 *
 * Procedure contracts consumed (verified against the server source
 * 2026-10-01, R3-b3):
 *  - memberMobileMoney.myTransactions query
 *      input: { provider?: "MTN MoMo"|"Airtel Money"|"Glo Xtra"|"9PSB";
 *               limit?: number (1..100, default 20); offset?: number } (opt)
 *      → { transactions: MemberMobileMoneyTx[]; count: number }
 *        (caller's phone-scoped rows, EVERY status verbatim)
 *  - memberMobileMoney.myTransaction query  input: { ref: string }
 *      → { transaction: MemberMobileMoneyTxDetail } (NOT_FOUND on miss)
 *  - memberMobileMoney.mySummary query  input: { periodDays?: number } (opt)
 *      → { periodDays: number; totalTransactions: number;
 *          byStatus: { status: string; count: number; volumeNGN: number }[] }
 *  - memberMobileMoney.providers query  input: none
 *      → { providers: { name: string; cashInCommission: number;
 *                       cashOutCommission: number }[];
 *          limits: { minAmountNGN: number; maxAmountNGN: number;
 *                    dailyLimitNGN: number };
 *          configured: boolean }   (configured:false → disclose unavailable)
 *  - memberAirtime.myHistory query
 *      input: { limit?: number; offset?: number } (optional)
 *      → { history: MemberAirtimeRow[]; total: number }
 *  - memberAirtime.mySummary query  input: { periodDays?: number } (opt)
 *      → same summary shape as memberMobileMoney.mySummary
 *
 * Transport: same-origin /api/trpc with credentials: "include" (member
 * session cookie), superjson envelope, paymentsApi.ts conventions
 * (2026-10-01 R3-b2). NOT_FOUND/FORBIDDEN → null → disclosed
 * UnavailableState on older deployments; genuine errors throw →
 * ErrorState.
 */

const TRPC_BASE = "/api/trpc";

/** Thrown for genuine failures (network, 5xx, UNAUTHORIZED). */
export class RailsApiError extends Error {
  constructor(
    message: string,
    readonly trpcCode?: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "RailsApiError";
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

/** Same defensive feature-detection contract as paymentsApi (R3-b2). */
function isUnavailableError(error: RailsApiError): boolean {
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
    throw new RailsApiError(
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
    const err = new RailsApiError(
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

// ── Shared shapes ──────────────────────────────────────────────────────────

/** Per-status summary bucket (memberMobileMoney.mySummary / memberAirtime.mySummary). */
export interface RailsStatusSummary {
  /** Ledger status verbatim (e.g. "success" | "pending" | "failed"). */
  status: string;
  count: number;
  volumeNGN: number;
}

export interface RailsSummary {
  periodDays: number;
  totalTransactions: number;
  byStatus: RailsStatusSummary[];
}

// ── memberMobileMoney (REAL — 2026-10-01, R3-b3) ───────────────────────────

/**
 * Row shape of memberMobileMoney.myTransactions. Amounts arrive as strings
 * (numeric columns) and are rendered verbatim. `providerStatus` is the
 * provider leg state verbatim — "pending_provider"/"unknown_outcome" are
 * disclosed, never renamed.
 */
export interface MemberMobileMoneyTx {
  ref: string;
  type: string;
  /** Numeric column — string, verbatim. */
  amount: string;
  fee: string | null;
  status: string;
  provider: string | null;
  providerStatus: string | null;
  createdAt: string;
}

/** Detail row of memberMobileMoney.myTransaction (adds failureReason). */
export interface MemberMobileMoneyTxDetail extends MemberMobileMoneyTx {
  failureReason: string | null;
}

export interface MyMobileMoneyTransactionsResult {
  transactions: MemberMobileMoneyTx[];
  count: number;
}

export interface MemberMobileMoneyProvider {
  name: string;
  cashInCommission: number;
  cashOutCommission: number;
}

export interface MemberMobileMoneyProvidersResult {
  providers: MemberMobileMoneyProvider[];
  limits: {
    minAmountNGN: number;
    maxAmountNGN: number;
    dailyLimitNGN: number;
  };
  /** Honest provider-integration status — false → top-ups unavailable. */
  configured: boolean;
}

export const memberMobileMoneyApi = {
  myTransactions: (params?: {
    provider?: "MTN MoMo" | "Airtel Money" | "Glo Xtra" | "9PSB";
    limit?: number;
    offset?: number;
  }) =>
    trpcCall<MyMobileMoneyTransactionsResult>(
      "memberMobileMoney.myTransactions",
      "query",
      params,
      { unavailableAsNull: true }
    ),
  myTransaction: (ref: string) =>
    trpcCall<{ transaction: MemberMobileMoneyTxDetail }>(
      "memberMobileMoney.myTransaction",
      "query",
      { ref },
      { unavailableAsNull: true }
    ),
  mySummary: (params?: { periodDays?: number }) =>
    trpcCall<RailsSummary>("memberMobileMoney.mySummary", "query", params, {
      unavailableAsNull: true,
    }),
  providers: () =>
    trpcCall<MemberMobileMoneyProvidersResult>(
      "memberMobileMoney.providers",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
};

// ── memberAirtime (REAL — 2026-10-01, R3-b3) ───────────────────────────────

/**
 * Row shape of memberAirtime.myHistory. `network`/`phoneNumber` come from
 * the vend metadata verbatim; `providerStatus` disclosed verbatim.
 */
export interface MemberAirtimeRow {
  ref: string;
  network: string | null;
  phoneNumber: string | null;
  /** Numeric column — string, verbatim. */
  amount: string;
  status: string;
  providerStatus: string | null;
  failureReason: string | null;
  createdAt: string;
}

export interface MyAirtimeHistoryResult {
  history: MemberAirtimeRow[];
  total: number;
}

export const memberAirtimeApi = {
  myHistory: (params?: { limit?: number; offset?: number }) =>
    trpcCall<MyAirtimeHistoryResult>(
      "memberAirtime.myHistory",
      "query",
      params,
      { unavailableAsNull: true }
    ),
  mySummary: (params?: { periodDays?: number }) =>
    trpcCall<RailsSummary>("memberAirtime.mySummary", "query", params, {
      unavailableAsNull: true,
    }),
};
