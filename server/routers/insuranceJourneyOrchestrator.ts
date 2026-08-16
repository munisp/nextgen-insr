/**
 * Insurance Journey Orchestrator — tRPC Router
 *
 * Exposes all 20 reusable insurance stakeholder journeys via tRPC.
 * Each journey is a Temporal workflow — reusable, saga-compensated, idempotent.
 * Journeys can be triggered from any frontend page or API client.
 *
 * Endpoints:
 *   - trigger: Start a journey workflow
 *   - status: Get current journey status
 *   - list: List all journey executions
 *   - cancel: Cancel a running journey
 *   - getDefinitions: Get all 20 journey definitions
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { getTemporalClient } from "../temporal";
import { eq, desc, and, sql } from "drizzle-orm";

// Journey input schemas
const J01Schema = z.object({
  customerId: z.number().optional(),
  email: z.string().email(),
  phone: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.string(),
  nin: z.string().optional(),
  bvn: z.string().optional(),
  address: z.string(),
  state: z.string(),
  policyType: z.string(),
  sumInsured: z.number().positive(),
  premiumAmount: z.number().positive(),
});

const J02Schema = z.object({
  customerId: z.number().positive(),
  policyType: z.string(),
  sumInsured: z.number().positive(),
  premiumAmount: z.number().positive(),
  startDate: z.string(),
  endDate: z.string(),
  paymentMethod: z.enum(["card", "bank_transfer", "ussd", "mobile_money"]).default("bank_transfer"),
});

const J03Schema = z.object({
  policyId: z.number().positive(),
  customerId: z.number().positive(),
  claimType: z.string(),
  incidentDate: z.string(),
  claimAmount: z.number().positive(),
  description: z.string(),
  evidenceUrls: z.array(z.string()).optional(),
  witnessCount: z.number().default(0),
  policeReportNumber: z.string().optional(),
});

const J04Schema = z.object({
  email: z.string().email(),
  phone: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  nin: z.string(),
  bvn: z.string(),
  agentType: z.enum(["individual", "corporate"]),
  state: z.string(),
  lga: z.string(),
  initialFloatAmount: z.number().positive(),
});

const J05Schema = z.object({
  agentId: z.number().positive(),
  agentCode: z.string(),
  operationType: z.enum(["airtime", "bill_payment", "mobile_money", "premium_collection"]),
  amount: z.number().positive(),
  customerId: z.number().optional(),
  policyId: z.number().optional(),
  billType: z.string().optional(),
  phone: z.string().optional(),
});

const J06Schema = z.object({
  policyId: z.number().positive(),
  customerId: z.number().positive(),
  renewalType: z.enum(["standard", "enhanced", "reduced"]).default("standard"),
  newSumInsured: z.number().positive().optional(),
});

const J07Schema = z.object({
  transactionId: z.number().positive(),
  agentId: z.number().positive(),
  amount: z.number().positive(),
  transactionType: z.string(),
  sourceIp: z.string().optional(),
  deviceId: z.string().optional(),
});

const J08Schema = z.object({
  agentId: z.number().positive(),
  periodStart: z.string(),
  periodEnd: z.string(),
  commissionType: z.enum(["policy_sale", "renewal", "claim_referral"]).default("policy_sale"),
});

const J09Schema = z.object({
  senderId: z.number().positive(),
  senderPhone: z.string(),
  recipientName: z.string(),
  recipientPhone: z.string(),
  recipientCountry: z.string(),
  amount: z.number().positive(),
  currency: z.string().default("NGN"),
  targetCurrency: z.string(),
  purpose: z.string().default("family_support"),
});

const J10Schema = z.object({
  claimId: z.number().positive(),
  customerId: z.number().positive(),
  disputeReason: z.string(),
  requestedAmount: z.number().positive(),
  evidenceUrls: z.array(z.string()).optional(),
  escalationLevel: z.enum(["supervisor", "manager", "executive", "naicom"]).optional(),
});

const J11Schema = z.object({
  brokerId: z.number().positive(),
  clientId: z.number().positive(),
  policies: z.array(z.object({
    policyType: z.string(),
    sumInsured: z.number().positive(),
    premiumAmount: z.number().positive(),
    startDate: z.string(),
    endDate: z.string(),
  })),
  commissionRate: z.number().min(0).max(100),
});

const J12Schema = z.object({
  actuaryId: z.number().positive(),
  reportingDate: z.string(),
  portfolios: z.array(z.object({
    policyType: z.string(),
    measurementModel: z.enum(["BBA", "PAA"]),
  })),
  currency: z.string().default("NGN"),
});

const J13Schema = z.object({
  entityType: z.enum(["customer", "agent", "transaction"]),
  entityId: z.number().positive(),
  amount: z.number().nonnegative(),
  transactionType: z.string(),
  complianceOfficerId: z.number().positive(),
  reportingPeriod: z.string().optional(),
});

const J14Schema = z.object({
  agentId: z.number().positive(),
  terminalSerialNumber: z.string(),
  action: z.enum(["provision", "deploy", "ota_update", "decommission"]),
  firmwareVersion: z.string().optional(),
  location: z.object({ lat: z.number(), lng: z.number(), address: z.string() }).optional(),
});

const J15Schema = z.object({
  reinsurerCode: z.string(),
  treatyType: z.enum(["proportional", "excess_of_loss", "quota_share"]),
  portfolioType: z.string(),
  exposureAmount: z.number().positive(),
  retentionLimit: z.number().positive(),
  cedingPremium: z.number().positive(),
  periodStart: z.string(),
  periodEnd: z.string(),
});

const J16Schema = z.object({
  customerId: z.number().positive(),
  action: z.enum(["view_policies", "download_certificate", "check_claim_status", "update_beneficiary"]),
  policyId: z.number().optional(),
  claimId: z.number().optional(),
  beneficiaryData: z.object({ name: z.string(), relationship: z.string(), percentage: z.number() }).optional(),
});

const J17Schema = z.object({
  batchId: z.string(),
  uploadedBy: z.number().positive(),
  payments: z.array(z.object({
    customerId: z.number().positive(),
    policyId: z.number().positive(),
    policyType: z.string(),
    premiumAmount: z.number().positive(),
    paymentRef: z.string(),
  })),
});

const J18Schema = z.object({
  agentId: z.number().positive(),
  agentCode: z.string(),
  reconciliationDate: z.string(),
  expectedBalance: z.number().nonnegative(),
  supervisorId: z.number().positive(),
});

const J19Schema = z.object({
  applicationId: z.number().positive(),
  customerId: z.number().positive(),
  policyType: z.string(),
  sumInsured: z.number().positive(),
  riskFactors: z.record(z.string(), z.unknown()).default({}),
  underwriterId: z.number().positive(),
  autoBindThreshold: z.number().min(0).max(100).optional(),
});

const J20Schema = z.object({
  triggeredBy: z.enum(["scheduler", "manual", "alert"]).default("manual"),
  operatorId: z.number().optional(),
  services: z.array(z.string()).optional(),
});

// Journey definitions for the frontend
const JOURNEY_DEFINITIONS = [
  { id: "J01", name: "New Customer Onboarding", description: "KYC → Policy Quote → Bind → Premium Payment → Welcome", category: "customer", estimatedDuration: "5-10 min" },
  { id: "J02", name: "Insurance Policy Purchase", description: "Browse → Quote → Underwriting → Bind → TigerBeetle Ledger", category: "policy", estimatedDuration: "3-5 min" },
  { id: "J03", name: "Claims Filing & Settlement", description: "FNOL → Adjuster → AI Fraud Check → Approval → Payout", category: "claims", estimatedDuration: "10-30 min" },
  { id: "J04", name: "Agent Onboarding & Activation", description: "Registration → KYC → Float Top-up → Terminal → First Transaction", category: "agent", estimatedDuration: "15-20 min" },
  { id: "J05", name: "Agent Daily Operations", description: "Login → Float Check → Transactions → Settlement", category: "agent", estimatedDuration: "1-3 min" },
  { id: "J06", name: "Policy Renewal", description: "Expiry Detection → Quote → Payment → Renewal Binding", category: "policy", estimatedDuration: "3-5 min" },
  { id: "J07", name: "Fraud Detection & Response", description: "Transaction → AI Scoring → Alert → Freeze → Investigation", category: "fraud", estimatedDuration: "1-2 min" },
  { id: "J08", name: "Commission Payout", description: "Earn → Accumulate → Request → Approve → TigerBeetle Transfer", category: "finance", estimatedDuration: "5-10 min" },
  { id: "J09", name: "Cross-Border Remittance", description: "FX Quote → Compliance → TigerBeetle Debit → NIBSS/SWIFT → Credit", category: "finance", estimatedDuration: "5-15 min" },
  { id: "J10", name: "Claim Dispute & Escalation", description: "Dispute → Evidence → AI Analysis → Escalation → Resolution", category: "claims", estimatedDuration: "10-20 min" },
  { id: "J11", name: "Broker Policy Management", description: "Client Onboarding → Multi-Policy → Renewal Tracking → Commission", category: "broker", estimatedDuration: "10-15 min" },
  { id: "J12", name: "Actuary IFRS17 Reserve Computation", description: "Data Pull → BBA/PAA Calculation → Reserve Posting → NAICOM Report", category: "actuarial", estimatedDuration: "15-30 min" },
  { id: "J13", name: "AML/Compliance Monitoring", description: "Transaction Screening → SAR Filing → CBN/NAICOM Reporting", category: "compliance", estimatedDuration: "2-5 min" },
  { id: "J14", name: "POS Terminal Lifecycle", description: "Procurement → Provisioning → Deployment → Monitoring → OTA Update", category: "agent", estimatedDuration: "5-10 min" },
  { id: "J15", name: "Reinsurance Treaty Cession", description: "Exposure Calculation → Cession → Premium Transfer → Recovery", category: "reinsurance", estimatedDuration: "10-20 min" },
  { id: "J16", name: "Customer Self-Service", description: "Portal Login → Policy View → Document Download → Claim Status", category: "customer", estimatedDuration: "1-3 min" },
  { id: "J17", name: "Bulk Premium Payment Processing", description: "Upload → Validation → TigerBeetle Batch → Reconciliation", category: "finance", estimatedDuration: "10-30 min" },
  { id: "J18", name: "Agent Float Reconciliation", description: "End-of-Day → TB Sync → Discrepancy Detection → Resolution", category: "agent", estimatedDuration: "5-10 min" },
  { id: "J19", name: "Underwriting Decision", description: "Application → AI Risk Score → Actuarial Review → Accept/Decline → Bind", category: "underwriting", estimatedDuration: "5-15 min" },
  { id: "J20", name: "Platform Health & SLA Monitoring", description: "Health Probes → SLA Breach Detection → Incident → Resolution", category: "platform", estimatedDuration: "1-2 min" },
];

async function startJourneyWorkflow(journeyId: string, workflowType: string, input: unknown, userId: number) {
  const temporal = await getTemporalClient();
      if (!temporal) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Temporal client unavailable" });
  const workflowId = `${journeyId}-${Date.now()}-user${userId}`;

  const handle = await temporal.workflow.start(workflowType, {
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "insureportal-journeys",
    workflowId,
    args: [input],
  });

  return { workflowId, runId: handle.firstExecutionRunId };
}

async function getWorkflowStatus(workflowId: string) {
  try {
    const temporal = await getTemporalClient();
      if (!temporal) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Temporal client unavailable" });
    const handle = temporal.workflow.getHandle(workflowId);
    const desc = await handle.describe();
    let currentStep = "unknown";
    try {
      currentStep = await handle.query("currentStep");
    } catch {}
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

export const insuranceJourneyOrchestratorRouter = router({
  // Get all journey definitions
  getDefinitions: protectedProcedure.query(() => {
    return JOURNEY_DEFINITIONS;
  }),

  // Get journey status
  getStatus: protectedProcedure
    .input(z.object({ workflowId: z.string() }))
    .query(async ({ input }) => {
      return getWorkflowStatus(input.workflowId);
    }),

  // List recent journey executions
  listExecutions: protectedProcedure
    .input(z.object({
      journeyId: z.string().optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      // In production: query Temporal's visibility store
      // For now: return empty list (Temporal UI provides full visibility)
      return { executions: [], total: 0, limit: input.limit, offset: input.offset };
    }),

  // ── Journey Triggers ──────────────────────────────────────────────────────

  triggerJ01: protectedProcedure.input(J01Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J01", "J01_CustomerOnboardingWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J01", message: "Customer onboarding journey started" };
  }),

  triggerJ02: protectedProcedure.input(J02Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J02", "J02_PolicyPurchaseWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J02", message: "Policy purchase journey started" };
  }),

  triggerJ03: protectedProcedure.input(J03Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J03", "J03_ClaimsSettlementWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J03", message: "Claims settlement journey started" };
  }),

  triggerJ04: protectedProcedure.input(J04Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J04", "J04_AgentOnboardingWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J04", message: "Agent onboarding journey started" };
  }),

  triggerJ05: protectedProcedure.input(J05Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J05", "J05_AgentDailyOpsWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J05", message: "Agent daily ops journey started" };
  }),

  triggerJ06: protectedProcedure.input(J06Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J06", "J06_PolicyRenewalWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J06", message: "Policy renewal journey started" };
  }),

  triggerJ07: protectedProcedure.input(J07Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J07", "J07_FraudResponseWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J07", message: "Fraud response journey started" };
  }),

  triggerJ08: protectedProcedure.input(J08Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J08", "J08_CommissionPayoutWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J08", message: "Commission payout journey started" };
  }),

  triggerJ09: protectedProcedure.input(J09Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J09", "J09_RemittanceWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J09", message: "Remittance journey started" };
  }),

  triggerJ10: protectedProcedure.input(J10Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J10", "J10_ClaimDisputeWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J10", message: "Claim dispute journey started" };
  }),

  triggerJ11: protectedProcedure.input(J11Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J11", "J11_BrokerPolicyManagementWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J11", message: "Broker policy management journey started" };
  }),

  triggerJ12: protectedProcedure.input(J12Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J12", "J12_ActuaryIfrs17Workflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J12", message: "IFRS17 computation journey started" };
  }),

  triggerJ13: protectedProcedure.input(J13Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J13", "J13_ComplianceMonitoringWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J13", message: "Compliance monitoring journey started" };
  }),

  triggerJ14: protectedProcedure.input(J14Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J14", "J14_PosTerminalLifecycleWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J14", message: "POS terminal lifecycle journey started" };
  }),

  triggerJ15: protectedProcedure.input(J15Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J15", "J15_ReinsuranceCessionWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J15", message: "Reinsurance cession journey started" };
  }),

  triggerJ16: protectedProcedure.input(J16Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J16", "J16_CustomerSelfServiceWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J16", message: "Customer self-service journey started" };
  }),

  triggerJ17: protectedProcedure.input(J17Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J17", "J17_BulkPremiumPaymentWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J17", message: "Bulk payment journey started" };
  }),

  triggerJ18: protectedProcedure.input(J18Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J18", "J18_AgentFloatReconciliationWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J18", message: "Float reconciliation journey started" };
  }),

  triggerJ19: protectedProcedure.input(J19Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J19", "J19_UnderwritingDecisionWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J19", message: "Underwriting decision journey started" };
  }),

  triggerJ20: protectedProcedure.input(J20Schema).mutation(async ({ input, ctx }) => {
    const { workflowId, runId } = await startJourneyWorkflow("J20", "J20_PlatformHealthMonitoringWorkflow", input, ctx.user.id);
    return { success: true, workflowId, runId, journeyId: "J20", message: "Platform health monitoring journey started" };
  }),

  // Generic trigger by journey ID
  trigger: protectedProcedure
    .input(z.object({
      journeyId: z.enum(["J01","J02","J03","J04","J05","J06","J07","J08","J09","J10","J11","J12","J13","J14","J15","J16","J17","J18","J19","J20"]),
      input: z.record(z.string(), z.unknown()),
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
      const { workflowId, runId } = await startJourneyWorkflow(input.journeyId, workflowType, input.input, ctx.user.id);
      const def = JOURNEY_DEFINITIONS.find(d => d.id === input.journeyId);
      return { success: true, workflowId, runId, journeyId: input.journeyId, message: `${def?.name ?? input.journeyId} journey started` };
    }),
});
