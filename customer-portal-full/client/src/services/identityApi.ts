/**
 * identityApi.ts — R3 batch 4 PWA bindings (2026-10-01, R3-b4)
 *
 * Typed tRPC-over-HTTP bindings for the memberIdentity router
 * (server/routers/memberIdentity.ts, mounted as `memberIdentity` on the
 * monolith appRouter at /api/trpc, superjson transformer). Same
 * envelope/credentials/error contract as memberClaimsApi.ts: inputs travel
 * as `{ json: ... }`, results are unwrapped from `result.data.json`,
 * requests are same-origin with credentials: "include" (the member's
 * session cookie — no tokens stored).
 *
 * IDENTITY DOMAIN — extra-strict rules:
 *  - There is NO enroll/verify/document-upload binding here and there must
 *    never be one: the underlying enroll path is self-attested (fabricated
 *    identity) and the real provider flow is deferred to a separate wave.
 *  - No bvn/nin (AES-256-GCM at rest), hashes, or embeddingVector ever
 *    crosses this boundary — the server never selects them and this module
 *    never types them.
 *
 * Degradation contract (same as memberClaimsApi): NOT_FOUND/FORBIDDEN/
 * 404/403 resolve to `null` ONLY as a defensive fallback for deployments
 * whose backend predates the mount; pages MUST render a disclosed
 * "not available on this deployment" empty state. Genuine errors (network,
 * 5xx, UNAUTHORIZED) throw so pages can show an honest error state. No data
 * is ever fabricated by this module.
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
export class IdentityApiError extends Error {
  constructor(
    message: string,
    readonly trpcCode?: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "IdentityApiError";
  }
}

/** Same feature-detection contract as memberClaimsApi. */
function isUnavailableError(error: IdentityApiError): boolean {
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
    throw new IdentityApiError(
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
    const err = new IdentityApiError(
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

// ── R3-b4 member identity surface (REAL — server/routers/memberIdentity.ts)
// NOTE: numeric(5,2)/numeric(5,4) columns (livenessScore, docConfidence,
// qualityScore) serialize as strings over the wire; timestamps as ISO
// strings under the superjson envelope.

export interface MyKycSession {
  id: number;
  status: string;
  type: string;
  livenessPassed: boolean | null;
  livenessScore: number | null;
  docType: string | null;
  docConfidence: number | null;
  rejectionReason: string | null;
  reviewedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MyKycStatus {
  hasProfile: boolean;
  hasSession: boolean;
  status: string; // session status, or "unstarted"
  kycLevel: number;
  session: MyKycSession | null;
}

export interface MyMfaStatus {
  mfaEnabled: boolean;
  available: boolean; // always false on this deployment — no MFA capability
  reason: string;
}

/** Static CBN tier requirements from the KYC enforcement gateway. The
 * gateway owns the shape; we type it as unknown and render defensively. */
export type KycTierRequirements = unknown;

export interface MyFaceEnrollment {
  id: number;
  enrollmentType: string; // kyc | login | payment
  embeddingVersion: string;
  qualityScore: string | null;
  livenessScore: string | null;
  isActive: boolean;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  /** These credentials come from the self-attested enroll path — they are
   * NOT provider-verified. Render this label verbatim. */
  verificationBasis: "self-enrolled";
}

export interface LivenessCooldown {
  locked: boolean;
  remainingMs: number;
  failures: number;
}

export const identityApi = {
  getMyKycStatus: () =>
    trpcCall<MyKycStatus>("memberIdentity.myKycStatus", "query", undefined, {
      unavailableAsNull: true,
    }),

  getMyMfaStatus: () =>
    trpcCall<MyMfaStatus>("memberIdentity.myMfaStatus", "query", undefined, {
      unavailableAsNull: true,
    }),

  getKycTierRequirements: () =>
    trpcCall<KycTierRequirements>(
      "memberIdentity.kycTierRequirements",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),

  getMyFaceEnrollments: () =>
    trpcCall<MyFaceEnrollment[]>(
      "memberIdentity.myFaceEnrollments",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),

  getMyActiveFaceEnrollment: (input?: {
    enrollmentType?: "kyc" | "login" | "payment";
  }) =>
    trpcCall<MyFaceEnrollment | null>(
      "memberIdentity.myActiveFaceEnrollment",
      "query",
      input ?? {},
      { unavailableAsNull: true }
    ),

  revokeMyFaceEnrollment: (input: { enrollmentId: number; reason: string }) =>
    trpcCall<{ success: true; id: number }>(
      "memberIdentity.revokeMyFaceEnrollment",
      "mutation",
      input
    ),

  checkLivenessCooldown: () =>
    trpcCall<LivenessCooldown>(
      "memberIdentity.checkLivenessCooldown",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
};
