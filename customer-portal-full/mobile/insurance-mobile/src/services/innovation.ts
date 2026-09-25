/**
 * innovation.ts — Q-wave Q6 mobile bindings (2026-09-25)
 *
 * tRPC-over-HTTP bindings for the Q3 telematics + usage-cover surfaces,
 * following the Q4 envelope pattern (see services/api.ts history): the
 * monolith appRouter is mounted at /api/trpc with the superjson transformer.
 * The shared axios instance attaches the member JWT — this module stores no
 * tokens itself.
 *
 * BINDING DISCLOSURE: Q3 (feat/innov-pools-telematics) is planned in
 * plan-q.md but not deployed yet. Both bindings FEATURE-DETECT: a tRPC
 * NOT_FOUND / FORBIDDEN (procedure absent or gated) resolves to null so
 * screens can render a disclosed "not available yet" state — never
 * fabricated data. Genuine errors (network, 5xx) still throw.
 */
import { api } from './api';

interface TrpcEnvelope<T> {
  // superjson-transformed routers answer {data:{json:…}}; plain servers
  // answer {data:…}. Both are unwrapped (2026-09-25).
  result?: { data?: { json?: T } | T };
  error?: {
    message?: string;
    code?: number | string;
    data?: { code?: string; httpStatus?: number };
  };
}

function unwrap<T>(env: TrpcEnvelope<T>): T | null {
  const data = env.result?.data;
  if (data != null && typeof data === 'object' && 'json' in data) {
    return ((data as { json?: T }).json ?? null) as T | null;
  }
  return ((data as T | undefined) ?? null) as T | null;
}

export class InnovationApiError extends Error {
  constructor(
    message: string,
    readonly trpcCode?: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'InnovationApiError';
  }
}

function isUnavailable(error: InnovationApiError): boolean {
  return (
    error.trpcCode === 'NOT_FOUND' ||
    error.trpcCode === 'FORBIDDEN' ||
    error.httpStatus === 404 ||
    error.httpStatus === 403
  );
}

async function trpcGet<T>(path: string, input?: unknown): Promise<T | null> {
  const qs =
    input === undefined
      ? ''
      : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await api.get<TrpcEnvelope<T>>(`/api/trpc/${path}${qs}`);
  return unwrap(res.data);
}

async function trpcPost<T>(path: string, input?: unknown): Promise<T | null> {
  const res = await api.post<TrpcEnvelope<T>>(`/api/trpc/${path}`, {
    json: input ?? null,
  });
  return unwrap(res.data);
}

/** null = feature not deployed yet (feature-detected, disclosed). */
async function guarded<T>(fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    const err = new InnovationApiError(
      (error as Error)?.message ?? 'Request failed',
      undefined,
      status,
    );
    if (isUnavailable(err)) return null;
    throw err;
  }
}

// ── Q3 telematics (FORWARD-LOOKING, 2026-09-25) ────────────────────────────

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
    guarded(() => trpcGet<DrivingScoreResult>('telematicsScore.myScore')),
  myTrips: (params?: { limit?: number; offset?: number }) =>
    guarded(() =>
      trpcGet<{ trips: TripItem[]; count: number }>('telematicsScore.myTrips', params),
    ),
};

// ── Q3 usage-based cover (FORWARD-LOOKING, 2026-09-25) ─────────────────────

export interface UsageCoverActivation {
  id: number;
  coverType: string; // 'per_trip' | 'per_day'
  status: string;
  activatedAt: string;
  expiresAt: string | null;
  premiumQuoted: string | null;
  currency: string;
}

export const usageCoverApi = {
  myActivations: () =>
    guarded(() =>
      trpcGet<{ activations: UsageCoverActivation[] }>('usageCover.myActivations'),
    ),
  activate: (input: { coverType: 'per_trip' | 'per_day'; policyId?: number }) =>
    guarded(() => trpcPost<UsageCoverActivation>('usageCover.activate', input)),
  deactivate: (input: { activationId: number }) =>
    guarded(() => trpcPost<{ success: boolean }>('usageCover.deactivate', input)),
};
