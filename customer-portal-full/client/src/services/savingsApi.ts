/**
 * savingsApi.ts — R3 batch 2 PWA bindings (2026-10-01, R3-b2)
 *
 * Typed tRPC-over-HTTP bindings for the member savings/accounts surface
 * (`memberSavings` router, server/routers/memberSavings.ts), following the
 * memberPoliciesApi.ts conventions exactly: the monolith appRouter is mounted
 * same-origin at /api/trpc with the superjson transformer, so inputs travel
 * as `{ json: ... }` and results are unwrapped from `result.data.json`.
 * Requests carry credentials: "include" (the member's session cookie) — no
 * tokens are stored or cached by this module.
 *
 * Bindings (all REAL — memberSavings.*):
 *  - savingsApi.mySummary      → settled-only (status="success") Cash In −
 *                                Cash Out balance; never fabricated
 *  - savingsApi.myTransactions → caller-scoped transaction history
 *  - savingsApi.myAccount      → own customers row projection (never PII), or
 *                                `{ account: null }` when no profile exists
 *  - savingsApi.openMyAccount  → session-bound account opening (names/identity
 *                                come from the session server-side; bvn/nin
 *                                optional; fail-closed KYC gate)
 *
 * There is intentionally NO deposit/withdraw binding — the domain
 * savingsProducts money paths write success rows with no rail leg
 * (fabricated funds) and are not exposed to members. Funding goes through
 * `/wallet` (batch 1, rail-verified).
 *
 * The NOT_FOUND/FORBIDDEN → null degradation is a defensive fallback for
 * older deployments that predate this mount (and for members without a
 * savings profile on the savings views): pages MUST treat `null` as a
 * disclosed state, never as a zero balance. Genuine errors (network, 5xx,
 * UNAUTHORIZED) still throw so pages can show an honest error state. No data
 * is ever fabricated here.
 */

const TRPC_BASE = "/api/trpc";

interface TrpcEnvelope<T> {
  result?: { data?: { json?: T } | T };
  error?: {
    message?: string;
    code?: number | string;
    data?: { code?: string; httpStatus?: number };
  };
}

/** Thrown for genuine failures (network, 5xx, UNAUTHORIZED, CONFLICT…). */
export class SavingsApiError extends Error {
  constructor(
    message: string,
    readonly trpcCode?: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "SavingsApiError";
  }
}

function isUnavailableError(error: SavingsApiError): boolean {
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
    throw new SavingsApiError(
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
    const err = new SavingsApiError(
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

// ── Member savings/accounts (REAL — memberSavings router, 2026-10-01 R3-b2) ──

export interface SavingsSummary {
  customerId: number;
  /** Settled-only balance: status="success" Cash In − Cash Out. */
  balance: number;
  totalIn: number;
  totalOut: number;
  settledTransactions: number;
  currency: string;
}

export interface SavingsTransaction {
  id: number;
  ref: string;
  type: string;
  amount: string;
  currency: string;
  channel: string | null;
  status: string;
  failureReason: string | null;
  createdAt: string;
}

export interface MemberAccount {
  id: number;
  firstName: string;
  lastName: string;
  status: string;
  kycLevel: number;
  createdAt: string;
}

export const savingsApi = {
  mySummary: () =>
    trpcCall<SavingsSummary>("memberSavings.mySummary", "query", undefined, {
      unavailableAsNull: true,
    }),
  myTransactions: (params?: {
    limit?: number;
    offset?: number;
    type?: "Cash In" | "Cash Out";
  }) =>
    trpcCall<{ transactions: SavingsTransaction[]; count: number }>(
      "memberSavings.myTransactions",
      "query",
      params,
      { unavailableAsNull: true }
    ),
  myAccount: () =>
    trpcCall<{ account: MemberAccount | null }>(
      "memberSavings.myAccount",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
  /**
   * Mutation: genuine errors (CONFLICT duplicate, PRECONDITION_FAILED KYC
   * gate blocked, validation) THROW so the form can surface the server's
   * real message — never swallow them into a fake success.
   */
  openMyAccount: (input: {
    phone: string;
    email?: string;
    bvn?: string;
    nin?: string;
    address?: string;
  }) =>
    trpcCall<{ success: boolean; account: MemberAccount }>(
      "memberSavings.openMyAccount",
      "mutation",
      input
    ),
};
