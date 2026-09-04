/**
 * journey-activities-extended.ts
 *
 * Extended activities library for the 20 insurance journeys.
 * Adds missing service integrations not in journey-activities.ts:
 *   - Permify RBAC checks
 *   - APISIX gateway management
 *   - Keycloak session management
 *   - Rust fraud-gate (port 8090)
 *   - Go float-reconciler (port 8095)
 *   - Go health-worker (port 8096)
 *   - Python ML fraud scoring (port 8001)
 *   - Python KYC verification (port 8002)
 *   - Python IFRS17 actuarial engine (port 8003)
 *   - Journey execution tracking (PostgreSQL)
 *   - Journey step event recording
 *   - Agent float top-up
 *   - Remittance order creation
 *   - Ollama risk narrative generation
 */
import { eq, and, desc, sql } from "drizzle-orm";

import { getDb } from "./db";
import { fluvioProduce } from "./fluvio";
import { tbCreateTransfer, tbEnsureAgentAccount, tbGetAgentBalance } from "./tbClient";
import { agents, customers, transactions, auditLog } from "../drizzle/schema";
import { journeyExecutions, journeyStepEvents } from "../drizzle/schema.journeys";
import { ENV } from "./_core/env";
import { logger } from "./_core/logger";
import { getApisixAdminKey } from "./lib/envValidation";
import { acquireLock, releaseLock } from "./lib/redisClient";

// ── Service URLs ──────────────────────────────────────────────────────────────
const FRAUD_GATE_URL = process.env.FRAUD_GATE_URL ?? "http://localhost:8090";
const FLOAT_RECONCILER_URL = process.env.FLOAT_RECONCILER_URL ?? "http://localhost:8095";
const HEALTH_WORKER_URL = process.env.HEALTH_WORKER_URL ?? "http://localhost:8096";
const ML_FRAUD_URL = process.env.ML_FRAUD_URL ?? "http://localhost:8001";
const KYC_SERVICE_URL = process.env.KYC_SERVICE_URL ?? "http://localhost:8002";
const IFRS17_ENGINE_URL = process.env.IFRS17_ENGINE_URL ?? "http://localhost:8003";
const PERMIFY_URL = process.env.PERMIFY_URL ?? "http://localhost:3476";
const APISIX_ADMIN_URL = process.env.APISIX_ADMIN_URL ?? "http://localhost:9180";
// DD-TSSEC: no fallback to the publicly-known APISIX default admin key —
// required from env in production (throws), empty outside it.
const APISIX_ADMIN_KEY = getApisixAdminKey();
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? "http://localhost:8080";
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? "insureportal";
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? "insureportal-api";
const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? "";

// ── Helper: fail-open fetch with timeout ─────────────────────────────────────
async function safeFetch(url: string, options: RequestInit, timeoutMs = 5000): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res;
  } catch {
    return null;
  }
}

// ── Helper: emit Fluvio event (fail-open) ─────────────────────────────────────
async function emit(topic: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await fluvioProduce(topic, { value: JSON.stringify({ ...payload, ts: Date.now() }) });
  } catch { /* fail-open */ }
}

// ── Helper: write audit log (fail-open) ──────────────────────────────────────
async function audit(action: string, resource: string, resourceId: string, meta?: Record<string, unknown>): Promise<void> {
  try {
    const d = await getDb();
    if (d) await d.insert(auditLog).values({ action, resource, resourceId, status: "success", metadata: meta ?? null });
  } catch { /* fail-open */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// JOURNEY EXECUTION TRACKING ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function recordJourneyStart(input: {
  journeyId: string;
  journeyName: string;
  workflowId: string;
  runId: string;
  triggeredBy: number;
  inputSnapshot: Record<string, unknown>;
  idempotencyKey?: string;
  scheduled?: boolean;
  scheduleId?: string;
}): Promise<{ executionId: number }> {
  const d = await getDb();
  if (!d) throw new Error("DB unavailable");

  // Scrub PII from input snapshot before storing
  const scrubbed = { ...input.inputSnapshot };
  for (const key of ["nin", "bvn", "password", "pin", "cardNumber", "cvv", "accountNumber"]) {
    if (key in scrubbed) scrubbed[key] = "***REDACTED***";
  }

  const [row] = await d.insert(journeyExecutions).values({
    journeyId: input.journeyId,
    journeyName: input.journeyName,
    workflowId: input.workflowId,
    runId: input.runId,
    triggeredBy: input.triggeredBy,
    inputSnapshot: scrubbed,
    status: "running",
    currentStep: "initializing",
    idempotencyKey: input.idempotencyKey,
    scheduled: input.scheduled ?? false,
    scheduleId: input.scheduleId,
  }).returning({ id: journeyExecutions.id });

  return { executionId: row.id };
}

export async function recordJourneyStep(input: {
  executionId: number;
  stepName: string;
  status: "started" | "completed" | "failed" | "compensated";
  service?: string;
  durationMs?: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const d = await getDb();
  if (!d) return; // fail-open — step tracking must not block business logic

  await d.insert(journeyStepEvents).values({
    executionId: input.executionId,
    stepName: input.stepName,
    status: input.status,
    service: input.service,
    durationMs: input.durationMs,
    errorMessage: input.errorMessage,
    metadata: input.metadata ?? {},
  });

  // Update current step on the execution record
  if (input.status === "started") {
    await d.update(journeyExecutions)
      .set({ currentStep: input.stepName })
      .where(eq(journeyExecutions.id, input.executionId));
  }
}

export async function recordJourneyComplete(input: {
  executionId: number;
  workflowId: string;
  status: "completed" | "failed" | "cancelled" | "timed_out";
  resultSnapshot?: Record<string, unknown>;
  errorMessage?: string;
}): Promise<void> {
  const d = await getDb();
  if (!d) return;

  const now = new Date();
  const row = await d.select({ startedAt: journeyExecutions.startedAt })
    .from(journeyExecutions)
    .where(eq(journeyExecutions.id, input.executionId))
    .limit(1);

  const startedAt = row[0]?.startedAt;
  const durationMs = startedAt ? now.getTime() - new Date(startedAt).getTime() : undefined;

  await d.update(journeyExecutions).set({
    status: input.status,
    completedAt: now,
    durationMs,
    resultSnapshot: input.resultSnapshot ?? null,
    errorMessage: input.errorMessage ?? null,
    currentStep: input.status === "completed" ? "done" : input.status,
  }).where(eq(journeyExecutions.id, input.executionId));
}

// ═══════════════════════════════════════════════════════════════════════════
// PERMIFY RBAC/ABAC ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function checkPermifyPermission(input: {
  subjectType: string;
  subjectId: string;
  permission: string;
  entityType: string;
  entityId: string;
  tenantId?: string;
}): Promise<{ allowed: boolean; reason: string }> {
  const tenantId = input.tenantId ?? "insureportal";
  const res = await safeFetch(
    `${PERMIFY_URL}/v1/tenants/${tenantId}/permissions/check`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metadata: { schema_version: "", snap_token: "", depth: 20 },
        entity: { type: input.entityType, id: input.entityId },
        permission: input.permission,
        subject: { type: input.subjectType, id: input.subjectId },
      }),
    },
    3000
  );

  if (!res || !res.ok) {
    // DD-FINAL-SWEEP (B4): default posture is FAIL-CLOSED — a Permify outage
    // must NOT authorize money movements in the 9 journey call sites that
    // gate on `permCheck.allowed`. This mirrors server/_core/permify.ts:66-99.
    // PERMIFY_FAIL_OPEN=true is an explicit, loud, INSECURE opt-in intended
    // only for short-lived disaster-recovery scenarios (and the unit-test
    // harness, which sets it in vitest.config.ts).
    if (process.env.PERMIFY_FAIL_OPEN === "true") {
      logger.error(
        { msg: "[Permify] FAIL-OPEN ACTIVE (PERMIFY_FAIL_OPEN=true) — allowing during outage", input },
      );
      return { allowed: true, reason: "permify_unavailable_fail_open" };
    }
    logger.error(
      { msg: "[Permify] unavailable — failing CLOSED (denying)", input },
    );
    return { allowed: false, reason: "permify_unavailable_fail_closed" };
  }

  const data = await res.json() as { can: string };
  const allowed = data.can === "CHECK_RESULT_ALLOWED";
  return {
    allowed,
    reason: allowed ? "permify_allowed" : "permify_denied",
  };
}

export async function writePermifyRelationship(input: {
  tenantId?: string;
  entityType: string;
  entityId: string;
  relation: string;
  subjectType: string;
  subjectId: string;
}): Promise<{ success: boolean }> {
  const tenantId = input.tenantId ?? "insureportal";
  const res = await safeFetch(
    `${PERMIFY_URL}/v1/tenants/${tenantId}/relationships/write`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metadata: { schema_version: "" },
        tuples: [{
          entity: { type: input.entityType, id: input.entityId },
          relation: input.relation,
          subject: { type: input.subjectType, id: input.subjectId },
        }],
      }),
    },
    5000
  );

  if (!res || !res.ok) {
    logger.warn({ msg: "Permify write relationship failed", input });
    return { success: false };
  }

  await audit("PERMIFY_RELATIONSHIP_WRITE", input.entityType, input.entityId, input);
  return { success: true };
}

/**
 * Grant a subject a relation on an object (policy-level access update).
 * Alias-shaped wrapper over writePermifyRelationship with object/subject naming.
 */
export async function updatePermifyPolicy(input: {
  tenantId?: string;
  subjectType: string;
  subjectId: string;
  relation: string;
  objectType: string;
  objectId: string;
}): Promise<{ success: boolean }> {
  return writePermifyRelationship({
    tenantId: input.tenantId,
    entityType: input.objectType,
    entityId: input.objectId,
    relation: input.relation,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// KEYCLOAK SESSION ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function validateKeycloakSession(input: {
  accessToken: string;
}): Promise<{ valid: boolean; userId: string; email: string; roles: string[] }> {
  const res = await safeFetch(
    `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/userinfo`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${input.accessToken}` },
    },
    3000
  );

  if (!res || !res.ok) {
    return { valid: false, userId: "", email: "", roles: [] };
  }

  const data = await res.json() as {
    sub: string;
    email: string;
    realm_access?: { roles: string[] };
  };

  return {
    valid: true,
    userId: data.sub,
    email: data.email,
    roles: data.realm_access?.roles ?? [],
  };
}

export async function createKeycloakUser(input: {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  temporaryPassword?: string;
}): Promise<{ keycloakId: string; success: boolean }> {
  // Get admin token
  const tokenRes = await safeFetch(
    `${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: "admin-cli",
        client_secret: process.env.KEYCLOAK_ADMIN_SECRET ?? "",
      }).toString(),
    },
    5000
  );

  if (!tokenRes || !tokenRes.ok) {
    logger.warn({ msg: "Keycloak admin token failed — user creation skipped" });
    return { keycloakId: `local-${Date.now()}`, success: false };
  }

  const tokenData = await tokenRes.json() as { access_token: string };

  const userRes = await safeFetch(
    `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify({
        username: input.email,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        enabled: true,
        emailVerified: false,
        attributes: { phone: [input.phone] },
        credentials: input.temporaryPassword ? [{
          type: "password",
          value: input.temporaryPassword,
          temporary: true,
        }] : [],
      }),
    },
    5000
  );

  if (!userRes) return { keycloakId: `local-${Date.now()}`, success: false };

  if (userRes.status === 201) {
    const location = userRes.headers.get("Location") ?? "";
    const keycloakId = location.split("/").pop() ?? `kc-${Date.now()}`;
    await audit("KEYCLOAK_USER_CREATED", "user", keycloakId, { email: input.email });
    return { keycloakId, success: true };
  }

  // 409 = user already exists
  if (userRes.status === 409) {
    return { keycloakId: `existing-${input.email}`, success: true };
  }

  return { keycloakId: `local-${Date.now()}`, success: false };
}

export async function assignKeycloakRole(input: {
  keycloakUserId: string;
  role: string;
}): Promise<{ success: boolean }> {
  const tokenRes = await safeFetch(
    `${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: "admin-cli",
        client_secret: process.env.KEYCLOAK_ADMIN_SECRET ?? "",
      }).toString(),
    },
    5000
  );

  if (!tokenRes || !tokenRes.ok) return { success: false };
  const tokenData = await tokenRes.json() as { access_token: string };

  // Get role ID
  const roleRes = await safeFetch(
    `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/roles/${input.role}`,
    { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
    3000
  );
  if (!roleRes || !roleRes.ok) return { success: false };
  const roleData = await roleRes.json() as { id: string; name: string };

  // Assign role to user
  const assignRes = await safeFetch(
    `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users/${input.keycloakUserId}/role-mappings/realm`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify([{ id: roleData.id, name: roleData.name }]),
    },
    5000
  );

  return { success: assignRes?.ok ?? false };
}

// ═══════════════════════════════════════════════════════════════════════════
// RUST FRAUD-GATE ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function callRustFraudGate(input: {
  userId: number;
  amount: number;
  transactionType: string;
  recipient?: string;
  sourceIp?: string;
  deviceId?: string;
  traceId?: string;
}): Promise<{
  allowed: boolean;
  riskScore: number;
  riskLevel: string;
  flags: string[];
  velocitySource: string;
}> {
  const res = await safeFetch(
    `${FRAUD_GATE_URL}/check`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: input.userId,
        amount: input.amount,
        transaction_type: input.transactionType,
        recipient: input.recipient ?? "",
        source_ip: input.sourceIp,
        device_id: input.deviceId,
        trace_id: input.traceId ?? `JRN-${Date.now()}`,
      }),
    },
    2000 // 2s timeout — fraud check must be fast
  );

  if (!res || !res.ok) {
    // DD-LEGACY (#17): was fail-open (allowed:true, riskScore:0) — a money
    // flow proceeded with no fraud check. Fail-closed: block and mark the
    // control as unavailable so the workflow retries/escalates.
    logger.error({ msg: "Rust fraud-gate unavailable — failing CLOSED (transaction not allowed)", userId: input.userId });
    return { allowed: false, riskScore: 100, riskLevel: "unknown", flags: ["fraud_gate_unavailable"], velocitySource: "none" };
  }

  const data = await res.json() as {
    allowed: boolean;
    risk_score: number;
    risk_level: string;
    flags: string[];
    velocity_source: string;
  };

  return {
    allowed: data.allowed,
    riskScore: data.risk_score,
    riskLevel: data.risk_level,
    flags: data.flags,
    velocitySource: data.velocity_source,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GO FLOAT-RECONCILER ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function callGoFloatReconciler(input: {
  agentId: number;
  agentCode: string;
  date?: string;
}): Promise<{
  agentId: number;
  pgBalance: number;
  tbBalance: number;
  discrepancy: number;
  status: "balanced" | "discrepancy_minor" | "discrepancy_major" | "error";
  action: string;
}> {
  const date = input.date ?? new Date().toISOString().split("T")[0];
  const res = await safeFetch(
    `${FLOAT_RECONCILER_URL}/reconcile`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: input.agentId,
        agent_code: input.agentCode,
        date,
      }),
    },
    10000 // 10s — reconciliation can take time
  );

  if (!res || !res.ok) {
    logger.warn({ msg: "Go float-reconciler unavailable", agentId: input.agentId });
    return {
      agentId: input.agentId,
      pgBalance: 0,
      tbBalance: 0,
      discrepancy: 0,
      status: "error",
      action: "reconciler_unavailable",
    };
  }

  const data = await res.json() as {
    agent_id: number;
    pg_balance: number;
    tb_balance: number;
    discrepancy: number;
    status: string;
    action: string;
  };

  return {
    agentId: data.agent_id,
    pgBalance: data.pg_balance,
    tbBalance: data.tb_balance,
    discrepancy: data.discrepancy,
    status: data.status as "balanced" | "discrepancy_minor" | "discrepancy_major" | "error",
    action: data.action,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GO HEALTH-WORKER ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function callGoHealthWorker(input: {
  services?: string[];
}): Promise<{
  overallStatus: "healthy" | "degraded" | "critical";
  services: Array<{ name: string; status: string; latencyMs: number; error?: string }>;
  slaBreaches: Array<{ service: string; metric: string; threshold: number; actual: number }>;
}> {
  const res = await safeFetch(
    `${HEALTH_WORKER_URL}/probe`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ services: input.services }),
    },
    15000 // 15s — health probes can take time
  );

  if (!res || !res.ok) {
    return {
      overallStatus: "critical",
      services: [{ name: "health-worker", status: "unavailable", latencyMs: 0, error: "health-worker unreachable" }],
      slaBreaches: [],
    };
  }

  const data = await res.json() as {
    overall_status: string;
    services: Array<{ name: string; status: string; latency_ms: number; error?: string }>;
    sla_breaches: Array<{ service: string; metric: string; threshold: number; actual: number }>;
  };

  return {
    overallStatus: data.overall_status as "healthy" | "degraded" | "critical",
    services: data.services.map(s => ({ name: s.name, status: s.status, latencyMs: s.latency_ms, error: s.error })),
    slaBreaches: data.sla_breaches,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PYTHON ML FRAUD SCORING ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function callPythonFraudScore(input: {
  transactionId: number;
  agentId: number;
  amount: number;
  transactionType: string;
  hour?: number;
  dayOfWeek?: number;
  customerAge?: number;
  previousFraudCount?: number;
}): Promise<{
  fraudProbability: number;
  riskScore: number;
  riskLevel: string;
  modelVersion: string;
  features: Record<string, number>;
}> {
  const now = new Date();
  const res = await safeFetch(
    `${ML_FRAUD_URL}/predict`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_id: input.transactionId,
        agent_id: input.agentId,
        amount: input.amount,
        transaction_type: input.transactionType,
        hour_of_day: input.hour ?? now.getHours(),
        day_of_week: input.dayOfWeek ?? now.getDay(),
        customer_age: input.customerAge ?? 35,
        previous_fraud_count: input.previousFraudCount ?? 0,
      }),
    },
    5000
  );

  if (!res || !res.ok) {
    // DD-LEGACY (#17): was a fabricated zero risk score consumed by workflow
    // decisions. Fail-closed: report maximum caution with an explicit
    // unavailable marker — never a fake "safe" score.
    logger.error({ msg: "ML fraud scoring unavailable — returning fail-closed maximum-caution result" });
    return {
      fraudProbability: 1,
      riskScore: 100,
      riskLevel: "unavailable",
      modelVersion: "unavailable",
      features: {},
    };
  }

  const data = await res.json() as {
    fraud_probability: number;
    risk_score: number;
    risk_level: string;
    model_version: string;
    features: Record<string, number>;
  };

  return {
    fraudProbability: data.fraud_probability,
    riskScore: data.risk_score,
    riskLevel: data.risk_level,
    modelVersion: data.model_version,
    features: data.features,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PYTHON KYC VERIFICATION ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function callPythonKycVerification(input: {
  customerId: number;
  nin?: string;
  bvn?: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  documentType?: string;
  documentNumber?: string;
}): Promise<{
  verified: boolean;
  kycLevel: number;
  score: number;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  sessionId: string;
}> {
  const res = await safeFetch(
    `${KYC_SERVICE_URL}/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_id: input.customerId,
        nin: input.nin,
        bvn: input.bvn,
        first_name: input.firstName,
        last_name: input.lastName,
        date_of_birth: input.dateOfBirth,
        document_type: input.documentType,
        document_number: input.documentNumber,
      }),
    },
    15000 // KYC can take time
  );

  if (!res || !res.ok) {
    return {
      verified: false,
      kycLevel: 0,
      score: 0,
      checks: [{ name: "kyc_service", passed: false, detail: "KYC service unavailable" }],
      sessionId: "", // no real session exists — KYC service was unreachable (fail-closed)
    };
  }

  const data = await res.json() as {
    verified: boolean;
    kyc_level: number;
    score: number;
    checks: Array<{ name: string; passed: boolean; detail: string }>;
    session_id: string;
  };

  return {
    verified: data.verified,
    kycLevel: data.kyc_level,
    score: data.score,
    checks: data.checks,
    sessionId: data.session_id,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PYTHON IFRS17 ACTUARIAL ENGINE ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function callIfrs17Engine(input: {
  portfolioId: string;
  reportingDate: string;
  measurementModel: "BBA" | "PAA" | "VFA";
  discountRate?: number;
  riskAdjustmentMethod?: string;
}): Promise<{
  csm: number;
  ra: number;
  lcr: number;
  liabilityForRemainingCoverage: number;
  liabilityForIncurredClaims: number;
  contractualServiceMargin: number;
  riskAdjustment: number;
  reportingDate: string;
  measurementModel: string;
}> {
  const res = await safeFetch(
    `${IFRS17_ENGINE_URL}/calculate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        portfolio_id: input.portfolioId,
        reporting_date: input.reportingDate,
        measurement_model: input.measurementModel,
        discount_rate: input.discountRate ?? 0.12,
        risk_adjustment_method: input.riskAdjustmentMethod ?? "percentile_75",
      }),
    },
    30000 // IFRS17 calculations can be intensive
  );

  if (!res || !res.ok) {
    throw new Error(`IFRS17 engine unavailable: ${res?.status ?? "no response"}`);
  }

  const data = await res.json() as {
    csm: number;
    ra: number;
    lcr: number;
    liability_for_remaining_coverage: number;
    liability_for_incurred_claims: number;
    contractual_service_margin: number;
    risk_adjustment: number;
    reporting_date: string;
    measurement_model: string;
  };

  return {
    csm: data.csm,
    ra: data.ra,
    lcr: data.lcr,
    liabilityForRemainingCoverage: data.liability_for_remaining_coverage,
    liabilityForIncurredClaims: data.liability_for_incurred_claims,
    contractualServiceMargin: data.contractual_service_margin,
    riskAdjustment: data.risk_adjustment,
    reportingDate: data.reporting_date,
    measurementModel: data.measurement_model,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// APISIX GATEWAY ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function checkApisixRateLimit(input: {
  routeId: string;
  consumerId: string;
}): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  // APISIX rate limiting is enforced at the gateway level automatically.
  // This activity checks the current rate limit status for a consumer.
  const res = await safeFetch(
    `${APISIX_ADMIN_URL}/apisix/admin/consumers/${input.consumerId}`,
    {
      headers: { "X-API-KEY": APISIX_ADMIN_KEY },
    },
    3000
  );

  if (!res || !res.ok) {
    return { allowed: true, remaining: 1000, resetAt: Date.now() + 60000 };
  }

  // APISIX doesn't expose real-time rate limit counters via admin API.
  // Rate limiting is enforced per-request at the proxy layer.
  return { allowed: true, remaining: 1000, resetAt: Date.now() + 60000 };
}

export async function createApisixConsumer(input: {
  username: string;
  plugins?: Record<string, unknown>;
}): Promise<{ success: boolean; consumerId: string }> {
  const res = await safeFetch(
    `${APISIX_ADMIN_URL}/apisix/admin/consumers`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": APISIX_ADMIN_KEY,
      },
      body: JSON.stringify({
        username: input.username,
        plugins: input.plugins ?? {
          "key-auth": { key: `${input.username}-${Date.now()}` },
          "limit-req": { rate: 100, burst: 50, key: "consumer_name" },
        },
      }),
    },
    5000
  );

  if (!res || !res.ok) {
    logger.warn({ msg: "APISIX consumer creation failed", username: input.username });
    return { success: false, consumerId: input.username };
  }

  return { success: true, consumerId: input.username };
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT FLOAT TOP-UP ACTIVITY
// ═══════════════════════════════════════════════════════════════════════════

export async function topUpAgentFloat(input: {
  agentId: number;
  agentCode: string;
  amount: number;
  paymentRef: string;
  fundingSource: "bank_transfer" | "internal" | "corporate";
}): Promise<{ success: boolean; newBalance: number; transactionId: string; tbTransferId: string }> {
  if (input.amount <= 0) throw new Error("Float top-up amount must be positive");
  if (input.amount > 10_000_000) throw new Error("Float top-up exceeds ₦10M single limit");

  const idempotencyKey = `float-topup-${input.agentId}-${input.paymentRef}`;
  const { acquireLock: lock, releaseLock: release } = await import("./lib/redisClient");
  const lockAcquired = await lock(idempotencyKey, 30);
  if (!lockAcquired) throw new Error("Float top-up already in progress for this reference");

  try {
    const d = await getDb();
    if (!d) throw new Error("DB unavailable");

    // Check idempotency — only a prior SUCCESSFUL top-up with this ref is a
    // replay (DD-FINAL-SWEEP H3: pending/failed rows from a crashed attempt
    // must be resumable, not mistaken for success).
    const existing = await d.select().from(transactions)
      .where(and(
        eq(transactions.agentId, input.agentId),
        eq(transactions.ref, input.paymentRef),
        eq(transactions.type, "Cash In"),
        eq(transactions.status, "success")
      )).limit(1);

    if (existing.length > 0) {
      const agent = await d.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);
      return {
        success: true,
        newBalance: parseFloat(agent[0]?.premiumReserve ?? "0"),
        transactionId: existing[0].id.toString(),
        tbTransferId: "idempotent-replay",
      };
    }

    // Ensure TB account exists
    await tbEnsureAgentAccount(input.agentCode);

    // DD-FINAL-SWEEP (H3): INSERT-FIRST idempotency. The durable transactions
    // row is written BEFORE the TigerBeetle leg (previously the TB leg ran
    // first — an activity failure in between + retry double-credited). The TB
    // transfer id is now deterministic (`FLOAT-TOPUP-${agentId}-${paymentRef}`)
    // instead of Date.now(), so TB ref/id-idempotency dedupes retries.
    const tbTransferId = `FLOAT-TOPUP-${input.agentId}-${input.paymentRef}`;
    const [txn] = await d.insert(transactions).values({
      ref: input.paymentRef,
      agentId: input.agentId,
      type: "Cash In",
      amount: input.amount.toString(),
      status: "pending",
      metadata: { description: `Float top-up via ${input.fundingSource}`, tbTransferId, fundingSource: input.fundingSource },
    }).onConflictDoNothing({ target: transactions.ref })
      .returning({ id: transactions.id });

    let transactionId: number;
    if (txn) {
      transactionId = txn.id;
    } else {
      // A crashed prior attempt left the durable row — resume it (the TB leg
      // below is idempotent on the deterministic transfer id).
      const [row] = await d.select({ id: transactions.id }).from(transactions)
        .where(eq(transactions.ref, input.paymentRef)).limit(1);
      if (!row) throw new Error("Float top-up durable row missing after conflict");
      transactionId = row.id;
    }

    // TigerBeetle transfer: FLOAT_POOL → agent account
    try {
      await tbCreateTransfer({
        id: tbTransferId,
        debitAccountId: process.env.TB_FLOAT_POOL_ID ?? "float-pool",
        creditAccountId: `float-${input.agentCode}`,
        amount: Math.round(input.amount * 100), // kobo
        ledger: 2000,
        code: 300, // WALLET_TOPUP
        ref: input.paymentRef,
        txType: "float_topup",
        agentId: input.agentCode,
      });
    } catch (e: unknown) {
      // Fail loud and mark the durable row failed so the retry path resumes
      // honestly instead of reporting success.
      await d.update(transactions)
        .set({
          status: "failed",
          failureReason: e instanceof Error ? e.message : String(e),
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transactionId));
      throw e;
    }

    // Update PostgreSQL balance
    await d.update(agents)
      .set({
        premiumReserve: sql`${agents.premiumReserve} + ${input.amount}`,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, input.agentId));

    // Mark the durable row successful
    await d.update(transactions)
      .set({ status: "success", updatedAt: new Date() })
      .where(eq(transactions.id, transactionId));

    const agent = await d.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);

    await emit("agent.float.topup", {
      agentId: input.agentId,
      amount: input.amount,
      newBalance: parseFloat(agent[0]?.premiumReserve ?? "0"),
      paymentRef: input.paymentRef,
    });

    await audit("FLOAT_TOPUP", "agent", input.agentId.toString(), {
      amount: input.amount,
      paymentRef: input.paymentRef,
    });

    return {
      success: true,
      newBalance: parseFloat(agent[0]?.premiumReserve ?? "0"),
      transactionId: transactionId.toString(),
      tbTransferId,
    };
  } finally {
    await release(idempotencyKey);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// REMITTANCE ORDER ACTIVITY
// ═══════════════════════════════════════════════════════════════════════════

export async function createRemittanceOrder(input: {
  senderId: number;
  senderName: string;
  recipientName: string;
  recipientAccount: string;
  recipientBank: string;
  recipientCountry: string;
  sendAmount: number;
  sendCurrency: string;
  receiveCurrency: string;
  exchangeRate: number;
  receiveAmount: number;
  paymentRef: string;
  channel: "nibss" | "swift" | "mobile_money" | "cash";
}): Promise<{
  orderId: string;
  status: string;
  sendAmount: number;
  receiveAmount: number;
  exchangeRate: number;
  estimatedDelivery: string;
  trackingCode: string;
}> {
  const d = await getDb();
  if (!d) throw new Error("DB unavailable");

  const orderId = `REM-${Date.now()}-${input.senderId}`;
  const { randomBytes } = await import("crypto");
  const trackingCode = `TRK${randomBytes(4).toString("hex").toUpperCase()}`;

  // Record remittance order in transactions table
  await d.insert(transactions).values({
    ref: input.paymentRef,
    agentId: input.senderId,
    type: "Transfer",
    amount: input.sendAmount.toString(),
    status: "pending",
    metadata: {
      orderId,
      description: `Remittance to ${input.recipientName} in ${input.recipientCountry}`,
      trackingCode,
      recipientName: input.recipientName,
      recipientAccount: input.recipientAccount,
      recipientBank: input.recipientBank,
      recipientCountry: input.recipientCountry,
      sendCurrency: input.sendCurrency,
      receiveCurrency: input.receiveCurrency,
      exchangeRate: input.exchangeRate,
      receiveAmount: input.receiveAmount,
      channel: input.channel,
    },
  });

  await emit("remittance.order.created", {
    orderId,
    senderId: input.senderId,
    amount: input.sendAmount,
    currency: input.sendCurrency,
    channel: input.channel,
  });

  const estimatedDelivery = new Date(
    Date.now() + (input.channel === "nibss" ? 30 * 60 * 1000 : 24 * 60 * 60 * 1000)
  ).toISOString();

  return {
    orderId,
    status: "pending",
    sendAmount: input.sendAmount,
    receiveAmount: input.receiveAmount,
    exchangeRate: input.exchangeRate,
    estimatedDelivery,
    trackingCode,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// OLLAMA RISK NARRATIVE ACTIVITY
// ═══════════════════════════════════════════════════════════════════════════

export async function generateOllamaRiskNarrative(input: {
  context: string;
  riskScore: number;
  riskFactors: string[];
  policyType?: string;
  claimType?: string;
  narrativeType: "underwriting" | "fraud" | "claims" | "compliance" | "renewal";
}): Promise<{ narrative: string; recommendation: string; confidence: number }> {
  const OLLAMA_URL = ENV.ollamaUrl ?? "http://localhost:11434";

  const prompts: Record<string, string> = {
    underwriting: `You are an insurance underwriter for a Nigerian insurance company. 
Analyze this risk profile and provide a concise underwriting narrative:
Policy Type: ${input.policyType ?? "general"}
Risk Score: ${input.riskScore}/100
Risk Factors: ${input.riskFactors.join(", ")}
Context: ${input.context}
Provide: 1) Risk assessment (2-3 sentences) 2) Recommendation (accept/decline/refer) 3) Any conditions`,

    fraud: `You are a fraud analyst for a Nigerian insurance company.
Analyze this fraud alert and provide a brief investigation narrative:
Risk Score: ${input.riskScore}/100
Fraud Indicators: ${input.riskFactors.join(", ")}
Context: ${input.context}
Provide: 1) Fraud assessment (2-3 sentences) 2) Recommended action (block/review/allow) 3) Key evidence`,

    claims: `You are a claims adjuster for a Nigerian insurance company.
Analyze this claim and provide an adjudication narrative:
Claim Type: ${input.claimType ?? "general"}
Risk Score: ${input.riskScore}/100
Flags: ${input.riskFactors.join(", ")}
Context: ${input.context}
Provide: 1) Claim assessment (2-3 sentences) 2) Decision (approve/decline/investigate) 3) Rationale`,

    compliance: `You are a compliance officer for a Nigerian insurance company (NAICOM/CBN regulated).
Analyze this compliance matter:
Risk Score: ${input.riskScore}/100
Compliance Issues: ${input.riskFactors.join(", ")}
Context: ${input.context}
Provide: 1) Compliance assessment (2-3 sentences) 2) Required action 3) Regulatory reference`,

    renewal: `You are an insurance renewal specialist for a Nigerian insurance company.
Analyze this renewal request:
Policy Type: ${input.policyType ?? "general"}
Risk Score: ${input.riskScore}/100
Renewal Factors: ${input.riskFactors.join(", ")}
Context: ${input.context}
Provide: 1) Renewal recommendation (2-3 sentences) 2) Premium adjustment (increase/decrease/maintain) 3) Conditions`,
  };

  const prompt = prompts[input.narrativeType] ?? prompts.underwriting;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2:3b",
        prompt,
        stream: false,
        options: { temperature: 0.3, num_predict: 300 },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      return {
        narrative: `Risk score: ${input.riskScore}/100. Factors: ${input.riskFactors.join(", ")}.`,
        recommendation: input.riskScore > 70 ? "decline" : input.riskScore > 40 ? "refer" : "accept",
        confidence: 0.5,
      };
    }

    const data = await res.json() as { response: string };
    const text = data.response ?? "";

    // Extract recommendation from narrative
    let recommendation = "refer";
    if (/accept|approve|allow/i.test(text)) recommendation = "accept";
    else if (/decline|reject|block/i.test(text)) recommendation = "decline";
    else if (/investigate|review|refer/i.test(text)) recommendation = "refer";

    return {
      narrative: text.trim(),
      recommendation,
      confidence: 0.85,
    };
  } catch {
    return {
      narrative: `Risk score: ${input.riskScore}/100. Factors: ${input.riskFactors.join(", ")}.`,
      recommendation: input.riskScore > 70 ? "decline" : input.riskScore > 40 ? "refer" : "accept",
      confidence: 0.5,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DAPR SERVICE INVOCATION ACTIVITY
// ═══════════════════════════════════════════════════════════════════════════

export async function invokeDaprService(input: {
  appId: string;
  method: string;
  httpMethod?: string;
  data?: Record<string, unknown>;
}): Promise<{ success: boolean; data: unknown }> {
  const DAPR_HTTP_PORT = process.env.DAPR_HTTP_PORT ?? "3500";
  const url = `http://localhost:${DAPR_HTTP_PORT}/v1.0/invoke/${input.appId}/method/${input.method}`;

  const res = await safeFetch(
    url,
    {
      method: input.httpMethod ?? "POST",
      headers: { "Content-Type": "application/json" },
      body: input.data ? JSON.stringify(input.data) : undefined,
    },
    5000
  );

  if (!res || !res.ok) {
    logger.warn({ msg: "Dapr service invocation failed", appId: input.appId, method: input.method });
    return { success: false, data: null };
  }

  const data = await res.json().catch(() => null);
  return { success: true, data };
}
