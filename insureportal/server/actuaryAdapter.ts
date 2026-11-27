/**
 * actuaryAdapter.ts — typed HTTP client for the Go actuary pricing service
 * (actuary-engine/pricing-service, W34-B; contract: design Appendix D, base
 * path /v1, default port 7080 per Appendix G).
 *
 * 2026-11-28 (W34-D): copies the goServiceBridge.ts circuit-breaker +
 * fetchWithTimeout pattern EXACTLY (per-service circuit state, failure
 * threshold 5, reset timeout 30 s, retries=3 with 2^attempt×100 ms backoff),
 * layered over a typed adapter surface so routers never hand-craft URLs.
 * The breaker semantics are identical to goServiceBridge's constants:
 * `closed` → `open` after 5 consecutive failures → fail-fast until 30 s
 * elapse → `half-open` single probe → success closes (failures reset);
 * a probe failure re-opens.
 *
 * Wire-double policy (platform precedent): tests double the HTTP BOUNDARY
 * with a real in-process HTTP server — never the compute path.
 *
 * Fail-closed posture (design Appendix I): when the pricing service is
 * unreachable or the circuit is open, rate() throws
 * ActuaryServiceUnavailableError — the actuary router maps this to
 * SERVICE_UNAVAILABLE, never a fabricated premium.
 */
import { createHmac } from "crypto";
import logger from "./_core/logger";

// ── Circuit-breaker configuration (goServiceBridge.ts:25-26 verbatim) ──────
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_RESET_TIMEOUT_MS = 30_000;

type CircuitBreakerState = "closed" | "open" | "half-open";

interface CircuitBreaker {
  state: CircuitBreakerState;
  failures: number;
  lastFailure: number;
}

export interface ActuaryAdapterOptions {
  /** Base URL of the Go pricing service, e.g. http://actuary-pricing:7080 */
  baseUrl: string;
  /** Optional shared secret for service-to-service HMAC (Appendix D). */
  hmacSecret?: string;
  /** Per-attempt timeout (2 s — same posture as tbClient). */
  timeoutMs?: number;
  /** fetchWithTimeout retry count (goServiceBridge default 3). */
  retries?: number;
  /** Breaker tunables — production uses the goServiceBridge constants; the
   *  acceptance tests inject a shortened resetTimeoutMs to observe the
   *  half-open transition without a 30 s wall-clock wait. */
  failureThreshold?: number;
  resetTimeoutMs?: number;
  /** Injectable for tests that point the base URL at an in-process server;
   *  defaults to the global fetch (same as goServiceBridge). */
  fetchImpl?: typeof fetch;
  /** Injectable clock so breaker timing tests are deterministic. */
  now?: () => number;
}

export class ActuaryServiceUnavailableError extends Error {
  constructor(
    message: string,
    public readonly circuitState?: CircuitBreakerState
  ) {
    super(message);
    this.name = "ActuaryServiceUnavailableError";
  }
}

/** Typed non-availability refusal from the Go service itself (e.g. 503
 *  no approved rate version for a managed line — Appendix I step 3). */
export class ActuaryServiceRefusedError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = "ActuaryServiceRefusedError";
  }
}

// ── Wire types (design Appendix D — FROZEN cross-leg contract) ─────────────

export type ActuaryDecision = "accept" | "refer" | "decline";

export interface RateRequest {
  productLine: string;
  variables: Record<string, unknown>;
  /** NGN major units; the Go boundary converts to kobo minor units. */
  sumInsured: number;
  exposures: number;
  geoCell?: string;
  quoteRef?: string;
}

export interface RateResponse {
  purePremium: number;
  loadings: { expense: number; commission: number; profit: number };
  taxes: Array<{ code: string; amountKobo: number }>;
  totalPremiumKobo: number;
  rateVersion: string;
  decision: ActuaryDecision;
  reasonCodes: string[];
  accumulationDelta: number;
}

export interface RateVersionSummary {
  id: number;
  productLine: string;
  version: string;
  status: "draft" | "filing" | "approved" | "retired";
  effectiveFrom?: string;
  naicomFilingRef?: string | null;
}

export interface AccumulationCell {
  line: string;
  geoCell: string;
  aggregateExposure: number;
  limit?: number | null;
  breach: boolean;
}

export interface ExposureCheckRequest {
  productLine: string;
  sumInsured: number;
  premium?: number;
  geoCell?: string;
}

export interface ExposureCheckResponse {
  withinLimits: boolean;
  breaches: string[];
}

export interface ReferralCase {
  id: number;
  quoteRef: string;
  productLine: string;
  reasonCodes: string[];
  status: "open" | "accepted" | "declined";
  createdAt: string;
}

export interface CapitalSummary {
  naicomRbc: { required: number; available: number; ratio: number };
  ec: {
    var995: number;
    tvar99: number;
    perLine: Array<{ line: string; tvar99: number }>;
  };
  asOf: string;
  status: string;
}

export interface ReinsuranceEvaluation {
  retainedVar995: number;
  retainedTvar99: number;
  cededCostKobo: number;
  deltaVar995: number;
  deltaTvar99: number;
}

// ── Adapter ─────────────────────────────────────────────────────────────────

export interface ActuaryAdapter {
  circuitState(): CircuitBreakerState;
  circuitFailures(): number;
  /** Test hook: force the breaker back to its initial state. */
  resetCircuit(): void;
  rate(input: RateRequest): Promise<RateResponse>;
  rateVersions(line?: string): Promise<RateVersionSummary[]>;
  activateRateVersion(id: number): Promise<{ id: number; status: string }>;
  accumulation(line: string, geoCell: string): Promise<AccumulationCell>;
  exposureCheck(input: ExposureCheckRequest): Promise<ExposureCheckResponse>;
  referrals(status?: string): Promise<ReferralCase[]>;
  decideReferral(
    id: number,
    decision: "accepted" | "declined",
    underwriterId?: number
  ): Promise<{ id: number; status: string }>;
  capitalSummary(asOf?: string): Promise<CapitalSummary>;
  reinsuranceEvaluate(payload: Record<string, unknown>): Promise<ReinsuranceEvaluation>;
}

export function createActuaryAdapter(
  options: ActuaryAdapterOptions
): ActuaryAdapter {
  const threshold = options.failureThreshold ?? CIRCUIT_FAILURE_THRESHOLD;
  const resetTimeout = options.resetTimeoutMs ?? CIRCUIT_RESET_TIMEOUT_MS;
  const timeout = options.timeoutMs ?? 2_000;
  const retries = options.retries ?? 3;
  const now = options.now ?? (() => Date.now());
  const httpClient: typeof fetch =
    options.fetchImpl ??
    ((input, init) => globalThis.fetch(input, init));
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  // goServiceBridge keeps a Map of per-service circuits; this adapter
  // serves exactly one service, so the map degenerates to a single entry
  // with the identical shape/semantics.
  const circuit: CircuitBreaker = {
    state: "closed",
    failures: 0,
    lastFailure: 0,
  };

  function recordFailure(): void {
    circuit.failures += 1;
    circuit.lastFailure = now();
    if (circuit.failures >= threshold) {
      circuit.state = "open";
      logger.error(
        `[ActuaryAdapter] circuit OPEN after ${circuit.failures} consecutive failures (threshold ${threshold})`
      );
    }
  }

  function recordSuccess(): void {
    circuit.failures = 0;
    circuit.state = "closed";
  }

  /**
   * Gate a call through the breaker. Identical semantics to the
   * goServiceBridge model: open → fail fast until resetTimeout has elapsed
   * since the last failure; then exactly one half-open probe is allowed;
   * probe success closes, probe failure re-opens.
   */
  function assertCircuitAllows(): void {
    if (circuit.state === "open") {
      if (now() - circuit.lastFailure < resetTimeout) {
        throw new ActuaryServiceUnavailableError(
          `Actuary pricing service circuit is OPEN (${circuit.failures} consecutive failures) — refusing call`,
          "open"
        );
      }
      circuit.state = "half-open";
    }
  }

  /** Half-open probe that errored: re-open immediately (one probe only). */
  function noteHalfOpenFailure(): void {
    if (circuit.state === "half-open") {
      circuit.state = "open";
      circuit.lastFailure = now();
    }
  }

  // fetchWithTimeout — goServiceBridge.ts:45-67 verbatim shape (abort
  // controller per attempt, 2^attempt×100 ms backoff before retries, throws
  // the last error after the retry budget).
  async function fetchWithTimeout(
    url: string,
    init: RequestInit
  ): Promise<Response> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const backoff = Math.pow(2, attempt) * 100;
        if (attempt > 0) await new Promise(r => setTimeout(r, backoff));
        const res = await httpClient(url, {
          ...init,
          signal: controller.signal,
        });
        clearTimeout(timer);
        return res;
      } catch (e) {
        clearTimeout(timer);
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastError ?? new Error("fetch failed");
  }

  function signHeaders(body: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    // Appendix D: service-to-service HMAC (rust-middleware signing
    // precedent) for internal callers. Absent secret → unsigned (dev).
    if (options.hmacSecret) {
      const ts = String(Math.floor(now() / 1000));
      headers["X-Actuary-Timestamp"] = ts;
      headers["X-Actuary-Signature"] = createHmac("sha256", options.hmacSecret)
        .update(`${ts}.${body}`)
        .digest("hex");
    }
    return headers;
  }

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<T> {
    assertCircuitAllows();
    const payload = body === undefined ? "" : JSON.stringify(body);
    let res: Response;
    try {
      res = await fetchWithTimeout(`${baseUrl}${path}`, {
        method,
        headers: signHeaders(payload),
        ...(method === "POST" ? { body: payload } : {}),
      });
    } catch (e) {
      // Network/timeout failure: counts toward the breaker.
      recordFailure();
      noteHalfOpenFailure();
      throw new ActuaryServiceUnavailableError(
        `Actuary pricing service unreachable: ${e instanceof Error ? e.message : String(e)}`,
        circuit.state
      );
    }
    if (res.status >= 500) {
      // Server-side failure (including the Go service's own fail-closed
      // 503 for a managed line without an approved rate version): counts
      // toward the breaker and surfaces as a typed refusal — the router
      // must never fabricate a premium from it.
      recordFailure();
      noteHalfOpenFailure();
      const text = await res.text().catch(() => "");
      throw new ActuaryServiceRefusedError(
        `Actuary pricing service refused (${res.status}): ${text.slice(0, 256)}`,
        res.status,
        text
      );
    }
    if (!res.ok) {
      // 4xx: caller error — does NOT trip the breaker (goServiceBridge
      // treats HTTP responses as responses).
      const text = await res.text().catch(() => "");
      throw new ActuaryServiceRefusedError(
        `Actuary pricing service rejected request (${res.status}): ${text.slice(0, 256)}`,
        res.status,
        text
      );
    }
    recordSuccess();
    return (await res.json()) as T;
  }

  return {
    circuitState: () => circuit.state,
    circuitFailures: () => circuit.failures,
    resetCircuit: () => {
      circuit.state = "closed";
      circuit.failures = 0;
      circuit.lastFailure = 0;
    },

    rate: input => call<RateResponse>("POST", "/v1/rate", input),
    rateVersions: line =>
      call<RateVersionSummary[]>(
        "GET",
        `/v1/rate/versions${line ? `?line=${encodeURIComponent(line)}` : ""}`
      ),
    activateRateVersion: id =>
      call<{ id: number; status: string }>(
        "POST",
        `/v1/rate/versions/${id}/activate`
      ),
    accumulation: (line, geoCell) =>
      call<AccumulationCell>(
        "GET",
        `/v1/accumulation/${encodeURIComponent(line)}/${encodeURIComponent(geoCell)}`
      ),
    exposureCheck: input =>
      call<ExposureCheckResponse>("POST", "/v1/exposure/check", input),
    referrals: status =>
      call<ReferralCase[]>(
        "GET",
        `/v1/referrals${status ? `?status=${encodeURIComponent(status)}` : ""}`
      ),
    decideReferral: (id, decision, underwriterId) =>
      call<{ id: number; status: string }>(
        "POST",
        `/v1/referrals/${id}/decide`,
        { decision, underwriterId }
      ),
    capitalSummary: asOf =>
      call<CapitalSummary>("POST", "/v1/capital/summary", asOf ? { asOf } : {}),
    reinsuranceEvaluate: payload =>
      call<ReinsuranceEvaluation>("POST", "/v1/reinsurance/evaluate", payload),
  };
}

// ── Default singleton (production wiring) ───────────────────────────────────
// Configured by env exactly like the other service clients (tbClient etc.):
//   ACTUARY_PRICING_URL       default http://localhost:7080 (Appendix G port)
//   ACTUARY_PRICING_HMAC      optional service-to-service HMAC secret
let _default: ActuaryAdapter | null = null;

export function getActuaryAdapter(): ActuaryAdapter {
  if (!_default) {
    _default = createActuaryAdapter({
      baseUrl: process.env.ACTUARY_PRICING_URL ?? "http://localhost:7080",
      hmacSecret: process.env.ACTUARY_PRICING_HMAC || undefined,
    });
  }
  return _default;
}

/** Test hook: drop the memoized default adapter (env-driven re-create). */
export function resetActuaryAdapterForTests(): void {
  _default = null;
}
