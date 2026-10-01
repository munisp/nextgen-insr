/**
 * memberBillsFxApi.ts — R3 batch 3 PWA bindings (2026-10-01, R3-b3)
 *
 * Typed tRPC-over-HTTP bindings for the member bill-payments catalog and FX
 * surfaces, following the memberPoliciesApi.ts conventions exactly: the
 * monolith appRouter is mounted same-origin at /api/trpc with the superjson
 * transformer, so inputs travel as `{ json: ... }` and results are unwrapped
 * from `result.data.json`. Requests carry credentials: "include" (the
 * member's session cookie) — no tokens are stored or cached by this module.
 *
 * Bindings (all REAL, READ-ONLY — server/routers/memberBillPayments.ts +
 * server/routers/memberFxRates.ts, 2026-10-01 R3-b3):
 *  - memberBillPaymentsApi.billers/validateCustomer → memberBillPayments.*
 *    (biller catalog + customer-number format validator; payment initiation
 *    is deferred — billPayments.pay is a funds mutation behind
 *    financialProcedure and is NEVER called from the member PWA)
 *  - memberFxRatesApi.rates/convert/currencies/historical → memberFxRates.*
 *    (stored EUR-base rate book + real Frankfurter/ECB history;
 *    updateRates/refresh are never called — broken authz in the base router)
 *
 * The NOT_FOUND/FORBIDDEN → null degradation is a defensive fallback for
 * older deployments that predate these mounts: pages MUST treat `null` as
 * "feature not available on this deployment" and render a disclosed empty
 * state. PRECONDITION_FAILED (no FX rates stored) also resolves to null for
 * the converter so pages can disclose "rates not refreshed yet". Genuine
 * errors (network, 5xx, UNAUTHORIZED) still throw so pages can show an
 * honest error state. No data is ever fabricated here.
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
export class MemberBillsFxApiError extends Error {
  constructor(
    message: string,
    readonly trpcCode?: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "MemberBillsFxApiError";
  }
}

function isUnavailableError(error: MemberBillsFxApiError): boolean {
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
    throw new MemberBillsFxApiError(
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
    const err = new MemberBillsFxApiError(
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

// ── Bill payments catalog (REAL — memberBillPayments router, R3-b3) ────────

export interface BillerInfo {
  name: string;
  commissionRate: number;
  commissionPct: string;
}

export interface BillerCatalog {
  billers: BillerInfo[];
  limits: { minAmountNGN: number; maxAmountNGN: number; dailyLimitNGN: number };
  configured: boolean;
}

export interface ValidateCustomerResult {
  valid: boolean;
  customerNumber: string;
  biller: string;
  message: string;
}

export const memberBillPaymentsApi = {
  billers: () =>
    trpcCall<BillerCatalog>("memberBillPayments.billers", "query", undefined, {
      unavailableAsNull: true,
    }),
  validateCustomer: (input: { biller: string; customerNumber: string }) =>
    trpcCall<ValidateCustomerResult>(
      "memberBillPayments.validateCustomer",
      "query",
      input,
      { unavailableAsNull: true }
    ),
};

// ── FX rates (REAL — memberFxRates router, R3-b3) ──────────────────────────

export interface FxRatesResult {
  baseCurrency: string;
  rates: Record<string, number>;
  lastUpdated: string | null;
}

export interface FxConvertResult {
  from: string;
  to: string;
  amount: number;
  convertedAmount: number;
  rate: number;
}

export interface FxCurrenciesResult {
  currencies: Array<{ code: string; rate: number }>;
  baseCurrency: string;
}

export interface FxHistoricalResult {
  base: string;
  target: string;
  timeseries: Array<{ date: string; rate: number }>;
  source: string;
}

export const memberFxRatesApi = {
  rates: (baseCurrency?: string) =>
    trpcCall<FxRatesResult>(
      "memberFxRates.rates",
      "query",
      baseCurrency ? { baseCurrency } : undefined,
      { unavailableAsNull: true }
    ),
  /**
   * PRECONDITION_FAILED (no rates stored / malformed book / unknown
   * currency) is surfaced as null so the page can disclose "rates not
   * refreshed yet" instead of an error; genuine failures still throw.
   */
  convert: async (input: { from: string; to: string; amount: number }) => {
    try {
      return await trpcCall<FxConvertResult>(
        "memberFxRates.convert",
        "query",
        input,
        { unavailableAsNull: true }
      );
    } catch (error) {
      if (
        error instanceof MemberBillsFxApiError &&
        error.trpcCode === "PRECONDITION_FAILED"
      ) {
        return null;
      }
      throw error;
    }
  },
  currencies: () =>
    trpcCall<FxCurrenciesResult>("memberFxRates.currencies", "query", undefined, {
      unavailableAsNull: true,
    }),
  historical: (input?: { base?: string; target?: string; days?: number }) =>
    trpcCall<FxHistoricalResult>(
      "memberFxRates.historical",
      "query",
      input,
      { unavailableAsNull: true }
    ),
};
