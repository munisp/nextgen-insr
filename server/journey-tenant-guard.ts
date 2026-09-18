/**
 * journey-tenant-guard.ts
 *
 * Tenant isolation guard for all 28 insurance journey workflows.
 *
 * Every journey that operates on tenant-scoped resources (policies, claims,
 * agents, transactions, float accounts) must call `assertTenantAccess()`
 * at the start of the workflow before executing any business logic.
 *
 * This module is imported by all journey files and provides:
 *   1. `assertTenantAccess()` — Permify check that the triggering user
 *      belongs to the tenant and has the required role for this journey
 *   2. `assertResourceBelongsToTenant()` — Permify check that a specific
 *      resource (policy, claim, agent) belongs to the caller's tenant
 *   3. `buildTenantContext()` — Extracts tenant context from journey input
 *
 * Tenant Isolation Model:
 *   - Each insurance company (insurer) is a separate Permify tenant
 *   - Agents belong to exactly one tenant
 *   - Policies, claims, and transactions are scoped to a tenant
 *   - Cross-tenant access is denied at the Permify level
 *   - Platform admins (role=admin) can access all tenants for support
 *
 * Failure Mode (AUTH-12 — fail-closed everywhere):
 *   - Permify unavailable → FAIL-CLOSED for ALL journeys. An authorization
 *     outage is never an authz bypass; journeys retry when Permify recovers.
 *   - Unknown journey (no permission mapping) → DENIED.
 *   - Circuit breaker: 5 failures → 30s open → half-open probe
 *   - The `failClosed` field below is retained for schema compatibility but
 *     every journey is now fail-closed.
 */

import { ApplicationFailure } from "@temporalio/workflow";

import logger from "./_core/logger";

const PERMIFY_URL = process.env.PERMIFY_URL ?? "http://permify:3476";

// ── Circuit Breaker ────────────────────────────────────────────────────────────
let cbFailures = 0;
let cbOpenedAt = 0;
const CB_THRESHOLD = 5;
const CB_RECOVERY_MS = 30_000;

function isCbOpen(): boolean {
  if (cbFailures < CB_THRESHOLD) return false;
  if (Date.now() - cbOpenedAt > CB_RECOVERY_MS) {
    cbFailures = CB_THRESHOLD - 1; // half-open
    return false;
  }
  return true;
}

// ── Journey Tenant Context ─────────────────────────────────────────────────────

export interface TenantContext {
  tenantId: string;       // Permify tenant ID (e.g., "insurer_001")
  userId: string;         // Keycloak sub / platform user ID
  userRole: string;       // platform role (admin, agent, underwriter, etc.)
  organizationId?: string; // optional org ID for multi-org tenants
}

/**
 * Extract tenant context from journey input.
 * All journey inputs must include `triggeredBy` (userId) and optionally
 * `tenantId`. If tenantId is absent, defaults to "insureportal" (single-tenant).
 */
export function buildTenantContext(input: {
  triggeredBy?: number | string;
  tenantId?: string;
  userRole?: string;
  organizationId?: string;
} & object): TenantContext {
  return {
    tenantId: input.tenantId ?? process.env.PERMIFY_TENANT_ID ?? "insureportal",
    userId: input.triggeredBy != null ? String(input.triggeredBy) : "system",
    userRole: input.userRole ?? "agent",
    organizationId: input.organizationId,
  };
}

// ── Journey Permission Map ─────────────────────────────────────────────────────
// Maps each journey to the Permify permission required to trigger it.
// Financial journeys are fail-closed; read-only journeys are fail-open.

export const JOURNEY_PERMISSIONS: Record<string, {
  entityType: string;
  permission: string;
  failClosed: boolean;
  description: string;
}> = {
  J01_CustomerOnboardingWorkflow: {
    entityType: "tenant",
    permission: "create_customer",
    failClosed: true, // AUTH-12: fail-closed — outage must not bypass authz
    description: "Create new customer in tenant",
  },
  J02_PolicyPurchaseWorkflow: {
    entityType: "policy",
    permission: "create",
    failClosed: true, // financial — fail closed
    description: "Purchase insurance policy",
  },
  J03_ClaimsSettlementWorkflow: {
    entityType: "claim",
    permission: "approve",
    failClosed: true, // financial — fail closed
    description: "Settle insurance claim with payout",
  },
  J04_AgentOnboardingWorkflow: {
    entityType: "tenant",
    permission: "create_agent",
    failClosed: true, // AUTH-12: fail-closed
    description: "Onboard new agent to tenant",
  },
  J05_AgentDailyOpsWorkflow: {
    entityType: "tenant",
    permission: "agent_operations",
    failClosed: true, // AUTH-12: fail-closed
    description: "Agent daily operations (airtime, bills, cash)",
  },
  J06_PolicyRenewalWorkflow: {
    entityType: "policy",
    permission: "renew",
    failClosed: true, // financial — fail closed
    description: "Renew expiring policy",
  },
  J07_FraudResponseWorkflow: {
    entityType: "fraud_alert",
    permission: "resolve",
    failClosed: true, // AUTH-12: fail-closed
    description: "Fraud detection and account freeze",
  },
  J08_CommissionPayoutWorkflow: {
    entityType: "billing_ledger",
    permission: "record",
    failClosed: true, // financial — fail closed
    description: "Agent commission payout",
  },
  J09_RemittanceWorkflow: {
    entityType: "billing_ledger",
    permission: "record",
    failClosed: true, // financial — fail closed
    description: "Cross-border remittance",
  },
  J10_ClaimDisputeWorkflow: {
    entityType: "claim",
    permission: "view",
    failClosed: true, // AUTH-12: fail-closed
    description: "Claim dispute and escalation",
  },
  J11_BrokerPolicyManagementWorkflow: {
    entityType: "policy",
    permission: "view",
    failClosed: true, // AUTH-12: fail-closed
    description: "Broker multi-policy management",
  },
  J12_ActuaryIfrs17Workflow: {
    entityType: "audit_log",
    permission: "view",
    failClosed: true, // AUTH-12: fail-closed
    description: "IFRS17 actuarial reserve computation",
  },
  J13_ComplianceMonitoringWorkflow: {
    entityType: "audit_log",
    permission: "export",
    failClosed: true, // AUTH-12: fail-closed
    description: "AML/compliance monitoring and SAR filing",
  },
  J14_PosTerminalLifecycleWorkflow: {
    entityType: "tenant",
    permission: "manage_terminals",
    failClosed: true, // AUTH-12: fail-closed
    description: "POS terminal lifecycle management",
  },
  J15_ReinsuranceCessionWorkflow: {
    entityType: "billing_ledger",
    permission: "reconcile",
    failClosed: true, // financial — fail closed
    description: "Reinsurance treaty cession",
  },
  J16_CustomerSelfServiceWorkflow: {
    entityType: "policy",
    permission: "view",
    failClosed: true, // AUTH-12: fail-closed
    description: "Customer self-service portal",
  },
  J17_BulkPremiumPaymentWorkflow: {
    entityType: "billing_ledger",
    permission: "record",
    failClosed: true, // financial — fail closed
    description: "Bulk premium payment processing",
  },
  J18_AgentFloatReconciliationWorkflow: {
    entityType: "billing_ledger",
    permission: "reconcile",
    failClosed: true, // AUTH-12: fail-closed
    description: "Agent float EOD reconciliation",
  },
  J19_UnderwritingDecisionWorkflow: {
    entityType: "policy",
    permission: "edit",
    failClosed: true, // AUTH-12: fail-closed
    description: "Underwriting risk assessment and decision",
  },
  J20_PlatformHealthMonitoringWorkflow: {
    entityType: "audit_log",
    permission: "view",
    failClosed: true, // AUTH-12: fail-closed
    description: "Platform health and SLA monitoring",
  },
  J21_ParametricTriggerWorkflow: {
    entityType: "billing_ledger",
    permission: "record",
    failClosed: true, // financial — fail closed
    description: "Parametric insurance trigger and payout",
  },
  J22_UBIMonthlyAdjustmentWorkflow: {
    entityType: "policy",
    permission: "edit",
    failClosed: true, // AUTH-12: fail-closed
    description: "UBI monthly premium adjustment",
  },
  J23_P2PPoolLifecycleWorkflow: {
    entityType: "pool",
    permission: "manage",
    failClosed: true, // financial — fail closed
    description: "P2P risk pool lifecycle",
  },
  J24_WellnessRewardsWorkflow: {
    entityType: "policy",
    permission: "edit",
    failClosed: true, // AUTH-12: fail-closed
    description: "Wellness rewards and premium discount",
  },
  J25_NHIAClaimsWorkflow: {
    entityType: "claim",
    permission: "approve",
    failClosed: true, // financial — fail closed
    description: "NHIA health insurance claims",
  },
  J26_PredictiveRenewalWorkflow: {
    entityType: "policy",
    permission: "renew",
    failClosed: true, // AUTH-12: fail-closed
    description: "AI-predicted policy renewal",
  },
  J27_EmbeddedInsuranceWorkflow: {
    entityType: "policy",
    permission: "create",
    failClosed: true, // financial — fail closed
    description: "Embedded insurance via partner API",
  },
  J28_GroupInsuranceEnrollmentWorkflow: {
    entityType: "policy",
    permission: "create",
    failClosed: true, // financial — fail closed
    description: "Group insurance enrollment",
  },
};

// ── Core Guard Function ────────────────────────────────────────────────────────

/**
 * Assert that the triggering user has permission to execute this journey
 * within their tenant. Throws ApplicationFailure (non-retryable) if denied.
 *
 * @param journeyName - The workflow function name (e.g., "J02_PolicyPurchaseWorkflow")
 * @param ctx - Tenant context extracted from journey input
 */
export async function assertTenantAccess(
  journeyName: string,
  ctx: TenantContext
): Promise<void> {
  // Platform admins bypass tenant isolation (for support/ops)
  if (ctx.userRole === "admin" || ctx.userRole === "super_admin") {
    return;
  }

  const perm = JOURNEY_PERMISSIONS[journeyName];
  if (!perm) {
    // AUTH-12: unknown journeys are DENIED (fail-closed) — an unmapped
    // workflow must not silently bypass tenant authorization.
    logger.error({ journeyName }, "[TenantGuard] Unknown journey — denying (no permission mapping)");
    throw ApplicationFailure.create({
      message: `[TenantGuard] Unknown journey '${journeyName}' has no permission mapping — access denied (fail-closed)`,
      type: "AUTHORIZATION_DENIED",
      nonRetryable: true,
    });
  }

  // Circuit breaker check (AUTH-12: ALL journeys fail closed when Permify is
  // unavailable — an outage is never an authorization bypass).
  if (isCbOpen()) {
    throw ApplicationFailure.create({
      message: `[TenantGuard] Permify circuit breaker open — denying access to ${journeyName} (fail-closed)`,
      type: "AUTHORIZATION_DENIED",
      nonRetryable: true,
    });
  }

  try {
    const res = await fetch(
      `${PERMIFY_URL}/v1/tenants/${ctx.tenantId}/permissions/check`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { schema_version: "", snap_token: "", depth: 20 },
          entity: { type: perm.entityType, id: ctx.tenantId },
          permission: perm.permission,
          subject: { type: "user", id: ctx.userId },
        }),
        signal: AbortSignal.timeout(2_000),
      }
    );

    if (!res.ok) {
      cbFailures++;
      if (cbFailures >= CB_THRESHOLD && cbOpenedAt === 0) cbOpenedAt = Date.now();
      throw ApplicationFailure.create({
        message: `[TenantGuard] Permify returned ${res.status} — denying access to ${journeyName} (fail-closed)`,
        type: "AUTHORIZATION_DENIED",
        nonRetryable: true,
      });
    }

    const data = await res.json() as { can: string };
    cbFailures = 0; cbOpenedAt = 0; // reset circuit breaker on success

    if (data.can !== "CHECK_RESULT_ALLOWED") {
      throw ApplicationFailure.create({
        message: `[TenantGuard] Access denied: user ${ctx.userId} does not have '${perm.permission}' on '${perm.entityType}' in tenant ${ctx.tenantId}`,
        type: "AUTHORIZATION_DENIED",
        nonRetryable: true,
      });
    }

    logger.info({
      journeyName,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      permission: perm.permission,
    }, "[TenantGuard] Access granted");

  } catch (err) {
    if (err instanceof ApplicationFailure) throw err; // re-throw auth denials

    // Network/timeout error
    cbFailures++;
    if (cbFailures >= CB_THRESHOLD && cbOpenedAt === 0) cbOpenedAt = Date.now();

    // AUTH-12: fail-closed for ALL journeys — Permify unavailability denies.
    throw ApplicationFailure.create({
      message: `[TenantGuard] Permify unavailable — denying access to ${journeyName} (fail-closed): ${(err as Error).message}`,
      type: "AUTHORIZATION_DENIED",
      nonRetryable: true,
    });
  }
}

/**
 * Assert that a specific resource (policy, claim, agent) belongs to the
 * caller's tenant. Prevents cross-tenant data access.
 *
 * @param resourceType - e.g., "policy", "claim", "agent"
 * @param resourceId - The resource ID to check
 * @param ctx - Tenant context
 */
export async function assertResourceBelongsToTenant(
  resourceType: string,
  resourceId: string,
  ctx: TenantContext
): Promise<void> {
  if (ctx.userRole === "admin" || ctx.userRole === "super_admin") return;
  if (!resourceId || resourceId === "*") return;

  // AUTH-12: fail-closed — an unreachable policy engine denies the resource
  // check instead of silently allowing cross-tenant access.
  if (isCbOpen()) {
    logger.warn({ resourceType, resourceId }, "[TenantGuard] CB open — denying resource check (fail-closed)");
    throw ApplicationFailure.create({
      message: `[TenantGuard] Permify circuit breaker open — denying access to ${resourceType}:${resourceId} (fail-closed)`,
      type: "CROSS_TENANT_ACCESS_DENIED",
      nonRetryable: true,
    });
  }

  try {
    const res = await fetch(
      `${PERMIFY_URL}/v1/tenants/${ctx.tenantId}/permissions/check`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { schema_version: "", snap_token: "", depth: 20 },
          entity: { type: resourceType, id: resourceId },
          permission: "view",
          subject: { type: "user", id: ctx.userId },
        }),
        signal: AbortSignal.timeout(2_000),
      }
    );

    if (!res.ok) {
      cbFailures++;
      if (cbFailures >= CB_THRESHOLD && cbOpenedAt === 0) cbOpenedAt = Date.now();
      throw ApplicationFailure.create({
        message: `[TenantGuard] Permify returned ${res.status} — denying access to ${resourceType}:${resourceId} (fail-closed)`,
        type: "CROSS_TENANT_ACCESS_DENIED",
        nonRetryable: true,
      });
    }

    const data = await res.json() as { can: string };
    cbFailures = 0; cbOpenedAt = 0;

    if (data.can !== "CHECK_RESULT_ALLOWED") {
      throw ApplicationFailure.create({
        message: `[TenantGuard] Cross-tenant access denied: user ${ctx.userId} cannot access ${resourceType}:${resourceId} in tenant ${ctx.tenantId}`,
        type: "CROSS_TENANT_ACCESS_DENIED",
        nonRetryable: true,
      });
    }
  } catch (err) {
    if (err instanceof ApplicationFailure) throw err;
    cbFailures++;
    if (cbFailures >= CB_THRESHOLD && cbOpenedAt === 0) cbOpenedAt = Date.now();
    // AUTH-12: fail-closed for resource checks too.
    throw ApplicationFailure.create({
      message: `[TenantGuard] Resource check failed — denying access to ${resourceType}:${resourceId} (fail-closed): ${(err as Error).message}`,
      type: "CROSS_TENANT_ACCESS_DENIED",
      nonRetryable: true,
    });
  }
}

/**
 * Write a Permify relationship after a resource is created.
 * Called after J01 (customer created), J02 (policy created), J04 (agent created), etc.
 */
export async function writeResourceRelationship(
  entityType: string,
  entityId: string,
  relation: string,
  subjectType: string,
  subjectId: string,
  tenantId: string
): Promise<void> {
  try {
    await fetch(
      `${PERMIFY_URL}/v1/tenants/${tenantId}/relationships/write`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { schema_version: "" },
          tuples: [{
            entity: { type: entityType, id: entityId },
            relation,
            subject: { type: subjectType, id: subjectId },
          }],
        }),
        signal: AbortSignal.timeout(3_000),
      }
    );
  } catch (err) {
    // Non-fatal: relationship can be re-created later
    logger.warn({ entityType, entityId, relation, err: (err as Error).message },
      "[TenantGuard] Failed to write Permify relationship — non-fatal");
  }
}
