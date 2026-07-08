// @ts-check

/**
 * Africa's Talking USSD Handler Adapter (S88-13)
 * Bridges Node.js to Go at-ussd-handler for AT USSD integration
 */
import { atUssdHandler, type AdapterResponse } from "./goServiceAdapter";

export interface AtUssdCallback {
  sessionId: string;
  phoneNumber: string;
  networkCode: string;
  serviceCode: string;
  text: string;
}

export interface AtUssdResponse {
  response: string;
  endSession: boolean;
}

export interface AtUssdSessionInfo {
  sessionId: string;
  phoneNumber: string;
  state: string;
  menuPath: string[];
  createdAt: string;
  lastActivity: string;
}

export async function handleCallback(
  callback: AtUssdCallback
): Promise<AdapterResponse<AtUssdResponse>> {
  return atUssdHandler.post<AtUssdResponse>("/ussd/callback", callback);
}

export async function listSessions(
  limit?: number
): Promise<AdapterResponse<AtUssdSessionInfo[]>> {
  return atUssdHandler.get<AtUssdSessionInfo[]>(
    "/ussd/sessions",
    limit ? { limit: String(limit) } : undefined
  );
}

export async function cleanupExpiredSessions(): Promise<
  AdapterResponse<{ cleaned: number }>
> {
  return atUssdHandler.post<{ cleaned: number }>("/ussd/cleanup");
}
