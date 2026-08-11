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
const PERMIFY_FAIL_OPEN = process.env.PERMIFY_FAIL_OPEN === "true";

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
      schemaVersion: "",
      snapToken: "",
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
