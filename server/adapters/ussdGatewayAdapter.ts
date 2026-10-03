/**
 * USSD Gateway Adapter (S88-09)
 * Bridges Node.js to the Go ussd-gateway for USSD session visibility.
 *
 * RECONCILIATION (2026-10-03): this adapter previously called
 * `/api/ussd/session`, `/api/ussd/callback`, `/api/ussd/sessions` and
 * `/api/ussd/stats` — paths that NEITHER live gateway implements:
 *  - root ./ussd-gateway (chi, :8092 in docker-compose.production.yml) serves
 *    POST /ussd plus /api/v1/{register,agents/{id},sessions/{id},...};
 *  - services/go/ussd-gateway (gin, :8082 in docker-compose.yaml) serves
 *    POST /ussd/callback (telco form POST) plus /api/v1/ussd/{sessions,stats}.
 * Neither gateway exposes REST session creation or a JSON callback — USSD
 * sessions are created implicitly by telco-driven form callbacks. Those
 * functions now FAIL CLOSED instead of silently calling non-existent paths.
 * Stats are wired to the real services/go/ussd-gateway endpoints, which
 * require the USSD_CALLBACK_TOKEN shared secret (X-Callback-Token header,
 * attached by goServiceAdapter) and fail closed with 503 when unconfigured.
 */
import { ussdGateway, type AdapterResponse } from "./goServiceAdapter";

export interface UssdSession {
  sessionId: string;
  phoneNumber: string;
  serviceCode: string;
  currentMenu: string;
  state: "active" | "completed" | "timeout";
  createdAt: string;
  lastActivity: string;
}

// Real payload of GET /api/v1/ussd/stats on services/go/ussd-gateway
// (main.go getUSSDStats). Counts only — the gateway deliberately withholds
// per-session identifiers, so no session list can be honestly returned.
export interface UssdStats {
  totalSessions: number;
  activeSessions: number;
  completedSessions: number;
  topFlows: string[];
  window: string;
  processStartedAt: string;
}

function failClosed(fn: string, reason: string): AdapterResponse<never> {
  return {
    success: false,
    error: `[ussdGatewayAdapter.${fn}] ${reason} (reconciled 2026-10-03 — refusing to call non-existent gateway paths)`,
    latencyMs: 0,
    service: "ussd-gateway",
    circuitState: "closed",
  };
}

/**
 * @deprecated 2026-10-03 — no live gateway implements REST session creation;
 * sessions are telco-callback-driven. Fails closed.
 */
export async function createSession(
  _phoneNumber: string,
  _serviceCode: string
): Promise<AdapterResponse<UssdSession>> {
  return failClosed(
    "createSession",
    "REST session creation is not implemented by any ussd-gateway"
  );
}

/**
 * @deprecated 2026-10-03 — no live gateway implements a JSON USSD callback;
 * callbacks are telco form POSTs to /ussd (root gateway) or /ussd/callback
 * (services/go gateway) authenticated with the telco shared secret. Fails
 * closed.
 */
export async function handleCallback(
  _sessionId: string,
  _input: string
): Promise<AdapterResponse<{ response: string; endSession: boolean }>> {
  return failClosed(
    "handleCallback",
    "JSON USSD callback is not implemented by any ussd-gateway"
  );
}

/**
 * @deprecated 2026-10-03 — services/go/ussd-gateway intentionally returns
 * session COUNTS only (identifiers withheld); no gateway returns a session
 * list, so a UssdSession[] cannot be honestly produced. Fails closed.
 */
export async function listSessions(
  _status?: string
): Promise<AdapterResponse<UssdSession[]>> {
  return failClosed(
    "listSessions",
    "gateway exposes aggregate session counts only, never a session list"
  );
}

// Real gateway call: GET /api/v1/ussd/stats on services/go/ussd-gateway.
export async function getStats(): Promise<AdapterResponse<UssdStats>> {
  return ussdGateway.get<UssdStats>("/api/v1/ussd/stats");
}
