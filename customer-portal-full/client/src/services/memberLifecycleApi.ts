/**
 * memberLifecycleApi.ts — R3 batch 5 PWA bindings (2026-10-01, R3-b5)
 *
 * Typed tRPC-over-HTTP bindings for the member lifecycle routers
 * memberBeneficiaries / memberRenewals / memberEndorsements
 * (server/routers/memberBeneficiaries.ts, memberRenewals.ts,
 * memberEndorsements.ts — mounted under those names on the monolith
 * appRouter at /api/trpc, superjson transformer). Same envelope/credentials
 * conventions as memberClaimsApi.ts: inputs travel as `{ json: ... }`,
 * results are unwrapped from `result.data.json`, requests are same-origin
 * with credentials: "include" (the member's session cookie — no tokens
 * stored).
 *
 * Degradation contract (same as memberClaimsApi): NOT_FOUND/FORBIDDEN/
 * 404/403 resolve to `null` ONLY as a defensive fallback for deployments
 * whose backend predates the mount; pages MUST render a disclosed "not
 * available on this deployment" empty state. Genuine errors (network, 5xx,
 * UNAUTHORIZED) throw so pages can show an honest error state. No data is
 * ever fabricated by this module.
 *
 * PII note: beneficiary nationalId arrives MASKED from the server
 * (last-2 only) — this module never sees the full value.
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
export class MemberLifecycleApiError extends Error {
  constructor(
    message: string,
    readonly trpcCode?: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "MemberLifecycleApiError";
  }
}

/** Same feature-detection contract as memberClaimsApi.isUnavailableError. */
function isUnavailableError(error: MemberLifecycleApiError): boolean {
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
    throw new MemberLifecycleApiError(
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
    const err = new MemberLifecycleApiError(
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

// ── R3-b5 member lifecycle surfaces (REAL — server/routers/member*.ts) ─────
// Amounts are numeric(18,2) columns — serialized as strings over the wire.

export interface MemberBeneficiaryItem {
  id: number;
  policyId: number;
  name: string;
  relationship: string;
  percentage: string;
  dateOfBirth: string | null;
  isMinor: boolean | null;
  guardianName: string | null;
  /** MASKED by the server (last-2 only, e.g. "***34") — never the full id. */
  nationalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberRenewalItem {
  id: number;
  originalPolicyId: number;
  policyNumber: string;
  status: string;
  renewalDueDate: string;
  renewalPremium: string | null;
  isAutoRenewal: boolean | null;
  completedAt: string | null;
  createdAt: string;
  currency: string;
}

export interface MemberEndorsementItem {
  id: number;
  endorsementNumber: string;
  policyId: number;
  policyNumber: string;
  type: string;
  effectiveDate: string;
  description: string;
  premiumAdjustment: string | null;
  sumInsuredAdjustment: string | null;
  approvedAt: string | null;
  createdAt: string;
  currency: string;
}

export type EndorsementType =
  | "addition"
  | "deletion"
  | "modification"
  | "extension"
  | "reduction"
  | "cancellation"
  | "reinstatement";

export const memberBeneficiariesApi = {
  myBeneficiaries: (input: { policyId: number }) =>
    trpcCall<{ items: MemberBeneficiaryItem[] }>(
      "memberBeneficiaries.myBeneficiaries",
      "query",
      input,
      { unavailableAsNull: true }
    ),

  upsertBeneficiary: (input: {
    policyId: number;
    name: string;
    relationship: string;
    percentage: number;
    dateOfBirth?: string;
    isMinor?: boolean;
    guardianName?: string;
    nationalId?: string;
    beneficiaryId?: number;
  }) =>
    trpcCall<{ success: boolean; beneficiaryId: number }>(
      "memberBeneficiaries.upsertBeneficiary",
      "mutation",
      input
    ),

  removeBeneficiary: (input: { policyId: number; beneficiaryId: number }) =>
    trpcCall<{ success: boolean }>(
      "memberBeneficiaries.removeBeneficiary",
      "mutation",
      input
    ),
};

export const memberRenewalsApi = {
  myRenewals: (params?: { limit?: number; offset?: number }) =>
    trpcCall<{ renewals: MemberRenewalItem[]; count: number }>(
      "memberRenewals.myRenewals",
      "query",
      params,
      { unavailableAsNull: true }
    ),

  requestRenewal: (input: { policyId: number; isAutoRenewal?: boolean }) =>
    trpcCall<{ renewal: MemberRenewalItem }>(
      "memberRenewals.requestRenewal",
      "mutation",
      input
    ),
};

export const memberEndorsementsApi = {
  myEndorsements: (params?: {
    policyId?: number;
    limit?: number;
    offset?: number;
  }) =>
    trpcCall<{ endorsements: MemberEndorsementItem[]; count: number }>(
      "memberEndorsements.myEndorsements",
      "query",
      params,
      { unavailableAsNull: true }
    ),

  requestEndorsement: (input: {
    policyId: number;
    type: EndorsementType;
    effectiveDate: string;
    description: string;
    premiumAdjustment?: number;
    sumInsuredAdjustment?: number;
  }) =>
    trpcCall<{ endorsement: MemberEndorsementItem; endorsementNumber: string }>(
      "memberEndorsements.requestEndorsement",
      "mutation",
      input
    ),
};
