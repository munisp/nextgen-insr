/**
 * InsurePortal Permify Client
 * HTTP client for Permify authorization service.
 * Falls back to role-based checks when Permify is unavailable.
 *
 * FAIL-CLOSED (default): a Permify outage denies access. Fail-open is an
 * INSECURE explicit opt-in (PERMIFY_FAIL_OPEN=true), boot-guarded in
 * production/staging — see the W23 block below.
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

const PERMIFY_URL = process.env.PERMIFY_URL ?? "http://localhost:3476";
const PERMIFY_TENANT_ID = process.env.PERMIFY_TENANT_ID ?? "t1";

// ── Fail-open override (INSECURE — explicit opt-in only) ────────────────────
// 2026-11-26 (W23, drift vs main repo server/_core/permify.ts W22-C guard):
// this client's Permify-outage catch block was unconditionally FAIL-OPEN
// ("Service unavailable — failing open (allow)", returned true) with no
// flag, no loud log, and no boot-guard — any network hiccup silently
// disabled authorization in every environment, production included.
// Mirroring the main repo's explicit-opt-in semantics: fail-open now
// requires PERMIFY_FAIL_OPEN=true (literal), and NODE_ENV=production or
// staging REFUSES TO BOOT with the flag set unless
// PERMIFY_FAIL_OPEN_INCIDENT_ACK=true (declared-incident acknowledgement)
// is also set. Default posture is FAIL-CLOSED (deny).
// Preserved as-is: the role short-circuits (admin early-return) in
// canAccessTransaction/canApproveTopUp/canUpdateFraudAlert, and the
// HTTP-error (!res.ok) path stays fail-closed even under the flag — a
// reachable-but-erroring Permify is not treated as an outage bypass here.
const PERMIFY_FAIL_OPEN = process.env.PERMIFY_FAIL_OPEN === "true";

if (
  PERMIFY_FAIL_OPEN &&
  (process.env.NODE_ENV === "production" ||
    process.env.NODE_ENV === "staging") &&
  process.env.PERMIFY_FAIL_OPEN_INCIDENT_ACK !== "true"
) {
  throw new Error(
    "[Permify] PERMIFY_FAIL_OPEN=true is forbidden when NODE_ENV is " +
      "production or staging without " +
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
 * (fail-closed default). Fail-open only via the explicit, insecure
 * PERMIFY_FAIL_OPEN=true opt-in (boot-guarded in production/staging).
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
        `[Permify] Check failed: ${res.status} — falling back to deny`
      );
      return false;
    }

    const json = (await res.json()) as PermifyCheckResponse;
    return json.can === "CHECK_RESULT_ALLOWED";
  } catch (err) {
    // 2026-11-26 (W23): this catch was the unconditional fail-open — a
    // Permify outage ALLOWED every check in every environment. Fail-open
    // now requires the explicit PERMIFY_FAIL_OPEN=true opt-in (boot-guarded
    // in production/staging at module load above); otherwise fail-closed.
    if (PERMIFY_FAIL_OPEN) {
      logger.error(
        { err },
        "[Permify] ALERT: service unavailable but PERMIFY_FAIL_OPEN=true — allowing request (INSECURE)"
      );
      return true;
    }
    logger.error(
      { err },
      "[Permify] ALERT: service unavailable — denying access (fail-closed)"
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
