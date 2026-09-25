/**
 * teleconsultAdapter.ts — Q4 health & retention wave (2026-09-25)
 *
 * Configurable HTTP adapter for an external teleconsultation provider
 * (Alan-style care-app retention layer). REAL HTTP only, built on the
 * shared resilient client (timeout + retry + circuit breaker, same
 * discipline as the P-wave NIBSS path — see server/lib/resilientFetch.ts).
 *
 * FAIL-CLOSED / HONEST-BY-CONSTRUCTION:
 *  - When TELECONSULT_PROVIDER_URL is not configured, every operation throws
 *    TeleconsultNotConfiguredError. The router maps this to PRECONDITION_FAILED
 *    with an explicit "provider not configured" message. NO fake consultations
 *    are ever synthesized.
 *  - Circuit open / timeout / provider errors propagate as errors; sessions
 *    are never silently marked booked.
 *
 * PHI DISCIPLINE: the adapter exchanges only a pseudonymous member reference
 * (`member:<userId>`) and a scheduled timestamp. No names, symptoms, notes or
 * clinical data cross this boundary, and none are persisted
 * (teleconsult_sessions stores refs + status only).
 *
 * Configuration (env):
 *  - TELECONSULT_PROVIDER_URL   base URL of the provider API (required)
 *  - TELECONSULT_API_KEY        bearer credential (required when URL set)
 *  - TELECONSULT_PROVIDER_CODE  provider tenant code stored on rows (default "default")
 *  - TELECONSULT_TIMEOUT_MS     per-request timeout (default 5000)
 */
import { resilientFetch } from "./resilientFetch";

const SERVICE_NAME = "teleconsult";

export class TeleconsultNotConfiguredError extends Error {
  constructor() {
    super(
      "Teleconsult provider is not configured (TELECONSULT_PROVIDER_URL/TELECONSULT_API_KEY). No consultation can be booked; this platform never simulates one."
    );
    this.name = "TeleconsultNotConfiguredError";
  }
}

export interface TeleconsultConfig {
  baseUrl: string;
  apiKey: string;
  providerCode: string;
  timeoutMs: number;
}

export function getTeleconsultConfig(): TeleconsultConfig | null {
  const baseUrl = process.env.TELECONSULT_PROVIDER_URL?.trim();
  const apiKey = process.env.TELECONSULT_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    providerCode: process.env.TELECONSULT_PROVIDER_CODE?.trim() || "default",
    timeoutMs: Number(process.env.TELECONSULT_TIMEOUT_MS ?? 5_000) || 5_000,
  };
}

export function isTeleconsultConfigured(): boolean {
  return getTeleconsultConfig() !== null;
}

function requireConfig(): TeleconsultConfig {
  const cfg = getTeleconsultConfig();
  if (!cfg) throw new TeleconsultNotConfiguredError();
  return cfg;
}

/** Lifecycle statuses mirrored from the provider (coarse, non-clinical). */
export type TeleconsultStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "failed";

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
  "failed",
]);

interface ProviderBookResponse {
  sessionId?: unknown;
  status?: unknown;
}

interface ProviderStatusResponse {
  sessionId?: unknown;
  status?: unknown;
}

function headers(cfg: TeleconsultConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/**
 * Book a teleconsult session with the provider. Returns the provider's opaque
 * session reference. Throws TeleconsultNotConfiguredError when unconfigured
 * and Error on any provider/transport failure — callers must not fabricate
 * a booking on failure.
 */
export async function bookSession(input: {
  memberRef: string;
  scheduledAt: Date;
}): Promise<{ providerSessionRef: string; providerCode: string }> {
  const cfg = requireConfig();
  const res = await resilientFetch<ProviderBookResponse>(
    `${cfg.baseUrl}/v1/sessions`,
    {
      method: "POST",
      headers: headers(cfg),
      body: JSON.stringify({
        // Pseudonymous reference + schedule only — no PHI crosses the boundary.
        memberRef: input.memberRef,
        scheduledAt: input.scheduledAt.toISOString(),
      }),
    },
    { serviceName: SERVICE_NAME, timeoutMs: cfg.timeoutMs }
  );
  const sessionId = res?.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    // Honest contract failure: provider answered 2xx but without the session
    // reference we need to track the booking — treat as failure, not success.
    throw new Error(
      "[teleconsult] Provider response missing sessionId — booking not trackable"
    );
  }
  return { providerSessionRef: sessionId, providerCode: cfg.providerCode };
}

/**
 * Poll the provider for the current (coarse) session status. An unrecognized
 * provider status THROWS rather than persisting a guessed value.
 */
export async function getSessionStatus(input: {
  providerSessionRef: string;
}): Promise<{ status: TeleconsultStatus }> {
  const cfg = requireConfig();
  const res = await resilientFetch<ProviderStatusResponse>(
    `${cfg.baseUrl}/v1/sessions/${encodeURIComponent(input.providerSessionRef)}`,
    { method: "GET", headers: headers(cfg) },
    { serviceName: SERVICE_NAME, timeoutMs: cfg.timeoutMs }
  );
  const status = res?.status;
  if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
    throw new Error(
      `[teleconsult] Provider returned unrecognized status ${JSON.stringify(status)} — not persisting a guessed value`
    );
  }
  return { status: status as TeleconsultStatus };
}
