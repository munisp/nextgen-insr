/**
 * memberOnboardingApi.ts — R3 batch 6 PWA bindings (2026-10-01, R3-b6)
 *
 * Typed tRPC-over-HTTP bindings for the memberOnboarding router
 * (server/routers/memberOnboarding.ts, mounted as `memberOnboarding` on the
 * monolith appRouter at /api/trpc, superjson transformer). Same
 * envelope/credentials conventions as memberClaimsApi.ts: inputs travel as
 * `{ json: ... }`, results are unwrapped from `result.data.json`, requests
 * are same-origin with credentials: "include".
 *
 * Degradation contract (same as memberClaimsApi): NOT_FOUND/FORBIDDEN/
 * 404/403 resolve to `null` ONLY as a defensive fallback for deployments
 * whose backend predates the mount; pages MUST render a disclosed "not
 * available on this deployment" empty state. Genuine errors throw. No data
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
export class MemberOnboardingApiError extends Error {
  constructor(
    message: string,
    readonly trpcCode?: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "MemberOnboardingApiError";
  }
}

function isUnavailableError(error: MemberOnboardingApiError): boolean {
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
    throw new MemberOnboardingApiError(
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
    const err = new MemberOnboardingApiError(
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

// ── R3-b6 member onboarding surface (REAL — server/routers/memberOnboarding.ts)

export interface OnboardingStageMeta {
  id: number;
  name: string;
  order: number;
  required: boolean;
  estimatedMinutes: number;
}

export interface MemberOnboardingProgress {
  currentStage: string;
  stageIndex: number;
  totalStages: number;
  completionPercent: number;
  stages: OnboardingStageMeta[];
  startedAt: string;
}

export const memberOnboardingApi = {
  myProgress: () =>
    trpcCall<MemberOnboardingProgress>(
      "memberOnboarding.myProgress",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
};
