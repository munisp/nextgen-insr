// @ts-check

/**
 * PBAC Engine Adapter (S88-05)
 * Bridges Node.js to Go pbac-engine for policy-based access control
 */
import { pbacEngine, type AdapterResponse } from "./goServiceAdapter";

export interface Policy {
  id: string;
  name: string;
  effect: "allow" | "deny";
  subjects: string[];
  resources: string[];
  actions: string[];
  conditions?: Record<string, unknown>;
  priority: number;
}

export interface AuthorizationResult {
  allowed: boolean;
  matchedPolicy?: string;
  reason: string;
  evaluationTimeMs: number;
}

export async function authorize(
  subject: string,
  resource: string,
  action: string,
  context?: Record<string, unknown>
): Promise<AdapterResponse<AuthorizationResult>> {
  return pbacEngine.post<AuthorizationResult>("/authorize", {
    subject,
    resource,
    action,
    context,
  });
}

export async function listPolicies(): Promise<AdapterResponse<Policy[]>> {
  return pbacEngine.get<Policy[]>("/policies");
}

export async function createPolicy(
  policy: Omit<Policy, "id">
): Promise<AdapterResponse<Policy>> {
  return pbacEngine.post<Policy>("/policies", policy);
}

export async function updatePolicy(
  id: string,
  policy: Partial<Policy>
): Promise<AdapterResponse<Policy>> {
  return pbacEngine.put<Policy>(`/policies/${id}`, policy);
}

export async function deletePolicy(id: string): Promise<AdapterResponse<void>> {
  return pbacEngine.delete<void>(`/policies/${id}`);
}
