// @ts-check

/**
 * USSD Gateway Adapter (S88-09)
 * Bridges Node.js to Go ussd-gateway for USSD session management
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

export interface UssdStats {
  activeSessions: number;
  completedToday: number;
  avgDurationMs: number;
  topMenus: Array<{ menu: string; count: number }>;
}

export async function createSession(
  phoneNumber: string,
  serviceCode: string
): Promise<AdapterResponse<UssdSession>> {
  return ussdGateway.post<UssdSession>("/api/ussd/session", {
    phoneNumber,
    serviceCode,
  });
}

export async function handleCallback(
  sessionId: string,
  input: string
): Promise<AdapterResponse<{ response: string; endSession: boolean }>> {
  return ussdGateway.post<{ response: string; endSession: boolean }>(
    "/api/ussd/callback",
    { sessionId, input }
  );
}

export async function listSessions(
  status?: string
): Promise<AdapterResponse<UssdSession[]>> {
  return ussdGateway.get<UssdSession[]>(
    "/api/ussd/sessions",
    status ? { status } : undefined
  );
}

export async function getStats(): Promise<AdapterResponse<UssdStats>> {
  return ussdGateway.get<UssdStats>("/api/ussd/stats");
}
