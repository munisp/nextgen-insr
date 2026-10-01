/**
 * loyaltyApi.ts — R3 batch 1 member loyalty + referrals bindings (2026-10-01, R3)
 *
 * Typed tRPC-over-HTTP bindings for the NEW member-scoped monolith routers
 * (server/routers/memberLoyalty.ts / memberReferrals.ts), following the
 * innovationApi.ts envelope conventions: same-origin /api/trpc, superjson
 * envelope `{json:…}` in / `result.data.json` out, `credentials: "include"`
 * (member session cookie — no tokens stored), and the NOT_FOUND/FORBIDDEN/404/
 * 403 → `null` degradation contract: pages MUST treat `null` as "feature not
 * available on this deployment" and render a disclosed empty state.
 *
 * Binding status (2026-10-01, R3 — all bindings REAL):
 *  - memberLoyalty.myBalance / myHistory   REAL — member-scoped read-only
 *    views; the `loyalty` router is an AGENT program and
 *    `customerLoyaltyProgram` takes arbitrary customerId (IDOR), so neither
 *    is used here.
 *  - memberReferrals.myReferrals / myCode  REAL — member-scoped list +
 *    persisted code minting (REF + CSPRNG, 30-day expiry). No fabricated
 *    codes: if the backend is unavailable the page shows the disclosed
 *    "not available" state.
 *  - referralProgramDedicated.tiers        REAL — static reward-tier config
 *    (member-safe read-only; the platform-wide list/summary and the
 *    arbitrary-referrerId generateLink on that router are NOT used).
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
export class LoyaltyApiError extends Error {
  constructor(
    message: string,
    readonly trpcCode?: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "LoyaltyApiError";
  }
}

/**
 * Feature-detection contract (2026-10-01, R3 — same as innovationApi.ts):
 * when a deployment runs an older backend that predates these mounts (tRPC
 * NOT_FOUND, HTTP 404) or gates them (FORBIDDEN 403), the binding resolves
 * to `null` instead of throwing. Genuine errors still throw.
 */
function isUnavailableError(error: LoyaltyApiError): boolean {
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
    throw new LoyaltyApiError(
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
    const err = new LoyaltyApiError(
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

// ── R3 member loyalty (REAL — server/routers/memberLoyalty.ts) ────────────

export interface LoyaltyBalance {
  customerId: number;
  earned: number;
  redeemed: number;
  balance: number;
}

export interface LoyaltyHistoryItem {
  id: number;
  type: string; // "earned" | "redeemed" | "bonus" | "penalty" | "challenge"
  points: number;
  description: string | null;
  balanceAfter: number;
  createdAt: string;
}

export interface LoyaltyHistoryResult {
  history: LoyaltyHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}

export const loyaltyApi = {
  myBalance: () =>
    trpcCall<LoyaltyBalance>("memberLoyalty.myBalance", "query", undefined, {
      unavailableAsNull: true,
    }),
  myHistory: (params?: { limit?: number; offset?: number }) =>
    trpcCall<LoyaltyHistoryResult>(
      "memberLoyalty.myHistory",
      "query",
      params,
      { unavailableAsNull: true }
    ),
};

// ── R3 member referrals (REAL — server/routers/memberReferrals.ts) ────────

export interface ReferralItem {
  id: number;
  referralCode: string;
  refereeCode: string | null;
  status: string; // "pending" | "activated" | "rewarded" | "expired"
  bonusPoints: number;
  bonusCash: string;
  activatedAt: string | null;
  rewardedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ReferralListResult {
  referrals: ReferralItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ReferralCodeResult {
  referralCode: string;
  expiresAt: string | null;
  /** 2026-10-01 (R3-fix): always true — myCode is read-only and only ever returns a pre-existing still-valid code. */
  existing: boolean;
}

export interface ReferralTier {
  min: number;
  max: number;
  perReferral: number;
  revShare: number;
  revShareMonths: number;
}

export const referralsApi = {
  myReferrals: (params?: {
    status?: "pending" | "activated" | "rewarded" | "expired";
    limit?: number;
    offset?: number;
  }) =>
    trpcCall<ReferralListResult>(
      "memberReferrals.myReferrals",
      "query",
      params,
      { unavailableAsNull: true }
    ),
  /**
   * 2026-10-01 (R3-fix): READ-ONLY query — the server no longer mints codes
   * from a member context (referrals.referrer_agent_id FKs to agents.id);
   * it returns the caller's existing valid agent-side code or null, which
   * maps to the disclosed unavailable state. Never fabricates a code.
   */
  myCode: () =>
    trpcCall<ReferralCodeResult>(
      "memberReferrals.myCode",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
  /** Static reward-tier config (read-only, member-safe). */
  tiers: () =>
    trpcCall<{ tiers: ReferralTier[] }>(
      "referralProgramDedicated.tiers",
      "query",
      undefined,
      { unavailableAsNull: true }
    ),
};
