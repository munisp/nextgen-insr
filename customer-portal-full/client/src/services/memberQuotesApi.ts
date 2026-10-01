/**
 * memberQuotesApi.ts — R3 batch 5 PWA bindings (2026-10-01, R3-b5)
 *
 * Typed tRPC-over-HTTP bindings for the memberQuotes router
 * (server/routers/memberQuotes.ts, mounted as `memberQuotes` on the
 * monolith appRouter at /api/trpc, superjson transformer). Same
 * envelope/credentials conventions as memberClaimsApi.ts: inputs travel as
 * `{ json: ... }`, results are unwrapped from `result.data.json`, requests
 * are same-origin with credentials: "include".
 *
 * The server binds every cart row to the caller's resolved customers.id —
 * this module NEVER sends a customerId (the member input schemas have no
 * such field; identity comes from the session cookie).
 *
 * Degradation contract (same as memberClaimsApi): NOT_FOUND/FORBIDDEN/
 * 404/403 resolve to `null` as a defensive fallback for deployments whose
 * backend predates the mount; pages MUST render a disclosed "not available
 * on this deployment" empty state. Genuine errors throw. No data is ever
 * fabricated by this module.
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

/** Thrown for genuine failures (network, 5xx, UNAUTHORIZED). */
export class MemberQuotesApiError extends Error {
  constructor(
    message: string,
    readonly trpcCode?: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "MemberQuotesApiError";
  }
}

/** Same feature-detection contract as memberClaimsApi.isUnavailableError. */
function isUnavailableError(error: MemberQuotesApiError): boolean {
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
    throw new MemberQuotesApiError(
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
    const err = new MemberQuotesApiError(
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

// ── R3-b5 member quote cart (REAL — server/routers/memberQuotes.ts) ────────
// Amounts are numeric(18,2) columns — serialized as strings over the wire.

export interface MemberQuoteItem {
  id: number;
  productId: number | null;
  productName: string | null;
  productType: string | null;
  sumInsured: string | null;
  premiumAmount: string | null;
  stampDuty: string | null;
  totalPayable: string | null;
  durationMonths: number | null;
  coverageType: string | null;
  status: string;
  validUntil: string | null;
  createdAt: string;
}

export interface MemberQuoteCart {
  items: MemberQuoteItem[];
  subTotal: number;
  totalPremium: number;
  count: number;
  currency: string;
}

export interface AddQuoteResult {
  quote: MemberQuoteItem & { customerId: number | null };
  premiumAmount: number;
  stampDuty: number;
  totalPayable: number;
  currency: string;
}

export const memberQuotesApi = {
  myQuoteCart: () =>
    trpcCall<MemberQuoteCart>("memberQuotes.myQuoteCart", "query", undefined, {
      unavailableAsNull: true,
    }),

  addToQuoteCart: (input: {
    productId: number;
    sumInsured: number;
    durationMonths?: number;
    coverageType?: string;
  }) =>
    trpcCall<AddQuoteResult>(
      "memberQuotes.addToQuoteCart",
      "mutation",
      input
    ),

  removeQuoteItem: (input: { quoteId: number }) =>
    trpcCall<{ removed: boolean; quoteId: number }>(
      "memberQuotes.removeQuoteItem",
      "mutation",
      input
    ),

  clearQuoteCart: () =>
    trpcCall<{ cleared: boolean; cancelled: number }>(
      "memberQuotes.clearQuoteCart",
      "mutation"
    ),

  quoteSummary: () =>
    trpcCall<{ count: number; totalPremium: number; currency: string }>(
      "memberQuotes.quoteSummary",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
};
