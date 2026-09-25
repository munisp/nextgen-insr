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
 * Binding status per surface (honest disclosure):
 *  - careRetention.*            REAL — Q4 checkpoint server/routers/careRetention.ts
 *  - documentManagement.requestUploadUrl  REAL — existing P-wave presigned flow
 *  - parametricEngine.myCoverage/myPayouts  FORWARD-LOOKING — the Q2 checkpoint
 *    (server/routers/parametricEngine.ts) ships ADMIN-only procedures today;
 *    member-scoped coverage/payout procedures are planned. Calls feature-detect
 *    NOT_FOUND / FORBIDDEN and degrade to `null` (pages render an honest
 *    "not yet available" empty state — never fabricated data).
 *  - poolSurplus.* / telematicsScore.* / usageCover.*  FORWARD-LOOKING — Q3
 *    (feat/innov-pools-telematics) procedure names planned in plan-q.md; same
 *    graceful-degradation contract.
 *  - freemiumTiers.*            FORWARD-LOOKING — Q1 (feat/innov-embedded)
 *    freemium ladder; same graceful-degradation contract.
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
 * 2026-09-25 — Feature-detection contract for FORWARD-LOOKING bindings: when
 * the backend does not expose the procedure yet (tRPC NOT_FOUND, HTTP 404) or
 * the procedure exists but is admin-gated (FORBIDDEN 403), the binding
 * resolves to `null` instead of throwing. Pages MUST treat `null` as
 * "feature not available on this deployment" and render a disclosed empty
 * state. Genuine errors (network, 5xx) still throw so pages can show an
 * honest error state.
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

// ── Q2 parametric member surfaces (FORWARD-LOOKING, 2026-09-25) ────────────
// The Q2 checkpoint router (parametricEngine) currently exposes admin-only
// procedures. Member-scoped `myCoverage` / `myPayouts` are the planned member
// procedures; both degrade to null (feature-detect) until the backend lands.

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
  policyId: number;
  amount: string;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
}

export const parametricMemberApi = {
  /** null = member parametric surface not deployed yet (disclosed empty state). */
  myCoverage: () =>
    trpcCall<{ coverage: ParametricCoverageItem[] }>(
      "parametricEngine.myCoverage",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
  myPayouts: (params?: { limit?: number; offset?: number }) =>
    trpcCall<{ payouts: ParametricPayoutItem[]; count: number }>(
      "parametricEngine.myPayouts",
      "query",
      params,
      { unavailableAsNull: true }
    ),
};

// ── Q3 pools / telematics / usage cover (FORWARD-LOOKING, 2026-09-25) ──────
// Procedure names follow plan-q.md (feat/innov-pools-telematics): pool
// surplus accounting, telematics driving scores, per-trip/per-day usage
// cover. All degrade to null until the Q3 backend lands.

export interface PoolMembershipItem {
  poolId: number;
  poolName: string;
  mode: string; // "p2p_refund" | "takaful_surplus"
  role: string;
  joinedAt: string;
  status: string;
}

export interface PoolSurplusStatement {
  periodId: number;
  poolName: string;
  periodStart: string;
  periodEnd: string;
  contributed: string;
  surplusShare: string;
  distributionStatus: string;
  currency: string;
}

export const poolSurplusApi = {
  myMemberships: () =>
    trpcCall<{ memberships: PoolMembershipItem[] }>(
      "poolSurplus.myMemberships",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
  myStatements: (params?: { limit?: number; offset?: number }) =>
    trpcCall<{ statements: PoolSurplusStatement[]; count: number }>(
      "poolSurplus.myStatements",
      "query",
      params,
      { unavailableAsNull: true }
    ),
};

export interface DrivingScoreResult {
  score: number;
  tripsScored: number;
  ratingFactorApplied: boolean;
  periodStart: string;
  periodEnd: string;
}

export interface TripItem {
  id: number;
  startedAt: string;
  endedAt: string | null;
  distanceKm: number;
  score: number | null;
  events: { harshBraking: number; harshAcceleration: number; speeding: number };
}

export const telematicsApi = {
  myScore: () =>
    trpcCall<DrivingScoreResult>(
      "telematicsScore.myScore",
      "query",
      undefined,
      {
        unavailableAsNull: true,
      }
    ),
  myTrips: (params?: { limit?: number; offset?: number }) =>
    trpcCall<{ trips: TripItem[]; count: number }>(
      "telematicsScore.myTrips",
      "query",
      params,
      { unavailableAsNull: true }
    ),
};

export interface UsageCoverActivation {
  id: number;
  coverType: string; // "per_trip" | "per_day"
  status: string;
  activatedAt: string;
  expiresAt: string | null;
  premiumQuoted: string | null;
  currency: string;
}

export const usageCoverApi = {
  myActivations: () =>
    trpcCall<{ activations: UsageCoverActivation[] }>(
      "usageCover.myActivations",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
  activate: (input: { coverType: "per_trip" | "per_day"; policyId?: number }) =>
    trpcCall<UsageCoverActivation>("usageCover.activate", "mutation", input, {
      unavailableAsNull: true,
    }),
  deactivate: (input: { activationId: number }) =>
    trpcCall<{ success: boolean }>("usageCover.deactivate", "mutation", input, {
      unavailableAsNull: true,
    }),
};

// ── Q1 freemium ladder (FORWARD-LOOKING, 2026-09-25) ───────────────────────
// Q1 (feat/innov-embedded) freemium tiers: free basic cover → paid upgrade.
// Degrades to null until the Q1 backend lands.

export interface FreemiumTier {
  code: string;
  name: string;
  description: string;
  monthlyPremium: string;
  currency: string;
  coverLimit: string;
  benefits: string[];
}

export const freemiumApi = {
  myTier: () =>
    trpcCall<{ tier: string; since: string | null }>(
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
  upgrade: (input: { tierCode: string }) =>
    trpcCall<{ success: boolean; tier: string }>(
      "freemiumTiers.upgrade",
      "mutation",
      input,
      { unavailableAsNull: true }
    ),
};

export { isUnavailableError };
