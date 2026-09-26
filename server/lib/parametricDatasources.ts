/**
 * parametricDatasources.ts — Q-wave Q2 (2026-09-25)
 *
 * Pluggable datasource adapters for the Parametric Trigger Engine.
 *
 * Discipline (fail-closed, no fabricated data):
 *   - 'http'   — REAL HTTP client: fetch with a hard timeout and a simple
 *                per-URL circuit breaker (same discipline as the G2
 *                enhanced-kyc-kyb client and server/lib/resilientFetch).
 *                The response body is schema-validated (zod); unreachable,
 *                non-2xx, unparseable, schema-invalid or STALE readings all
 *                throw DatasourceUnavailableError — the caller records the
 *                event as 'data_unavailable' and NEVER pays out.
 *   - 'manual' — staff-attested reading (e.g. an agronomist's rainfall
 *                gauge reading) with DUAL CONTROL: one staff member attests,
 *                a DIFFERENT staff member confirms, and only the confirmed
 *                reading is usable. Honest by construction — the reading is
 *                a recorded human attestation, never a silent default.
 *
 * No adapter ever invents a value: every reading carries its observedAt
 * timestamp and the raw payload hash for audit.
 */
import { createHash } from "crypto";

import { z } from "zod";

// ── Errors ───────────────────────────────────────────────────────────────────
export class DatasourceUnavailableError extends Error {
  constructor(
    message: string,
    public readonly reason:
      | "unreachable"
      | "http_error"
      | "unparseable"
      | "schema_invalid"
      | "stale"
      | "circuit_open"
      | "unconfirmed"
      | "misconfigured",
  ) {
    super(message);
    this.name = "DatasourceUnavailableError";
  }
}

// ── Reading schema (what every adapter must produce) ────────────────────────
export const datasourceReadingSchema = z.object({
  metric: z.string().min(1),
  value: z.number().finite(),
  // ISO-8601 timestamp of WHEN the value was observed (staleness bound).
  observedAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
});
export type DatasourceReading = z.infer<typeof datasourceReadingSchema>;

// ── Datasource config schemas ────────────────────────────────────────────────
export const httpDatasourceConfigSchema = z.object({
  type: z.literal("http"),
  url: z.string().url(),
  // Optional static bearer token for partner feeds (never fabricated — when
  // the partner credential is absent the call fails closed).
  authTokenEnv: z.string().optional(),
  timeoutMs: z.number().int().positive().max(60_000).default(10_000),
});
export const manualDatasourceConfigSchema = z.object({
  type: z.literal("manual"),
});
export const datasourceConfigSchema = z.discriminatedUnion("type", [
  httpDatasourceConfigSchema,
  manualDatasourceConfigSchema,
]);
export type DatasourceConfig = z.infer<typeof datasourceConfigSchema>;

// ── Simple per-URL circuit breaker (P-wave NIBSS discipline) ────────────────
// Closed → open after FAILURE_THRESHOLD consecutive failures; open for
// RESET_MS; one half-open probe decides recovery.
const FAILURE_THRESHOLD = 3;
const RESET_MS = 30_000;
const breakers = new Map<
  string,
  { failures: number; openedAt: number; state: "closed" | "open" | "half_open" }
>();

function breakerFor(key: string) {
  let b = breakers.get(key);
  if (!b) {
    b = { failures: 0, openedAt: 0, state: "closed" };
    breakers.set(key, b);
  }
  return b;
}

/** Test/maintenance hook: reset all circuit breakers. */
export function resetDatasourceBreakers(): void {
  breakers.clear();
}

// ── HTTP adapter ─────────────────────────────────────────────────────────────
export async function fetchHttpReading(
  config: z.infer<typeof httpDatasourceConfigSchema>,
  metric: string,
  windowSeconds: number,
): Promise<{ reading: DatasourceReading; payloadHash: string; raw: unknown }> {
  const breaker = breakerFor(config.url);
  if (breaker.state === "open") {
    if (Date.now() - breaker.openedAt < RESET_MS) {
      throw new DatasourceUnavailableError(
        `datasource circuit OPEN for ${config.url} — refusing to call (fail-closed)`,
        "circuit_open",
      );
    }
    breaker.state = "half_open";
  }

  const token = config.authTokenEnv ? process.env[config.authTokenEnv] : undefined;
  if (config.authTokenEnv && !token) {
    throw new DatasourceUnavailableError(
      `datasource auth token env ${config.authTokenEnv} is not configured (fail-closed)`,
      "misconfigured",
    );
  }

  let res: Response;
  try {
    res = await fetch(config.url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (err) {
    breaker.failures++;
    if (breaker.failures >= FAILURE_THRESHOLD) {
      breaker.state = "open";
      breaker.openedAt = Date.now();
    }
    throw new DatasourceUnavailableError(
      `datasource unreachable: ${config.url} (${(err as Error).message})`,
      "unreachable",
    );
  }

  if (!res.ok) {
    breaker.failures++;
    if (breaker.failures >= FAILURE_THRESHOLD) {
      breaker.state = "open";
      breaker.openedAt = Date.now();
    }
    throw new DatasourceUnavailableError(
      `datasource returned HTTP ${res.status} for ${config.url}`,
      "http_error",
    );
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    breaker.failures++;
    throw new DatasourceUnavailableError(
      `datasource response is not valid JSON (${config.url})`,
      "unparseable",
    );
  }

  const parsed = datasourceReadingSchema.safeParse(raw);
  if (!parsed.success) {
    breaker.failures++;
    throw new DatasourceUnavailableError(
      `datasource payload failed schema validation: ${parsed.error.issues[0]?.message ?? "invalid"}`,
      "schema_invalid",
    );
  }
  if (parsed.data.metric !== metric) {
    breaker.failures++;
    throw new DatasourceUnavailableError(
      `datasource returned metric '${parsed.data.metric}', expected '${metric}'`,
      "schema_invalid",
    );
  }

  // Staleness: a reading older than the trigger window is NOT evidence.
  const observedMs = Date.parse(parsed.data.observedAt);
  if (!Number.isFinite(observedMs) || Date.now() - observedMs > windowSeconds * 1000) {
    breaker.failures++;
    throw new DatasourceUnavailableError(
      `datasource reading is stale (observedAt=${parsed.data.observedAt}, window=${windowSeconds}s)`,
      "stale",
    );
  }

  breaker.failures = 0;
  breaker.state = "closed";
  const payloadHash = createHash("sha256").update(JSON.stringify(raw)).digest("hex");
  return { reading: parsed.data, payloadHash, raw };
}

// ── Manual adapter (staff-attested, dual-control) ────────────────────────────
// The reading itself is persisted by the router (attest + confirm); the
// engine resolves the latest CONFIRMED reading for the trigger's metric.
// This function only validates shape/staleness — storage access lives in the
// engine (keeps this module storage-free).
export function validateManualReading(
  reading: unknown,
  metric: string,
  windowSeconds: number,
  confirmedBy: number | null | undefined,
  attestedBy: number | null | undefined,
): DatasourceReading {
  const parsed = datasourceReadingSchema.safeParse(reading);
  if (!parsed.success) {
    throw new DatasourceUnavailableError(
      `manual reading failed schema validation: ${parsed.error.issues[0]?.message ?? "invalid"}`,
      "schema_invalid",
    );
  }
  if (parsed.data.metric !== metric) {
    throw new DatasourceUnavailableError(
      `manual reading metric '${parsed.data.metric}' does not match trigger metric '${metric}'`,
      "schema_invalid",
    );
  }
  // Dual control: confirmation by a DIFFERENT staff member is mandatory.
  if (confirmedBy == null || attestedBy == null || confirmedBy === attestedBy) {
    throw new DatasourceUnavailableError(
      "manual reading lacks dual-control confirmation (attester ≠ confirmer required)",
      "unconfirmed",
    );
  }
  const observedMs = Date.parse(parsed.data.observedAt);
  if (!Number.isFinite(observedMs) || Date.now() - observedMs > windowSeconds * 1000) {
    throw new DatasourceUnavailableError(
      `manual reading is stale (observedAt=${parsed.data.observedAt}, window=${windowSeconds}s)`,
      "stale",
    );
  }
  return parsed.data;
}

// ── Threshold comparison (pure) ──────────────────────────────────────────────
export function thresholdBreached(
  operator: string,
  measured: number,
  threshold: number,
): boolean {
  switch (operator) {
    case "gt": return measured > threshold;
    case "gte": return measured >= threshold;
    case "lt": return measured < threshold;
    case "lte": return measured <= threshold;
    case "eq": return measured === threshold;
    default: return false; // unknown operator ⇒ never fires (fail-closed)
  }
}
