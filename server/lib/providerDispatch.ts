/**
 * providerDispatch.ts — shared protocol client for vending / bill-payment /
 * mobile-money provider HTTP APIs (VTpass/Baxi/Reloadly-style JSON APIs).
 *
 * Unknown-outcome discipline (funds safety, F-02):
 *   - Every operation is keyed by a stable, caller-provided `reference` that
 *     is persisted locally BEFORE dispatch and sent to the provider as the
 *     idempotency key.
 *   - Dispatch outcomes are TRI-STATE:
 *       accepted — the provider explicitly accepted the operation (definitive)
 *       rejected — the provider explicitly rejected it (definitive; safe to
 *                  surface as failed and safe to retry with a NEW reference)
 *       unknown  — timeout, connection reset, 5xx, or a malformed reply AFTER
 *                  the request may have reached the provider. The caller MUST
 *                  NOT blindly re-dispatch (the provider may have accepted);
 *                  it MUST resolve via lookupProviderStatus() first.
 *   - Malformed provider replies are NEVER treated as success (fail-closed).
 *
 * Wire protocol (documented; mirrors common Nigerian vending providers):
 *   POST {baseUrl}{path}
 *     headers: Content-Type: application/json, Authorization: Bearer <apiKey>?
 *     body:    { ...payload, reference, api_key? }
 *   definitive accept  <- HTTP 2xx AND body.status in {"success","accepted"}
 *   definitive reject  <- HTTP 4xx, OR HTTP 2xx with body.status in
 *                         {"failed","error","rejected"}
 *   unknown            <- timeout / network error / HTTP 5xx / any other shape
 *
 *   GET {baseUrl}/status/{reference}
 *     -> body.status in {"completed","failed","pending"}; anything else is
 *        "unknown" (never fabricated).
 */

export type ProviderDispatchOutcome = "accepted" | "rejected" | "unknown";

export interface ProviderDispatchResult {
  outcome: ProviderDispatchOutcome;
  providerRef?: string;
  reason?: string;
}

export type ProviderStatusValue = "completed" | "failed" | "pending" | "unknown";

export interface ProviderStatusResult {
  status: ProviderStatusValue;
  providerRef?: string;
  reason?: string;
}

export interface ProviderClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function headers(apiKey?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
  return h;
}

/** Error marker for outcomes where the provider may have accepted the op. */
export const UNKNOWN_OUTCOME_PREFIX = "UNKNOWN_OUTCOME:";

export function isUnknownOutcomeError(err: unknown): boolean {
  return (
    err instanceof Error && err.message.startsWith(UNKNOWN_OUTCOME_PREFIX)
  );
}

export async function dispatchProviderOperation(
  cfg: ProviderClientConfig & {
    path: string;
    reference: string;
    payload: Record<string, unknown>;
  }
): Promise<ProviderDispatchResult> {
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}${cfg.path}`, {
      method: "POST",
      headers: headers(cfg.apiKey),
      body: JSON.stringify({
        ...cfg.payload,
        reference: cfg.reference,
        ...(cfg.apiKey ? { api_key: cfg.apiKey } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Timeout / network failure AFTER dispatch: the provider may hold the op.
    return {
      outcome: "unknown",
      reason: `provider unreachable or timed out: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const text = await res.text().catch(() => "");
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (res.status >= 400 && res.status < 500) {
    // Definitive rejection: the provider did not accept the operation.
    return {
      outcome: "rejected",
      reason: `provider rejected (HTTP ${res.status}): ${body?.message ?? text.slice(0, 200)}`,
    };
  }
  if (res.status >= 500) {
    return {
      outcome: "unknown",
      reason: `provider error (HTTP ${res.status}): outcome unknown`,
    };
  }

  // HTTP 2xx — only a well-formed explicit status is definitive.
  const status = typeof body?.status === "string" ? body.status.toLowerCase() : null;
  const providerRef =
    body?.provider_ref ?? body?.providerRef ?? body?.transaction_id ?? undefined;
  if (status === "success" || status === "accepted") {
    return {
      outcome: "accepted",
      providerRef: providerRef ? String(providerRef) : undefined,
    };
  }
  if (status === "failed" || status === "error" || status === "rejected") {
    return {
      outcome: "rejected",
      providerRef: providerRef ? String(providerRef) : undefined,
      reason: body?.message ? String(body.message) : "provider reported failure",
    };
  }
  // Malformed 2xx reply — NEVER phantom success.
  return {
    outcome: "unknown",
    reason: "malformed provider reply: missing/unrecognized status field",
  };
}

export async function lookupProviderStatus(
  cfg: ProviderClientConfig & { reference: string }
): Promise<ProviderStatusResult> {
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let res: Response;
  try {
    res = await fetch(
      `${cfg.baseUrl}/status/${encodeURIComponent(cfg.reference)}`,
      { headers: headers(cfg.apiKey), signal: AbortSignal.timeout(timeoutMs) }
    );
  } catch (err) {
    return {
      status: "unknown",
      reason: `status lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!res.ok) {
    return { status: "unknown", reason: `status lookup HTTP ${res.status}` };
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    return { status: "unknown", reason: "status lookup returned malformed JSON" };
  }
  const status = typeof body?.status === "string" ? body.status.toLowerCase() : null;
  const providerRef =
    body?.provider_ref ?? body?.providerRef ?? body?.transaction_id ?? undefined;
  if (status === "completed" || status === "failed" || status === "pending") {
    return {
      status,
      providerRef: providerRef ? String(providerRef) : undefined,
      reason: body?.message ? String(body.message) : undefined,
    };
  }
  return { status: "unknown", reason: "malformed status reply" };
}
