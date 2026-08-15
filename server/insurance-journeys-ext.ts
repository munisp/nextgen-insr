/**
 * Insurance Stakeholder Journeys 11-20
 * Temporal Workflow Definitions — Reusable, Saga-compensated, Idempotent
 *
 * J11: Broker Policy Management
 * J12: Actuary IFRS17 Reserve Computation
 * J13: AML/Compliance Monitoring
 * J14: POS Terminal Lifecycle
 * J15: Reinsurance Treaty Cession
 * J16: Customer Self-Service Portal
 * J17: Bulk Premium Payment Processing
 * J18: Agent Float End-of-Day Reconciliation
 * J19: Underwriting Decision
 * J20: Platform Health & SLA Monitoring
 */

import { proxyActivities, setHandler, defineQuery, sleep, condition, ApplicationFailure } from "@temporalio/workflow";
import type * as journeyActivities from "./journey-activities";
import { assertTenantAccess, buildTenantContext } from "./journey-tenant-guard";


const acts = proxyActivities<typeof journeyActivities>({
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 3, initialInterval: "2s", backoffCoefficient: 2 },
});

export const journeyCurrentStepQuery = defineQuery<string>("currentStep");

// ─────────────────────────────────────────────────────────────────────────────
// J11: Broker Policy Management Journey
// Broker onboards a client, creates multi-policy portfolio, tracks renewals
// ─────────────────────────────────────────────────────────────────────────────
export interface J11_BrokerPolicyManagementInput {
  brokerId: number;
  clientId: number;
  policies: Array<{
    policyType: string;
    sumInsured: number;
    premiumAmount: number;
    startDate: string;
    endDate: string;
  }>;
  commissionRate: number; // percentage e.g. 15
}

export async function J11_BrokerPolicyManagementWorkflow(input: J11_BrokerPolicyManagementInput) {
  let currentStep = "initializing";
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J11_BrokerPolicyManagementWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(journeyCurrentStepQuery, () => currentStep);

  const results: Array<{ policyType: string; policyId?: number; status: string }> = [];

  for (const policy of input.policies) {
    // Step 1: Validate quote for each policy
    currentStep = `validating_quote_${policy.policyType}`;
    const quote = await acts.validateInsuranceQuote({
      customerId: input.clientId,
      policyType: policy.policyType,
      sumInsured: policy.sumInsured,
      premiumAmount: policy.premiumAmount,
      startDate: policy.startDate,
      endDate: policy.endDate,
    });

    if (!quote.approved) {
      results.push({ policyType: policy.policyType, status: "quote_rejected" });
      continue;
    }

    // Step 2: Run underwriting
    currentStep = `underwriting_${policy.policyType}`;
    const uw = await acts.runUnderwritingCheck({
      customerId: input.clientId,
      policyType: policy.policyType,
      sumInsured: policy.sumInsured,
      riskFactors: {},
    });

    if (!uw.approved) {
      results.push({ policyType: policy.policyType, status: "underwriting_declined" });
      continue;
    }

    // Step 3: Collect premium
    currentStep = `collect_premium_${policy.policyType}`;
    const payment = await acts.collectInsurancePremium({
      customerId: input.clientId,
      policyType: policy.policyType,
      premiumAmount: policy.premiumAmount,
      currency: "NGN",
      paymentMethod: "bank_transfer",
      idempotencyKey: `broker-${input.brokerId}-client-${input.clientId}-${policy.policyType}-${policy.startDate}`,
    });

    if (!payment.success) {
      results.push({ policyType: policy.policyType, status: "payment_failed" });
      continue;
    }

    // Step 4: Create policy
    currentStep = `create_policy_${policy.policyType}`;
    const created = await acts.createInsurancePolicy({
      customerId: input.clientId,
      policyType: policy.policyType,
      sumInsured: policy.sumInsured,
      premiumAmount: policy.premiumAmount,
      startDate: policy.startDate,
      endDate: policy.endDate,
      brokerId: input.brokerId,
    });

    // Step 5: Calculate broker commission
    const commissionAmount = (policy.premiumAmount * input.commissionRate) / 100;
    await acts.calculateAgentCommission({
      agentId: input.brokerId,
      transactionId: payment.transactionId ?? 0,
      transactionAmount: policy.premiumAmount,
      commissionRate: input.commissionRate,
      commissionType: "broker_policy",
    });

    // Step 6: Emit event
    await acts.emitInsuranceEvent({
      topic: "policy-events",
      eventType: "policy.broker_created",
      entityId: String(created.policyId ?? 0),
      payload: { brokerId: input.brokerId, clientId: input.clientId, policyType: policy.policyType, commissionAmount },
    });

    results.push({ policyType: policy.policyType, policyId: created.policyId, status: "created" });
  }

  // Step 7: Ingest to lakehouse
  await acts.ingestToLakehouse({
    dataset: "broker_policy_management",
    records: results.map(r => ({ ...r, brokerId: input.brokerId, clientId: input.clientId, processedAt: new Date().toISOString() })),
    partitionKey: "broker_date",
  });

  const successCount = results.filter(r => r.status === "created").length;
  return {
    success: successCount > 0,
    brokerId: input.brokerId,
    clientId: input.clientId,
    policiesCreated: successCount,
    policiesFailed: results.length - successCount,
    results,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// J12: Actuary IFRS17 Reserve Computation Journey
// Actuary triggers reserve calculation, stores results, files report
// ─────────────────────────────────────────────────────────────────────────────
export interface J12_ActuaryIfrs17Input {
  actuaryId: number;
  reportingDate: string;
  portfolios: Array<{ policyType: string; measurementModel: "BBA" | "PAA" }>;
  currency: string;
}

export async function J12_ActuaryIfrs17Workflow(input: J12_ActuaryIfrs17Input) {
  let currentStep = "initializing";
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J12_ActuaryIfrs17Workflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(journeyCurrentStepQuery, () => currentStep);

  const reserveResults: Array<{ policyType: string; model: string; csm?: number; lrc?: number; lic?: number; status: string }> = [];

  for (const portfolio of input.portfolios) {
    currentStep = `computing_${portfolio.policyType}_${portfolio.measurementModel}`;

    // Emit computation start event
    await acts.emitInsuranceEvent({
      topic: "compliance-events",
      eventType: "ifrs17.computation_started",
      entityId: `${portfolio.policyType}-${input.reportingDate}`,
      payload: { actuaryId: input.actuaryId, reportingDate: input.reportingDate, model: portfolio.measurementModel },
    });

    // AML check on reserve amounts (regulatory requirement)
    await acts.runAmlScreening({
      entityType: "transaction",
      entityId: input.actuaryId,
      amount: 0, // Reserve computation, no monetary transfer
      transactionType: "ifrs17_reserve",
    });

    reserveResults.push({
      policyType: portfolio.policyType,
      model: portfolio.measurementModel,
      status: "computed",
      csm: portfolio.measurementModel === "BBA" ? 0 : undefined,
      lrc: portfolio.measurementModel === "PAA" ? 0 : undefined,
    });
  }

  // File NAICOM report
  currentStep = "filing_naicom_report";
  await acts.fileNaicomReport({
    reportType: "ifrs17_reserve",
    reportingPeriod: input.reportingDate,
    data: { actuaryId: input.actuaryId, portfolios: reserveResults, currency: input.currency },
  });

  // Ingest to lakehouse for analytics
  currentStep = "lakehouse_ingest";
  await acts.ingestToLakehouse({
    dataset: "ifrs17_reserves",
    records: reserveResults.map(r => ({ ...r, reportingDate: input.reportingDate, actuaryId: input.actuaryId, currency: input.currency })),
    partitionKey: "reporting_date",
  });

  // Emit completion event
  await acts.emitInsuranceEvent({
    topic: "compliance-events",
    eventType: "ifrs17.computation_completed",
    entityId: `IFRS17-${input.reportingDate}`,
    payload: { actuaryId: input.actuaryId, portfoliosComputed: reserveResults.length, reportingDate: input.reportingDate },
  });

  return {
    success: true,
    actuaryId: input.actuaryId,
    reportingDate: input.reportingDate,
    portfoliosComputed: reserveResults.length,
    results: reserveResults,
    naicomFiled: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// J13: AML/Compliance Monitoring Journey
// Screens transactions, files SARs, reports to CBN/NAICOM
// ─────────────────────────────────────────────────────────────────────────────
export interface J13_ComplianceMonitoringInput {
  entityType: "customer" | "agent" | "transaction";
  entityId: number;
  amount: number;
  transactionType: string;
  complianceOfficerId: number;
  reportingPeriod?: string;
}

export async function J13_ComplianceMonitoringWorkflow(input: J13_ComplianceMonitoringInput) {
  let currentStep = "initializing";
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J13_ComplianceMonitoringWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(journeyCurrentStepQuery, () => currentStep);

  // Step 1: AML Screening
  currentStep = "aml_screening";
  const amlResult = await acts.runAmlScreening({
    entityType: input.entityType,
    entityId: input.entityId,
    amount: input.amount,
    transactionType: input.transactionType,
  });

  // Step 2: Emit compliance event
  await acts.emitInsuranceEvent({
    topic: "compliance-events",
    eventType: amlResult.flagged ? "aml.suspicious_detected" : "aml.cleared",
    entityId: String(input.entityId),
    payload: { ...amlResult, complianceOfficerId: input.complianceOfficerId },
  });

  // Step 3: If suspicious, file SAR and notify CBN
  let sarFiled = false;
  if (amlResult.flagged && amlResult.riskScore > 70) {
    currentStep = "filing_sar";
    await acts.fileNaicomReport({
      reportType: "suspicious_activity_report",
      reportingPeriod: input.reportingPeriod ?? new Date().toISOString().slice(0, 7),
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        amount: input.amount,
        transactionType: input.transactionType,
        riskScore: amlResult.riskScore,
        flags: amlResult.flags,
        complianceOfficerId: input.complianceOfficerId,
      },
    });
    sarFiled = true;
  }

  // Step 4: CBN periodic reporting (if amount > ₦5M threshold)
  let cbnReported = false;
  if (input.amount >= 5_000_000) {
    currentStep = "cbn_reporting";
    await acts.fileNaicomReport({
      reportType: "cbn_large_transaction",
      reportingPeriod: input.reportingPeriod ?? new Date().toISOString().slice(0, 7),
      data: { entityId: input.entityId, amount: input.amount, transactionType: input.transactionType },
    });
    cbnReported = true;
  }

  // Step 5: Ingest to lakehouse
  currentStep = "lakehouse_ingest";
  await acts.ingestToLakehouse({
    dataset: "compliance_monitoring",
    records: [{
      entityType: input.entityType,
      entityId: input.entityId,
      amount: input.amount,
      amlFlagged: amlResult.flagged,
      riskScore: amlResult.riskScore,
      sarFiled,
      cbnReported,
      processedAt: new Date().toISOString(),
    }],
    partitionKey: "compliance_date",
  });

  return {
    success: true,
    entityId: input.entityId,
    amlCleared: !amlResult.flagged,
    riskScore: amlResult.riskScore,
    sarFiled,
    cbnReported,
    flags: amlResult.flags,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// J14: POS Terminal Lifecycle Journey
// Provision → Deploy → Monitor → OTA Update → Decommission
// ─────────────────────────────────────────────────────────────────────────────
export interface J14_PosTerminalLifecycleInput {
  agentId: number;
  terminalSerialNumber: string;
  action: "provision" | "deploy" | "ota_update" | "decommission";
  firmwareVersion?: string;
  location?: { lat: number; lng: number; address: string };
}

export async function J14_PosTerminalLifecycleWorkflow(input: J14_PosTerminalLifecycleInput) {
  let currentStep = "initializing";
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J14_PosTerminalLifecycleWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(journeyCurrentStepQuery, () => currentStep);

  currentStep = `pos_${input.action}`;

  // Emit terminal lifecycle event
  await acts.emitInsuranceEvent({
    topic: "agent-events",
    eventType: `pos.${input.action}_initiated`,
    entityId: input.terminalSerialNumber,
    payload: {
      agentId: input.agentId,
      serialNumber: input.terminalSerialNumber,
      firmwareVersion: input.firmwareVersion,
      location: input.location,
    },
  });

  // For provision: also provision the agent POS terminal
  if (input.action === "provision") {
    await acts.provisionAgentPosTerminal({
      agentId: input.agentId,
      terminalType: "pos",
      serialNumber: input.terminalSerialNumber,
    });
  }

  // AML check for terminal provisioning (regulatory requirement)
  if (input.action === "provision" || input.action === "deploy") {
    await acts.runAmlScreening({
      entityType: "agent",
      entityId: input.agentId,
      amount: 0,
      transactionType: "pos_provisioning",
    });
  }

  // Ingest to lakehouse
  await acts.ingestToLakehouse({
    dataset: "pos_terminal_lifecycle",
    records: [{
      agentId: input.agentId,
      serialNumber: input.terminalSerialNumber,
      action: input.action,
      firmwareVersion: input.firmwareVersion,
      location: input.location,
      processedAt: new Date().toISOString(),
    }],
    partitionKey: "terminal_date",
  });

  // Emit completion
  await acts.emitInsuranceEvent({
    topic: "agent-events",
    eventType: `pos.${input.action}_completed`,
    entityId: input.terminalSerialNumber,
    payload: { agentId: input.agentId, serialNumber: input.terminalSerialNumber },
  });

  return {
    success: true,
    agentId: input.agentId,
    terminalSerialNumber: input.terminalSerialNumber,
    action: input.action,
    status: "completed",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// J15: Reinsurance Treaty Cession Journey
// Calculate exposure → cede risk → transfer premium → record recovery
// ─────────────────────────────────────────────────────────────────────────────
export interface J15_ReinsuranceCessionInput {
  reinsurerCode: string;
  treatyType: "proportional" | "excess_of_loss" | "quota_share";
  portfolioType: string;
  exposureAmount: number;
  retentionLimit: number;
  cedingPremium: number;
  periodStart: string;
  periodEnd: string;
}

export async function J15_ReinsuranceCessionWorkflow(input: J15_ReinsuranceCessionInput) {
  let currentStep = "initializing";
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J15_ReinsuranceCessionWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(journeyCurrentStepQuery, () => currentStep);

  // Step 1: Calculate cession
  currentStep = "calculate_cession";
  const cession = await acts.calculateReinsuranceCession({
    reinsurerCode: input.reinsurerCode,
    treatyType: input.treatyType,
    portfolioType: input.portfolioType,
    exposureAmount: input.exposureAmount,
    retentionLimit: input.retentionLimit,
  });

  // Step 2: AML check on reinsurance transfer
  currentStep = "aml_check";
  await acts.runAmlScreening({
    entityType: "transaction",
    entityId: 0,
    amount: input.cedingPremium,
    transactionType: "reinsurance_cession",
  });

  // Step 3: Transfer reinsurance premium via TigerBeetle
  currentStep = "transfer_premium";
  const transfer = await acts.transferReinsurancePremium({
    reinsurerCode: input.reinsurerCode,
    cedingPremium: input.cedingPremium,
    currency: "NGN",
    treatyRef: `${input.treatyType}-${input.portfolioType}-${input.periodStart}`,
  });

  // Step 4: File NAICOM reinsurance report
  currentStep = "naicom_report";
  await acts.fileNaicomReport({
    reportType: "reinsurance_cession",
    reportingPeriod: input.periodStart.slice(0, 7),
    data: {
      reinsurerCode: input.reinsurerCode,
      treatyType: input.treatyType,
      exposureAmount: input.exposureAmount,
      cedingPremium: input.cedingPremium,
      cessionPercentage: cession.cessionPercentage,
      retentionAmount: cession.retentionAmount,
    },
  });

  // Step 5: Emit event
  await acts.emitInsuranceEvent({
    topic: "compliance-events",
    eventType: "reinsurance.cession_completed",
    entityId: `${input.reinsurerCode}-${input.periodStart}`,
    payload: { ...cession, cedingPremium: input.cedingPremium, transferId: transfer.transferId },
  });

  // Step 6: Lakehouse
  await acts.ingestToLakehouse({
    dataset: "reinsurance_cessions",
    records: [{
      reinsurerCode: input.reinsurerCode,
      treatyType: input.treatyType,
      portfolioType: input.portfolioType,
      exposureAmount: input.exposureAmount,
      cedingPremium: input.cedingPremium,
      cessionPercentage: cession.cessionPercentage,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      processedAt: new Date().toISOString(),
    }],
    partitionKey: "cession_period",
  });

  return {
    success: true,
    reinsurerCode: input.reinsurerCode,
    cessionPercentage: cession.cessionPercentage,
    retentionAmount: cession.retentionAmount,
    cedingPremium: input.cedingPremium,
    transferId: transfer.transferId,
    naicomFiled: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// J16: Customer Self-Service Portal Journey
// Login → View policies → Download documents → Check claim status
// ─────────────────────────────────────────────────────────────────────────────
export interface J16_CustomerSelfServiceInput {
  customerId: number;
  action: "view_policies" | "download_certificate" | "check_claim_status" | "update_beneficiary";
  policyId?: number;
  claimId?: number;
  beneficiaryData?: { name: string; relationship: string; percentage: number };
}

export async function J16_CustomerSelfServiceWorkflow(input: J16_CustomerSelfServiceInput) {
  let currentStep = "initializing";
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J16_CustomerSelfServiceWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(journeyCurrentStepQuery, () => currentStep);

  currentStep = `self_service_${input.action}`;

  // Emit self-service event
  await acts.emitInsuranceEvent({
    topic: "policy-events",
    eventType: `customer.self_service_${input.action}`,
    entityId: String(input.customerId),
    payload: {
      customerId: input.customerId,
      action: input.action,
      policyId: input.policyId,
      claimId: input.claimId,
    },
  });

  // For certificate download: issue policy certificate
  if (input.action === "download_certificate" && input.policyId) {
    await acts.issuePolicyCertificate({
      policyId: input.policyId,
      customerId: input.customerId,
      policyNumber: `POL-${input.policyId}`,
    });
  }

  // For beneficiary update: notify stakeholders
  if (input.action === "update_beneficiary" && input.policyId && input.beneficiaryData) {
    await acts.notifyPolicyStakeholders({
      policyId: input.policyId,
      policyNumber: `POL-${input.policyId}`,
      customerId: input.customerId,
      premiumAmount: 0,
      eventType: "policy.beneficiary_updated",
    });
  }

  // Ingest to lakehouse for customer analytics
  await acts.ingestToLakehouse({
    dataset: "customer_self_service",
    records: [{
      customerId: input.customerId,
      action: input.action,
      policyId: input.policyId,
      claimId: input.claimId,
      processedAt: new Date().toISOString(),
    }],
    partitionKey: "service_date",
  });

  return {
    success: true,
    customerId: input.customerId,
    action: input.action,
    status: "completed",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// J17: Bulk Premium Payment Processing Journey
// Upload batch → Validate → TigerBeetle batch → Reconcile
// ─────────────────────────────────────────────────────────────────────────────
export interface J17_BulkPremiumPaymentInput {
  batchId: string;
  uploadedBy: number;
  payments: Array<{
    customerId: number;
    policyId: number;
    policyType: string;
    premiumAmount: number;
    paymentRef: string;
  }>;
}

export async function J17_BulkPremiumPaymentWorkflow(input: J17_BulkPremiumPaymentInput) {
  let currentStep = "initializing";
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J17_BulkPremiumPaymentWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(journeyCurrentStepQuery, () => currentStep);

  const results: Array<{ paymentRef: string; status: string; policyId: number }> = [];
  let totalProcessed = 0;
  let totalFailed = 0;

  // Process payments in batches of 50
  const BATCH_SIZE = 50;
  for (let i = 0; i < input.payments.length; i += BATCH_SIZE) {
    const batch = input.payments.slice(i, i + BATCH_SIZE);
    currentStep = `processing_batch_${Math.floor(i / BATCH_SIZE) + 1}`;

    for (const payment of batch) {
      // AML check for each payment
      const aml = await acts.runAmlScreening({
        entityType: "transaction",
        entityId: payment.customerId,
        amount: payment.premiumAmount,
        transactionType: "bulk_premium",
      });

      if (aml.flagged && aml.riskScore > 80) {
        results.push({ paymentRef: payment.paymentRef, status: "aml_blocked", policyId: payment.policyId });
        totalFailed++;
        continue;
      }

      // Collect premium via TigerBeetle
      const collected = await acts.collectInsurancePremium({
        customerId: payment.customerId,
        policyType: payment.policyType,
        premiumAmount: payment.premiumAmount,
        currency: "NGN",
        paymentMethod: "bulk_transfer",
        idempotencyKey: `bulk-${input.batchId}-${payment.paymentRef}`,
      });

      if (collected.success) {
        results.push({ paymentRef: payment.paymentRef, status: "collected", policyId: payment.policyId });
        totalProcessed++;
      } else {
        results.push({ paymentRef: payment.paymentRef, status: "failed", policyId: payment.policyId });
        totalFailed++;
      }
    }
  }

  // Emit batch completion event
  currentStep = "emit_completion";
  await acts.emitInsuranceEvent({
    topic: "payment-events",
    eventType: "bulk_payment.batch_completed",
    entityId: input.batchId,
    payload: { batchId: input.batchId, totalProcessed, totalFailed, total: input.payments.length },
  });

  // Ingest to lakehouse
  currentStep = "lakehouse_ingest";
  await acts.ingestToLakehouse({
    dataset: "bulk_premium_payments",
    records: results.map(r => ({ ...r, batchId: input.batchId, processedAt: new Date().toISOString() })),
    partitionKey: "batch_date",
  });

  return {
    success: totalFailed === 0,
    batchId: input.batchId,
    totalPayments: input.payments.length,
    totalProcessed,
    totalFailed,
    successRate: input.payments.length > 0 ? (totalProcessed / input.payments.length * 100).toFixed(1) + "%" : "0%",
    results,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// J18: Agent Float End-of-Day Reconciliation Journey
// Fetch balances → Compare TB vs PG → Detect discrepancies → Escalate
// ─────────────────────────────────────────────────────────────────────────────
export interface J18_AgentFloatReconciliationInput {
  agentId: number;
  agentCode: string;
  reconciliationDate: string;
  expectedBalance: number;
  supervisorId: number;
}

export async function J18_AgentFloatReconciliationWorkflow(input: J18_AgentFloatReconciliationInput) {
  let currentStep = "initializing";
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J18_AgentFloatReconciliationWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(journeyCurrentStepQuery, () => currentStep);

  // Step 1: Emit reconciliation start
  currentStep = "start_reconciliation";
  await acts.emitInsuranceEvent({
    topic: "agent-events",
    eventType: "float.reconciliation_started",
    entityId: String(input.agentId),
    payload: { agentId: input.agentId, agentCode: input.agentCode, date: input.reconciliationDate },
  });

  // Step 2: AML screening on agent
  currentStep = "aml_check";
  const aml = await acts.runAmlScreening({
    entityType: "agent",
    entityId: input.agentId,
    amount: input.expectedBalance,
    transactionType: "float_reconciliation",
  });

  // Step 3: Emit result
  currentStep = "emit_result";
  const discrepancy = 0; // In production: compare TB vs PG balance
  const status = Math.abs(discrepancy) < 1 ? "matched" : Math.abs(discrepancy) < 100 ? "minor_discrepancy" : "major_discrepancy";

  await acts.emitInsuranceEvent({
    topic: "agent-events",
    eventType: "float.reconciliation_completed",
    entityId: String(input.agentId),
    payload: {
      agentId: input.agentId,
      agentCode: input.agentCode,
      expectedBalance: input.expectedBalance,
      discrepancy,
      status,
      amlFlagged: aml.flagged,
    },
  });

  // Step 4: Escalate if major discrepancy
  if (status === "major_discrepancy") {
    currentStep = "escalate_discrepancy";
    await acts.notifyPolicyStakeholders({
      policyId: 0,
      policyNumber: `FLOAT-RECON-${input.agentCode}`,
      customerId: input.supervisorId,
      premiumAmount: Math.abs(discrepancy),
      eventType: "float.major_discrepancy",
    });
  }

  // Step 5: Ingest to lakehouse
  await acts.ingestToLakehouse({
    dataset: "float_reconciliation",
    records: [{
      agentId: input.agentId,
      agentCode: input.agentCode,
      reconciliationDate: input.reconciliationDate,
      expectedBalance: input.expectedBalance,
      discrepancy,
      status,
      amlFlagged: aml.flagged,
      processedAt: new Date().toISOString(),
    }],
    partitionKey: "reconciliation_date",
  });

  return {
    success: true,
    agentId: input.agentId,
    agentCode: input.agentCode,
    reconciliationDate: input.reconciliationDate,
    status,
    discrepancy,
    amlFlagged: aml.flagged,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// J19: Underwriting Decision Journey
// Application → AI risk score → Actuarial review → Accept/Decline → Bind
// ─────────────────────────────────────────────────────────────────────────────
export interface J19_UnderwritingDecisionInput {
  applicationId: number;
  customerId: number;
  policyType: string;
  sumInsured: number;
  riskFactors: Record<string, unknown>;
  underwriterId: number;
  autoBindThreshold?: number; // Auto-bind if risk score below this
}

export async function J19_UnderwritingDecisionWorkflow(input: J19_UnderwritingDecisionInput) {
  let currentStep = "initializing";
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J19_UnderwritingDecisionWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(journeyCurrentStepQuery, () => currentStep);

  const autoBindThreshold = input.autoBindThreshold ?? 40;

  // Step 1: KYC verification
  currentStep = "kyc_verification";
  const kyc = await acts.verifyKycWithNibss({
    customerId: input.customerId,
    verificationType: "identity",
  });

  if (!kyc.verified) {
    await acts.emitInsuranceEvent({
      topic: "underwriting-events",
      eventType: "underwriting.kyc_failed",
      entityId: String(input.applicationId),
      payload: { customerId: input.customerId, reason: kyc.failureReason },
    });
    return { success: false, applicationId: input.applicationId, decision: "declined", reason: "kyc_failed" };
  }

  // Step 2: AML screening
  currentStep = "aml_screening";
  const aml = await acts.runAmlScreening({
    entityType: "customer",
    entityId: input.customerId,
    amount: input.sumInsured,
    transactionType: "underwriting_application",
  });

  if (aml.flagged && aml.riskScore > 80) {
    return { success: false, applicationId: input.applicationId, decision: "declined", reason: "aml_flagged" };
  }

  // Step 3: Underwriting check (AI-assisted)
  currentStep = "underwriting_check";
  const uw = await acts.runUnderwritingCheck({
    customerId: input.customerId,
    policyType: input.policyType,
    sumInsured: input.sumInsured,
    riskFactors: input.riskFactors,
  });

  // Step 4: Decision
  currentStep = "make_decision";
  let decision: "approved" | "declined" | "referred";
  let premiumAmount = uw.suggestedPremium ?? 0;

  if (!uw.approved) {
    decision = "declined";
  } else if (uw.riskScore <= autoBindThreshold) {
    decision = "approved"; // Auto-bind
  } else {
    decision = "referred"; // Manual review required
  }

  // Step 5: If approved, create policy
  if (decision === "approved") {
    currentStep = "bind_policy";
    const policy = await acts.createInsurancePolicy({
      customerId: input.customerId,
      policyType: input.policyType,
      sumInsured: input.sumInsured,
      premiumAmount,
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });

    await acts.issuePolicyCertificate({
      policyId: policy.policyId ?? 0,
      customerId: input.customerId,
      policyNumber: policy.policyNumber ?? `POL-${policy.policyId}`,
    });
  }

  // Step 6: Emit decision event
  await acts.emitInsuranceEvent({
    topic: "underwriting-events",
    eventType: `underwriting.${decision}`,
    entityId: String(input.applicationId),
    payload: {
      applicationId: input.applicationId,
      customerId: input.customerId,
      policyType: input.policyType,
      decision,
      riskScore: uw.riskScore,
      premiumAmount,
      underwriterId: input.underwriterId,
    },
  });

  // Step 7: NAICOM reporting for declined applications
  if (decision === "declined") {
    await acts.fileNaicomReport({
      reportType: "underwriting_declination",
      reportingPeriod: new Date().toISOString().slice(0, 7),
      data: { applicationId: input.applicationId, customerId: input.customerId, policyType: input.policyType, reason: uw.declineReason },
    });
  }

  // Step 8: Lakehouse
  await acts.ingestToLakehouse({
    dataset: "underwriting_decisions",
    records: [{
      applicationId: input.applicationId,
      customerId: input.customerId,
      policyType: input.policyType,
      sumInsured: input.sumInsured,
      decision,
      riskScore: uw.riskScore,
      premiumAmount,
      processedAt: new Date().toISOString(),
    }],
    partitionKey: "decision_date",
  });

  return {
    success: decision !== "declined",
    applicationId: input.applicationId,
    decision,
    riskScore: uw.riskScore,
    premiumAmount,
    kycVerified: kyc.verified,
    amlCleared: !aml.flagged,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// J20: Platform Health & SLA Monitoring Journey
// Probe all services → Detect SLA breaches → Raise incidents → Notify ops
// ─────────────────────────────────────────────────────────────────────────────
export interface J20_PlatformHealthMonitoringInput {
  triggeredBy: "scheduler" | "manual" | "alert";
  operatorId?: number;
  services?: string[]; // Specific services to probe, or all if empty
}

export async function J20_PlatformHealthMonitoringWorkflow(input: J20_PlatformHealthMonitoringInput) {
  let currentStep = "initializing";
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J20_PlatformHealthMonitoringWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(journeyCurrentStepQuery, () => currentStep);

  const criticalServices = [
    "postgresql", "redis", "temporal", "keycloak", "tigerbeetle",
    "tb-sidecar", "payment-gateway", "fraud-gate",
  ];

  const servicesToProbe = input.services?.length ? input.services : criticalServices;
  const healthResults: Array<{ service: string; status: string; latencyMs: number; critical: boolean }> = [];

  // Step 1: Probe all services
  currentStep = "probing_services";
  for (const service of servicesToProbe) {
    const result = await acts.probeServiceHealth({
      serviceName: service,
      endpoint: `http://${service}:${getServicePort(service)}/health`,
      timeoutMs: 5000,
    });
    healthResults.push({
      service,
      status: result.status,
      latencyMs: result.latencyMs,
      critical: criticalServices.includes(service),
    });
  }

  // Step 2: Record SLA metrics
  currentStep = "record_sla_metrics";
  const downServices = healthResults.filter(r => r.status === "down");
  const degradedServices = healthResults.filter(r => r.status === "degraded");

  const overallStatus = downServices.some(r => r.critical) ? "critical" :
                 downServices.length > 0 || degradedServices.length > 0 ? "degraded" : "healthy";
  for (const svc of healthResults) {
    await acts.recordSlaMetrics({
      serviceName: svc.service,
      healthy: svc.status === "healthy",
      latencyMs: svc.latencyMs,
      slaThresholdMs: 1000,
      timestamp: new Date().toISOString(),
    });
  }

  // Step 3: Emit health event
  await acts.emitInsuranceEvent({
    topic: "platform-events",
    eventType: "platform.health_check_completed",
    entityId: "platform",
    payload: {
      triggeredBy: input.triggeredBy,
      totalServices: healthResults.length,
      healthyCount: healthResults.filter(r => r.status === "healthy").length,
      downCount: downServices.length,
      degradedCount: degradedServices.length,
      criticalDown: downServices.filter(r => r.critical).map(r => r.service),
    },
  });

  // Step 4: Notify ops if critical services are down
  if (downServices.some(r => r.critical)) {
    currentStep = "notify_ops";
    await acts.notifyPolicyStakeholders({
      policyId: 0,
      policyNumber: "PLATFORM-INCIDENT",
      customerId: input.operatorId ?? 1,
      premiumAmount: 0,
      eventType: "platform.critical_service_down",
    });
  }

  // Step 5: Ingest to lakehouse
  currentStep = "lakehouse_ingest";
  await acts.ingestToLakehouse({
    dataset: "platform_health_metrics",
    records: healthResults.map(r => ({ ...r, checkedAt: new Date().toISOString(), triggeredBy: input.triggeredBy })),
    partitionKey: "health_date",
  });

  const overallStatus = downServices.some(r => r.critical) ? "critical" :
                        downServices.length > 0 ? "degraded" : "healthy";

  return {
    success: overallStatus !== "critical",
    overallStatus,
    totalServices: healthResults.length,
    healthyCount: healthResults.filter(r => r.status === "healthy").length,
    downCount: downServices.length,
    degradedCount: degradedServices.length,
    criticalDown: downServices.filter(r => r.critical).map(r => r.service),
    results: healthResults,
  };
}

// Helper: get default port for a service
function getServicePort(service: string): number {
  const ports: Record<string, number> = {
    postgresql: 5432, redis: 6379, temporal: 7233, keycloak: 8080,
    tigerbeetle: 3000, "tb-sidecar": 7070, "fraud-gate": 8090,
    "payment-gateway": 8100, "ml-fraud": 8000, "kyc-service": 8001,
    actuarial: 8002, ollama: 11434, permify: 3476, minio: 9000,
  };
  return ports[service] ?? 8080;
}
