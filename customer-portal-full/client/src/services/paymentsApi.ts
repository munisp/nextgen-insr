/**
 * paymentsApi.ts — R3 batch 2 (2026-10-01, R3-b2)
 *
 * Typed tRPC-over-HTTP bindings for the member payments surface:
 * `memberPayments` (server/routers/memberPayments.ts). READ-ONLY — the
 * member premium funds path (payPremium) is deliberately not wired: the
 * underlying premiumTopUp.topUp is a financialProcedure gated by the
 * `premium_collect` role, which member accounts (role "user") do not hold
 * (permifyMiddleware.ts ROLE_PERMISSIONS), and it lacks a caller→policy
 * ownership check. The reviewed funds wave owns that change; until then the
 * UI renders a disclosed "online premium payment coming soon" notice and
 * NEVER simulates a payment.
 *
 * Procedure contracts consumed (verified against the server source
 * 2026-10-01, R3-b2):
 *  - myPremiums   query  input: { policyId?: number; limit?: number (1..100,
 *                                 default 50); offset?: number } (optional)
 *      → { premiums: MemberPremiumRow[]; count: number }
 *        (caller's premium ledger rows, EVERY status verbatim)
 *  - myPremiumDue query  input: none
 *      → { duePremiums: MemberPremiumDueRow[];
 *          policies: MemberPayablePolicy[]; disclosure: string }
 *        (duePremiums = real ledger rows with status "due"; policies carry
 *        the recorded annualPremium as a REFERENCE amount — never a
 *        synthesized outstanding balance)
 *
 * Transport: same-origin /api/trpc with credentials: "include" (member
 * session cookie), superjson envelope ({ json: ... } in / result.data.json
 * out), walletApi.ts conventions (2026-10-01 R3). NOT_FOUND/FORBIDDEN → null
 * → disclosed UnavailableState on older deployments; genuine errors throw →
 * ErrorState. No number shown from this module is ever fabricated.
 */

const TRPC_BASE = "/api/trpc";

/** Thrown for genuine failures (network, 5xx, UNAUTHORIZED). */
export class PaymentsApiError extends Error {
  constructor(
    message: string,
    readonly trpcCode?: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "PaymentsApiError";
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

/** 2026-10-01 (R3-b2): same defensive feature-detection contract as walletApi. */
function isUnavailableError(error: PaymentsApiError): boolean {
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
    throw new PaymentsApiError(
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
    const err = new PaymentsApiError(
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

// ── memberPayments (REAL — 2026-10-01, R3-b2) ──────────────────────────────

/**
 * Row shape of memberPayments.myPremiums — mirrors the premiums ledger
 * columns the router selects (drizzle/schema.additions.ts:303). Amounts
 * arrive as strings (numeric columns) and are rendered verbatim.
 */
export interface MemberPremiumRow {
  id: number;
  policyId: number;
  premiumRef: string;
  /** Numeric column — string, verbatim. */
  amount: string;
  currency: string;
  dueDate: string;
  paidDate: string | null;
  /** Ledger status, shown verbatim (e.g. "due" | "paid" | "failed"). */
  status: string;
  paymentMethod: string | null;
  paymentRef: string | null;
  createdAt: string;
  policyNumber: string | null;
}

/** Response of memberPayments.myPremiums (verified 2026-10-01, R3-b2). */
export interface MyPremiumsResult {
  premiums: MemberPremiumRow[];
  count: number;
}

/** Row shape of memberPayments.myPremiumDue duePremiums (status "due"). */
export interface MemberPremiumDueRow {
  id: number;
  policyId: number;
  premiumRef: string;
  /** Recorded due amount — string, verbatim. */
  amount: string;
  currency: string;
  dueDate: string;
  gracePeriodDays: number | null;
  status: string;
  policyNumber: string | null;
}

/**
 * Payable-policy reference row of memberPayments.myPremiumDue. annualPremium
 * is the RECORDED policy amount — a reference figure, NOT a computed
 * outstanding balance (no such column exists; none is invented server-side).
 */
export interface MemberPayablePolicy {
  id: number;
  policyNumber: string;
  status: string;
  /** Recorded annual premium — string, verbatim. */
  annualPremium: string;
  renewalDate: string | null;
  productId: number;
  productName: string | null;
  currency: "NGN";
}

/** Response of memberPayments.myPremiumDue (verified 2026-10-01, R3-b2). */
export interface MyPremiumDueResult {
  duePremiums: MemberPremiumDueRow[];
  policies: MemberPayablePolicy[];
  /** Server-supplied honesty note — render it verbatim. */
  disclosure: string;
}

export const paymentsApi = {
  myPremiums: (params?: { policyId?: number; limit?: number; offset?: number }) =>
    trpcCall<MyPremiumsResult>(
      "memberPayments.myPremiums",
      "query",
      params,
      { unavailableAsNull: true }
    ),
  myPremiumDue: () =>
    trpcCall<MyPremiumDueResult>(
      "memberPayments.myPremiumDue",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
};
