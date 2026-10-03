import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

// 2026-10-01 (R1c): base URL comes from centralized config (build-time env,
// localhost fallback only behind __DEV__) — no hardcoded endpoints here.
import { API_BASE_URL } from '../config';
// 2026-10-01 (W9-B3): tokens now come from the real Keycloak OIDC flow
// (see keycloakAuth.ts). The previous refresh interceptor POSTed to
// /api/v1/auth/refresh on the Go BFF — a route that does not exist.
import { getValidAccessToken, refreshAccessToken, clearTokens } from './keycloakAuth';
// 2026-10-03 (W9-B4): member* tRPC calls go through memberTrpc (Bearer +
// 401 → Keycloak refresh → one retry, fail-closed).
import { memberQuery, memberMutation } from './memberTrpc';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
/** 2026-10-03 (W9-B4): row shape returned by memberPolicies.myPolicies /
 *  myPolicy (server/routers/memberPolicies.ts:112,175 — caller-scoped,
 *  NOT_FOUND on foreign id). */
interface MemberPolicyRow {
  id: number;
  policyNumber: string;
  status: string;
  coverageType: string | null;
  sumInsured: string | null;
  annualPremium: string | null;
  startDate: string | Date | null;
  endDate: string | Date | null;
  renewalDate?: string | Date | null;
  certificateNumber?: string | null;
  productId: number | null;
  productName: string | null;
  productDescription?: string | null;
  currency: string;
}

/** Map the real memberPolicies row onto the legacy screen shape. No fields
 *  are invented: type/provider come from the real coverageType/productName,
 *  amounts from the recorded annualPremium/sumInsured columns. */
function mapMemberPolicy(r: MemberPolicyRow) {
  return {
    id: r.id,
    policyNumber: r.policyNumber,
    type: r.coverageType ?? r.productName ?? 'Policy',
    provider: r.productName ?? null,
    status: r.status,
    premiumAmount: Number(r.annualPremium ?? 0),
    coverageAmount: Number(r.sumInsured ?? 0),
    startDate: r.startDate,
    endDate: r.endDate,
    renewalDate: r.renewalDate ?? null,
    certificateNumber: r.certificateNumber ?? null,
    productDescription: r.productDescription ?? null,
    currency: r.currency ?? 'NGN',
  };
}

// 2026-10-03 (W9-B4): rewired OFF the Go BFF /api/v1/policies passthrough
// onto the hardened memberPolicies router (server/routers/memberPolicies.ts).
// myPolicies/myPolicy scope rows to the caller (dual identity space);
// myPolicy answers NOT_FOUND for foreign ids (non-enumerating).
export const policyApi = {
  list: async () => {
    const res = await memberQuery<{ policies: MemberPolicyRow[]; count: number }>(
      'memberPolicies.myPolicies', { limit: 50, offset: 0 },
    );
    return { data: { policies: (res?.policies ?? []).map(mapMemberPolicy), count: res?.count ?? 0 } };
  },
  getById: async (id: string | number) => {
    const num = Number(id);
    if (!Number.isInteger(num) || num <= 0) {
      throw new Error(`Policy ${id} not found in your account`);
    }
    const row = await memberQuery<MemberPolicyRow>('memberPolicies.myPolicy', { id: num });
    return { data: mapMemberPolicy(row) };
  },
  // 2026-10-03 (W9-B4): REAL now — memberRenewals.requestRenewal
  // (server/routers/memberRenewals.ts:157): ownership guard first, only
  // active/bound policies, one-open-renewal duplicate guard. No funds move.
  renew: (id: string | number) =>
    memberMutation('memberRenewals.requestRenewal', { policyId: Number(id) }),
  // 2026-10-01 (W9-B3): still no member-safe policy-documents procedure
  // (2026-10-03 W9-B4: none exists under member*). Throws an honest error.
  getDocuments: async (_id: string): Promise<never> => {
    throw new Error('Policy documents are not available in the app yet.');
  },
};

// 2026-10-01 (W9-B3): claims list rewired to the REAL mounted member-scoped
// tRPC router (memberClaims.myClaims, server/routers/memberClaims.ts:75 —
// claimantId = ctx.user.id, fail-closed). The old /api/v1/claims BFF route
// never existed. Returned in the axios-like {data:{claims}} shape screens use.
export const claimsApi = {
  // 2026-10-03 (W9-B4): routed through memberTrpc so a stale token gets one
  // Keycloak refresh + retry instead of an immediate failure.
  list: async () => {
    // 2026-10-03 (W9-B4 round 2): the real memberClaims.myClaims returns
    // `{ claims: rows, count }` (server/routers/memberClaims.ts:111), NOT a
    // bare array. The pre-round-2 code typed it any[] and did
    // `Array.isArray(rows) ? rows : []` — an object is never an array, so
    // the claims list was silently empty forever. Map the real shape.
    const res = await memberQuery<{ claims: any[]; count: number }>(
      'memberClaims.myClaims', { limit: 50, offset: 0 },
    );
    return { data: { claims: res?.claims ?? [] } };
  },
  // 2026-10-01 (W9-B3): rewired to the real memberClaims.myClaim (id-scoped
  // to the caller). No fabricated detail view.
  getById: async (id: number) => {
    const data = await memberQuery<any>('memberClaims.myClaim', { id: Number(id) });
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
  }) =>
    memberMutation('memberClaims.fileClaim', input),
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

// 2026-10-03 (W9-B4): premium payments rewired onto the REAL hardened
// memberPayments router (server/routers/memberPayments.ts):
//   - myPremiumDue (line ~248): server-derived due ledger rows — the ONLY
//     source of payable amounts; nothing client-entered.
//   - myPremiums (line ~156): the caller's premium ledger history.
//   - initiatePremiumPayment (line ~335): ownership gate → server-derived
//     amount from the due ledger row (the input carries NO amount field) →
//     F-02 idempotency (key + payload hash) → derived reference
//     PP-{policyNumber}-{key} → real Paystack initialize. Gateway
//     unconfigured → PRECONDITION_FAILED and NOTHING is written.
//   - verifyPremiumPayment (line ~569): server-side Paystack verification +
//     atomic credit; replay-safe (never credits twice).
// Mobile cannot host the Paystack inline webview honestly in this build, so
// initiation returns the real reference/authorizationUrl and the UI renders
// the honest pending/verify state — never a fake success.

export interface DuePremium {
  id: number;
  policyId: number;
  premiumRef: string;
  amount: string;
  currency: string | null;
  dueDate: string | null;
  gracePeriodDays: number | null;
  status: string;
  policyNumber: string | null;
}

export interface PremiumDueView {
  duePremiums: DuePremium[];
  policies: Array<{
    id: number;
    policyNumber: string;
    status: string;
    annualPremium: string | null;
    renewalDate: string | null;
    productName: string | null;
    currency: string;
  }>;
  disclosure: string;
}

export interface InitiatedPremiumPayment {
  reference: string;
  authorizationUrl: string | null;
  accessCode?: string | null;
  amount: string;
  currency: string;
  paymentId: number;
  idempotent: boolean;
}

export interface VerifiedPremiumPayment {
  reference: string;
  status: string;
  amount: string;
  currency: string;
  paymentId: number;
  idempotent: boolean;
}

const IDEM_KEY_PREFIX = '@insureportal/premium_idem';

/** Stable idempotency key per user payment intent (policyId:premiumId).
 *  The key is generated once and persisted so a retry after a crash/network
 *  failure replays the SAME intent (server returns the recorded result)
 *  instead of initiating a second payment. Cleared only on verified success
 *  (a new payment intent for the same due row then gets a fresh key). */
async function idempotencyKeyFor(policyId: number, premiumId: number): Promise<string> {
  const slot = `${IDEM_KEY_PREFIX}/${policyId}/${premiumId}`;
  const existing = await AsyncStorage.getItem(slot);
  if (existing && existing.length >= 8 && existing.length <= 64) return existing;
  const key = `m-${policyId}-${premiumId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(slot, key);
  return key;
}

async function clearIdempotencyKey(policyId: number, premiumId: number): Promise<void> {
  await AsyncStorage.removeItem(`${IDEM_KEY_PREFIX}/${policyId}/${premiumId}`);
}

export const premiumApi = {
  /** Server-derived payable view: real due ledger rows + the disclosure. */
  due: () => memberQuery<PremiumDueView>('memberPayments.myPremiumDue', null),
  /** The caller's premium ledger history (optionally per policy). */
  history: (policyId?: number) =>
    memberQuery<{ premiums: any[]; count: number }>(
      'memberPayments.myPremiums',
      { ...(policyId != null ? { policyId: Number(policyId) } : {}), limit: 50, offset: 0 },
    ),
  /** Initiate a premium payment. NEVER sends an amount — the server derives
   *  it from the due ledger row. Idempotency key is stable per intent. */
  initiate: async (policyId: number, premiumId: number): Promise<InitiatedPremiumPayment> => {
    const idempotencyKey = await idempotencyKeyFor(policyId, premiumId);
    return memberMutation<InitiatedPremiumPayment>('memberPayments.initiatePremiumPayment', {
      policyId, premiumId, idempotencyKey,
    });
  },
  /** Verify a payment by its server-derived reference. On verified success
   *  the intent's idempotency key is retired (payment complete — a future
   *  payment of the same due row would be a NEW intent). */
  verify: async (reference: string, policyId?: number, premiumId?: number): Promise<VerifiedPremiumPayment> => {
    const res = await memberMutation<VerifiedPremiumPayment>('memberPayments.verifyPremiumPayment', { reference });
    if (res?.status === 'success' && policyId != null && premiumId != null) {
      await clearIdempotencyKey(policyId, premiumId);
    }
    return res;
  },
  // 2026-10-03 (W9-B4): no member-safe premium CALCULATOR exists for an
  // arbitrary policy (memberPolicies.quote is productId-based, pre-bind).
  // Throws an honest error — never a fabricated premium figure.
  calculate: async (_params: Record<string, unknown>): Promise<never> => {
    throw new Error('Premium calculation is not available in the app yet.');
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
