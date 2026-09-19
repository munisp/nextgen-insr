/**
 * insuranceJourneyOrchestratorV2.ts
 *
 * Complete tRPC router for all 20 insurance stakeholder journeys.
 * Fixes all gaps from v1:
 *   - listExecutions: real PostgreSQL query (not empty stub)
 *   - cancel: cancel a running Temporal workflow
 *   - retry: retry a failed workflow
 *   - schedule: create/update/delete recurring journey schedules
 *   - history: get step-by-step execution history
 *   - idempotency: prevent duplicate triggers
 *   - All 20 journey triggers with validated inputs
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, like, gte, lte } from "drizzle-orm";
import { z } from "zod";

import { customers, policies, auditLog } from "../../drizzle/schema";
import { journeyExecutions, journeyStepEvents, journeySchedules } from "../../drizzle/schema.journeys";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { sanitizeGenericJourneyInput, stripForgedTrustedFields } from "../lib/journeyTriggerPolicy";
import { assertClaimIncidentValid } from "../lib/policyLifecycle";
import { getTemporalClient } from "../temporal";

// ── M-wave (W1, 2026-09-19): staff detection for journey triggers ───────────
// Same staff convention as insuranceWorkflows.ts (L-wave): the platform role
// enum carries only admin/supervisor as staff. Computed SERVER-SIDE from the
// session — never from client payloads.
const JOURNEY_STAFF_ROLES = ["admin", "supervisor"] as const;
function isStaffCaller(ctx: { user?: { role?: string } | null }): boolean {
  return (JOURNEY_STAFF_ROLES as readonly string[]).includes(ctx.user?.role ?? "");
}

/**
 * M-wave (W1, 2026-09-19): shared J03 trigger guard. The Temporal claims
 * journey previously accepted caller-chosen customerId/claimedAmount/
 * beneficiaryAccount from ANY authenticated user and settled real
 * TigerBeetle funds with no staff role and no SoD. Now, before any workflow
 * starts:
 *   - customerId is SESSION-DERIVED for non-staff (the caller must own the
 *     customer record, resolved via customers.keycloakSub — the same
 *     convention as V1 triggerJ02); staff may act on behalf of any existing
 *     customer, with an audit record;
 *   - the policy must belong to that customer and claimedAmount must not
 *     exceed the policy's sumInsured (server-side coverage check);
 *   - beneficiary fields are never accepted here — settlement pays the
 *     beneficiary of record inside the activity.
 * Returns the validated journey input.
 */
async function validateJ03Trigger(
  ctx: { user?: { id?: number; role?: string } | null },
  input: { policyId: number; customerId: number; claimedAmount: number },
): Promise<{ customerId: number; initiatedByStaff: boolean }> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

  const staff = isStaffCaller(ctx);
  let customerId = input.customerId;
  if (!staff) {
    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.keycloakSub, String(ctx.user?.id)))
      .limit(1);
    if (!customer) {
      throw new TRPCError({ code: "FORBIDDEN", message: "No customer profile for the authenticated account" });
    }
    if (customer.id !== input.customerId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "customerId does not match the authenticated account" });
    }
    customerId = customer.id;
  } else {
    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, input.customerId))
      .limit(1);
    if (!customer) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Customer ${input.customerId} not found` });
    }
  }

  const [policy] = await db
    .select({ id: policies.id, customerId: policies.customerId, sumInsured: policies.sumInsured })
    .from(policies)
    .where(eq(policies.id, input.policyId))
    .limit(1);
  if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: `Policy ${input.policyId} not found` });
  if (policy.customerId !== customerId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Policy does not belong to the claiming customer" });
  }
  const coverage = Number(policy.sumInsured ?? NaN);
  if (!Number.isFinite(coverage) || input.claimedAmount > coverage) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `claimedAmount ₦${input.claimedAmount} exceeds the policy coverage ₦${policy.sumInsured ?? 0}`,
    });
  }

  if (staff) {
    // Staff acting on behalf of a customer — audited.
    await db.insert(auditLog).values({
      action: "J03_TRIGGERED_ON_BEHALF",
      resource: "customers",
      resourceId: String(customerId),
      status: "success",
      metadata: { staffUserId: ctx.user?.id ?? null, policyId: input.policyId, claimedAmount: input.claimedAmount },
    }).catch(() => {});
  }
  return { customerId, initiatedByStaff: staff };
}



// ── Journey definitions (metadata for the frontend) ──────────────────────────
export const JOURNEY_DEFINITIONS = [
  { id: "J01", name: "New Customer Onboarding", description: "KYC → Keycloak Identity → Policy Quote → Bind → Welcome", category: "customer", estimatedDuration: "5-10 min", stakeholders: ["customer", "agent", "compliance"], services: ["keycloak", "postgresql", "python-kyc", "nibss", "permify", "apisix", "ollama", "fluvio", "dapr", "lakehouse"] },
  { id: "J02", name: "Insurance Policy Purchase", description: "Fraud Check → Underwriting AI → Premium TB Ledger → Certificate", category: "policy", estimatedDuration: "3-5 min", stakeholders: ["customer", "agent", "underwriter"], services: ["rust-fraud-gate", "postgresql", "tigerbeetle", "permify", "ollama", "fluvio", "dapr", "lakehouse"] },
  { id: "J03", name: "Claims Filing & Settlement", description: "FNOL → ML Fraud Score → Adjuster → AI Analysis → TB Payout", category: "claims", estimatedDuration: "10-30 min", stakeholders: ["customer", "adjuster", "fraud_analyst"], services: ["python-ml", "rust-fraud-gate", "postgresql", "tigerbeetle", "permify", "ollama", "aml", "fluvio", "dapr", "lakehouse"] },
  { id: "J04", name: "Agent Onboarding & Activation", description: "KYC → Keycloak → Float TB → POS Terminal → APISIX Consumer", category: "agent", estimatedDuration: "15-20 min", stakeholders: ["agent", "supervisor", "compliance"], services: ["keycloak", "python-kyc", "postgresql", "tigerbeetle", "permify", "apisix", "fluvio", "dapr", "lakehouse"] },
  { id: "J05", name: "Agent Daily Operations", description: "Fraud Gate → Float Check → Transaction → TB Settlement", category: "agent", estimatedDuration: "1-3 min", stakeholders: ["agent", "customer"], services: ["rust-fraud-gate", "postgresql", "tigerbeetle", "fluvio", "lakehouse"] },
  { id: "J06", name: "Policy Renewal", description: "Expiry Detection → AI Recommendation → Quote → TB Payment → Rebind", category: "policy", estimatedDuration: "3-5 min", stakeholders: ["customer", "agent"], services: ["postgresql", "rust-fraud-gate", "ollama", "tigerbeetle", "permify", "fluvio", "dapr", "lakehouse"] },
  { id: "J07", name: "Fraud Detection & Response", description: "ML Score → Rust Gate → AI Narrative → Freeze → AML → Resolution", category: "fraud", estimatedDuration: "1-2 min", stakeholders: ["fraud_analyst", "compliance", "agent"], services: ["python-ml", "rust-fraud-gate", "postgresql", "permify", "ollama", "aml", "fluvio", "lakehouse"] },
  { id: "J08", name: "Commission Payout", description: "Calculate → AML → Fraud Gate → TB Credit → Notify", category: "finance", estimatedDuration: "5-10 min", stakeholders: ["agent", "finance"], services: ["postgresql", "aml", "rust-fraud-gate", "tigerbeetle", "permify", "dapr", "fluvio", "lakehouse"] },
  { id: "J09", name: "Cross-Border Remittance", description: "AML → Fraud Gate → TB Debit → NIBSS/SWIFT → NAICOM Report", category: "finance", estimatedDuration: "5-15 min", stakeholders: ["customer", "compliance"], services: ["aml", "rust-fraud-gate", "permify", "postgresql", "tigerbeetle", "dapr", "naicom", "fluvio", "lakehouse"] },
  { id: "J10", name: "Claim Dispute & Escalation", description: "Permify Check → AI Analysis → Senior Adjuster → NAICOM Escalation", category: "claims", estimatedDuration: "10-20 min", stakeholders: ["customer", "adjuster", "compliance"], services: ["permify", "ollama", "postgresql", "dapr", "naicom", "fluvio", "lakehouse"] },
  { id: "J11", name: "Broker Policy Management", description: "Permify → KYC → Multi-Policy TB → Broker Commission → Portfolio", category: "broker", estimatedDuration: "10-15 min", stakeholders: ["broker", "client", "underwriter"], services: ["permify", "python-kyc", "rust-fraud-gate", "postgresql", "tigerbeetle", "ollama", "fluvio", "lakehouse"] },
  { id: "J12", name: "Actuary IFRS17 Reserve Computation", description: "Permify → Python IFRS17 → AI Narrative → NAICOM Report → Lakehouse", category: "actuarial", estimatedDuration: "15-30 min", stakeholders: ["actuary", "finance", "compliance"], services: ["permify", "python-ifrs17", "ollama", "naicom", "dapr", "fluvio", "lakehouse"] },
  { id: "J13", name: "AML/Compliance Monitoring", description: "AML Screen → ML Score → AI Narrative → CBN/NAICOM Report → SAR", category: "compliance", estimatedDuration: "2-5 min", stakeholders: ["compliance", "finance"], services: ["aml", "python-ml", "ollama", "naicom", "fluvio", "lakehouse"] },
  { id: "J14", name: "POS Terminal Lifecycle", description: "Permify → Provision/OTA/Decommission → Dapr → Fluvio", category: "agent", estimatedDuration: "5-10 min", stakeholders: ["agent", "operations"], services: ["permify", "postgresql", "dapr", "ota-service", "fluvio", "lakehouse"] },
  { id: "J15", name: "Reinsurance Treaty Cession", description: "Permify → Calculate → AML → TB Transfer → NAICOM Report", category: "reinsurance", estimatedDuration: "10-20 min", stakeholders: ["reinsurance_mgr", "finance", "compliance"], services: ["permify", "postgresql", "aml", "tigerbeetle", "naicom", "fluvio", "lakehouse"] },
  { id: "J16", name: "Customer Self-Service", description: "Permify → Policy View/Certificate/Beneficiary → Fluvio", category: "customer", estimatedDuration: "1-3 min", stakeholders: ["customer"], services: ["permify", "postgresql", "dapr", "fluvio"] },
  { id: "J17", name: "Bulk Premium Payment Processing", description: "Permify → Per-Payment AML+Fraud → TB Batch → Reconciliation", category: "finance", estimatedDuration: "10-30 min", stakeholders: ["corporate", "finance"], services: ["permify", "aml", "rust-fraud-gate", "tigerbeetle", "fluvio", "lakehouse"] },
  { id: "J18", name: "Agent Float Reconciliation", description: "Go Reconciler → Discrepancy → Freeze/NAICOM → Lakehouse", category: "agent", estimatedDuration: "5-10 min", stakeholders: ["agent", "finance", "operations"], services: ["go-float-reconciler", "postgresql", "naicom", "fluvio", "lakehouse"] },
  { id: "J19", name: "Underwriting Decision", description: "KYC → AML → ML Risk → Underwriting → AI Narrative → Permify", category: "underwriting", estimatedDuration: "5-15 min", stakeholders: ["underwriter", "applicant"], services: ["python-kyc", "aml", "python-ml", "postgresql", "ollama", "permify", "fluvio", "lakehouse"] },
  { id: "J20", name: "Platform Health & SLA Monitoring", description: "Go Health Worker → SLA Metrics → Breach Alerts → Incident Filing", category: "operations", estimatedDuration: "1-2 min", stakeholders: ["operations", "management"], services: ["go-health-worker", "postgresql", "naicom", "dapr", "fluvio", "lakehouse"] },
] as const;

// ── Input schemas ─────────────────────────────────────────────────────────────
const J01Schema = z.object({ email: z.string().email(), phone: z.string().min(11), firstName: z.string().min(1), lastName: z.string().min(1), dateOfBirth: z.string(), nin: z.string().optional(), bvn: z.string().optional(), address: z.string().min(5), state: z.string().min(2), policyType: z.string(), sumInsured: z.number().positive(), premiumAmount: z.number().positive(), idempotencyKey: z.string().optional() });
const J02Schema = z.object({ customerId: z.number().positive(), productId: z.number().positive(), sumInsured: z.number().positive(), premiumAmount: z.number().positive(), durationMonths: z.number().min(1).max(120).default(12), paymentRef: z.string(), agentId: z.number().optional(), beneficiaryName: z.string().optional(), idempotencyKey: z.string().optional() });
// M-wave (W1, 2026-09-19): beneficiaryAccount/beneficiaryBank REMOVED from the
// trigger schema — settlement pays the beneficiary of record, never a
// caller-named account.
const J03Schema = z.object({ policyId: z.number().positive(), customerId: z.number().positive(), claimType: z.string(), incidentDate: z.string(), claimedAmount: z.number().positive(), description: z.string().min(10), agentId: z.number().optional(), paymentRef: z.string(), paymentMethod: z.string().optional(), idempotencyKey: z.string().optional() });
const J04Schema = z.object({ email: z.string().email(), phone: z.string().min(11), firstName: z.string(), lastName: z.string(), nin: z.string(), bvn: z.string(), agentType: z.enum(["individual", "corporate"]), state: z.string(), lga: z.string(), initialFloatAmount: z.number().positive(), idempotencyKey: z.string().optional() });
const J05Schema = z.object({ agentId: z.number().positive(), agentCode: z.string(), operationType: z.enum(["airtime", "bill_payment", "mobile_money", "premium_collection"]), amount: z.number().positive(), customerId: z.number().optional(), policyId: z.number().optional(), billType: z.string().optional(), phone: z.string().optional(), paymentRef: z.string(), idempotencyKey: z.string().optional() });
const J06Schema = z.object({ policyId: z.number().positive(), customerId: z.number().positive(), renewalType: z.enum(["standard", "enhanced", "reduced"]).default("standard"), newSumInsured: z.number().positive().optional(), idempotencyKey: z.string().optional() });
const J07Schema = z.object({ transactionId: z.number().positive(), agentId: z.number().positive(), amount: z.number().positive(), transactionType: z.string(), sourceIp: z.string().optional(), deviceId: z.string().optional(), idempotencyKey: z.string().optional() });
const J08Schema = z.object({ agentId: z.number().positive(), agentCode: z.string(), payoutPeriod: z.string(), paymentRef: z.string(), idempotencyKey: z.string().optional() });
const J09Schema = z.object({ senderId: z.number().positive(), senderName: z.string(), recipientName: z.string(), recipientAccount: z.string(), recipientBank: z.string(), recipientCountry: z.string(), sendAmount: z.number().positive(), sendCurrency: z.string().default("NGN"), receiveCurrency: z.string(), exchangeRate: z.number().positive(), receiveAmount: z.number().positive(), paymentRef: z.string(), channel: z.enum(["nibss", "swift", "mobile_money", "cash"]), idempotencyKey: z.string().optional() });
const J10Schema = z.object({ claimId: z.number().positive(), customerId: z.number().positive(), disputeReason: z.string().min(10), evidenceUrls: z.array(z.string()).optional(), requestedAmount: z.number().positive(), idempotencyKey: z.string().optional() });
const J11Schema = z.object({ brokerId: z.number().positive(), clientId: z.number().positive(), policyTypes: z.array(z.string()).min(1), sumInsureds: z.array(z.number().positive()).min(1), premiumAmounts: z.array(z.number().positive()).min(1), paymentRef: z.string(), idempotencyKey: z.string().optional() });
const J12Schema = z.object({ portfolioId: z.string(), reportingDate: z.string(), measurementModel: z.enum(["BBA", "PAA", "VFA"]), discountRate: z.number().optional(), idempotencyKey: z.string().optional() });
const J13Schema = z.object({ customerId: z.number().positive(), transactionId: z.number().positive(), amount: z.number().positive(), transactionType: z.string(), reference: z.string(), idempotencyKey: z.string().optional() });
const J14Schema = z.object({ agentId: z.number().positive(), agentCode: z.string(), action: z.enum(["provision", "update_firmware", "decommission", "health_check"]), terminalId: z.string().optional(), firmwareVersion: z.string().optional(), idempotencyKey: z.string().optional() });
const J15Schema = z.object({ treatyId: z.number().positive(), portfolioId: z.string(), cessionPercentage: z.number().min(0).max(100), premiumAmount: z.number().positive(), paymentRef: z.string(), idempotencyKey: z.string().optional() });
const J16Schema = z.object({ customerId: z.number().positive(), action: z.enum(["view_policies", "download_certificate", "update_beneficiary", "check_claim_status"]), policyId: z.number().optional(), claimId: z.number().optional(), beneficiaryName: z.string().optional(), beneficiaryRelationship: z.string().optional(), idempotencyKey: z.string().optional() });
const J17Schema = z.object({ corporateId: z.number().positive(), payments: z.array(z.object({ customerId: z.number(), policyId: z.number(), amount: z.number().positive(), reference: z.string() })).min(1), batchRef: z.string(), idempotencyKey: z.string().optional() });
const J18Schema = z.object({ agentId: z.number().positive(), agentCode: z.string(), date: z.string().optional(), idempotencyKey: z.string().optional() });
const J19Schema = z.object({ customerId: z.number().positive(), productId: z.number().positive(), sumInsured: z.number().positive(), premiumAmount: z.number().positive(), applicationData: z.record(z.string(), z.unknown()).default({}), agentId: z.number().optional(), idempotencyKey: z.string().optional() });
const J20Schema = z.object({ services: z.array(z.string()).optional(), slaThresholdMs: z.number().optional(), idempotencyKey: z.string().optional() });

// ── Helper: start a journey workflow ─────────────────────────────────────────
// N-wave (2026-09-19): trusted journey-input fields (triggeredBy /
// authenticatedUserRole) are derived from the authenticated session and
// injected SERVER-SIDE at workflow start; caller-forged copies are stripped
// first (journeyTriggerPolicy). buildTenantContext consumes ONLY these.
async function startJourneyWorkflow(
  journeyId: string,
  workflowType: string,
  input: unknown,
  userId: number,
  userRole: string,
  idempotencyKey?: string
): Promise<{ workflowId: string; runId: string; executionDbId?: number }> {
  const d = await getDb();

  // Idempotency check — prevent duplicate triggers
  if (idempotencyKey && d) {
    const existing = await d.select()
      .from(journeyExecutions)
      .where(eq(journeyExecutions.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing.length > 0) {
      return {
        workflowId: existing[0].workflowId,
        runId: existing[0].runId ?? "",
        executionDbId: existing[0].id,
      };
    }
  }

  const temporal = await getTemporalClient();
      if (!temporal) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Temporal client unavailable" });
  const workflowId = `${journeyId}-${Date.now()}-u${userId}`;

  const handle = await temporal.workflow.start(workflowType, {
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "insureportal-journeys",
    workflowId,
    args: [{
      ...stripForgedTrustedFields(input),
      triggeredBy: userId,
      authenticatedUserRole: userRole,
      idempotencyKey,
    }],
  });

  return { workflowId, runId: handle.firstExecutionRunId };
}

// ── Helper: get workflow status from Temporal ─────────────────────────────────
async function getWorkflowStatus(workflowId: string) {
  try {
    const temporal = await getTemporalClient();
      if (!temporal) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Temporal client unavailable" });
    const handle = temporal.workflow.getHandle(workflowId);
    const desc = await handle.describe();
    let currentStep = "unknown";
    try { currentStep = await handle.query("currentStep"); } catch {}
    return {
      workflowId,
      status: desc.status.name,
      currentStep,
      startTime: desc.startTime,
      closeTime: desc.closeTime,
    };
  } catch (e: unknown) {
    const err = e as Error;
    throw new TRPCError({ code: "NOT_FOUND", message: `Workflow ${workflowId} not found: ${err.message}` });
  }
}

// ── Router ────────────────────────────────────────────────────────────────────
export const insuranceJourneyOrchestratorV2Router = router({

  // ── Metadata ────────────────────────────────────────────────────────────────
  getDefinitions: protectedProcedure.query(() => JOURNEY_DEFINITIONS),

  // ── Status & History ────────────────────────────────────────────────────────
  getStatus: protectedProcedure
    .input(z.object({ workflowId: z.string() }))
    .query(async ({ input }) => getWorkflowStatus(input.workflowId)),

  getExecutionHistory: protectedProcedure
    .input(z.object({ workflowId: z.string() }))
    .query(async ({ input }) => {
      const d = await getDb();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const execution = await d.select().from(journeyExecutions)
        .where(eq(journeyExecutions.workflowId, input.workflowId))
        .limit(1);

      if (!execution.length) throw new TRPCError({ code: "NOT_FOUND", message: "Execution not found" });

      const steps = await d.select().from(journeyStepEvents)
        .where(eq(journeyStepEvents.executionId, execution[0].id))
        .orderBy(journeyStepEvents.recordedAt);

      return { execution: execution[0], steps };
    }),

  listExecutions: protectedProcedure
    .input(z.object({
      journeyId: z.string().optional(),
      status: z.enum(["running", "completed", "failed", "cancelled", "timed_out"]).optional(),
      triggeredBy: z.number().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input, ctx }) => {
      const d = await getDb();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [];
      if (input.journeyId) conditions.push(eq(journeyExecutions.journeyId, input.journeyId));
      if (input.status) conditions.push(eq(journeyExecutions.status, input.status));
      if (input.triggeredBy) conditions.push(eq(journeyExecutions.triggeredBy, input.triggeredBy));
      if (input.from) conditions.push(gte(journeyExecutions.startedAt, new Date(input.from)));
      if (input.to) conditions.push(lte(journeyExecutions.startedAt, new Date(input.to)));

      const [executions, totalRow] = await Promise.all([
        d.select().from(journeyExecutions)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(journeyExecutions.startedAt))
          .limit(input.limit)
          .offset(input.offset),
        d.select({ count: sql<number>`COUNT(*)` }).from(journeyExecutions)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
      ]);

      return {
        executions,
        total: totalRow[0]?.count ?? 0,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  // ── Cancel ──────────────────────────────────────────────────────────────────
  cancel: protectedProcedure
    .input(z.object({ workflowId: z.string(), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const temporal = await getTemporalClient();
      if (!temporal) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Temporal client unavailable" });
      const handle = temporal.workflow.getHandle(input.workflowId);
      await handle.cancel();

      // Update DB status
      const d = await getDb();
      if (d) {
        await d.update(journeyExecutions)
          .set({ status: "cancelled", completedAt: new Date(), currentStep: "cancelled" })
          .where(eq(journeyExecutions.workflowId, input.workflowId));
      }

      return { success: true, workflowId: input.workflowId };
    }),

  // ── Signal (approve a step) ──────────────────────────────────────────────────
  approveStep: protectedProcedure
    .input(z.object({ workflowId: z.string(), stepId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const temporal = await getTemporalClient();
      if (!temporal) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Temporal client unavailable" });
      const handle = temporal.workflow.getHandle(input.workflowId);
      await handle.signal("approveStep", { stepId: input.stepId, approvedBy: ctx.user.id });
      return { success: true };
    }),

  // ── Schedules ───────────────────────────────────────────────────────────────
  createSchedule: adminProcedure
    .input(z.object({
      journeyId: z.enum(["J01","J02","J03","J04","J05","J06","J07","J08","J09","J10","J11","J12","J13","J14","J15","J16","J17","J18","J19","J20"]),
      cronExpression: z.string().optional(),
      intervalMs: z.number().optional(),
      inputTemplate: z.record(z.string(), z.unknown()),
    }))
    .mutation(async ({ input, ctx }) => {
      const d = await getDb();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const scheduleId = `sched-${input.journeyId}-${Date.now()}`;

      await d.insert(journeySchedules).values({
        journeyId: input.journeyId,
        scheduleId,
        cronExpression: input.cronExpression,
        intervalMs: input.intervalMs,
        inputTemplate: input.inputTemplate,
        createdBy: ctx.user.id,
        enabled: true,
      });

      return { success: true, scheduleId };
    }),

  listSchedules: protectedProcedure
    .input(z.object({ journeyId: z.string().optional() }))
    .query(async ({ input }) => {
      const d = await getDb();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const schedules = await d.select().from(journeySchedules)
        .where(input.journeyId ? eq(journeySchedules.journeyId, input.journeyId) : undefined)
        .orderBy(desc(journeySchedules.createdAt));

      return schedules;
    }),

  toggleSchedule: adminProcedure
    .input(z.object({ scheduleId: z.string(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const d = await getDb();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await d.update(journeySchedules)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(eq(journeySchedules.scheduleId, input.scheduleId));

      return { success: true };
    }),

  // ── Analytics ───────────────────────────────────────────────────────────────
  getAnalytics: protectedProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(30) }))
    .query(async ({ input }) => {
      const d = await getDb();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      const [byJourney, byStatus, avgDuration] = await Promise.all([
        d.select({
          journeyId: journeyExecutions.journeyId,
          journeyName: journeyExecutions.journeyName,
          count: sql<number>`COUNT(*)`,
          successCount: sql<number>`COUNT(*) FILTER (WHERE status = 'completed')`,
          failureCount: sql<number>`COUNT(*) FILTER (WHERE status = 'failed')`,
        }).from(journeyExecutions)
          .where(gte(journeyExecutions.startedAt, since))
          .groupBy(journeyExecutions.journeyId, journeyExecutions.journeyName)
          .orderBy(desc(sql`COUNT(*)`)),
        d.select({
          status: journeyExecutions.status,
          count: sql<number>`COUNT(*)`,
        }).from(journeyExecutions)
          .where(gte(journeyExecutions.startedAt, since))
          .groupBy(journeyExecutions.status),
        d.select({
          journeyId: journeyExecutions.journeyId,
          avgDurationMs: sql<number>`AVG(duration_ms)`,
        }).from(journeyExecutions)
          .where(and(gte(journeyExecutions.startedAt, since), eq(journeyExecutions.status, "completed")))
          .groupBy(journeyExecutions.journeyId),
      ]);

      return { byJourney, byStatus, avgDuration, period: `${input.days} days` };
    }),

  // ── Generic trigger ──────────────────────────────────────────────────────────
  trigger: protectedProcedure
    .input(z.object({
      journeyId: z.enum(["J01","J02","J03","J04","J05","J06","J07","J08","J09","J10","J11","J12","J13","J14","J15","J16","J17","J18","J19","J20"]),
      input: z.record(z.string(), z.unknown()),
      idempotencyKey: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const workflowTypeMap: Record<string, string> = {
        J01: "J01_CustomerOnboardingWorkflow", J02: "J02_PolicyPurchaseWorkflow",
        J03: "J03_ClaimsSettlementWorkflow", J04: "J04_AgentOnboardingWorkflow",
        J05: "J05_AgentDailyOpsWorkflow", J06: "J06_PolicyRenewalWorkflow",
        J07: "J07_FraudResponseWorkflow", J08: "J08_CommissionPayoutWorkflow",
        J09: "J09_RemittanceWorkflow", J10: "J10_ClaimDisputeWorkflow",
        J11: "J11_BrokerPolicyManagementWorkflow", J12: "J12_ActuaryIfrs17Workflow",
        J13: "J13_ComplianceMonitoringWorkflow", J14: "J14_PosTerminalLifecycleWorkflow",
        J15: "J15_ReinsuranceCessionWorkflow", J16: "J16_CustomerSelfServiceWorkflow",
        J17: "J17_BulkPremiumPaymentWorkflow", J18: "J18_AgentFloatReconciliationWorkflow",
        J19: "J19_UnderwritingDecisionWorkflow", J20: "J20_PlatformHealthMonitoringWorkflow",
      };
      const workflowType = workflowTypeMap[input.journeyId];
      // M-wave (W1, 2026-09-19): the generic trigger must not bypass the J03
      // ownership/coverage guard or smuggle staff context / settlement
      // destinations into workflows. J03 is only startable via triggerJ03;
      // initiatedByStaff is computed server-side; beneficiary fields stripped.
      if (input.journeyId === "J03") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "J03 (claims settlement) must be started via triggerJ03 — it enforces ownership, coverage and staff-routing validation",
        });
      }
      // N-wave (2026-09-19): the same staff-context smuggle applies to the
      // other journeys — sanitizeGenericJourneyInput also strips staff
      // context and caller-chosen tenant identity for ALL journey types
      // (fail-closed). Tenant identity for the Permify check is
      // session-derived (journey-tenant-guard.ts).
      const sanitizedInput = sanitizeGenericJourneyInput(input.input, isStaffCaller(ctx));
      const { workflowId, runId } = await startJourneyWorkflow(input.journeyId, workflowType, sanitizedInput, ctx.user.id, ctx.user.role, input.idempotencyKey);
      const def = JOURNEY_DEFINITIONS.find(d => d.id === input.journeyId);
      return { success: true, workflowId, runId, journeyId: input.journeyId, message: `${def?.name ?? input.journeyId} journey started` };
    }),

  // ── Individual journey triggers ───────────────────────────────────────────
  triggerJ01: protectedProcedure.input(J01Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J01", "J01_CustomerOnboardingWorkflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J01" };
  }),
  triggerJ02: protectedProcedure.input(J02Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J02", "J02_PolicyPurchaseWorkflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J02" };
  }),
  triggerJ03: protectedProcedure.input(J03Schema).mutation(async ({ input, ctx }) => {
    // INS-2/23: validate the incident date against the REAL policy period
    // before starting the claims journey workflow.
    await assertClaimIncidentValid(input.policyId, input.incidentDate);
    // M-wave (W1, 2026-09-19): session-derived ownership + server-side
    // coverage validation; staff on-behalf is audited. beneficiaryAccount is
    // not accepted (beneficiary of record pays out).
    const { customerId, initiatedByStaff } = await validateJ03Trigger(ctx, input);
    const journeyInput = { ...input, customerId, initiatedByStaff };
    const { workflowId, runId } = await startJourneyWorkflow("J03", "J03_ClaimsSettlementWorkflow", journeyInput, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J03" };
  }),
  triggerJ04: protectedProcedure.input(J04Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J04", "J04_AgentOnboardingWorkflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J04" };
  }),
  triggerJ05: protectedProcedure.input(J05Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J05", "J05_AgentDailyOpsWorkflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J05" };
  }),
  triggerJ06: protectedProcedure.input(J06Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J06", "J06_PolicyRenewalWorkflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J06" };
  }),
  triggerJ07: protectedProcedure.input(J07Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J07", "J07_FraudResponseWorkflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J07" };
  }),
  triggerJ08: protectedProcedure.input(J08Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J08", "J08_CommissionPayoutWorkflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J08" };
  }),
  triggerJ09: protectedProcedure.input(J09Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J09", "J09_RemittanceWorkflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J09" };
  }),
  triggerJ10: protectedProcedure.input(J10Schema).mutation(async ({ input, ctx }) => {
    // M-wave (W1, 2026-09-19): propagate the server-computed staff flag — the
    // J10 adjuster-assignment activity is staff-context-gated.
    const { workflowId, runId } = await startJourneyWorkflow("J10", "J10_ClaimDisputeWorkflow", { ...input, initiatedByStaff: isStaffCaller(ctx) }, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J10" };
  }),
  triggerJ11: protectedProcedure.input(J11Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J11", "J11_BrokerPolicyManagementWorkflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J11" };
  }),
  triggerJ12: protectedProcedure.input(J12Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J12", "J12_ActuaryIfrs17Workflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J12" };
  }),
  triggerJ13: protectedProcedure.input(J13Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J13", "J13_ComplianceMonitoringWorkflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J13" };
  }),
  triggerJ14: protectedProcedure.input(J14Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J14", "J14_PosTerminalLifecycleWorkflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J14" };
  }),
  triggerJ15: protectedProcedure.input(J15Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J15", "J15_ReinsuranceCessionWorkflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J15" };
  }),
  triggerJ16: protectedProcedure.input(J16Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J16", "J16_CustomerSelfServiceWorkflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J16" };
  }),
  triggerJ17: protectedProcedure.input(J17Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J17", "J17_BulkPremiumPaymentWorkflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J17" };
  }),
  triggerJ18: protectedProcedure.input(J18Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J18", "J18_AgentFloatReconciliationWorkflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J18" };
  }),
  triggerJ19: protectedProcedure.input(J19Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J19", "J19_UnderwritingDecisionWorkflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J19" };
  }),
  triggerJ20: protectedProcedure.input(J20Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J20", "J20_PlatformHealthMonitoringWorkflow", input, ctx.user.id, ctx.user.role, input.idempotencyKey);
    return { success: true, workflowId, runId, journeyId: "J20" };
  }),
});
