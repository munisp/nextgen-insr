/**
 * innovationApi.ts — Q-wave Q6 PWA bindings (2026-09-25)
 *
 * Typed tRPC-over-HTTP bindings for the Q-wave innovation backends, following
 * the same envelope pattern as the mobile app (mobile/insurance-mobile,
 * Q4 2026-09-25): the monolith appRouter is mounted at /api/trpc with the
 * superjson transformer, so inputs travel as `{ json: ... }` and results are
 * unwrapped from `result.data.json`. Requests are same-origin with
 * credentials: "include", i.e. the member's existing session cookie — no
 * tokens are stored or cached by this module.
 *
 * Binding status per surface (2026-10-01, R2 — all bindings now REAL):
 *  - careRetention.*            REAL — Q4 checkpoint server/routers/careRetention.ts
 *  - documentManagement.requestUploadUrl  REAL — existing P-wave presigned flow
 *  - parametricMember.myCoverage/myPayouts  REAL — Q6 member router
 *    server/routers/parametricMember.ts (protectedProcedure, READ-ONLY views
 *    over the Q2 0087 tables; the admin engine stays on parametricEngine).
 *  - poolSurplus.*  REAL — member reads on the Q3 p2pPools router
 *    (p2pPools.myMemberships / p2pPools.myStatements; surplus mutations stay
 *    financialProcedure-gated).
 *  - telematicsScore.*  REAL — member reads on the Q3 telematics router
 *    (telematics.myScore / telematics.myTrips).
 *  - usageCover.*  REAL — Q3 usageCover router (usageCover.myActivations /
 *    activateCover / cancelCover; server names are the contract of record).
 *  - freemiumTiers.*  REAL — Q6 member router server/routers/freemiumTiers.ts
 *    (freemiumTiers.myTier / listTiers / upgrade; upgrade delegates to the
 *    Q1 embeddedFactory procedures — premium collection stays fail-closed).
 *
 * The NOT_FOUND/FORBIDDEN → null degradation below is kept ONLY as a
 * defensive fallback (2026-10-01, R2): if a deployment runs an older backend
 * that predates these mounts, pages still render the disclosed "not
 * available" empty state instead of crashing. It is no longer the primary
 * path — every binding above resolves against the live monolith.
 */

const TRPC_BASE = "/api/trpc";

/**
 * Envelope tolerance (2026-09-25): the monolith appRouter (superjson
 * transformer) answers `{result:{data:{json:…}}}`; this portal's standalone
 * server.cjs answers `{result:{data:…}}` and 404s unknown routes — which the
 * feature-detection below turns into the disclosed "not available yet"
 * state. Both shapes are unwrapped; neither is ever fabricated.
 */
interface TrpcEnvelope<T> {
  result?: { data?: { json?: T } | T };
  error?: {
    message?: string;
    code?: number | string;
    data?: { code?: string; httpStatus?: number };
  };
}

/** Thrown for genuine failures (network, 5xx, UNAUTHORIZED). */
export class InnovationApiError extends Error {
  constructor(
    message: string,
    readonly trpcCode?: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "InnovationApiError";
  }
}

/**
 * 2026-09-25 — Feature-detection contract. As of 2026-10-01 (R2) every
 * binding in this module is REAL (see header); this degradation is retained
 * ONLY as a defensive fallback: when a deployment runs an older backend
 * that predates the mount (tRPC NOT_FOUND, HTTP 404) or gates it
 * (FORBIDDEN 403), the binding resolves to `null` instead of throwing.
 * Pages MUST treat `null` as "feature not available on this deployment"
 * and render a disclosed empty state. Genuine errors (network, 5xx) still
 * throw so pages can show an honest error state.
 */
function isUnavailableError(error: InnovationApiError): boolean {
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
    throw new InnovationApiError(
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
    const err = new InnovationApiError(
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

// ── Q4 health & retention (REAL — careRetention.ts, 2026-09-25) ────────────

export interface WellnessFeedItem {
  id: number;
  title: string;
  body: string;
  category: string;
  locale: string;
  status: string;
  publishedAt: string | null;
  createdAt: string;
}

export interface WellnessFeedResult {
  items: WellnessFeedItem[];
  total: number;
  locale: string;
}

export interface TeleconsultSession {
  id: number;
  providerCode: string;
  status: string;
  scheduledAt: string;
  createdAt: string;
}

export interface TeleconsultListResult {
  sessions: TeleconsultSession[];
  count: number;
}

export interface PhotoReimbursementItem {
  id: number;
  claimId: number | null;
  amount: string;
  currency: string;
  description: string | null;
  status: string;
  ocrStatus: string;
  createdAt: string;
}

export interface PhotoReimbursementListResult {
  reimbursements: PhotoReimbursementItem[];
  count: number;
}

export interface ReimbursementSubmitResult {
  id: number;
  status: string;
  claimId: number | null;
  ocrStatus: string;
  /** Disclosed fallback notice when no OCR provider is configured — surface
   *  verbatim; it is NOT an OCR result. */
  ocrDisclosure: string | null;
}

export interface PresignedUpload {
  uploadUrl: string;
  fileKey: string;
  bucket: string;
  expiresIn: number;
  instructions: string;
}

export const careRetentionApi = {
  wellnessFeed: (params?: {
    locale?: string;
    category?: string;
    limit?: number;
    offset?: number;
  }) =>
    trpcCall<WellnessFeedResult>("careRetention.wellnessFeed", "query", {
      locale: "en",
      ...params,
    }) as Promise<WellnessFeedResult>,

  teleconsultList: (params?: { limit?: number; offset?: number }) =>
    trpcCall<TeleconsultListResult>(
      "careRetention.teleconsultList",
      "query",
      params
    ) as Promise<TeleconsultListResult>,

  teleconsultBook: (input: { scheduledAt: string }) =>
    trpcCall<{
      id: number;
      status: string;
      scheduledAt: string;
      providerCode: string;
    }>("careRetention.teleconsultBook", "mutation", input),

  photoReimbursementList: (params?: { limit?: number; offset?: number }) =>
    trpcCall<PhotoReimbursementListResult>(
      "careRetention.photoReimbursementList",
      "query",
      params
    ) as Promise<PhotoReimbursementListResult>,

  photoReimbursementSubmit: (input: {
    claimId?: number;
    documentRefs: string[];
    amount: number;
    currency?: string;
    description?: string;
  }) =>
    trpcCall<ReimbursementSubmitResult>(
      "careRetention.photoReimbursementSubmit",
      "mutation",
      input
    ),
};

/** Existing P-wave presigned upload flow (documentManagement.requestUploadUrl). */
export const uploadApi = {
  requestUploadUrl: (input: {
    fileName: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
    fileSize: number;
  }) =>
    trpcCall<PresignedUpload>(
      "documentManagement.requestUploadUrl",
      "mutation",
      {
        ...input,
        purpose: "claim_document",
      }
    ) as Promise<PresignedUpload>,

  /** Step 2: PUT bytes directly to object storage at the presigned URL. */
  uploadBytes: async (uploadUrl: string, blob: Blob, mimeType: string) => {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: blob,
    });
    if (!res.ok)
      throw new InnovationApiError(`Upload failed (HTTP ${res.status})`);
  },
};

// ── Q2 parametric member surfaces (REAL — 2026-10-01, R2) ─────────────────
// Member-scoped READ-ONLY views live on the Q6 parametricMember router
// (server/routers/parametricMember.ts); the parametricEngine router remains
// admin-only by design. `null` is now only the defensive fallback for older
// backends (see header).

export interface ParametricCoverageItem {
  policyId: number;
  productName: string;
  coveredPeril: string;
  payoutAmount: string;
  currency: string;
  status: string;
  triggerStatus: string | null;
}

export interface ParametricPayoutItem {
  id: number;
  eventId: number;
  claimId: number;
  policyId: number;
  amount: string;
  currency: string;
  status: string; // "paid" | "pending_adjudication"
  createdAt: string;
}

export const parametricMemberApi = {
  myCoverage: () =>
    trpcCall<{ coverage: ParametricCoverageItem[] }>(
      "parametricMember.myCoverage",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
  myPayouts: (params?: { limit?: number; offset?: number }) =>
    trpcCall<{ payouts: ParametricPayoutItem[]; count: number }>(
      "parametricMember.myPayouts",
      "query",
      params,
      { unavailableAsNull: true }
    ),
};

// ── Q3 pools / telematics / usage cover (REAL — 2026-10-01, R2) ───────────
// Server is the contract of record: member reads live on the Q3 p2pPools /
// telematics / usageCover routers in server/routers/innovationRouters.ts.
// Surplus distribution mutations stay financialProcedure-gated server-side;
// these bindings are read-only for pools/telematics and member-scoped for
// usage cover.

export interface PoolMembershipItem {
  memberId: number;
  poolId: number;
  poolName: string;
  poolType: string; // "family" | "cooperative" | "employer" | "community"
  productType: string;
  poolStatus: string;
  role: "organiser" | "member";
  contributionPaid: string;
  joinedAt: string;
  status: string;
}

export interface PoolSurplusStatement {
  distributionId: number;
  periodId: number;
  poolName: string;
  periodStart: string;
  periodEnd: string;
  distributionMode: string; // "p2p_refund" | "takaful_wakala"
  periodStatus: string;
  contributed: string;
  surplusShare: string;
  shareBps: number;
  distributionStatus: string; // "proposed" | "approved" | "executed" | "failed"
  currency: string;
}

export const poolSurplusApi = {
  myMemberships: () =>
    trpcCall<{ memberships: PoolMembershipItem[] }>(
      "p2pPools.myMemberships",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
  myStatements: (params?: { limit?: number; offset?: number }) =>
    trpcCall<{ statements: PoolSurplusStatement[]; count: number }>(
      "p2pPools.myStatements",
      "query",
      params,
      { unavailableAsNull: true }
    ),
};

export interface DrivingScoreResult {
  policyId: number | null;
  /** null = no trips ingested yet (honest empty state, not a fabricated 0). */
  score: number | null;
  ratingFactor: number;
  tripsScored: number;
  windowDays: number;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface TripItem {
  id: number;
  policyId: number;
  startedAt: string;
  endedAt: string | null;
  distanceKm: number;
  durationSeconds: number;
  score: number | null;
  events: { hardBrakes: number; speedingEvents: number; corneringEvents: number };
}

export const telematicsApi = {
  myScore: () =>
    trpcCall<DrivingScoreResult>(
      "telematics.myScore",
      "query",
      undefined,
      {
        unavailableAsNull: true,
      }
    ),
  myTrips: (params?: { limit?: number; offset?: number }) =>
    trpcCall<{ trips: TripItem[]; count: number }>(
      "telematics.myTrips",
      "query",
      params,
      { unavailableAsNull: true }
    ),
};

export interface UsageCoverActivation {
  id: number;
  policyId: number;
  coverType: "trip" | "day"; // server contract of record
  status: string;
  activatedAt: string;
  expiresAt: string | null;
  /** Recorded-not-collected premium estimate (server docstring) — never
   *  treat as received funds. */
  premiumAmount: string | null;
  tripId: number | null;
  days: number | null;
}

export interface UsageCoverActivationResult {
  success: boolean;
  idempotent: boolean;
  activationId: number;
  status: string;
  expiresAt: string | null;
}

export const usageCoverApi = {
  myActivations: () =>
    trpcCall<{ activations: UsageCoverActivation[] }>(
      "usageCover.myActivations",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
  /**
   * Activate per-trip or per-day cover. Server contract
   * (usageCover.activateCover): idempotent by clientActivationId — the page
   * MUST generate a stable client key per user intent (e.g. crypto.randomUUID()
   * kept in component state) so a retry replays honestly instead of
   * double-activating. `days` is required for "day" cover, `tripId` for
   * "trip" cover.
   */
  activate: (input: {
    policyId: number;
    coverType: "trip" | "day";
    clientActivationId: string;
    days?: number;
    tripId?: number;
    premiumAmount?: number;
  }) =>
    trpcCall<UsageCoverActivationResult>(
      "usageCover.activateCover",
      "mutation",
      input,
      { unavailableAsNull: true }
    ),
  deactivate: (input: { activationId: number }) =>
    trpcCall<UsageCoverActivationResult>(
      "usageCover.cancelCover",
      "mutation",
      input,
      { unavailableAsNull: true }
    ),
};

// ── Q1 freemium ladder (REAL — 2026-10-01, R2) ─────────────────────────────
// Member surface on the Q6 freemiumTiers router
// (server/routers/freemiumTiers.ts). `upgrade` delegates server-side to the
// Q1 embeddedFactory procedures: free tier → immediate enrollment; paid tier
// → premium collected FIRST via the mobile-money rail (fail-closed, so
// msisdn is required for paid upgrades).

export interface FreemiumTier {
  tierId: number;
  code: string;
  name: string;
  coverageType: string;
  monthlyPremium: string;
  currency: string;
  coverLimit: string;
  isFree: boolean;
  sortOrder: number;
}

export interface FreemiumUpgradeResult {
  success: boolean;
  tier: string;
  enrollmentId?: number;
  policyId?: number;
  /** Present when success=false: the honest collection-declined reason. */
  reason?: string;
  message?: string;
}

export const freemiumApi = {
  myTier: () =>
    trpcCall<{ tier: string; tierName?: string; since: string | null }>(
      "freemiumTiers.myTier",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
  listTiers: () =>
    trpcCall<{ tiers: FreemiumTier[] }>(
      "freemiumTiers.listTiers",
      "query",
      undefined,
      {
        unavailableAsNull: true,
      }
    ),
  upgrade: (input: {
    tierCode: string;
    /** Required for PAID tiers (premium collection); omit for free enroll. */
    msisdn?: string;
    channel?: "airtime" | "mobile_money";
  }) =>
    trpcCall<FreemiumUpgradeResult>(
      "freemiumTiers.upgrade",
      "mutation",
      input,
      { unavailableAsNull: true }
    ),
};

export { isUnavailableError };
