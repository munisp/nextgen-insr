/**
 * memberPoliciesApi.ts — R3 batch 1 PWA bindings (2026-10-01, R3)
 *
 * Typed tRPC-over-HTTP bindings for the member policies/products surface,
 * following the innovationApi.ts conventions exactly: the monolith appRouter
 * is mounted same-origin at /api/trpc with the superjson transformer, so
 * inputs travel as `{ json: ... }` and results are unwrapped from
 * `result.data.json`. Requests carry credentials: "include" (the member's
 * session cookie) — no tokens are stored or cached by this module.
 *
 * Bindings (all REAL — server/routers/memberPolicies.ts +
 * server/routers/insuranceProductCatalog.ts):
 *  - productCatalogApi.listProducts/getProduct/listCategories/getFeatured
 *    → insuranceProductCatalog.* (catalog reads; listProducts is
 *    serviceOrUserProcedure, the rest protectedProcedure)
 *  - memberPoliciesApi.myPolicies/myPolicy/quote
 *    → memberPolicies.* (2026-10-01 R3 router; protectedProcedure,
 *    caller-scoped via customers.keycloakSub = ctx.user.id)
 *
 * The NOT_FOUND/FORBIDDEN → null degradation is a defensive fallback for
 * older deployments that predate these mounts: pages MUST treat `null` as
 * "feature not available on this deployment" and render a disclosed empty
 * state. Genuine errors (network, 5xx, UNAUTHORIZED) still throw so pages
 * can show an honest error state. No data is ever fabricated here.
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
export class MemberPoliciesApiError extends Error {
  constructor(
    message: string,
    readonly trpcCode?: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "MemberPoliciesApiError";
  }
}

function isUnavailableError(error: MemberPoliciesApiError): boolean {
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
    throw new MemberPoliciesApiError(
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
    const err = new MemberPoliciesApiError(
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

// ── Product catalog (REAL — insuranceProductCatalog, 2026-10-01 R3) ────────

export interface CatalogProduct {
  id: number;
  productCode: string;
  name: string;
  description: string | null;
  coverageType: string;
  minPremium: string | null;
  maxCoverageAmount: string | null;
  minAge: number | null;
  maxAge: number | null;
  waitingPeriodDays: number | null;
  policyTermMonths: number | null;
  isActive: boolean;
  naicomProductCode: string | null;
  createdAt: string;
}

export interface CatalogCategory {
  id: number;
  name: string;
  description?: string | null;
  isActive: boolean;
}

export const productCatalogApi = {
  listProducts: (params?: {
    limit?: number;
    offset?: number;
    productType?:
      | "life"
      | "health"
      | "motor"
      | "property"
      | "agriculture"
      | "micro"
      | "all";
    search?: string;
  }) =>
    trpcCall<{ data: CatalogProduct[]; total: number }>(
      "insuranceProductCatalog.listProducts",
      "query",
      { productType: "all", isActive: true, limit: 50, offset: 0, ...params },
      { unavailableAsNull: true }
    ),
  getProduct: (id: number) =>
    trpcCall<CatalogProduct>(
      "insuranceProductCatalog.getProduct",
      "query",
      { id },
      { unavailableAsNull: true }
    ),
  listCategories: () =>
    trpcCall<CatalogCategory[]>(
      "insuranceProductCatalog.listCategories",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
  getFeatured: () =>
    trpcCall<CatalogProduct[]>(
      "insuranceProductCatalog.getFeatured",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
};

// ── Member policies (REAL — memberPolicies router, 2026-10-01 R3) ──────────

export interface MemberPolicyItem {
  id: number;
  policyNumber: string;
  status: string;
  coverageType: string;
  sumInsured: string;
  annualPremium: string;
  startDate: string | null;
  endDate: string | null;
  renewalDate: string | null;
  createdAt: string;
  productId: number;
  productName: string | null;
  currency: string;
}

export interface MemberPolicyDetail extends MemberPolicyItem {
  certificateNumber: string | null;
  productDescription: string | null;
}

export interface QuoteResult {
  productId: number;
  productName: string;
  sumInsured: number;
  durationMonths: number;
  baseRate: number;
  loadingFactor: number;
  telematicsRatingFactor: number;
  telematicsScore: number | null;
  annualPremium: number;
  premiumNGN: number;
  stampDuty: number;
  totalPayable: number;
  currency: string;
  validUntil: string;
}

export const memberPoliciesApi = {
  myPolicies: (params?: {
    status?:
      | "draft"
      | "quoted"
      | "bound"
      | "active"
      | "endorsed"
      | "renewed"
      | "cancelled"
      | "lapsed"
      | "expired"
      | "suspended";
    limit?: number;
    offset?: number;
  }) =>
    trpcCall<{ policies: MemberPolicyItem[]; count: number }>(
      "memberPolicies.myPolicies",
      "query",
      params,
      { unavailableAsNull: true }
    ),
  myPolicy: (id: number) =>
    trpcCall<MemberPolicyDetail>(
      "memberPolicies.myPolicy",
      "query",
      { id },
      { unavailableAsNull: true }
    ),
  quote: (input: {
    productId: number;
    sumInsured: number;
    durationMonths?: number;
    age?: number;
  }) =>
    trpcCall<QuoteResult>("memberPolicies.quote", "query", input, {
      unavailableAsNull: true,
    }),
};
