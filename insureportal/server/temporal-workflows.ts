/**
 * InsurePortal — Temporal Workflow Definitions
 *
 * Loaded by server/temporal-worker.ts via `workflowsPath` (resolved as
 * `<server>/temporal-workflows`) and bundled into the Temporal workflow
 * sandbox at Worker.create() time. These functions run inside the sandbox:
 * no direct I/O is permitted here — all I/O is delegated to the activities
 * registered by the worker from ./temporal-activities.
 *
 * Provenance / deltas vs the main-repo server/temporal-workflows.ts:
 * The main-repo file cannot be ported byte-exact because it orchestrates
 * activities that this portal worker does NOT register:
 *   - SettlementWorkflow / FloatReplenishmentWorkflow /
 *     BillingProvisioningWorkflow reference settlement, float, and billing
 *     activities (fetchUnsettledTransactions, executeSettlementTransfers,
 *     checkAgentFloatBalance, validateTenantForBilling, …) that exist only in
 *     the main repo's 523-line server/temporal-activities.ts.
 *   - InsurancePolicyBindingWorkflow imports ./journey-activities (2035
 *     lines), which was never ported to insureportal.
 * Referencing unregistered activities would compile but fail at runtime
 * ("Activity function X is not registered"), so those workflows are
 * deliberately omitted rather than shipped as broken placeholders.
 *
 * What IS defined here is the set the portal's worker can actually execute —
 * every activity proxied below is a real export of ./temporal-activities
 * (compile-time enforced by `proxyActivities<typeof activities>`), matching
 * the original Sprint 3 port intent ("insurance workflow definitions:
 * policy lifecycle, claims, renewals" — commit f74d7df).
 */
import { proxyActivities, log, workflowInfo } from "@temporalio/workflow";

import type * as activities from "./temporal-activities";

// ── Activity proxies ──────────────────────────────────────────────────────────
// Type-parameterised against the worker's registered activities module, so a
// typo or a removed activity is a compile error, not a runtime surprise.
const {
  sendPolicyIssuanceEmail,
  triggerUnderwritingReview,
  processClaimPayment,
  sendClaimNotification,
  runActuarialReserveCalc,
  generateRegulatoryReport,
  syncToLakehouse,
  processReinsuranceCession,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "1s",
    backoffCoefficient: 2,
    maximumInterval: "30s",
  },
});

// ── Policy Issuance Workflow ──────────────────────────────────────────────────
// Policy lifecycle: underwriting review must complete before the issuance
// email is sent. Sequential awaits make that ordering durable; if the review
// activity exhausts its retries the workflow fails and NO issuance email is
// ever sent (fail-closed for customer-facing notifications).
export interface PolicyIssuanceInput {
  policyId: number;
}

export async function PolicyIssuanceWorkflow(
  input: PolicyIssuanceInput
): Promise<{ policyId: number; underwritten: boolean; notified: boolean }> {
  const { workflowId } = workflowInfo();
  log.info("Policy issuance started", { workflowId, policyId: input.policyId });

  await triggerUnderwritingReview(input.policyId);
  await sendPolicyIssuanceEmail(input.policyId);

  log.info("Policy issuance completed", { workflowId, policyId: input.policyId });
  return { policyId: input.policyId, underwritten: true, notified: true };
}

// ── Claim Settlement Workflow ─────────────────────────────────────────────────
// Claims: the payment is executed first and the claimant is notified only
// after the payment activity succeeds. If payment fails, the workflow throws
// before any notification — a claimant is never told "paid" for a payment
// that did not happen (fail-closed for funds).
export interface ClaimSettlementInput {
  claimId: number;
  /** Major currency units as a decimal string, e.g. "12500.00". */
  amount: string;
}

export async function ClaimSettlementWorkflow(
  input: ClaimSettlementInput
): Promise<{ claimId: number; paid: boolean; notified: boolean }> {
  const { workflowId } = workflowInfo();
  log.info("Claim settlement started", { workflowId, claimId: input.claimId });

  await processClaimPayment(input.claimId, input.amount);
  await sendClaimNotification(input.claimId, "paid");

  log.info("Claim settlement completed", { workflowId, claimId: input.claimId });
  return { claimId: input.claimId, paid: true, notified: true };
}

// ── Actuarial Reserve Calculation Workflow ────────────────────────────────────
export interface ActuarialReserveInput {
  tenantId: number;
}

export async function ActuarialReserveWorkflow(
  input: ActuarialReserveInput
): Promise<{ tenantId: number; calculated: boolean }> {
  const { workflowId } = workflowInfo();
  log.info("Actuarial reserve calc started", { workflowId, tenantId: input.tenantId });

  await runActuarialReserveCalc(input.tenantId);

  return { tenantId: input.tenantId, calculated: true };
}

// ── Regulatory Reporting Workflow ─────────────────────────────────────────────
export interface RegulatoryReportingInput {
  tenantId: number;
  /** Reporting period, e.g. "2026-Q3". */
  period: string;
}

export async function RegulatoryReportingWorkflow(
  input: RegulatoryReportingInput
): Promise<{ tenantId: number; period: string; generated: boolean }> {
  const { workflowId } = workflowInfo();
  log.info("Regulatory report started", {
    workflowId,
    tenantId: input.tenantId,
    period: input.period,
  });

  await generateRegulatoryReport(input.tenantId, input.period);

  return { tenantId: input.tenantId, period: input.period, generated: true };
}

// ── Lakehouse Sync Workflow ───────────────────────────────────────────────────
export interface LakehouseSyncInput {
  tableName: string;
  fromDate: Date;
}

export async function LakehouseSyncWorkflow(
  input: LakehouseSyncInput
): Promise<{ tableName: string; synced: boolean }> {
  const { workflowId } = workflowInfo();
  log.info("Lakehouse sync started", { workflowId, tableName: input.tableName });

  await syncToLakehouse(input.tableName, input.fromDate);

  return { tableName: input.tableName, synced: true };
}

// ── Reinsurance Cession Workflow ──────────────────────────────────────────────
export interface ReinsuranceCessionInput {
  treatyId: number;
}

export async function ReinsuranceCessionWorkflow(
  input: ReinsuranceCessionInput
): Promise<{ treatyId: number; processed: boolean }> {
  const { workflowId } = workflowInfo();
  log.info("Reinsurance cession started", { workflowId, treatyId: input.treatyId });

  await processReinsuranceCession(input.treatyId);

  return { treatyId: input.treatyId, processed: true };
}
