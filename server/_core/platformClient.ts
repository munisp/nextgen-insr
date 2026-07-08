// @ts-check

/**
 * platformClient.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin HTTP gateway that forwards POS Shell requests to the canonical platform
 * microservices.  Every call attaches the Keycloak access_token from the
 * current request context so the downstream services can enforce their own
 * RBAC policies.
 *
 * Service URLs are read from environment variables so they can be overridden
 * per deployment (local Docker Compose, K8s, staging, prod).
 *
 * Fail-open strategy: when a platform service is unreachable the caller
 * receives a structured PlatformError and can decide whether to fall back to
 * the local PostgreSQL implementation or surface the error to the client.
 */

import { ENV } from "./env.js";
import { getMtlsAgent } from "../lib/mtlsAgent.js";

// ─── Service base URLs ────────────────────────────────────────────────────────

export const PLATFORM_URLS = {
  kyc: ENV.PLATFORM_KYC_URL ?? "https://kyc.insureportal.io",
  videoKyc: ENV.PLATFORM_VIDEO_KYC_URL ?? "https://videokyc.insureportal.io",
  fraud: ENV.PLATFORM_FRAUD_URL ?? "https://fraud.insureportal.io",
  settlement: ENV.PLATFORM_SETTLEMENT_URL ?? "https://settlement.insureportal.io",
  geofencing: ENV.PLATFORM_GEOFENCING_URL ?? "https://geofencing.insureportal.io",
  loyalty: ENV.PLATFORM_LOYALTY_URL ?? "https://loyalty.insureportal.io",
  float: ENV.PLATFORM_FLOAT_URL ?? "https://float.insureportal.io",
  dispute: ENV.PLATFORM_DISPUTE_URL ?? "https://disputes.insureportal.io",
  analytics: ENV.PLATFORM_ANALYTICS_URL ?? "https://analytics.insureportal.io",
  notification: ENV.PLATFORM_NOTIFICATION_URL ?? "https://notify.insureportal.io",
} as const;

// ─── Error type ───────────────────────────────────────────────────────────────

export class PlatformError extends Error {
  constructor(
    public readonly service: string,
    public readonly status: number,
    public readonly detail: string
  ) {
    super(`[${service}] ${status}: ${detail}`);
    this.name = "PlatformError";
  }
}

// ─── Core fetch helper ────────────────────────────────────────────────────────

async function platformFetch<T>(
  service: string,
  baseUrl: string,
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((fetchOptions.headers as Record<string, string>) ?? {}),
  };

  const url = `${baseUrl}${path}`;

  // Attach mTLS agent when certificates are available (HTTPS platform services).
  // Falls back to plain fetch when MTLS_ENABLED=false or certs are absent.
  const mtlsAgent = getMtlsAgent();
  const agentOption = mtlsAgent ? { agent: mtlsAgent } : {};

  let res: Response;
  try {
    res = await fetch(url, {
      ...fetchOptions,
      ...agentOption,
      headers,
    } as RequestInit);
  } catch (err) {
    throw new PlatformError(
      service,
      503,
      `Service unreachable: ${String(err)}`
    );
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string; message?: string };
      detail = body.detail ?? body.message ?? detail;
    } catch {
      /* ignore */
    }
    throw new PlatformError(service, res.status, detail);
  }

  return res.json() as Promise<T>;
}

// ─── KYC Service ─────────────────────────────────────────────────────────────

export const kycPlatform = {
  /** Create an Enhanced KYC case for a customer */
  createCase: (payload: Record<string, unknown>, token: string) =>
    platformFetch("kyc", PLATFORM_URLS.kyc, "/cases", {
      method: "POST",
      body: JSON.stringify(payload),
      token,
    }),

  /** Get a specific KYC case */
  getCase: (caseId: string, token: string) =>
    platformFetch("kyc", PLATFORM_URLS.kyc, `/cases/${caseId}`, { token }),

  /** List KYC cases with optional status filter */
  listCases: (
    params: { skip?: number; limit?: number; status?: string },
    token: string
  ) => {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ).toString();
    return platformFetch(
      "kyc",
      PLATFORM_URLS.kyc,
      `/cases${qs ? `?${qs}` : ""}`,
      { token }
    );
  },
};

// ─── Video KYC / Liveness Service ────────────────────────────────────────────

export const videoKycPlatform = {
  /** Create a liveness challenge */
  createChallenge: (
    payload: { session_id: string; challenge_type?: string },
    token: string
  ) =>
    platformFetch("video-kyc", PLATFORM_URLS.videoKyc, "/challenge/create", {
      method: "POST",
      body: JSON.stringify(payload),
      token,
    }),

  /** Submit a frame response to a liveness challenge */
  respondChallenge: (
    challengeId: string,
    payload: { frame_data: string; timestamp: number },
    token: string
  ) =>
    platformFetch(
      "video-kyc",
      PLATFORM_URLS.videoKyc,
      `/challenge/${challengeId}/respond`,
      {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }
    ),

  /** Get the status of a liveness challenge */
  challengeStatus: (challengeId: string, token: string) =>
    platformFetch(
      "video-kyc",
      PLATFORM_URLS.videoKyc,
      `/challenge/${challengeId}/status`,
      {
        token,
      }
    ),

  /** Run passive liveness detection on a single frame */
  detectLiveness: (payload: { image_data: string }, token: string) =>
    platformFetch("video-kyc", PLATFORM_URLS.videoKyc, "/detect", {
      method: "POST",
      body: JSON.stringify(payload),
      token,
    }),
};

// ─── Fraud Detection Service ──────────────────────────────────────────────────

export const fraudPlatform = {
  /** Create a fraud report */
  createReport: (payload: Record<string, unknown>, token: string) =>
    platformFetch("fraud", PLATFORM_URLS.fraud, "/api/v1/fraud-reports", {
      method: "POST",
      body: JSON.stringify(payload),
      token,
    }),

  /** List fraud reports */
  listReports: (
    params: { skip?: number; limit?: number; tenant_id?: number },
    token: string
  ) => {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ).toString();
    return platformFetch(
      "fraud",
      PLATFORM_URLS.fraud,
      `/api/v1/fraud-reports${qs ? `?${qs}` : ""}`,
      { token }
    );
  },

  /** Update a fraud report status */
  updateReport: (
    reportId: number,
    payload: Record<string, unknown>,
    token: string
  ) =>
    platformFetch(
      "fraud",
      PLATFORM_URLS.fraud,
      `/api/v1/fraud-reports/${reportId}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
        token,
      }
    ),
};

// ─── Float Settlement Engine ──────────────────────────────────────────────────

export const settlementPlatform = {
  /** Trigger settlement processing for a specific date */
  processSettlement: (
    payload: { settlement_date?: string; agent_ids?: string[] },
    token: string
  ) =>
    platformFetch(
      "settlement",
      PLATFORM_URLS.settlement,
      "/settlements/process",
      {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }
    ),

  /** Get outstanding settlements */
  getOutstanding: (token: string) =>
    platformFetch(
      "settlement",
      PLATFORM_URLS.settlement,
      "/settlements/outstanding",
      { token }
    ),

  /** Get settlement history */
  getHistory: (params: { limit?: number; offset?: number }, token: string) => {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ).toString();
    return platformFetch(
      "settlement",
      PLATFORM_URLS.settlement,
      `/settlements/history${qs ? `?${qs}` : ""}`,
      { token }
    );
  },
};

// ─── Geofencing Service ───────────────────────────────────────────────────────

export const geofencingPlatform = {
  /** Report a terminal's current location */
  reportLocation: (
    terminalId: string,
    payload: { lat: number; lng: number; accuracy?: number },
    token: string
  ) =>
    platformFetch(
      "geofencing",
      PLATFORM_URLS.geofencing,
      `/terminals/${terminalId}/location`,
      {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }
    ),

  /** Check if a terminal is within its assigned zones */
  checkZone: (terminalId: string, token: string) =>
    platformFetch(
      "geofencing",
      PLATFORM_URLS.geofencing,
      `/terminals/${terminalId}/check`,
      { token }
    ),

  /** List all geofence zones */
  listZones: (token: string) =>
    platformFetch("geofencing", PLATFORM_URLS.geofencing, "/zones", { token }),

  /** Create a geofence zone */
  createZone: (payload: Record<string, unknown>, token: string) =>
    platformFetch("geofencing", PLATFORM_URLS.geofencing, "/zones", {
      method: "POST",
      body: JSON.stringify(payload),
      token,
    }),

  /** Update a geofence zone */
  updateZone: (
    zoneId: string,
    payload: Record<string, unknown>,
    token: string
  ) =>
    platformFetch("geofencing", PLATFORM_URLS.geofencing, `/zones/${zoneId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
      token,
    }),
};

// ─── Loyalty Service ──────────────────────────────────────────────────────────

export const loyaltyPlatform = {
  /** Get loyalty profile for an agent */
  getProfile: (agentId: string, token: string) =>
    platformFetch(
      "loyalty",
      PLATFORM_URLS.loyalty,
      `/loyalty/agents/${agentId}/profile`,
      { token }
    ),

  /** Award loyalty points */
  awardPoints: (
    agentId: string,
    payload: { points: number; reason: string; txRef?: string },
    token: string
  ) =>
    platformFetch(
      "loyalty",
      PLATFORM_URLS.loyalty,
      `/loyalty/agents/${agentId}/points`,
      {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }
    ),

  /** Redeem loyalty points */
  redeemPoints: (
    agentId: string,
    payload: { points: number; reward_id: string },
    token: string
  ) =>
    platformFetch(
      "loyalty",
      PLATFORM_URLS.loyalty,
      `/loyalty/agents/${agentId}/redeem`,
      {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }
    ),

  /** List available rewards */
  listRewards: (token: string) =>
    platformFetch("loyalty", PLATFORM_URLS.loyalty, "/loyalty/rewards", {
      token,
    }),
};

// ─── Float Service ────────────────────────────────────────────────────────────

export const floatPlatform = {
  /** Get premium reserve for an agent (Go float-management service) */
  getBalance: (agentId: string, token: string) =>
    platformFetch(
      "float",
      PLATFORM_URLS.float,
      `/api/v1/float/agents/${agentId}/balance`,
      { token }
    ),

  /** Utilize (debit) float for a transaction — replaces reserve+commit */
  utilize: (
    payload: {
      agent_id: string;
      amount: number;
      reference: string;
      transaction_type: string;
      description?: string;
    },
    token: string
  ) =>
    platformFetch("float", PLATFORM_URLS.float, "/api/v1/float/utilize", {
      method: "POST",
      body: JSON.stringify(payload),
      token,
    }),

  /** Settle (credit) float for a Cash In / top-up */
  settle: (
    payload: {
      agent_id: string;
      amount: number;
      reference: string;
      transaction_type: string;
      description?: string;
    },
    token: string
  ) =>
    platformFetch("float", PLATFORM_URLS.float, "/api/v1/float/settle", {
      method: "POST",
      body: JSON.stringify(payload),
      token,
    }),

  /** Get float transaction history */
  getTransactions: (agentId: string, limit = 100, token: string) =>
    platformFetch(
      "float",
      PLATFORM_URLS.float,
      `/api/v1/float/agents/${agentId}/transactions?limit=${limit}`,
      { token }
    ),
};

// ─── Dispute Service ──────────────────────────────────────────────────────────

export const disputePlatform = {
  /** Open a new dispute */
  open: (payload: Record<string, unknown>, token: string) =>
    platformFetch("dispute", PLATFORM_URLS.dispute, "/disputes", {
      method: "POST",
      body: JSON.stringify(payload),
      token,
    }),

  /** List disputes (optionally filtered by agent/customer) */
  list: (
    params: { agent_id?: string; status?: string; limit?: number },
    token: string
  ) => {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ).toString();
    return platformFetch(
      "dispute",
      PLATFORM_URLS.dispute,
      `/disputes${qs ? `?${qs}` : ""}`,
      { token }
    );
  },

  /** Get a specific dispute */
  get: (disputeId: string, token: string) =>
    platformFetch("dispute", PLATFORM_URLS.dispute, `/disputes/${disputeId}`, {
      token,
    }),

  /** Add a message/evidence to a dispute */
  addMessage: (
    disputeId: string,
    payload: { message: string; attachments?: string[] },
    token: string
  ) =>
    platformFetch(
      "dispute",
      PLATFORM_URLS.dispute,
      `/disputes/${disputeId}/messages`,
      {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }
    ),

  /** Resolve a dispute */
  resolve: (
    disputeId: string,
    payload: { resolution: string; outcome: string },
    token: string
  ) =>
    platformFetch(
      "dispute",
      PLATFORM_URLS.dispute,
      `/disputes/${disputeId}/resolve`,
      {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }
    ),

  /** Create a new dispute (alias for open with full payload) */
  createDispute: (payload: Record<string, unknown>, token: string) =>
    platformFetch("dispute", PLATFORM_URLS.dispute, "/disputes", {
      method: "POST",
      body: JSON.stringify(payload),
      token,
    }),

  /** Get all disputes for a specific user/agent */
  getUserDisputes: (userId: string, token: string) =>
    platformFetch(
      "dispute",
      PLATFORM_URLS.dispute,
      `/disputes/user/${userId}`,
      { token }
    ),

  /** Issue provisional credit for a dispute */
  issueProvisionalCredit: (
    disputeId: string,
    payload: { amount: number; reason: string; issued_by: string },
    token: string
  ) =>
    platformFetch(
      "dispute",
      PLATFORM_URLS.dispute,
      `/disputes/${disputeId}/provisional-credit`,
      {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }
    ),

  /** Initiate a chargeback for a dispute */
  initiateChargeback: (
    disputeId: string,
    payload: {
      amount: number;
      reason: string;
      chargeback_code?: string;
      initiated_by: string;
    },
    token: string
  ) =>
    platformFetch(
      "dispute",
      PLATFORM_URLS.dispute,
      `/disputes/${disputeId}/chargeback`,
      {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }
    ),

  /** Complete a chargeback */
  completeChargeback: (
    disputeId: string,
    completedBy: string,
    success: boolean,
    notes: string,
    token: string
  ) =>
    platformFetch(
      "dispute",
      PLATFORM_URLS.dispute,
      `/disputes/${disputeId}/chargeback/complete`,
      {
        method: "POST",
        body: JSON.stringify({ completed_by: completedBy, success, notes }),
        token,
      }
    ),

  /** Get dispute statistics */
  getStats: (token: string) =>
    platformFetch("dispute", PLATFORM_URLS.dispute, "/stats", { token }),
};

// ─── Analytics Service ────────────────────────────────────────────────────────

export const analyticsPlatform = {
  /** Get transaction summary report */
  transactionSummary: (
    params: { start_date?: string; end_date?: string; agent_id?: string },
    token: string
  ) => {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ).toString();
    return platformFetch(
      "analytics",
      PLATFORM_URLS.analytics,
      `/analytics/reports/transactions${qs ? `?${qs}` : ""}`,
      { token }
    );
  },

  /** Get revenue analysis */
  revenueAnalysis: (
    params: { start_date?: string; end_date?: string },
    token: string
  ) => {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ).toString();
    return platformFetch(
      "analytics",
      PLATFORM_URLS.analytics,
      `/analytics/reports/revenue${qs ? `?${qs}` : ""}`,
      { token }
    );
  },

  /** Get risk analytics */
  riskAnalytics: (token: string) =>
    platformFetch(
      "analytics",
      PLATFORM_URLS.analytics,
      "/analytics/reports/risk",
      { token }
    ),
};

// ─── Notification Service ─────────────────────────────────────────────────────

export const notificationPlatform = {
  /** Send a notification to a user/agent */
  send: (
    payload: {
      recipient_id: string;
      channel: "sms" | "email" | "push" | "in_app";
      title: string;
      message: string;
      metadata?: Record<string, unknown>;
    },
    token: string
  ) =>
    platformFetch(
      "notification",
      PLATFORM_URLS.notification,
      "/notifications/send",
      {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }
    ),

  /** Send bulk notifications */
  sendBulk: (payload: { notifications: unknown[] }, token: string) =>
    platformFetch(
      "notification",
      PLATFORM_URLS.notification,
      "/notifications/bulk",
      {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }
    ),
};

// ── Generic proxy fetch (for platformProxy tRPC router) ──────────────────────
/**
 * proxyFetch — a thin public wrapper that forwards calls to any platform
 * microservice via the APISix gateway.  Injects the platform API key and
 * attaches the mTLS agent when certificates are available.
 *
 * @param url  Full URL (including base) to the platform microservice endpoint
 * @param init Standard RequestInit options (method, headers, body, etc.)
 */
export async function proxyFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const PLATFORM_API_KEY = process.env.PLATFORM_API_KEY ?? "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(PLATFORM_API_KEY
      ? { Authorization: `Bearer ${PLATFORM_API_KEY}` }
      : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const mtlsAgent = getMtlsAgent();
  const agentOption = mtlsAgent ? { agent: mtlsAgent } : {};
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, ...agentOption } as RequestInit);
  } catch (err) {
    throw new Error(`Platform gateway unreachable: ${String(err)}`);
  }
  return res;
}
