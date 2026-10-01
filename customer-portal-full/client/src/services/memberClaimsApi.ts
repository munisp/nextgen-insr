/**
 * memberClaimsApi.ts — R3 batch 1 PWA bindings (2026-10-01, R3)
 *
 * Typed tRPC-over-HTTP bindings for the memberClaims router
 * (server/routers/memberClaims.ts, mounted as `memberClaims` on the monolith
 * appRouter at /api/trpc, superjson transformer). Same envelope/credentials
 * conventions as innovationApi.ts: inputs travel as `{ json: ... }`, results
 * are unwrapped from `result.data.json`, requests are same-origin with
 * credentials: "include" (the member's session cookie — no tokens stored).
 *
 * This is a standalone module (innovationApi.ts is not edited in R3 batch 1;
 * the wiring decision for a shared trpc helper is deferred to integration).
 *
 * Degradation contract (same as innovationApi): NOT_FOUND/FORBIDDEN/404/403
 * resolve to `null` ONLY as a defensive fallback for deployments whose
 * backend predates the mount; pages MUST render a disclosed "not available
 * on this deployment" empty state. Genuine errors (network, 5xx,
 * UNAUTHORIZED) throw so pages can show an honest error state. No data is
 * ever fabricated by this module.
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
export class MemberClaimsApiError extends Error {
  constructor(
    message: string,
    readonly trpcCode?: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "MemberClaimsApiError";
  }
}

/** Same feature-detection contract as innovationApi.isUnavailableError. */
function isUnavailableError(error: MemberClaimsApiError): boolean {
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
    throw new MemberClaimsApiError(
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
    const err = new MemberClaimsApiError(
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

// ── R3 member claims surface (REAL — server/routers/memberClaims.ts) ───────
// Amounts are numeric(18,2) columns — serialized as strings over the wire.

export interface MemberClaimItem {
  id: number;
  claimNumber: string;
  policyId: number;
  policyNumber: string;
  status: string;
  claimType: string;
  incidentDate: string;
  reportedDate: string;
  claimedAmount: string;
  approvedAmount: string | null;
  paidAmount: string | null;
  createdAt: string;
}

export interface MemberClaimDetail extends MemberClaimItem {
  deductible: string | null;
  incidentDescription: string;
  rejectionReason: string | null;
  settlementDate: string | null;
  updatedAt: string;
}

export interface MemberClaimDocument {
  id: number;
  documentType: string;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string | null;
  isVerified: boolean;
  createdAt: string;
}

export interface ClaimPolicyPickerItem {
  id: number;
  policyNumber: string;
  productName: string;
  sumInsured: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
}

export interface FileClaimResult {
  claim: { id: number; claimNumber: string; status: string };
  claimNumber: string;
}

export const memberClaimsApi = {
  myClaims: (params?: { status?: string; limit?: number; offset?: number }) =>
    trpcCall<{ claims: MemberClaimItem[]; count: number }>(
      "memberClaims.myClaims",
      "query",
      params,
      { unavailableAsNull: true }
    ),

  myClaim: (input: { id: number }) =>
    trpcCall<{ claim: MemberClaimDetail; documents: MemberClaimDocument[] }>(
      "memberClaims.myClaim",
      "query",
      input,
      { unavailableAsNull: true }
    ),

  /** Real policy picker source — the caller's ACTIVE policies only. */
  myPoliciesPicker: () =>
    trpcCall<{ policies: ClaimPolicyPickerItem[] }>(
      "memberClaims.myPoliciesPicker",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),

  fileClaim: (input: {
    policyId: number;
    claimType: string;
    incidentDate: string;
    claimedAmount: number;
    incidentDescription: string;
    documents?: string[];
  }) =>
    trpcCall<FileClaimResult>("memberClaims.fileClaim", "mutation", input),
};
