/**
 * InsurePortal Permify Client
 * HTTP client for Permify authorization service.
 * FAIL-CLOSED (default): denies access when Permify is unavailable and emits
 * alert-level (error) logs. Circuit breaker prevents cascading timeouts when
 * Permify is down.
 *
 * INSECURE OPT-IN: setting PERMIFY_FAIL_OPEN=true reverts to fail-open
 * (requests are ALLOWED while Permify is unreachable). This disables
 * authorization enforcement during outages and logs a loud startup warning.
 * Never enable it in production outside a declared incident.
 *
 * Schema (defined in infra/permify/schema.perm):
 *   entity agent { ... }
 *   entity admin { ... }
 *   entity supervisor { ... }
 *
 * Policies:
 *   - agents can only read own transactions
 *   - admins can read all transactions
 *   - float top-up approval requires supervisor or admin
 *   - fraud alert status update requires admin
 */
import logger from "./logger";
import { getRedisClient } from "../lib/redisClient";

// 2026-09-19 (P-wave, perf hotspot #1): pin schemaVersion/snapToken from env.
// Both were hard-coded "" below, which forces Permify to evaluate every check
// against the latest schema snapshot and defeats Permify-side caching.
// Pinning is opt-in (default "" = previous behavior); when the deployment
// sets PERMIFY_SCHEMA_VERSION (and optionally PERMIFY_SNAP_TOKEN), checks
// become cacheable server-side and the pinned version joins the local
// decision-cache key so a schema bump never serves stale verdicts.
const PERMIFY_SCHEMA_VERSION = process.env.PERMIFY_SCHEMA_VERSION ?? "";
const PERMIFY_SNAP_TOKEN = process.env.PERMIFY_SNAP_TOKEN ?? "";

// ── Circuit Breaker ─────────────────────────────────────────────────────────
// Prevents cascading timeouts when Permify is down by short-circuiting
// requests after repeated failures.
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_RECOVERY_MS = 30_000; // 30s before retrying after open

let circuitFailures = 0;
let circuitOpenedAt = 0;

function isCircuitOpen(): boolean {
  if (circuitFailures < CIRCUIT_FAILURE_THRESHOLD) return false;
  if (Date.now() - circuitOpenedAt > CIRCUIT_RECOVERY_MS) {
    // Half-open: allow one probe request
    circuitFailures = CIRCUIT_FAILURE_THRESHOLD - 1;
    return false;
  }
  return true;
}

function recordSuccess(): void {
  circuitFailures = 0;
  circuitOpenedAt = 0;
}

function recordFailure(): void {
  circuitFailures++;
  if (circuitFailures >= CIRCUIT_FAILURE_THRESHOLD && circuitOpenedAt === 0) {
    circuitOpenedAt = Date.now();
    logger.error(
      "[Permify] ALERT: Circuit breaker OPEN — denying all requests for 30s"
    );
  }
}

const PERMIFY_URL = process.env.PERMIFY_URL ?? "http://localhost:3476";
const PERMIFY_TENANT_ID = process.env.PERMIFY_TENANT_ID ?? "t1";

// ── Fail-open override (INSECURE — explicit opt-in only) ────────────────────
// Default posture is FAIL-CLOSED: when Permify is unreachable, every
// authorization check is denied and an alert-level (error) log is emitted.
// PERMIFY_FAIL_OPEN=true allows requests during a Permify outage and is
// intended ONLY for short-lived disaster-recovery scenarios.
// 2026-09-19 (P-wave): `let` (not const) so the test-only hook below can
// exercise the fail-closed cache path in the integration suite (which boots
// with PERMIFY_FAIL_OPEN=true). Production value is fixed at module load.
let PERMIFY_FAIL_OPEN = process.env.PERMIFY_FAIL_OPEN === "true";

/**
 * TEST-ONLY hook (2026-09-19, P-wave): the integration suite boots with
 * PERMIFY_FAIL_OPEN=true (no Permify service), which makes the decision cache
 * unreachable code. This lets the cache tests exercise the real fail-closed
 * posture. Throws outside NODE_ENV=test so it can never be (mis)used live.
 */
export function __setPermifyFailOpenForTests(value: boolean): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("[Permify] __setPermifyFailOpenForTests is test-only");
  }
  PERMIFY_FAIL_OPEN = value;
}

// MED-18 (G1 fix-wave, 2026-06): deployment guard. Fail-open authorization
// is an incident-only posture; in production the process REFUSES TO BOOT
// with PERMIFY_FAIL_OPEN=true unless an explicit incident acknowledgement
// token is also set. Merchant financial endpoints must never degrade to an
// unauthenticated-role bypass by accident of an env var.
if (
  PERMIFY_FAIL_OPEN &&
  process.env.NODE_ENV === "production" &&
  process.env.PERMIFY_FAIL_OPEN_INCIDENT_ACK !== "true"
) {
  throw new Error(
    "[Permify] PERMIFY_FAIL_OPEN=true is forbidden in production without " +
      "PERMIFY_FAIL_OPEN_INCIDENT_ACK=true (declared-incident acknowledgement). Refusing to start."
  );
}

if (PERMIFY_FAIL_OPEN) {
  logger.error(
    "═══════════════════════════════════════════════════════════════════\n" +
      "[Permify] ⚠️  PERMIFY_FAIL_OPEN=true — AUTHORIZATION FAIL-OPEN ENABLED\n" +
      "[Permify] Requests will be ALLOWED while Permify is unreachable.\n" +
      "[Permify] This DISABLES authorization enforcement during outages.\n" +
      "[Permify] NEVER enable this in production outside a declared incident.\n" +
      "═══════════════════════════════════════════════════════════════════"
  );
}

interface PermifyCheckRequest {
  tenantId: string;
  metadata: { schemaVersion: string; snapToken: string; depth: number };
  entity: { type: string; id: string };
  permission: string;
  subject: { type: string; id: string; relation?: string };
}

interface PermifyCheckResponse {
  can:
    | "CHECK_RESULT_ALLOWED"
    | "CHECK_RESULT_DENIED"
    | "CHECK_RESULT_UNSPECIFIED";
}

/**
 * Check if a subject has permission on an entity.
 * Returns true if allowed, false if denied or Permify is unavailable
 * (fail-closed). When PERMIFY_FAIL_OPEN=true (insecure opt-in), returns true
 * while Permify is unreachable.
 */
export async function permifyCheck(params: {
  subjectType: string;
  subjectId: string;
  entityType: string;
  entityId: string;
  permission: string;
}): Promise<boolean> {
  const body: PermifyCheckRequest = {
    tenantId: PERMIFY_TENANT_ID,
    metadata: {
      schemaVersion: PERMIFY_SCHEMA_VERSION,
      snapToken: PERMIFY_SNAP_TOKEN,
      depth: 20,
    },
    entity: { type: params.entityType, id: params.entityId },
    permission: params.permission,
    subject: { type: params.subjectType, id: params.subjectId },
  };

  // Circuit breaker: if open, deny immediately without waiting for timeout
  if (isCircuitOpen()) {
    if (PERMIFY_FAIL_OPEN) {
      logger.error(
        "[Permify] ALERT: circuit breaker open but PERMIFY_FAIL_OPEN=true — allowing request (INSECURE)"
      );
      return true;
    }
    logger.error(
      "[Permify] ALERT: circuit breaker open — denying access (fail-closed)"
    );
    return false;
  }

  try {
    const res = await fetch(
      `${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT_ID}/permissions/check`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(2_000),
      }
    );

    if (!res.ok) {
      recordFailure();
      if (PERMIFY_FAIL_OPEN) {
        logger.error(
          `[Permify] ALERT: check returned HTTP ${res.status} but PERMIFY_FAIL_OPEN=true — allowing request (INSECURE)`
        );
        return true;
      }
      logger.error(
        `[Permify] ALERT: check failed with HTTP ${res.status} — denying access (fail-closed)`
      );
      return false;
    }

    const json = (await res.json()) as PermifyCheckResponse;
    recordSuccess();
    return json.can === "CHECK_RESULT_ALLOWED";
  } catch (err) {
    // Fail-closed (default): when Permify is unreachable, deny access.
    // This is the safe default — if authorization is down, access is denied.
    // Fail-open only via the explicit, insecure PERMIFY_FAIL_OPEN=true opt-in.
    const message = err instanceof Error ? err.message : String(err);
    if (PERMIFY_FAIL_OPEN) {
      logger.error(
        { err: message },
        "[Permify] ALERT: service unreachable but PERMIFY_FAIL_OPEN=true — allowing request (INSECURE)"
      );
      return true;
    }
    logger.error(
      { err: message },
      "[Permify] ALERT: service unreachable — denying access (fail-closed)"
    );
    return false;
  }
}

/**
 * Check if an agent can access a specific transaction.
 * Agents can only access their own transactions; admins can access all.
 */
export async function canAccessTransaction(
  agentId: string,
  agentRole: string,
  txRef: string
): Promise<boolean> {
  if (agentRole === "admin") return true;

  // Try Permify first
  const allowed = await permifyCheck({
    subjectType: "agent",
    subjectId: agentId,
    entityType: "transaction",
    entityId: txRef,
    permission: "read",
  });

  // If Permify is unavailable (returns false for unknown entities), fall back to ownership check
  return allowed;
}

/**
 * Check if an agent can approve float top-up requests.
 * Requires supervisor or admin role.
 */
export async function canApproveTopUp(
  agentId: string,
  agentRole: string
): Promise<boolean> {
  if (agentRole === "admin") return true;

  return permifyCheck({
    subjectType: "agent",
    subjectId: agentId,
    entityType: "float_topup",
    entityId: "*",
    permission: "approve",
  });
}

/**
 * Check if an agent can update fraud alert status.
 * Requires admin role.
 */
export async function canUpdateFraudAlert(
  agentId: string,
  agentRole: string
): Promise<boolean> {
  if (agentRole === "admin") return true;

  return permifyCheck({
    subjectType: "agent",
    subjectId: agentId,
    entityType: "fraud_alert",
    entityId: "*",
    permission: "update",
  });
}

export default {
  permifyCheck,
  canAccessTransaction,
  canApproveTopUp,
  canUpdateFraudAlert,
};

// ── Detailed check (B1 access-evaluation viewer) ────────────────────────────
// permifyCheck collapses "denied" and "Permify unreachable" into the same
// `false`, which is correct for enforcement but unusable for an audit viewer:
// the viewer must show the REAL verdict and fail loud (not "denied") when
// Permify itself is down. permifyCheckDetailed keeps the two outcomes
// distinct. The PERMIFY_FAIL_OPEN semantics are identical to permifyCheck
// (fail-open only via the explicit insecure opt-in, loud alert logs), with
// the flag surfaced as source='permify_fail_open' instead of a silent boolean.

export interface PermifyCheckDetailedResult {
  /** The real Permify verdict; null when Permify was unreachable. */
  allowed: boolean | null;
  /** false when the check could not reach Permify (network/HTTP/circuit). */
  reachable: boolean;
  /** How the answer was produced: real check vs insecure fail-open opt-in. */
  source: "permify" | "permify_fail_open";
  /** Exact reason the service was unreachable (when reachable=false). */
  error?: string;
}

export async function permifyCheckDetailed(params: {
  subjectType: string;
  subjectId: string;
  entityType: string;
  entityId: string;
  permission: string;
}): Promise<PermifyCheckDetailedResult> {
  // Read at call time (same opt-in semantics as the module-level flag above)
  // so an incident-time toggle takes effect on this code path too.
  const failOpen = process.env.PERMIFY_FAIL_OPEN === "true";
  const body: PermifyCheckRequest = {
    tenantId: PERMIFY_TENANT_ID,
    metadata: { schemaVersion: PERMIFY_SCHEMA_VERSION, snapToken: PERMIFY_SNAP_TOKEN, depth: 20 },
    entity: { type: params.entityType, id: params.entityId },
    permission: params.permission,
    subject: { type: params.subjectType, id: params.subjectId },
  };

  if (isCircuitOpen()) {
    if (failOpen) {
      logger.error(
        "[Permify] ALERT: circuit breaker open but PERMIFY_FAIL_OPEN=true — allowing request (INSECURE)"
      );
      return {
        allowed: true,
        reachable: false,
        source: "permify_fail_open",
        error: "permify circuit breaker open (repeated check failures)",
      };
    }
    logger.error(
      "[Permify] ALERT: circuit breaker open — access evaluation unavailable (fail-closed)"
    );
    return {
      allowed: null,
      reachable: false,
      source: "permify",
      error: "permify circuit breaker open (repeated check failures)",
    };
  }

  try {
    const res = await fetch(
      `${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT_ID}/permissions/check`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(2_000),
      }
    );
    if (!res.ok) {
      recordFailure();
      const reason = `permify check returned HTTP ${res.status}`;
      if (failOpen) {
        logger.error(
          `[Permify] ALERT: ${reason} but PERMIFY_FAIL_OPEN=true — allowing request (INSECURE)`
        );
        return {
          allowed: true,
          reachable: false,
          source: "permify_fail_open",
          error: reason,
        };
      }
      logger.error(
        `[Permify] ALERT: ${reason} — access evaluation unavailable (fail-closed)`
      );
      return {
        allowed: null,
        reachable: false,
        source: "permify",
        error: reason,
      };
    }
    const json = (await res.json()) as PermifyCheckResponse;
    recordSuccess();
    return {
      allowed: json.can === "CHECK_RESULT_ALLOWED",
      reachable: true,
      source: "permify",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (failOpen) {
      logger.error(
        { err: message },
        "[Permify] ALERT: service unreachable but PERMIFY_FAIL_OPEN=true — allowing request (INSECURE)"
      );
      return {
        allowed: true,
        reachable: false,
        source: "permify_fail_open",
        error: message,
      };
    }
    logger.error(
      { err: message },
      "[Permify] ALERT: service unreachable — access evaluation unavailable (fail-closed)"
    );
    return {
      allowed: null,
      reachable: false,
      source: "permify",
      error: message,
    };
  }
}

// ── Decision cache (2026-09-19, P-wave perf hotspot #1) ─────────────────────
// Redis-cached authorization decisions for the hot path (requirePermify /
// financialProcedure fired on EVERY protected call — 1–3 blocking HTTP POSTs
// per request before this cache).
//
// Semantics (fail-closed preserved exactly):
//   - Cache MISS, Redis error, or Redis down → REAL Permify call, identical
//     outcome to permifyCheck (built on permifyCheckDetailed so outages are
//     distinguishable from real denies).
//   - Only REAL Permify verdicts are cached (verdict.reachable === true).
//     Outage answers and PERMIFY_FAIL_OPEN answers are NEVER cached, so a
//     fail-open window cannot be frozen into the cache.
//   - ALLOW verdicts TTL = PERMIFY_DECISION_CACHE_TTL_S (default 45s).
//     DENY verdicts TTL = PERMIFY_DECISION_CACHE_DENY_TTL_S (default 10s):
//     a grant that flips deny→allow is never hidden for longer than this,
//     so permission grants take effect quickly while revocations (allow→deny)
//     are additionally busted by invalidatePermifyDecisionsForSubject() on
//     every role-write path.
//   - Key includes tenant, pinned schemaVersion, subject, entity, permission.
//
// Invalidation is exact in-process (keys tracked per subject) and exact in
// Redis for those tracked keys; keys written by OTHER replicas expire by TTL
// (≤45s) — disclosed bound for multi-replica deployments.

const DECISION_CACHE_PREFIX = "permify:dec:";
const DECISION_CACHE_ALLOW_TTL_S = (() => {
  const v = Number(process.env.PERMIFY_DECISION_CACHE_TTL_S ?? 45);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 45;
})();
const DECISION_CACHE_DENY_TTL_S = (() => {
  const v = Number(process.env.PERMIFY_DECISION_CACHE_DENY_TTL_S ?? 10);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 10;
})();

// subjectKey (`${subjectType}:${subjectId}`) → cache keys written by this
// process. Bounded: cleared when it exceeds MAX_TRACKED_KEYS (invalidation
// then degrades to TTL expiry — safe, disclosed above).
const decisionKeysBySubject = new Map<string, Set<string>>();
const MAX_TRACKED_KEYS = 10_000;

function decisionCacheKey(params: {
  subjectType: string;
  subjectId: string;
  entityType: string;
  entityId: string;
  permission: string;
}): string {
  return (
    DECISION_CACHE_PREFIX +
    [
      PERMIFY_TENANT_ID,
      PERMIFY_SCHEMA_VERSION || "latest",
      params.subjectType,
      params.subjectId,
      params.entityType,
      params.entityId,
      params.permission,
    ].join(":")
  );
}

/**
 * permifyCheck with a Redis decision cache. Behaviorally identical to
 * permifyCheck for every caller-observable outcome (same fail-closed /
 * fail-open semantics); the only difference is latency on repeat decisions.
 */
export async function permifyCheckCached(params: {
  subjectType: string;
  subjectId: string;
  entityType: string;
  entityId: string;
  permission: string;
}): Promise<boolean> {
  // Boot-time fail-open posture (PERMIFY_FAIL_OPEN=true at module load): the
  // cache is pointless (every check must hit the failing transport anyway to
  // preserve the exact permifyCheck semantics, which read the flag at module
  // load) — delegate uncached. Fail-open answers are never cacheable.
  if (PERMIFY_FAIL_OPEN) {
    return permifyCheck(params);
  }
  const key = decisionCacheKey(params);
  try {
    const hit = await getRedisClient().get(key);
    if (hit === "1") return true;
    if (hit === "0") return false;
  } catch {
    // Redis error/down → treat as MISS: real Permify call below. Fail-closed
    // posture is untouched because a miss can never manufacture an allow.
  }

  const verdict = await permifyCheckDetailed(params);
  const allowed = verdict.allowed === true;

  if (verdict.reachable) {
    try {
      await getRedisClient().set(
        key,
        allowed ? "1" : "0",
        "EX",
        allowed ? DECISION_CACHE_ALLOW_TTL_S : DECISION_CACHE_DENY_TTL_S
      );
      const subj = `${params.subjectType}:${params.subjectId}`;
      if (decisionKeysBySubject.size >= MAX_TRACKED_KEYS) {
        decisionKeysBySubject.clear();
      }
      let keys = decisionKeysBySubject.get(subj);
      if (!keys) {
        keys = new Set();
        decisionKeysBySubject.set(subj, keys);
      }
      keys.add(key);
    } catch {
      // Cache write failure is harmless — next call re-checks with Permify.
    }
  }
  return allowed;
}

/**
 * Bust cached decisions for one subject. Hooked on every role/permission
 * write path: Keycloak role re-sync persist, admin user-role change, tenant
 * admin update, login-path upsertUser role sync (2026-09-22), and the
 * Permify-native relationship writes (2026-09-22: writePermifyRelationship /
 * updatePermifyPolicy in journey-activities-extended.ts, writeResource-
 * Relationship in journey-tenant-guard.ts, PermifyConnector.writeRelation in
 * middlewareConnectors.ts) — so revocations take effect immediately instead
 * of after TTL.
 * Best-effort: Redis errors only mean the TTL bound applies.
 */
export async function invalidatePermifyDecisionsForSubject(
  subjectType: string,
  subjectId: string
): Promise<void> {
  const subj = `${subjectType}:${subjectId}`;
  const keys = decisionKeysBySubject.get(subj);
  decisionKeysBySubject.delete(subj);
  if (!keys || keys.size === 0) return;
  try {
    await getRedisClient().del(...keys);
  } catch {
    // TTL bounds staleness when the delete cannot run.
  }
}
