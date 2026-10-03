import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

// 2026-10-01 (R1c): base URL comes from centralized config (build-time env,
// localhost fallback only behind __DEV__) — no hardcoded endpoints here.
import { API_BASE_URL, trpcQuery, trpcMutation } from '../config';
// 2026-10-01 (W9-B3): tokens now come from the real Keycloak OIDC flow
// (see keycloakAuth.ts). The previous refresh interceptor POSTed to
// /api/v1/auth/refresh on the Go BFF — a route that does not exist.
import { getValidAccessToken, refreshAccessToken, clearTokens } from './keycloakAuth';

const API_BASE = API_BASE_URL;

// Certificate pinning domains — all production endpoints must be pinned.
// The native module (react-native-ssl-pinning or TrustKit) must be configured
// in the native iOS/Android projects with SHA-256 leaf certificate hashes for:
//   - api.insureportal.ng
//   - auth.insureportal.ng
//   - api.54link.ng
//   - staging.54link.ng
// Pin rotation: include both current and next certificate hashes.
export const PINNED_DOMAINS = [
  'api.insureportal.ng',
  'auth.insureportal.ng',
  'api.54link.ng',
  'staging.54link.ng',
] as const;

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  try {
    // getValidAccessToken refreshes proactively inside the skew window, so
    // requests rarely leave with an already-expired token. Throws when the
    // session is dead — fail-closed (request is rejected, not sent bare).
    const token = await getValidAccessToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // No valid session: send the request WITHOUT a fabricated token; the
    // server will answer 401 and the response interceptor below handles it.
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config;
    if (error.response?.status === 401 && original && !('_retry' in original)) {
      (original as unknown as Record<string, unknown>)._retry = true;
      try {
        // 2026-10-01 (W9-B3): refresh against the Keycloak token endpoint,
        // not the nonexistent BFF /api/v1/auth/refresh.
        const accessToken = await refreshAccessToken();
        if (original.headers) original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch {
        // Refresh failed — session is over. Tokens already cleared by
        // refreshAccessToken; clearTokens() again is harmless and explicit.
        await clearTokens();
      }
    }
    return Promise.reject(error);
  }
);

/** Go BFF route reality check (insurance-mobile-app/main.go:1268-1294):
 *  the ONLY /api/v1 routes that exist are mobile_sessions, device/register,
 *  sync/pull, sync/push, sync, and policies. Every other path below is
 *  marked with its real availability — nothing here pretends to work. */
export const policyApi = {
  // EXISTS on the BFF (user-scoped passthrough, Keycloak JWT middleware).
  list: () => api.get('/api/v1/policies'),
  // 2026-10-01 (W9-B3): GET /api/v1/policies/:id does NOT exist on the BFF.
  // Detail is derived client-side from the real list response (same source,
  // no fabrication). Throws an honest error when the policy is not found.
  getById: async (id: string) => {
    const res = await api.get('/api/v1/policies');
    const policies: any[] = res.data?.policies ?? res.data ?? [];
    const match = Array.isArray(policies) ? policies.find((p) => String(p.id) === String(id)) : null;
    if (!match) throw new Error(`Policy ${id} not found in your account`);
    return { data: match };
  },
  // 2026-10-01 (W9-B3): NOT a BFF route (404) and no member self-service
  // renewal tRPC procedure is mounted. Throws an honest error — renewal
  // must never fake success.
  renew: async (_id: string): Promise<never> => {
    throw new Error('In-app renewal is not available yet — please contact your agent to renew this policy.');
  },
  // 2026-10-01 (W9-B3): NOT a BFF route (404). Throws an honest error.
  getDocuments: async (_id: string): Promise<never> => {
    throw new Error('Policy documents are not available in the app yet.');
  },
};

// 2026-10-01 (W9-B3): claims list rewired to the REAL mounted member-scoped
// tRPC router (memberClaims.myClaims, server/routers/memberClaims.ts:75 —
// claimantId = ctx.user.id, fail-closed). The old /api/v1/claims BFF route
// never existed. Returned in the axios-like {data:{claims}} shape screens use.
export const claimsApi = {
  list: async (token?: string | null) => {
    const rows = await trpcQuery<any[]>(
      'memberClaims.myClaims', { limit: 50, offset: 0 }, token ?? (await getValidAccessToken()),
    );
    return { data: { claims: Array.isArray(rows) ? rows : [] } };
  },
  // 2026-10-01 (W9-B3): rewired to the real memberClaims.myClaim (id-scoped
  // to the caller). No fabricated detail view.
  getById: async (id: number, token?: string | null) => {
    const data = await trpcQuery<any>(
      'memberClaims.myClaim', { id }, token ?? (await getValidAccessToken()),
    );
    return { data };
  },
  // 2026-10-01 (W9-B3): rewired to memberClaims.fileClaim — the real member
  // wrapper that re-verifies policy ownership server-side before filing.
  // NOTE: `documents` are storage keys/URLs from a real upload; this app has
  // no document-upload pipeline yet, so callers pass [] and the UI says so.
  file: (input: {
    policyId: number;
    claimType: string;
    incidentDate: string;
    claimedAmount: number;
    incidentDescription: string;
    documents?: string[];
  }, token?: string | null) =>
    trpcMutation('memberClaims.fileClaim', input, token),
  // 2026-10-01 (W9-B3): no evidence-upload or claim-timeline endpoint exists
  // for members (BFF 404s; no member tRPC equivalent). These throw honest
  // errors instead of returning fabricated empty timelines.
  addEvidence: async (_id: string, _data: unknown): Promise<never> => {
    throw new Error('Evidence upload is not available in the app yet — your agent can attach documents to your claim.');
  },
  getTimeline: async (_id: string): Promise<never> => {
    throw new Error('Claim timeline is not available in the app yet.');
  },
};

// 2026-10-01 (W9-B3): NO premium endpoints exist on the BFF (all 404) and no
// member-scoped premium tRPC router is mounted for self-service payment.
// premiumApi methods throw honest errors — payment flows must not be faked.
export const premiumApi = {
  calculate: async (_params: Record<string, unknown>): Promise<never> => {
    throw new Error('Premium calculation is not available in the app yet.');
  },
  pay: async (_policyId: string, _data: Record<string, unknown>): Promise<never> => {
    throw new Error('In-app premium payment is not available yet — please pay via your agent or bank transfer using your policy number as reference.');
  },
  history: async (_policyId: string): Promise<never> => {
    throw new Error('Premium payment history is not available in the app yet.');
  },
};

// 2026-10-01 (W9-B3): /api/v1/agents/* does not exist on the BFF (404).
// Throws an honest error instead of fabricating a nearby-agents list.
export const agentApi = {
  findNearby: async (_lat: number, _lng: number, _radius: number): Promise<never> => {
    throw new Error('Agent lookup is not available in the app yet.');
  },
  getProfile: async (_id: string): Promise<never> => {
    throw new Error('Agent profiles are not available in the app yet.');
  },
};

// 2026-10-01 (W9-B3): authApi DELETED. The Go BFF exposes no /api/v1/auth/*
// routes — login/register/forgot-password/biometric all 404'd. Real auth is
// Keycloak OIDC (src/services/keycloakAuth.ts); profile comes from the
// monolith tRPC auth.me (server/routers.ts:571, Bearer-verified via JWKS).
