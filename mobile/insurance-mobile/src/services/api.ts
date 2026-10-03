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

// 2026-10-03 (W9-B6): PINNED_DOMAINS now lives in (and is ENFORCED by)
// services/domainAllowlist.ts — every axios request through `api` below is
// host-checked before dispatch (fail-closed). This is domain-allowlisting,
// NOT TLS certificate pinning: true SHA-256 SPKI pinning must still be
// configured in the native iOS/Android projects (TrustKit / OkHttp
// CertificatePinner) once they exist — recorded residual, see BUILD.md.
import { ALLOWED_DOMAINS, assertAxiosConfigAllowed } from './domainAllowlist';
export const PINNED_DOMAINS = ALLOWED_DOMAINS;

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// 2026-10-03 (W9-B6): domain allowlist guard runs FIRST, before the auth
// interceptor and before the adapter touches the network — a request to a
// non-allowlisted host is rejected with a loud error, never sent.
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  assertAxiosConfigAllowed({ baseURL: config.baseURL, url: config.url });
  return config;
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

// ---------------------------------------------------------------------------
// 2026-10-03 (W9-B5 wave 1): quotes / endorsements / renewals member surface,
// mirroring the web member portal (client/src/pages/member/MemberQuotes.tsx,
// MemberEndorsements.tsx, MemberRenewals.tsx — W7-B5, 2026-10-02) on the REAL
// hardened routers (server/routers/memberQuotes.ts, memberEndorsements.ts,
// memberRenewals.ts; mounted in server/routers.ts:1258-1260).
// Shapes below are copied from the server router code — never assumed.
// None of these three routers requires a client idempotency key (unlike
// memberPayments F-02): quotes/endorsements rows are server-numbered and
// requestRenewal has a server-side one-open-renewal duplicate guard.
// ---------------------------------------------------------------------------

/** Row shape from memberQuotes.myQuoteCart (server/routers/memberQuotes.ts:105). */
export interface MemberQuoteRow {
  id: number;
  productId: number | null;
  productName: string | null;
  productType: string | null;
  sumInsured: string | null;
  premiumAmount: string | null;
  stampDuty: string | null;
  totalPayable: string | null;
  durationMonths: number | null;
  coverageType: string | null;
  status: string;
  validUntil: string | Date | null;
  createdAt: string | Date | null;
}

export interface MemberQuoteCart {
  items: MemberQuoteRow[];
  subTotal: number;
  totalPremium: number;
  count: number;
  currency: string;
}

export interface AddQuoteResult {
  quote: MemberQuoteRow & Record<string, unknown>;
  premiumAmount: number;
  stampDuty: number;
  totalPayable: number;
  currency: string;
}

export const quotesApi = {
  /** The caller's pending quote cart (memberQuotes.myQuoteCart). */
  cart: () => memberQuery<MemberQuoteCart>('memberQuotes.myQuoteCart', null),
  /** Real COUNT/SUM over the caller's pending quotes (memberQuotes.quoteSummary). */
  summary: () =>
    memberQuery<{ count: number; totalPremium: number; currency: string }>(
      'memberQuotes.quoteSummary', null,
    ),
  /** Add a quote. NEVER sends a premium — the server prices it from the
   *  filed rating tables and throws PRECONDITION_FAILED (adding nothing)
   *  when no rating table covers the product; that error is surfaced. */
  add: (input: { productId: number; sumInsured: number; durationMonths: number; coverageType?: string }) =>
    memberMutation<AddQuoteResult>('memberQuotes.addToQuoteCart', input),
  /** Cancel one of the caller's pending quotes (NOT_FOUND on foreign id). */
  remove: (quoteId: number) =>
    memberMutation<{ removed: boolean; quoteId: number }>('memberQuotes.removeQuoteItem', { quoteId }),
  /** Cancel ALL of the caller's pending quotes; returns the real count. */
  clear: () => memberMutation<{ cleared: boolean; cancelled: number }>('memberQuotes.clearQuoteCart', null),
};

/** Row shape from memberEndorsements.myEndorsements
 *  (server/routers/memberEndorsements.ts:113 — joined to policies). */
export interface MemberEndorsementRow {
  id: number;
  endorsementNumber: string;
  policyId: number;
  policyNumber: string;
  type: string;
  effectiveDate: string | Date | null;
  description: string | null;
  premiumAdjustment: string | null;
  sumInsuredAdjustment: string | null;
  approvedAt: string | Date | null;
  createdAt: string | Date | null;
  currency: string;
}

/** Endorsement types = the server zod enum exactly
 *  (memberEndorsements.requestEndorsement input, :159). */
export const ENDORSEMENT_TYPES = [
  'addition', 'deletion', 'modification', 'extension', 'reduction', 'cancellation', 'reinstatement',
] as const;
export type EndorsementType = (typeof ENDORSEMENT_TYPES)[number];

export const endorsementsApi = {
  /** The caller's endorsements, newest first (optionally per policy). */
  list: (policyId?: number) =>
    memberQuery<{ endorsements: MemberEndorsementRow[]; count: number }>(
      'memberEndorsements.myEndorsements',
      { ...(policyId != null ? { policyId: Number(policyId) } : {}), limit: 50, offset: 0 },
    ),
  /** Request an endorsement on an OWNED policy. premiumAdjustment /
   *  sumInsuredAdjustment are member-PROPOSED request fields only — no
   *  funds movement (router header, memberEndorsements.ts:18-21). */
  request: (input: {
    policyId: number;
    type: EndorsementType;
    effectiveDate: string;
    description: string;
    premiumAdjustment?: number;
    sumInsuredAdjustment?: number;
  }) => memberMutation<{ endorsement: unknown; endorsementNumber: string }>(
    'memberEndorsements.requestEndorsement', input,
  ),
};

/** Row shape from memberRenewals.myRenewals
 *  (server/routers/memberRenewals.ts:118 — joined to policies). */
export interface MemberRenewalRow {
  id: number;
  originalPolicyId: number;
  policyNumber: string;
  status: string;
  renewalDueDate: string | Date | null;
  renewalPremium: string | null;
  isAutoRenewal: boolean | null;
  completedAt: string | Date | null;
  createdAt: string | Date | null;
  currency: string;
}

export const renewalsApi = {
  /** The caller's renewals, newest first (dual-space caller scope). */
  list: () =>
    memberQuery<{ renewals: MemberRenewalRow[]; count: number }>(
      'memberRenewals.myRenewals', { limit: 50, offset: 0 },
    ),
  /** Request a renewal for an OWNED active/bound policy — same procedure
   *  PolicyDetailScreen uses via policyApi.renew (W9-B4). Server enforces
   *  ownership, the status gate, and the one-open-renewal duplicate guard;
   *  no funds move. */
  request: (input: { policyId: number; isAutoRenewal?: boolean }) =>
    memberMutation<{ renewal: unknown }>('memberRenewals.requestRenewal', input),
};

// ---------------------------------------------------------------------------
// 2026-10-03 (W9-B5 wave 2): savings / loyalty / referrals / disputes member
// surface, mirroring the web member portal (client/src/pages/member/
// MemberSavings.tsx, MemberLoyalty.tsx, MemberReferrals.tsx,
// MemberDisputes.tsx — W7-B7/B8) on the REAL hardened routers
// (server/routers/memberSavings.ts, memberLoyalty.ts, memberReferrals.ts,
// memberDisputes.ts; mounted in server/routers.ts:1232-1242). Shapes below
// are copied from the server router code — never assumed.
//
// FUNDS DISCIPLINE (same as the web portal): there is deliberately NO
// savings deposit/withdraw (memberSavings.ts:13-15 — funding goes through
// the rail-verified wallet), NO loyalty redemption (memberLoyalty.ts:22-25
// — points are funds-adjacent, read-only by design), and NO referral-code
// minting (memberReferrals.ts:23-35 — myCode is read-only, null = honest
// unavailable). None of these routers takes a client idempotency key or a
// client-supplied amount for a money-moving mutation (fileDispute.amount is
// the member-declared DISPUTED amount on an already-owned transaction — no
// funds move; ownership is verified server-side first).
// ---------------------------------------------------------------------------

/** Row shape from memberSavings.myTransactions
 *  (server/routers/memberSavings.ts:216-228 — transactions select). */
export interface MemberSavingsTxRow {
  id: number;
  ref: string | null;
  type: string | null;
  amount: string | null;
  currency: string | null;
  channel: string | null;
  status: string | null;
  failureReason: string | null;
  createdAt: string | Date | null;
}

/** Account row from memberSavings.myAccount (memberSavings.ts:249-257 —
 *  ONLY id/names/status/kycLevel/createdAt; never bvn/nin/balances). */
export interface MemberSavingsAccount {
  id: number;
  firstName: string | null;
  lastName: string | null;
  status: string | null;
  kycLevel: string | null;
  createdAt: string | Date | null;
}

export const savingsApi = {
  /** The caller's savings account, or { account: null } when none exists
   *  (memberSavings.myAccount — non-enumerating null, never fabricated). */
  myAccount: () =>
    memberQuery<{ account: MemberSavingsAccount | null }>('memberSavings.myAccount', null),
  /** Settled-only balance/totals (memberSavings.mySummary — sums over
   *  status="success" rows only; NOT_FOUND when no customer profile). */
  mySummary: () =>
    memberQuery<{
      customerId: number; balance: number; totalIn: number; totalOut: number;
      settledTransactions: number; currency: string;
    }>('memberSavings.mySummary', null),
  /** The caller's savings transactions, ALL statuses (a history that hides
   *  failed rows would be dishonest — router header). */
  myTransactions: (input?: { limit?: number; offset?: number; type?: 'Cash In' | 'Cash Out' }) =>
    memberQuery<{ transactions: MemberSavingsTxRow[]; count: number }>(
      'memberSavings.myTransactions',
      { limit: input?.limit ?? 20, offset: input?.offset ?? 0, ...(input?.type ? { type: input.type } : {}) },
    ),
  /** Open the caller's OWN account. zod-exact input (memberSavings.ts:279-287)
   *  — names/identity come from the SESSION server-side, never from input;
   *  optional fields omitted entirely when blank so the server schema is
   *  never tripped by "". Tier 2+ (bvn/nin) is gated by the fail-closed
   *  KYC enforcement service server-side. */
  openMyAccount: (input: { phone: string; email?: string; bvn?: string; nin?: string; address?: string }) =>
    memberMutation<{ success: boolean; account: MemberSavingsAccount }>(
      'memberSavings.openMyAccount', input,
    ),
};

/** Row shape from memberLoyalty.myHistory (server/routers/memberLoyalty.ts:134-142). */
export interface MemberLoyaltyHistoryRow {
  id: number;
  type: string | null;
  points: number | null;
  description: string | null;
  balanceAfter: number | null;
  createdAt: string | Date | null;
}

export const loyaltyApi = {
  /** earned − redeemed over the caller's ledger (memberLoyalty.myBalance).
   *  READ-ONLY by design — no redemption mutation exists (funds-adjacent). */
  myBalance: () =>
    memberQuery<{ customerId: number; earned: number; redeemed: number; balance: number }>(
      'memberLoyalty.myBalance', null,
    ),
  /** The caller's loyalty ledger, newest first (memberLoyalty.myHistory). */
  myHistory: (input?: { limit?: number; offset?: number }) =>
    memberQuery<{ history: MemberLoyaltyHistoryRow[]; total: number; limit: number; offset: number }>(
      'memberLoyalty.myHistory',
      { limit: input?.limit ?? 50, offset: input?.offset ?? 0 },
    ),
};

/** Row shape from memberReferrals.myReferrals
 *  (server/routers/memberReferrals.ts:108-120). */
export interface MemberReferralRow {
  id: number;
  referralCode: string | null;
  refereeCode: string | null;
  status: string | null;
  bonusPoints: number | null;
  bonusCash: string | null;
  activatedAt: string | Date | null;
  rewardedAt: string | Date | null;
  expiresAt: string | Date | null;
  createdAt: string | Date | null;
}

export type ReferralStatusFilter = 'pending' | 'activated' | 'rewarded' | 'expired';

export const referralsApi = {
  /** The caller's referrals as referrer (memberReferrals.myReferrals). */
  myReferrals: (input?: { status?: ReferralStatusFilter; limit?: number; offset?: number }) =>
    memberQuery<{ referrals: MemberReferralRow[]; total: number; limit: number; offset: number }>(
      'memberReferrals.myReferrals',
      { limit: input?.limit ?? 50, offset: input?.offset ?? 0, ...(input?.status ? { status: input.status } : {}) },
    ),
  /** The caller's existing still-valid referral code, or null (READ-ONLY —
   *  memberReferrals.myCode; null is an honest "unavailable", nothing is
   *  ever minted from a member context). */
  myCode: () =>
    memberQuery<{ referralCode: string; expiresAt: string | Date | null; existing: boolean } | null>(
      'memberReferrals.myCode', null,
    ),
};

/** Row shape from memberDisputes.myDisputes
 *  (server/routers/memberDisputes.ts:125-137 — caller-scoped via
 *  disputes.agentId = ctx.user.id). */
export interface MemberDisputeRow {
  id: number;
  ref: string | null;
  transactionId: number | null;
  transactionRef: string | null;
  status: string | null;
  priority: string | null;
  type: string | null;
  reason: string | null;
  amount: string | null;
  createdAt: string | Date | null;
}

/** Detail shape from memberDisputes.myDispute (memberDisputes.ts:160-211 —
 *  NOT_FOUND non-enumerating on foreign ids). */
export interface MemberDisputeDetail {
  dispute: MemberDisputeRow & {
    description: string | null;
    resolution: string | null;
    resolvedAt: string | Date | null;
    updatedAt: string | Date | null;
  };
  messages: Array<{
    id: number; senderType: string | null; senderName: string | null;
    content: string | null; createdAt: string | Date | null;
  }>;
  evidence: Array<{
    id: number; fileName: string | null; fileUrl: string | null;
    mimeType: string | null; fileSize: number | null; createdAt: string | Date | null;
  }>;
}

/** Member-facing status filter subset (memberDisputes.ts:95-101). */
export const DISPUTE_STATUSES = ['open', 'investigating', 'escalated', 'resolved', 'closed'] as const;
export type DisputeStatusFilter = (typeof DISPUTE_STATUSES)[number];

export const disputesApi = {
  /** The caller's disputes, newest first (memberDisputes.myDisputes). */
  myDisputes: (input?: { status?: DisputeStatusFilter; limit?: number; offset?: number }) =>
    memberQuery<{ disputes: MemberDisputeRow[]; count: number }>(
      'memberDisputes.myDisputes',
      { limit: input?.limit ?? 50, offset: input?.offset ?? 0, ...(input?.status ? { status: input.status } : {}) },
    ),
  /** Single dispute detail + messages + evidence (memberDisputes.myDispute). */
  myDispute: (id: number) =>
    memberQuery<MemberDisputeDetail>('memberDisputes.myDispute', { id: Number(id) }),
  /** File a dispute against one of the CALLER'S transactions. zod-exact
   *  input (memberDisputes.ts:225-232): { transactionId, reason,
   *  description, amount }. `amount` is the member-DECLARED disputed amount
   *  on an already-owned transaction — NO funds move, so no client-computed
   *  amount discipline issue; ownership is verified server-side FIRST
   *  (NOT_FOUND non-enumerating), and agentId/ref/status are forced
   *  server-side. */
  fileDispute: (input: { transactionId: number; reason: string; description: string; amount: number }) =>
    memberMutation<{ id: number; ref: string; status: string }>('memberDisputes.fileDispute', input),
  /** Append a member reply (memberDisputes.replyDispute — ownership
   *  re-checked; resolved/closed → PRECONDITION_FAILED). */
  replyDispute: (input: { disputeId: number; content: string }) =>
    memberMutation<{ id: number; senderType: 'customer' }>('memberDisputes.replyDispute', input),
};

// ---------------------------------------------------------------------------
// 2026-10-03 (W9-B5 wave 3): bills / airtime+mobile-money / FX / parametric /
// phone-OTP member surface, mirroring the web member portal
// (client/src/pages/member/MemberBills.tsx, MemberAirtime.tsx, MemberFx.tsx,
// MemberParametric.tsx, MemberIdentity.tsx phone section — W7-B9/B10) on the
// REAL hardened routers (server/routers/memberBillPayments.ts,
// memberAirtime.ts, memberMobileMoney.ts, memberFxRates.ts,
// parametricMember.ts, memberPhone.ts; mounted in server/routers.ts:1223,
// 1248-1251, 1265). Shapes below are copied from the server router code —
// never assumed.
//
// FUNDS DISCIPLINE (verified against the routers, 2026-10-03): NONE of these
// routers exposes a money-moving mutation, so no idempotency-key lifecycle
// (F-02) applies here — that discipline stays on premiumApi only:
//   - memberBillPayments.ts:1-38 — deliberately NO pay mutation (billPayments.
//     pay is a `transfer` funds op the `user` role has no permission for);
//     no member bill history exists either (rows are not member-scopable).
//   - memberAirtime.ts / memberMobileMoney.ts headers — no vend/cashIn/cashOut
//     (financialProcedure rails, deferred to the reviewed funds wave).
//   - memberFxRates.ts:5-8 — NO mutation proc; updateRates/refresh are broken
//     authz on the base router and never exposed.
//   - parametricMember.ts:17 — no mutations at all (trigger/payout ops are
//     admin-only on parametricEngine).
// Mobile therefore ships NO pay/purchase/exchange/trigger UI — mirroring the
// web portal exactly (which also wires none).
// ---------------------------------------------------------------------------

/** Response shape from memberBillPayments.billers
 *  (server/routers/memberBillPayments.ts:78-90 — static registry, no DB). */
export interface MemberBillersView {
  billers: Array<{ name: string; commissionRate: number; commissionPct: string }>;
  limits: { minAmountNGN: number; maxAmountNGN: number; dailyLimitNGN: number };
  configured: boolean;
}

export const billsApi = {
  /** Biller catalog + platform limits + honest provider `configured` flag. */
  billers: () => memberQuery<MemberBillersView>('memberBillPayments.billers', null),
  /** Format-only customer-number check (memberBillPayments.ts:97-112). Never
   *  authorises a payment — a valid result is a regex match only. zod-exact
   *  input: { biller: min 2, customerNumber: min 1 }. */
  validateCustomer: (input: { biller: string; customerNumber: string }) =>
    memberQuery<{ valid: boolean; customerNumber: string; biller: string; message: string }>(
      'memberBillPayments.validateCustomer', input,
    ),
};

/** Row shape from memberAirtime.myHistory (memberAirtime.ts:104-125 — scoped
 *  to the caller's phone server-side; ALL statuses verbatim). */
export interface MemberAirtimeRow {
  ref: string;
  network: string | null;
  phoneNumber: string | null;
  amount: string | null;
  status: string;
  providerStatus: string | null;
  failureReason: string | null;
  createdAt: string | Date | null;
}

export interface MemberStatusSummary {
  periodDays: number;
  totalTransactions: number;
  byStatus: Array<{ status: string; count: number; volumeNGN: number }>;
}

export const airtimeApi = {
  myHistory: (input?: { limit?: number; offset?: number }) =>
    memberQuery<{ history: MemberAirtimeRow[]; total: number }>(
      'memberAirtime.myHistory',
      { limit: input?.limit ?? 20, offset: input?.offset ?? 0 },
    ),
  mySummary: (input?: { periodDays?: number }) =>
    memberQuery<MemberStatusSummary>(
      'memberAirtime.mySummary', { periodDays: input?.periodDays ?? 30 },
    ),
};

/** Row shape from memberMobileMoney.myTransactions
 *  (server/routers/memberMobileMoney.ts:125-146). */
export interface MemberMomoTxRow {
  ref: string;
  type: string | null;
  amount: string | null;
  fee: string | null;
  status: string;
  provider: string | null;
  providerStatus: string | null;
  createdAt: string | Date | null;
}

/** Provider enum exactly as server zod (memberMobileMoney.ts PROVIDERS). */
export const MOMO_PROVIDERS = ['MTN MoMo', 'Airtel Money', 'Glo Xtra', '9PSB'] as const;
export type MomoProvider = (typeof MOMO_PROVIDERS)[number];

export const mobileMoneyApi = {
  providers: () =>
    memberQuery<{
      providers: Array<{ name: string; cashInCommission: number; cashOutCommission: number }>;
      limits: { minAmountNGN: number; maxAmountNGN: number; dailyLimitNGN: number };
      configured: boolean;
    }>('memberMobileMoney.providers', null),
  myTransactions: (input?: { provider?: MomoProvider; limit?: number; offset?: number }) =>
    memberQuery<{ transactions: MemberMomoTxRow[]; count: number }>(
      'memberMobileMoney.myTransactions',
      {
        limit: input?.limit ?? 20, offset: input?.offset ?? 0,
        ...(input?.provider ? { provider: input.provider } : {}),
      },
    ),
  /** Detail by ref — NOT_FOUND non-enumerating on foreign/nonexistent ref
   *  (memberMobileMoney.ts:160-209). */
  myTransaction: (ref: string) =>
    memberQuery<{ transaction: MemberMomoTxRow & { failureReason: string | null } }>(
      'memberMobileMoney.myTransaction', { ref },
    ),
  mySummary: (input?: { periodDays?: number }) =>
    memberQuery<MemberStatusSummary>(
      'memberMobileMoney.mySummary', { periodDays: input?.periodDays ?? 30 },
    ),
};

export const fxApi = {
  /** The published EUR-base rate book; empty map + null timestamp when none
   *  — never fabricated (memberFxRates.ts:109-128). */
  rates: () =>
    memberQuery<{ baseCurrency: string; rates: Record<string, number>; lastUpdated: string | Date | null }>(
      'memberFxRates.rates', null,
    ),
  /** Codes derived from the stored book (memberFxRates.ts:173-179). */
  currencies: () =>
    memberQuery<{ currencies: Array<{ code: string; rate: number }>; baseCurrency: string }>(
      'memberFxRates.currencies', null,
    ),
  /** EUR-base conversion over the stored book; PRECONDITION_FAILED (surfaced
   *  verbatim) when the book is missing/malformed (memberFxRates.ts:130-171).
   *  zod-exact: from/to are /^[A-Z]{3}$/, amount > 0. */
  convert: (input: { from: string; to: string; amount: number }) =>
    memberQuery<{ from: string; to: string; amount: number; convertedAmount: number; rate: number }>(
      'memberFxRates.convert', input,
    ),
  /** Real Frankfurter/ECB time-series (memberFxRates.ts:189-235). */
  historical: (input: { base: string; target: string; days: number }) =>
    memberQuery<{ base: string; target: string; timeseries: Array<{ date: string; rate: number }>; source: string }>(
      'memberFxRates.historical', input,
    ),
};

/** Row shape from parametricMember.myCoverage
 *  (server/routers/parametricMember.ts:46-90 — policies.customerId =
 *  ctx.user.id, active parametric product mapping only). */
export interface ParametricCoverageRow {
  policyId: number;
  productName: string | null;
  coveredPeril: string | null;
  payoutAmount: string | null;
  currency: string;
  status: string;
  triggerStatus: string | null;
}

/** Row shape from parametricMember.myPayouts
 *  (parametricMember.ts:118-141 — claim-scoped IDOR guard: claimantId =
 *  ctx.user.id). */
export interface ParametricPayoutRow {
  id: number;
  eventId: number;
  claimId: number;
  policyId: number;
  amount: string | null;
  currency: string;
  status: string | null;
  createdAt: string | Date | null;
}

export const parametricApi = {
  myCoverage: () =>
    memberQuery<{ coverage: ParametricCoverageRow[] }>('parametricMember.myCoverage', null),
  myPayouts: (input?: { limit?: number; offset?: number }) =>
    memberQuery<{ payouts: ParametricPayoutRow[]; count: number }>(
      'parametricMember.myPayouts',
      { limit: input?.limit ?? 50, offset: input?.offset ?? 0 },
    ),
};

// Phone ownership verification (memberPhone.ts:93-114). The input schemas
// carry NO userId/customerId — the caller's own customer profile is required
// server-side (NOT_FOUND, non-enumerating) and the OTP is delivered to the
// CLAIMED phone (possession is the proof). Per-phone throttle (5 requests/hr)
// and the 5-attempt fail-closed lock live server-side; the API returns
// {success, message}/{verified} only — no cooldown fields, so no client-side
// countdown is fabricated (web parity, MemberIdentity.tsx W7-B9).
export const memberPhoneApi = {
  /** Step 1: request an OTP. zod-exact input: { phone: 10..15 chars } only. */
  requestPhoneOtp: (phone: string) =>
    memberMutation<{ success: boolean; message?: string }>(
      'memberPhone.requestPhoneOtp', { phone },
    ),
  /** Step 2: verify. zod-exact input: { phone: 10..15, otp: exactly 6 }.
   *  Wrong code → { verified: false } or a server error surfaced verbatim;
   *  never treated as success unless verified === true. */
  verifyPhoneOtp: (input: { phone: string; otp: string }) =>
    memberMutation<{ verified?: boolean }>(
      'memberPhone.verifyPhoneOtp', input,
    ),
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
