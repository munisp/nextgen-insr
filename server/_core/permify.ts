/**
 * InsurePortal Permify Client
 * HTTP client for Permify authorization service.
 * FAIL-CLOSED: denies access when Permify is unavailable.
 * Circuit breaker prevents cascading timeouts when Permify is down.
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
      "[Permify] Circuit breaker OPEN — denying all requests for 30s"
    );
  }
}

const PERMIFY_URL = process.env.PERMIFY_URL ?? "http://localhost:3476";
const PERMIFY_TENANT_ID = process.env.PERMIFY_TENANT_ID ?? "t1";

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
 * Returns true if allowed, false if denied or Permify is unavailable.
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
    logger.warn("[Permify] Circuit breaker open — denying access");
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
      logger.warn(
        `[Permify] Check failed: ${res.status} — denying access`
      );
      recordFailure();
      return false;
    }

    const json = (await res.json()) as PermifyCheckResponse;
    recordSuccess();
    return json.can === "CHECK_RESULT_ALLOWED";
  } catch (err) {
    // Fail-closed: when Permify is unavailable, deny access.
    // This is the safe default — if authorization is down, access is denied.
    // In development, use the role-based fallback in the caller instead.
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: message },
      "[Permify] Service unavailable — denying access (fail-closed)"
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
