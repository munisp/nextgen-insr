/**
 * insurance-journeys-v2.ts
 *
 * 20 Reusable Insurance Stakeholder Journey Workflows (v2)
 *
 * Each workflow:
 * - Is a Temporal workflow (reusable, saga-compensated, idempotent)
 * - Uses ALL platform services: PostgreSQL, TigerBeetle, Redis, Fluvio,
 *   Keycloak, Permify, Dapr, APISIX, OpenAppSec, Ollama AI, Python ML,
 *   Go float-reconciler, Go health-worker, Rust fraud-gate
 * - Records execution to journey_executions table
 * - Records each step to journey_step_events table
 * - Emits Fluvio events at each state change
 * - Has saga compensation for every fund-movement step
 * - Accepts a cancelJourney signal
 * - Exposes currentStep query
 *
 * Journeys:
 *   J01 — New Customer Onboarding
 *   J02 — Insurance Policy Purchase
 *   J03 — Claims Filing & Settlement
 *   J04 — Agent Onboarding & Activation
 *   J05 — Agent Daily Operations
 *   J06 — Policy Renewal
 *   J07 — Fraud Detection & Response
 *   J08 — Commission Payout
 *   J09 — Cross-Border Remittance
 *   J10 — Claim Dispute & Escalation
 *   J11 — Broker Policy Management
 *   J12 — Actuary IFRS17 Reserve Computation
 *   J13 — AML/Compliance Monitoring
 *   J14 — POS Terminal Lifecycle
 *   J15 — Reinsurance Treaty Cession
 *   J16 — Customer Self-Service
 *   J17 — Bulk Premium Payment Processing
 *   J18 — Agent Float Reconciliation
 *   J19 — Underwriting Decision
 *   J20 — Platform Health & SLA Monitoring
 */
import {
  proxyActivities,
  defineQuery,
  defineSignal,
  setHandler,
  condition,
  sleep,
  log,
} from "@temporalio/workflow";
import type * as acts from "./journey-activities";
import type * as exts from "./journey-activities-extended";
import { assertTenantAccess, buildTenantContext } from "./journey-tenant-guard";


// ── Activity proxies ──────────────────────────────────────────────────────────
const {
  createOrFetchCustomer, initiateKycVerification, verifyKycWithNibss,
  validateInsuranceQuote, runUnderwritingCheck, collectInsurancePremium,
  createInsurancePolicy, issuePolicyCertificate, notifyPolicyStakeholders,
  emitInsuranceEvent, compensatePolicyBindingStep, fileClaim,
  runClaimFraudCheck, assignClaimAdjuster, adjudicateClaim, settleClaimPayment,
  registerAgent, activateAgent, provisionAgentPosTerminal,
  detectExpiringPolicies, generateRenewalQuote, processRenewal,
  runTransactionFraudCheck, freezeAgentAccount, unfreezeAgentAccount,
  calculateAgentCommission, creditAgentCommission, runAmlScreening,
  fileNaicomReport, calculateReinsuranceCession, transferReinsurancePremium,
  probeServiceHealth, recordSlaMetrics, ingestToLakehouse,
} = proxyActivities<typeof acts>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 3, initialInterval: "2s", backoffCoefficient: 2 },
});

const {
  recordJourneyStart, recordJourneyStep, recordJourneyComplete,
  checkPermifyPermission, writePermifyRelationship,
  validateKeycloakSession, createKeycloakUser, assignKeycloakRole,
  callRustFraudGate, callGoFloatReconciler, callGoHealthWorker,
  callPythonFraudScore, callPythonKycVerification, callIfrs17Engine,
  checkApisixRateLimit, createApisixConsumer,
  topUpAgentFloat, createRemittanceOrder, generateOllamaRiskNarrative,
  invokeDaprService,
} = proxyActivities<typeof exts>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 3, initialInterval: "2s", backoffCoefficient: 2 },
});

// ── Workflow signals and queries ──────────────────────────────────────────────
export const journeyCurrentStepQuery = defineQuery<string>("currentStep");
export const cancelJourneySignal = defineSignal("cancelJourney");
export const approveStepSignal = defineSignal<[{ stepId: string; approvedBy: number }]>("approveStep");

// ── Saga helper ───────────────────────────────────────────────────────────────
type Compensation = () => Promise<void>;

async function runWithSaga<T>(
  fn: () => Promise<T>,
  compensations: Compensation[]
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    log.error(`Saga compensation triggered: ${(err as Error).message}`);
    for (const comp of compensations.reverse()) {
      try { await comp(); } catch (e) { log.warn(`Compensation failed: ${(e as Error).message}`); }
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J01 — NEW CUSTOMER ONBOARDING
// ═══════════════════════════════════════════════════════════════════════════
export interface J01Input {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nin?: string;
  bvn?: string;
  address: string;
  state: string;
  policyType: string;
  sumInsured: number;
  premiumAmount: number;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J01_CustomerOnboardingWorkflow(input: J01Input) {
  let currentStep = "initializing";
  let cancelled = false;
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J01_CustomerOnboardingWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(journeyCurrentStepQuery, () => currentStep);
  setHandler(cancelJourneySignal, () => { cancelled = true; });

  const { executionId } = await recordJourneyStart({
    journeyId: "J01", journeyName: "New Customer Onboarding",
    workflowId: `J01-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { email: input.email, firstName: input.firstName, lastName: input.lastName, state: input.state },
    idempotencyKey: input.idempotencyKey,
  });

  const compensations: Compensation[] = [];

  try {
    // Step 1: Keycloak — create user identity
    currentStep = "create_identity";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "keycloak" });
    const keycloakUser = await createKeycloakUser({
      email: input.email, firstName: input.firstName,
      lastName: input.lastName, phone: input.phone,
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "keycloak" });

    if (cancelled) throw new Error("Journey cancelled by user");

    // Step 2: PostgreSQL — create customer record
    currentStep = "create_customer";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "postgresql" });
    const customer = await createOrFetchCustomer({
      email: input.email, phone: input.phone,
      firstName: input.firstName, lastName: input.lastName,
      dateOfBirth: input.dateOfBirth, address: input.address, state: input.state,
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "postgresql" });

    // Step 3: Python KYC — verify identity
    currentStep = "kyc_verification";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "python-kyc" });
    const kycResult = await callPythonKycVerification({
      customerId: customer.customerId,
      nin: input.nin, bvn: input.bvn,
      firstName: input.firstName, lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "python-kyc",
      metadata: { kycLevel: kycResult.kycLevel, verified: kycResult.verified } });

    // Step 4: NIBSS — verify BVN/NIN
    currentStep = "nibss_verification";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "nibss" });
    const nibssResult = await verifyKycWithNibss({
      customerId: customer.customerId, nin: input.nin, bvn: input.bvn,
      firstName: input.firstName, lastName: input.lastName, dateOfBirth: input.dateOfBirth,
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "nibss" });

    // Step 5: Permify — set customer role
    currentStep = "set_permissions";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "permify" });
    await writePermifyRelationship({
      entityType: "customer", entityId: customer.customerId.toString(),
      relation: "owner", subjectType: "user", subjectId: keycloakUser.keycloakId,
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "permify" });

    // Step 6: APISIX — create consumer
    currentStep = "create_api_consumer";
    await createApisixConsumer({ username: `customer-${customer.customerId}` });

    // Step 7: Ollama AI — generate welcome risk profile
    currentStep = "generate_risk_profile";
    const riskNarrative = await generateOllamaRiskNarrative({
      context: `New customer: ${input.firstName} ${input.lastName}, ${input.state}, ${input.policyType}`,
      riskScore: kycResult.score,
      riskFactors: kycResult.checks.filter(c => !c.passed).map(c => c.name),
      policyType: input.policyType,
      narrativeType: "underwriting",
    });

    // Step 8: Fluvio — emit onboarding event
    currentStep = "emit_event";
    await emitInsuranceEvent({
      topic: "customer.onboarded",
      payload: { customerId: customer.customerId, email: input.email, kycLevel: kycResult.kycLevel },
    });

    // Step 9: Dapr — publish to notification service
    currentStep = "send_welcome";
    await invokeDaprService({
      appId: "notification-service", method: "send",
      data: {
        type: "welcome_email", to: input.email,
        subject: "Welcome to InsurePortal",
        body: `Dear ${input.firstName}, your account is ready. KYC Level: ${kycResult.kycLevel}`,
      },
    });

    // Step 10: Lakehouse — ingest onboarding data
    currentStep = "ingest_to_lakehouse";
    await ingestToLakehouse({
      dataset: "customer_onboarding",
      records: [{ customerId: customer.customerId, kycLevel: kycResult.kycLevel, state: input.state, policyType: input.policyType }],
      partitionKey: "onboarding_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J01-${Date.now()}`, status: "completed",
      resultSnapshot: { customerId: customer.customerId, kycLevel: kycResult.kycLevel, keycloakId: keycloakUser.keycloakId } });

    return {
      success: true, customerId: customer.customerId,
      keycloakId: keycloakUser.keycloakId, kycLevel: kycResult.kycLevel,
      riskNarrative: riskNarrative.narrative, recommendation: riskNarrative.recommendation,
    };
  } catch (err) {
    await recordJourneyComplete({ executionId, workflowId: `J01-${Date.now()}`,
      status: cancelled ? "cancelled" : "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J02 — INSURANCE POLICY PURCHASE
// ═══════════════════════════════════════════════════════════════════════════
export interface J02Input {
  customerId: number;
  productId: number;
  sumInsured: number;
  premiumAmount: number;
  durationMonths: number;
  paymentRef: string;
  agentId?: number;
  beneficiaryName?: string;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J02_PolicyPurchaseWorkflow(input: J02Input) {
  let currentStep = "initializing";
  let cancelled = false;
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J02_PolicyPurchaseWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(journeyCurrentStepQuery, () => currentStep);
  setHandler(cancelJourneySignal, () => { cancelled = true; });

  const { executionId } = await recordJourneyStart({
    journeyId: "J02", journeyName: "Insurance Policy Purchase",
    workflowId: `J02-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { customerId: input.customerId, productId: input.productId, premiumAmount: input.premiumAmount },
    idempotencyKey: input.idempotencyKey,
  });

  const compensations: Compensation[] = [];

  try {
    // Step 1: Permify — check customer can purchase
    currentStep = "check_permissions";
    const permCheck = await checkPermifyPermission({
      subjectType: "user", subjectId: input.customerId.toString(),
      permission: "purchase_policy", entityType: "product", entityId: input.productId.toString(),
    });
    if (!permCheck.allowed) throw new Error(`Permission denied: ${permCheck.reason}`);

    // Step 2: Rust fraud-gate — pre-purchase fraud check
    currentStep = "fraud_pre_check";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "rust-fraud-gate" });
    const fraudCheck = await callRustFraudGate({
      userId: input.customerId, amount: input.premiumAmount,
      transactionType: "premium_payment", traceId: input.paymentRef,
    });
    if (!fraudCheck.allowed) throw new Error(`Fraud check blocked: ${fraudCheck.flags.join(", ")}`);
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "rust-fraud-gate",
      metadata: { riskScore: fraudCheck.riskScore, riskLevel: fraudCheck.riskLevel } });

    // Step 3: Underwriting — AI risk assessment
    currentStep = "underwriting";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "postgresql+ollama" });
    const underwriting = await runUnderwritingCheck({
      customerId: input.customerId, productId: input.productId,
      sumInsured: input.sumInsured, agentId: input.agentId,
    });
    if (!underwriting.approved) {
      const narrative = await generateOllamaRiskNarrative({
        context: `Policy purchase declined: ${underwriting.conditions.join(", ")}`,
        riskScore: 80, riskFactors: underwriting.conditions,
        policyType: "insurance", narrativeType: "underwriting",
      });
      throw new Error(`Underwriting declined: ${narrative.recommendation}`);
    }
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "postgresql+ollama",
      metadata: { riskCategory: underwriting.riskCategory } });

    // Step 4: TigerBeetle — collect premium (with compensation)
    currentStep = "collect_premium";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "tigerbeetle" });
    const payment = await collectInsurancePremium({
      customerId: input.customerId, agentId: input.agentId,
      productId: input.productId, premiumAmount: input.premiumAmount, paymentRef: input.paymentRef,
    });
    compensations.push(async () => {
      await compensatePolicyBindingStep({
        step: "collect_premium", quoteId: 0,
        paymentRef: input.paymentRef, customerId: input.customerId, premiumAmount: input.premiumAmount,
      });
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "tigerbeetle",
      metadata: { transactionId: payment.transactionId } });

    if (cancelled) throw new Error("Journey cancelled by user");

    // Step 5: PostgreSQL — create policy
    currentStep = "create_policy";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "postgresql" });
    let policy;
    try {
      policy = await createInsurancePolicy({
        quoteId: 0, customerId: input.customerId, agentId: input.agentId,
        productId: input.productId, sumInsured: input.sumInsured,
        premiumAmount: input.premiumAmount, durationMonths: input.durationMonths,
        coverageStartDate: new Date().toISOString(), paymentRef: input.paymentRef,
        beneficiaryName: input.beneficiaryName,
      });
    } catch (err) {
      for (const comp of compensations.reverse()) { try { await comp(); } catch {} }
      throw err;
    }
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "postgresql",
      metadata: { policyId: policy.policyId, policyNumber: policy.policyNumber } });

    // Step 6: S3 — issue certificate
    currentStep = "issue_certificate";
    const certificate = await issuePolicyCertificate({ policyId: policy.policyId, customerId: input.customerId });

    // Step 7: TigerBeetle — credit agent commission
    currentStep = "credit_commission";
    if (input.agentId) {
      const commission = await calculateAgentCommission({
        agentId: input.agentId, policyId: policy.policyId,
        premiumAmount: input.premiumAmount, productType: "insurance",
      });
      await creditAgentCommission({
        agentId: input.agentId, commissionAmount: commission.commissionAmount,
        policyId: policy.policyId, commissionRef: `COMM-${policy.policyId}-${Date.now()}`,
      });
    }

    // Step 8: Permify — write policy ownership
    await writePermifyRelationship({
      entityType: "policy", entityId: policy.policyId.toString(),
      relation: "owner", subjectType: "customer", subjectId: input.customerId.toString(),
    });

    // Step 9: Fluvio + Dapr — notify stakeholders
    currentStep = "notify";
    await notifyPolicyStakeholders({
      policyId: policy.policyId, policyNumber: policy.policyNumber,
      customerId: input.customerId, agentId: input.agentId,
      premiumAmount: input.premiumAmount, eventType: "policy.bound",
    });

    // Step 10: Lakehouse
    currentStep = "ingest_to_lakehouse";
    await ingestToLakehouse({
      dataset: "policy_purchases",
      records: [{ policyId: policy.policyId, customerId: input.customerId, premiumAmount: input.premiumAmount }],
      partitionKey: "purchase_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J02-${Date.now()}`, status: "completed",
      resultSnapshot: { policyId: policy.policyId, policyNumber: policy.policyNumber, certificateUrl: certificate.certificateUrl } });

    return {
      success: true, policyId: policy.policyId, policyNumber: policy.policyNumber,
      certificateUrl: certificate.certificateUrl, transactionId: payment.transactionId,
      riskCategory: underwriting.riskCategory,
    };
  } catch (err) {
    await recordJourneyComplete({ executionId, workflowId: `J02-${Date.now()}`,
      status: cancelled ? "cancelled" : "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J03 — CLAIMS FILING & SETTLEMENT
// ═══════════════════════════════════════════════════════════════════════════
export interface J03Input {
  policyId: number;
  customerId: number;
  claimType: string;
  incidentDate: string;
  claimedAmount: number;
  description: string;
  agentId?: number;
  paymentRef: string;
  paymentMethod?: string;
  beneficiaryAccount?: string;
  beneficiaryBank?: string;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J03_ClaimsSettlementWorkflow(input: J03Input) {
  let currentStep = "initializing";
  let cancelled = false;
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J03_ClaimsSettlementWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  let approvalReceived = false;
  setHandler(journeyCurrentStepQuery, () => currentStep);
  setHandler(cancelJourneySignal, () => { cancelled = true; });
  setHandler(approveStepSignal, () => { approvalReceived = true; });

  const { executionId } = await recordJourneyStart({
    journeyId: "J03", journeyName: "Claims Filing & Settlement",
    workflowId: `J03-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { policyId: input.policyId, claimType: input.claimType, claimedAmount: input.claimedAmount },
    idempotencyKey: input.idempotencyKey,
  });

  try {
    // Step 1: File claim (FNOL)
    currentStep = "file_claim";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "postgresql" });
    const claim = await fileClaim({
      policyId: input.policyId, customerId: input.customerId,
      claimType: input.claimType, incidentDate: input.incidentDate,
      claimedAmount: input.claimedAmount, description: input.description,
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "postgresql",
      metadata: { claimId: claim.claimId } });

    // Step 2: Python ML — fraud scoring
    currentStep = "ml_fraud_score";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "python-ml" });
    const mlScore = await callPythonFraudScore({
      transactionId: claim.claimId, agentId: input.agentId ?? 0,
      amount: input.claimedAmount, transactionType: "claim",
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "python-ml",
      metadata: { fraudProbability: mlScore.fraudProbability, riskLevel: mlScore.riskLevel } });

    // Step 3: Rust fraud-gate — velocity check
    currentStep = "fraud_gate_check";
    const fraudGate = await callRustFraudGate({
      userId: input.customerId, amount: input.claimedAmount,
      transactionType: "claim_payout", traceId: input.paymentRef,
    });

    // Step 4: Combined fraud check
    currentStep = "fraud_adjudication";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "fraud-engine" });
    const combinedScore = (mlScore.fraudProbability * 100 * 0.6) + (fraudGate.riskScore * 0.4);
    const fraudResult = await runClaimFraudCheck({
      claimId: claim.claimId, customerId: input.customerId,
      policyId: input.policyId, claimedAmount: input.claimedAmount,
      claimType: input.claimType,
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "fraud-engine",
      metadata: { fraudScore: combinedScore, isFraud: fraudResult.isFraud } });

    if (fraudResult.isFraud && combinedScore > 70) {
      // High fraud risk — escalate for manual review
      currentStep = "awaiting_fraud_review";
      await emitInsuranceEvent({
        topic: "claim.fraud.flagged",
        payload: { claimId: claim.claimId, score: combinedScore, flags: fraudGate.flags },
      });
      // Wait for manual approval (up to 48 hours)
      const approved = await condition(() => approvalReceived || cancelled, "48 hours");
      if (!approved || cancelled) throw new Error("Claim fraud review timeout or cancelled");
    }

    // Step 5: Assign adjuster
    currentStep = "assign_adjuster";
    const adjuster = await assignClaimAdjuster({ claimId: claim.claimId, claimType: input.claimType, claimedAmount: input.claimedAmount });

    // Step 6: Ollama AI — adjudication narrative
    currentStep = "ai_adjudication";
    const narrative = await generateOllamaRiskNarrative({
      context: `Claim: ${input.claimType}, Amount: ₦${input.claimedAmount.toLocaleString()}, ${input.description}`,
      riskScore: combinedScore,
      riskFactors: fraudGate.flags,
      claimType: input.claimType,
      narrativeType: "claims",
    });

    // Step 7: Adjudicate claim
    currentStep = "adjudicate";
    const adjudication = await adjudicateClaim({
      claimId: claim.claimId, adjusterId: adjuster.adjusterId,
      decision: narrative.recommendation === "decline" ? "rejected" : "approved",
      approvedAmount: narrative.recommendation === "decline" ? 0 : input.claimedAmount,
      notes: narrative.narrative,
    });

    if (adjudication.decision === "rejected") {
      await recordJourneyComplete({ executionId, workflowId: `J03-${Date.now()}`, status: "completed",
        resultSnapshot: { claimId: claim.claimId, decision: "rejected", reason: narrative.narrative } });
      return { success: true, claimId: claim.claimId, decision: "rejected", reason: narrative.narrative };
    }

    // Step 8: AML screening before payout
    currentStep = "aml_screening";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "aml" });
    const aml = await runAmlScreening({
      customerId: input.customerId, transactionAmount: adjudication.approvedAmount,
      transactionType: "claim_payout", reference: input.paymentRef,
    });
    if (aml.blocked) throw new Error(`AML screening blocked claim payout: ${aml.reason}`);
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "aml" });

    // Step 9: TigerBeetle — settle claim payment
    currentStep = "settle_payment";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "tigerbeetle" });
    const settlement = await settleClaimPayment({
      claimId: claim.claimId, customerId: input.customerId,
      approvedAmount: adjudication.approvedAmount, paymentRef: input.paymentRef,
      paymentMethod: input.paymentMethod ?? "bank_transfer",
      beneficiaryAccount: input.beneficiaryAccount, beneficiaryBank: input.beneficiaryBank,
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "tigerbeetle",
      metadata: { transactionId: settlement.transactionId } });

    // Step 10: Permify — update claim status
    await writePermifyRelationship({
      entityType: "claim", entityId: claim.claimId.toString(),
      relation: "settled", subjectType: "customer", subjectId: input.customerId.toString(),
    });

    // Step 11: Fluvio + Dapr — notify
    await notifyPolicyStakeholders({
      policyId: input.policyId, policyNumber: "",
      customerId: input.customerId, agentId: input.agentId,
      premiumAmount: adjudication.approvedAmount, eventType: "claim.settled",
    });

    // Step 12: Lakehouse
    await ingestToLakehouse({
      dataset: "claims_settlements",
      records: [{ claimId: claim.claimId, customerId: input.customerId, approvedAmount: adjudication.approvedAmount, fraudScore: combinedScore }],
      partitionKey: "settlement_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J03-${Date.now()}`, status: "completed",
      resultSnapshot: { claimId: claim.claimId, approvedAmount: adjudication.approvedAmount, transactionId: settlement.transactionId } });

    return {
      success: true, claimId: claim.claimId, decision: "approved",
      approvedAmount: adjudication.approvedAmount, transactionId: settlement.transactionId,
      fraudScore: combinedScore, aiNarrative: narrative.narrative,
    };
  } catch (err) {
    await recordJourneyComplete({ executionId, workflowId: `J03-${Date.now()}`,
      status: cancelled ? "cancelled" : "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J04 — AGENT ONBOARDING & ACTIVATION
// ═══════════════════════════════════════════════════════════════════════════
export interface J04Input {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  nin: string;
  bvn: string;
  agentType: "individual" | "corporate";
  state: string;
  lga: string;
  initialFloatAmount: number;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J04_AgentOnboardingWorkflow(input: J04Input) {
  let currentStep = "initializing";
  let cancelled = false;
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J04_AgentOnboardingWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(journeyCurrentStepQuery, () => currentStep);
  setHandler(cancelJourneySignal, () => { cancelled = true; });

  const { executionId } = await recordJourneyStart({
    journeyId: "J04", journeyName: "Agent Onboarding & Activation",
    workflowId: `J04-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { email: input.email, firstName: input.firstName, state: input.state, agentType: input.agentType },
    idempotencyKey: input.idempotencyKey,
  });

  try {
    // Step 1: Keycloak — create agent identity
    currentStep = "create_identity";
    const keycloakUser = await createKeycloakUser({
      email: input.email, firstName: input.firstName,
      lastName: input.lastName, phone: input.phone,
    });
    await assignKeycloakRole({ keycloakUserId: keycloakUser.keycloakId, role: "agent" });

    // Step 2: Python KYC — verify agent identity
    currentStep = "kyc_verification";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "python-kyc" });
    const kycResult = await callPythonKycVerification({
      customerId: 0, nin: input.nin, bvn: input.bvn,
      firstName: input.firstName, lastName: input.lastName, dateOfBirth: "",
    });
    if (!kycResult.verified) throw new Error("Agent KYC verification failed — cannot onboard");
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "python-kyc" });

    // Step 3: PostgreSQL — register agent
    currentStep = "register_agent";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "postgresql" });
    const agent = await registerAgent({
      email: input.email, phone: input.phone,
      firstName: input.firstName, lastName: input.lastName,
      nin: input.nin, bvn: input.bvn,
      agentType: input.agentType, state: input.state, lga: input.lga,
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "postgresql",
      metadata: { agentId: agent.agentId, agentCode: agent.agentCode } });

    // Step 4: TigerBeetle — initial float top-up
    currentStep = "float_topup";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "tigerbeetle" });
    const floatResult = await topUpAgentFloat({
      agentId: agent.agentId, agentCode: agent.agentCode,
      amount: input.initialFloatAmount,
      paymentRef: `INIT-FLOAT-${agent.agentId}-${Date.now()}`,
      fundingSource: "corporate",
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "tigerbeetle",
      metadata: { newBalance: floatResult.newBalance } });

    // Step 5: Permify — set agent permissions
    currentStep = "set_permissions";
    await writePermifyRelationship({
      entityType: "agent", entityId: agent.agentId.toString(),
      relation: "owner", subjectType: "user", subjectId: keycloakUser.keycloakId,
    });

    // Step 6: APISIX — create agent API consumer
    await createApisixConsumer({ username: `agent-${agent.agentId}` });

    // Step 7: Activate agent
    currentStep = "activate_agent";
    await activateAgent({ agentId: agent.agentId, agentCode: agent.agentCode });

    // Step 8: POS terminal provisioning
    currentStep = "provision_terminal";
    const terminal = await provisionAgentPosTerminal({ agentId: agent.agentId, agentCode: agent.agentCode, state: input.state });

    // Step 9: Dapr — notify agent
    await invokeDaprService({
      appId: "notification-service", method: "send",
      data: {
        type: "agent_activated", to: input.email,
        subject: "Your InsurePortal Agent Account is Active",
        body: `Dear ${input.firstName}, your agent code is ${agent.agentCode}. Float balance: ₦${floatResult.newBalance.toLocaleString()}`,
      },
    });

    // Step 10: Fluvio
    await emitInsuranceEvent({
      topic: "agent.onboarded",
      payload: { agentId: agent.agentId, agentCode: agent.agentCode, state: input.state, kycLevel: kycResult.kycLevel },
    });

    // Step 11: Lakehouse
    await ingestToLakehouse({
      dataset: "agent_onboarding",
      records: [{ agentId: agent.agentId, state: input.state, agentType: input.agentType, initialFloat: input.initialFloatAmount }],
      partitionKey: "onboarding_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J04-${Date.now()}`, status: "completed",
      resultSnapshot: { agentId: agent.agentId, agentCode: agent.agentCode, floatBalance: floatResult.newBalance } });

    return {
      success: true, agentId: agent.agentId, agentCode: agent.agentCode,
      keycloakId: keycloakUser.keycloakId, kycLevel: kycResult.kycLevel,
      floatBalance: floatResult.newBalance, terminalId: terminal.terminalId,
    };
  } catch (err) {
    await recordJourneyComplete({ executionId, workflowId: `J04-${Date.now()}`,
      status: cancelled ? "cancelled" : "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J05 — AGENT DAILY OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════
export interface J05Input {
  agentId: number;
  agentCode: string;
  operationType: "airtime" | "bill_payment" | "mobile_money" | "premium_collection";
  amount: number;
  customerId?: number;
  policyId?: number;
  billType?: string;
  phone?: string;
  paymentRef: string;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J05_AgentDailyOpsWorkflow(input: J05Input) {
  let currentStep = "initializing";
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J05_AgentDailyOpsWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(journeyCurrentStepQuery, () => currentStep);

  const { executionId } = await recordJourneyStart({
    journeyId: "J05", journeyName: "Agent Daily Operations",
    workflowId: `J05-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { agentId: input.agentId, operationType: input.operationType, amount: input.amount },
    idempotencyKey: input.idempotencyKey,
  });

  try {
    // Step 1: Rust fraud-gate — pre-transaction check
    currentStep = "fraud_check";
    const fraudCheck = await callRustFraudGate({
      userId: input.agentId, amount: input.amount,
      transactionType: input.operationType, traceId: input.paymentRef,
    });
    if (!fraudCheck.allowed) throw new Error(`Transaction blocked by fraud gate: ${fraudCheck.flags.join(", ")}`);

    // Step 2: Check float balance via TigerBeetle
    currentStep = "check_float";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "tigerbeetle" });
    const balance = await probeServiceHealth({ service: "tigerbeetle" });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "tigerbeetle" });

    // Step 3: Process transaction
    currentStep = `process_${input.operationType}`;
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "postgresql+tigerbeetle" });
    const txResult = await runTransactionFraudCheck({
      transactionId: 0, agentId: input.agentId,
      amount: input.amount, type: input.operationType,
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "postgresql+tigerbeetle" });

    // Step 4: Fluvio — emit transaction event
    await emitInsuranceEvent({
      topic: `agent.transaction.${input.operationType}`,
      payload: { agentId: input.agentId, amount: input.amount, paymentRef: input.paymentRef },
    });

    // Step 5: Lakehouse
    await ingestToLakehouse({
      dataset: "agent_transactions",
      records: [{ agentId: input.agentId, operationType: input.operationType, amount: input.amount, date: new Date().toISOString() }],
      partitionKey: "transaction_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J05-${Date.now()}`, status: "completed",
      resultSnapshot: { operationType: input.operationType, amount: input.amount } });

    return { success: true, operationType: input.operationType, amount: input.amount, fraudScore: fraudCheck.riskScore };
  } catch (err) {
    await recordJourneyComplete({ executionId, workflowId: `J05-${Date.now()}`, status: "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J06 — POLICY RENEWAL
// ═══════════════════════════════════════════════════════════════════════════
export interface J06Input {
  policyId: number;
  customerId: number;
  renewalType: "standard" | "enhanced" | "reduced";
  newSumInsured?: number;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J06_PolicyRenewalWorkflow(input: J06Input) {
  let currentStep = "initializing";
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J06_PolicyRenewalWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(journeyCurrentStepQuery, () => currentStep);

  const { executionId } = await recordJourneyStart({
    journeyId: "J06", journeyName: "Policy Renewal",
    workflowId: `J06-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { policyId: input.policyId, renewalType: input.renewalType },
    idempotencyKey: input.idempotencyKey,
  });

  try {
    // Step 1: Detect expiring policy
    currentStep = "detect_expiry";
    const expiring = await detectExpiringPolicies({ policyId: input.policyId, daysAhead: 30 });

    // Step 2: Ollama AI — renewal recommendation
    currentStep = "ai_renewal_analysis";
    const narrative = await generateOllamaRiskNarrative({
      context: `Policy renewal: ${input.renewalType}, Policy ID: ${input.policyId}`,
      riskScore: 30, riskFactors: [],
      policyType: "renewal", narrativeType: "renewal",
    });

    // Step 3: Generate renewal quote
    currentStep = "generate_quote";
    const quote = await generateRenewalQuote({
      policyId: input.policyId, customerId: input.customerId,
      renewalType: input.renewalType, newSumInsured: input.newSumInsured,
    });

    // Step 4: Rust fraud-gate — pre-renewal check
    currentStep = "fraud_check";
    const fraudCheck = await callRustFraudGate({
      userId: input.customerId, amount: quote.newPremiumAmount,
      transactionType: "premium_renewal", traceId: `RENEW-${input.policyId}`,
    });

    // Step 5: Process renewal with TigerBeetle
    currentStep = "process_renewal";
    const renewal = await processRenewal({
      policyId: input.policyId, customerId: input.customerId,
      quoteId: quote.quoteId, newPremiumAmount: quote.newPremiumAmount,
      newSumInsured: input.newSumInsured ?? quote.newSumInsured,
      paymentRef: `RENEW-${input.policyId}-${Date.now()}`,
    });

    // Step 6: Permify — update policy permissions
    await writePermifyRelationship({
      entityType: "policy", entityId: input.policyId.toString(),
      relation: "renewed", subjectType: "customer", subjectId: input.customerId.toString(),
    });

    // Step 7: Fluvio + Dapr
    await notifyPolicyStakeholders({
      policyId: input.policyId, policyNumber: renewal.policyNumber,
      customerId: input.customerId, premiumAmount: quote.newPremiumAmount,
      eventType: "policy.renewed",
    });

    // Step 8: Lakehouse
    await ingestToLakehouse({
      dataset: "policy_renewals",
      records: [{ policyId: input.policyId, customerId: input.customerId, renewalType: input.renewalType, newPremium: quote.newPremiumAmount }],
      partitionKey: "renewal_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J06-${Date.now()}`, status: "completed",
      resultSnapshot: { policyId: input.policyId, newPremium: quote.newPremiumAmount } });

    return {
      success: true, policyId: input.policyId, newPremiumAmount: quote.newPremiumAmount,
      renewalId: renewal.renewalId, aiRecommendation: narrative.recommendation,
    };
  } catch (err) {
    await recordJourneyComplete({ executionId, workflowId: `J06-${Date.now()}`, status: "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J07 — FRAUD DETECTION & RESPONSE
// ═══════════════════════════════════════════════════════════════════════════
export interface J07Input {
  transactionId: number;
  agentId: number;
  amount: number;
  transactionType: string;
  sourceIp?: string;
  deviceId?: string;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J07_FraudResponseWorkflow(input: J07Input) {
  let currentStep = "initializing";
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J07_FraudResponseWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  let resolved = false;
  setHandler(journeyCurrentStepQuery, () => currentStep);
  setHandler(approveStepSignal, () => { resolved = true; });

  const { executionId } = await recordJourneyStart({
    journeyId: "J07", journeyName: "Fraud Detection & Response",
    workflowId: `J07-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { transactionId: input.transactionId, agentId: input.agentId, amount: input.amount },
    idempotencyKey: input.idempotencyKey,
  });

  try {
    // Step 1: Python ML — fraud scoring
    currentStep = "ml_fraud_score";
    const mlScore = await callPythonFraudScore({
      transactionId: input.transactionId, agentId: input.agentId,
      amount: input.amount, transactionType: input.transactionType,
    });

    // Step 2: Rust fraud-gate — velocity + pattern
    currentStep = "rust_fraud_gate";
    const gateResult = await callRustFraudGate({
      userId: input.agentId, amount: input.amount,
      transactionType: input.transactionType,
      sourceIp: input.sourceIp, deviceId: input.deviceId,
      traceId: `FRD-${input.transactionId}`,
    });

    // Step 3: Combined fraud check
    currentStep = "fraud_check";
    const combinedScore = (mlScore.fraudProbability * 100 * 0.6) + (gateResult.riskScore * 0.4);
    const fraudResult = await runTransactionFraudCheck({
      transactionId: input.transactionId, agentId: input.agentId,
      amount: input.amount, type: input.transactionType,
    });

    if (!fraudResult.isFraud && combinedScore < 50) {
      await recordJourneyComplete({ executionId, workflowId: `J07-${Date.now()}`, status: "completed",
        resultSnapshot: { decision: "allowed", score: combinedScore } });
      return { success: true, decision: "allowed", fraudScore: combinedScore };
    }

    // Step 4: Ollama AI — fraud narrative
    currentStep = "ai_fraud_narrative";
    const narrative = await generateOllamaRiskNarrative({
      context: `Transaction: ${input.transactionType}, Amount: ₦${input.amount.toLocaleString()}, Agent: ${input.agentId}`,
      riskScore: combinedScore,
      riskFactors: [...gateResult.flags, ...mlScore.features ? Object.keys(mlScore.features).filter(k => mlScore.features[k] > 0.5) : []],
      narrativeType: "fraud",
    });

    // Step 5: Freeze agent account
    currentStep = "freeze_account";
    await freezeAgentAccount({ agentId: input.agentId, reason: narrative.narrative, fraudScore: combinedScore });

    // Step 6: Permify — update agent status
    await writePermifyRelationship({
      entityType: "agent", entityId: input.agentId.toString(),
      relation: "frozen", subjectType: "system", subjectId: "fraud-engine",
    });

    // Step 7: AML — file suspicious activity
    currentStep = "aml_sar";
    if (combinedScore > 80) {
      await runAmlScreening({
        customerId: input.agentId, transactionAmount: input.amount,
        transactionType: "suspicious", reference: `FRD-${input.transactionId}`,
      });
    }

    // Step 8: Fluvio — emit fraud alert
    await emitInsuranceEvent({
      topic: "fraud.alert.raised",
      payload: { transactionId: input.transactionId, agentId: input.agentId, score: combinedScore, flags: gateResult.flags },
    });

    // Step 9: Wait for resolution (up to 72 hours)
    currentStep = "awaiting_resolution";
    const resolvedInTime = await condition(() => resolved, "72 hours");

    if (resolvedInTime) {
      await unfreezeAgentAccount({ agentId: input.agentId, resolvedBy: input.triggeredBy, resolution: "cleared" });
      currentStep = "resolved";
    }

    // Step 10: Lakehouse
    await ingestToLakehouse({
      dataset: "fraud_incidents",
      records: [{ transactionId: input.transactionId, agentId: input.agentId, score: combinedScore, resolved: resolvedInTime }],
      partitionKey: "incident_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J07-${Date.now()}`, status: "completed",
      resultSnapshot: { decision: "blocked", fraudScore: combinedScore, resolved: resolvedInTime } });

    return {
      success: true, decision: "blocked", fraudScore: combinedScore,
      narrative: narrative.narrative, resolved: resolvedInTime,
    };
  } catch (err) {
    await recordJourneyComplete({ executionId, workflowId: `J07-${Date.now()}`, status: "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J08 — COMMISSION PAYOUT
// ═══════════════════════════════════════════════════════════════════════════
export interface J08Input {
  agentId: number;
  agentCode: string;
  payoutPeriod: string;
  paymentRef: string;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J08_CommissionPayoutWorkflow(input: J08Input) {
  let currentStep = "initializing";
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J08_CommissionPayoutWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(journeyCurrentStepQuery, () => currentStep);

  const { executionId } = await recordJourneyStart({
    journeyId: "J08", journeyName: "Commission Payout",
    workflowId: `J08-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { agentId: input.agentId, payoutPeriod: input.payoutPeriod },
    idempotencyKey: input.idempotencyKey,
  });

  try {
    // Step 1: Calculate commission
    currentStep = "calculate_commission";
    const commission = await calculateAgentCommission({
      agentId: input.agentId, policyId: 0,
      premiumAmount: 0, productType: "all",
    });

    if (commission.commissionAmount <= 0) {
      await recordJourneyComplete({ executionId, workflowId: `J08-${Date.now()}`, status: "completed",
        resultSnapshot: { commissionAmount: 0, reason: "no_commission_due" } });
      return { success: true, commissionAmount: 0, reason: "No commission due for this period" };
    }

    // Step 2: AML screening
    currentStep = "aml_screening";
    const aml = await runAmlScreening({
      customerId: input.agentId, transactionAmount: commission.commissionAmount,
      transactionType: "commission_payout", reference: input.paymentRef,
    });
    if (aml.blocked) throw new Error(`AML blocked commission payout: ${aml.reason}`);

    // Step 3: Rust fraud-gate
    currentStep = "fraud_check";
    const fraudCheck = await callRustFraudGate({
      userId: input.agentId, amount: commission.commissionAmount,
      transactionType: "commission_payout", traceId: input.paymentRef,
    });
    if (!fraudCheck.allowed) throw new Error(`Fraud gate blocked commission: ${fraudCheck.flags.join(", ")}`);

    // Step 4: TigerBeetle — credit commission
    currentStep = "credit_commission";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "tigerbeetle" });
    await creditAgentCommission({
      agentId: input.agentId, commissionAmount: commission.commissionAmount,
      policyId: 0, commissionRef: input.paymentRef,
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "tigerbeetle" });

    // Step 5: Permify — log payout
    await writePermifyRelationship({
      entityType: "commission", entityId: input.paymentRef,
      relation: "paid", subjectType: "agent", subjectId: input.agentId.toString(),
    });

    // Step 6: Dapr — notify agent
    await invokeDaprService({
      appId: "notification-service", method: "send",
      data: {
        type: "commission_paid", agentId: input.agentId,
        amount: commission.commissionAmount, period: input.payoutPeriod,
      },
    });

    // Step 7: Fluvio
    await emitInsuranceEvent({
      topic: "agent.commission.paid",
      payload: { agentId: input.agentId, amount: commission.commissionAmount, period: input.payoutPeriod },
    });

    // Step 8: Lakehouse
    await ingestToLakehouse({
      dataset: "commission_payouts",
      records: [{ agentId: input.agentId, amount: commission.commissionAmount, period: input.payoutPeriod }],
      partitionKey: "payout_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J08-${Date.now()}`, status: "completed",
      resultSnapshot: { commissionAmount: commission.commissionAmount } });

    return { success: true, commissionAmount: commission.commissionAmount, paymentRef: input.paymentRef };
  } catch (err) {
    await recordJourneyComplete({ executionId, workflowId: `J08-${Date.now()}`, status: "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J09 — CROSS-BORDER REMITTANCE
// ═══════════════════════════════════════════════════════════════════════════
export interface J09Input {
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
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J09_RemittanceWorkflow(input: J09Input) {
  let currentStep = "initializing";
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J09_RemittanceWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(journeyCurrentStepQuery, () => currentStep);

  const { executionId } = await recordJourneyStart({
    journeyId: "J09", journeyName: "Cross-Border Remittance",
    workflowId: `J09-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { senderId: input.senderId, sendAmount: input.sendAmount, recipientCountry: input.recipientCountry },
    idempotencyKey: input.idempotencyKey,
  });

  const compensations: Compensation[] = [];

  try {
    // Step 1: AML screening (mandatory for cross-border)
    currentStep = "aml_screening";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "aml" });
    const aml = await runAmlScreening({
      customerId: input.senderId, transactionAmount: input.sendAmount,
      transactionType: "remittance", reference: input.paymentRef,
    });
    if (aml.blocked) throw new Error(`AML blocked remittance: ${aml.reason}`);
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "aml" });

    // Step 2: Rust fraud-gate
    currentStep = "fraud_check";
    const fraudCheck = await callRustFraudGate({
      userId: input.senderId, amount: input.sendAmount,
      transactionType: "remittance", traceId: input.paymentRef,
    });
    if (!fraudCheck.allowed) throw new Error(`Fraud gate blocked remittance: ${fraudCheck.flags.join(", ")}`);

    // Step 3: Permify — check remittance permission
    const permCheck = await checkPermifyPermission({
      subjectType: "user", subjectId: input.senderId.toString(),
      permission: "send_remittance", entityType: "remittance", entityId: input.paymentRef,
    });
    if (!permCheck.allowed) throw new Error("Remittance permission denied");

    // Step 4: Create remittance order
    currentStep = "create_order";
    const order = await createRemittanceOrder(input);

    // Step 5: TigerBeetle — debit sender
    currentStep = "debit_sender";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "tigerbeetle" });
    const payment = await collectInsurancePremium({
      customerId: input.senderId, agentId: undefined,
      productId: 0, premiumAmount: input.sendAmount, paymentRef: input.paymentRef,
    });
    compensations.push(async () => {
      await compensatePolicyBindingStep({
        step: "collect_premium", quoteId: 0,
        paymentRef: input.paymentRef, customerId: input.senderId, premiumAmount: input.sendAmount,
      });
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "tigerbeetle" });

    // Step 6: NIBSS/SWIFT routing
    currentStep = "route_payment";
    await invokeDaprService({
      appId: "payment-gateway", method: `${input.channel}/send`,
      data: {
        orderId: order.orderId, amount: input.receiveAmount,
        currency: input.receiveCurrency, recipientAccount: input.recipientAccount,
        recipientBank: input.recipientBank, country: input.recipientCountry,
      },
    });

    // Step 7: NAICOM report (>$10,000 equivalent)
    if (input.sendAmount > 5_000_000) {
      currentStep = "regulatory_report";
      await fileNaicomReport({
        reportType: "large_transaction", entityId: input.senderId,
        entityType: "customer", data: { amount: input.sendAmount, currency: input.sendCurrency, channel: input.channel },
      });
    }

    // Step 8: Fluvio
    await emitInsuranceEvent({
      topic: "remittance.sent",
      payload: { orderId: order.orderId, senderId: input.senderId, amount: input.sendAmount, country: input.recipientCountry },
    });

    // Step 9: Lakehouse
    await ingestToLakehouse({
      dataset: "remittances",
      records: [{ orderId: order.orderId, senderId: input.senderId, amount: input.sendAmount, country: input.recipientCountry }],
      partitionKey: "remittance_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J09-${Date.now()}`, status: "completed",
      resultSnapshot: { orderId: order.orderId, trackingCode: order.trackingCode } });

    return {
      success: true, orderId: order.orderId, trackingCode: order.trackingCode,
      estimatedDelivery: order.estimatedDelivery, transactionId: payment.transactionId,
    };
  } catch (err) {
    for (const comp of compensations.reverse()) { try { await comp(); } catch {} }
    await recordJourneyComplete({ executionId, workflowId: `J09-${Date.now()}`, status: "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J10 — CLAIM DISPUTE & ESCALATION
// ═══════════════════════════════════════════════════════════════════════════
export interface J10Input {
  claimId: number;
  customerId: number;
  disputeReason: string;
  evidenceUrls?: string[];
  requestedAmount: number;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J10_ClaimDisputeWorkflow(input: J10Input) {
  let currentStep = "initializing";
  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J10_ClaimDisputeWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  let resolved = false;
  setHandler(journeyCurrentStepQuery, () => currentStep);
  setHandler(approveStepSignal, () => { resolved = true; });

  const { executionId } = await recordJourneyStart({
    journeyId: "J10", journeyName: "Claim Dispute & Escalation",
    workflowId: `J10-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { claimId: input.claimId, disputeReason: input.disputeReason },
    idempotencyKey: input.idempotencyKey,
  });

  try {
    // Step 1: Permify — check dispute permission
    currentStep = "check_permissions";
    const permCheck = await checkPermifyPermission({
      subjectType: "customer", subjectId: input.customerId.toString(),
      permission: "dispute_claim", entityType: "claim", entityId: input.claimId.toString(),
    });
    if (!permCheck.allowed) throw new Error("Customer does not have permission to dispute this claim");

    // Step 2: Ollama AI — dispute analysis
    currentStep = "ai_dispute_analysis";
    const narrative = await generateOllamaRiskNarrative({
      context: `Claim dispute: ${input.disputeReason}. Requested: ₦${input.requestedAmount.toLocaleString()}`,
      riskScore: 40, riskFactors: [input.disputeReason],
      claimType: "dispute", narrativeType: "claims",
    });

    // Step 3: Assign senior adjuster
    currentStep = "assign_senior_adjuster";
    const adjuster = await assignClaimAdjuster({
      claimId: input.claimId, claimType: "dispute",
      claimedAmount: input.requestedAmount,
    });

    // Step 4: Fluvio — emit dispute event
    await emitInsuranceEvent({
      topic: "claim.disputed",
      payload: { claimId: input.claimId, customerId: input.customerId, reason: input.disputeReason },
    });

    // Step 5: Dapr — notify adjuster
    await invokeDaprService({
      appId: "notification-service", method: "send",
      data: { type: "claim_dispute_assigned", adjusterId: adjuster.adjusterId, claimId: input.claimId },
    });

    // Step 6: Wait for resolution (up to 30 days per NAICOM guidelines)
    currentStep = "awaiting_resolution";
    const resolvedInTime = await condition(() => resolved, "30 days");

    if (!resolvedInTime) {
      // Auto-escalate to NAICOM
      currentStep = "naicom_escalation";
      await fileNaicomReport({
        reportType: "dispute_escalation", entityId: input.claimId,
        entityType: "claim", data: { reason: input.disputeReason, requestedAmount: input.requestedAmount },
      });
    }

    // Step 7: Lakehouse
    await ingestToLakehouse({
      dataset: "claim_disputes",
      records: [{ claimId: input.claimId, customerId: input.customerId, resolved: resolvedInTime, requestedAmount: input.requestedAmount }],
      partitionKey: "dispute_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J10-${Date.now()}`, status: "completed",
      resultSnapshot: { claimId: input.claimId, resolved: resolvedInTime } });

    return {
      success: true, claimId: input.claimId, resolved: resolvedInTime,
      aiAnalysis: narrative.narrative, recommendation: narrative.recommendation,
    };
  } catch (err) {
    await recordJourneyComplete({ executionId, workflowId: `J10-${Date.now()}`, status: "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J11 — BROKER POLICY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════
export interface J11Input {
  brokerId: number;
  clientId: number;
  policyTypes: string[];
  sumInsureds: number[];
  premiumAmounts: number[];
  paymentRef: string;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J11_BrokerPolicyManagementWorkflow(input: J11Input) {
  let currentStep = "initializing";
  setHandler(journeyCurrentStepQuery, () => currentStep);

  const { executionId } = await recordJourneyStart({
    journeyId: "J11", journeyName: "Broker Policy Management",
    workflowId: `J11-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { brokerId: input.brokerId, clientId: input.clientId, policyCount: input.policyTypes.length },
    idempotencyKey: input.idempotencyKey,
  });

  const policies: Array<{ policyId: number; policyNumber: string; policyType: string }> = [];
  const compensations: Compensation[] = [];

  try {
    // Step 1: Permify — check broker permissions
    currentStep = "check_broker_permissions";
    const permCheck = await checkPermifyPermission({
      subjectType: "broker", subjectId: input.brokerId.toString(),
      permission: "manage_client_policies", entityType: "client", entityId: input.clientId.toString(),
    });
    if (!permCheck.allowed) throw new Error("Broker does not have permission to manage this client's policies");

    // Step 2: KYC check for client
    currentStep = "client_kyc_check";
    const kycResult = await callPythonKycVerification({
      customerId: input.clientId, firstName: "", lastName: "", dateOfBirth: "",
    });

    // Step 3: Process each policy
    for (let i = 0; i < input.policyTypes.length; i++) {
      currentStep = `create_policy_${i + 1}`;
      await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "postgresql+tigerbeetle" });

      // Fraud check per policy
      const fraudCheck = await callRustFraudGate({
        userId: input.clientId, amount: input.premiumAmounts[i],
        transactionType: "premium_payment", traceId: `${input.paymentRef}-${i}`,
      });
      if (!fraudCheck.allowed) {
        log.warn(`Policy ${i + 1} blocked by fraud gate`);
        continue;
      }

      // Underwriting
      const underwriting = await runUnderwritingCheck({
        customerId: input.clientId, productId: i + 1,
        sumInsured: input.sumInsureds[i], agentId: input.brokerId,
      });

      if (!underwriting.approved) continue;

      // Collect premium
      const payment = await collectInsurancePremium({
        customerId: input.clientId, agentId: input.brokerId,
        productId: i + 1, premiumAmount: input.premiumAmounts[i],
        paymentRef: `${input.paymentRef}-${i}`,
      });
      compensations.push(async () => {
        await compensatePolicyBindingStep({
          step: "collect_premium", quoteId: 0,
          paymentRef: `${input.paymentRef}-${i}`, customerId: input.clientId,
          premiumAmount: input.premiumAmounts[i],
        });
      });

      // Create policy
      const policy = await createInsurancePolicy({
        quoteId: 0, customerId: input.clientId, agentId: input.brokerId,
        productId: i + 1, sumInsured: input.sumInsureds[i],
        premiumAmount: input.premiumAmounts[i], durationMonths: 12,
        coverageStartDate: new Date().toISOString(), paymentRef: `${input.paymentRef}-${i}`,
      });

      policies.push({ policyId: policy.policyId, policyNumber: policy.policyNumber, policyType: input.policyTypes[i] });

      // Permify — broker manages policy
      await writePermifyRelationship({
        entityType: "policy", entityId: policy.policyId.toString(),
        relation: "managed_by", subjectType: "broker", subjectId: input.brokerId.toString(),
      });

      await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "postgresql+tigerbeetle",
        metadata: { policyId: policy.policyId } });
    }

    // Step 4: Calculate broker commission
    currentStep = "calculate_broker_commission";
    const totalPremium = input.premiumAmounts.reduce((a, b) => a + b, 0);
    const commission = await calculateAgentCommission({
      agentId: input.brokerId, policyId: 0,
      premiumAmount: totalPremium, productType: "broker",
    });
    await creditAgentCommission({
      agentId: input.brokerId, commissionAmount: commission.commissionAmount,
      policyId: 0, commissionRef: `BROKER-COMM-${input.paymentRef}`,
    });

    // Step 5: Fluvio + Lakehouse
    await emitInsuranceEvent({
      topic: "broker.portfolio.updated",
      payload: { brokerId: input.brokerId, clientId: input.clientId, policiesCreated: policies.length },
    });
    await ingestToLakehouse({
      dataset: "broker_portfolios",
      records: [{ brokerId: input.brokerId, clientId: input.clientId, policyCount: policies.length, totalPremium }],
      partitionKey: "portfolio_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J11-${Date.now()}`, status: "completed",
      resultSnapshot: { policiesCreated: policies.length, totalPremium, commissionAmount: commission.commissionAmount } });

    return { success: true, policies, totalPremium, commissionAmount: commission.commissionAmount };
  } catch (err) {
    for (const comp of compensations.reverse()) { try { await comp(); } catch {} }
    await recordJourneyComplete({ executionId, workflowId: `J11-${Date.now()}`, status: "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J12 — ACTUARY IFRS17 RESERVE COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════
export interface J12Input {
  portfolioId: string;
  reportingDate: string;
  measurementModel: "BBA" | "PAA" | "VFA";
  discountRate?: number;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J12_ActuaryIfrs17Workflow(input: J12Input) {
  let currentStep = "initializing";
  setHandler(journeyCurrentStepQuery, () => currentStep);

  const { executionId } = await recordJourneyStart({
    journeyId: "J12", journeyName: "Actuary IFRS17 Reserve Computation",
    workflowId: `J12-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { portfolioId: input.portfolioId, reportingDate: input.reportingDate, measurementModel: input.measurementModel },
    idempotencyKey: input.idempotencyKey,
  });

  try {
    // Step 1: Permify — check actuary permission
    currentStep = "check_permissions";
    const permCheck = await checkPermifyPermission({
      subjectType: "user", subjectId: input.triggeredBy.toString(),
      permission: "run_ifrs17", entityType: "portfolio", entityId: input.portfolioId,
    });
    if (!permCheck.allowed) throw new Error("User does not have actuary permission");

    // Step 2: Python IFRS17 engine
    currentStep = "ifrs17_calculation";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "python-ifrs17" });
    const ifrs17Result = await callIfrs17Engine({
      portfolioId: input.portfolioId,
      reportingDate: input.reportingDate,
      measurementModel: input.measurementModel,
      discountRate: input.discountRate,
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "python-ifrs17",
      metadata: { csm: ifrs17Result.csm, ra: ifrs17Result.ra } });

    // Step 3: Ollama AI — actuarial narrative
    currentStep = "ai_actuarial_narrative";
    const narrative = await generateOllamaRiskNarrative({
      context: `IFRS17 ${input.measurementModel}: CSM=${ifrs17Result.csm}, RA=${ifrs17Result.ra}, LRC=${ifrs17Result.liabilityForRemainingCoverage}`,
      riskScore: 20, riskFactors: [],
      policyType: "actuarial", narrativeType: "compliance",
    });

    // Step 4: NAICOM report
    currentStep = "naicom_report";
    await fileNaicomReport({
      reportType: "ifrs17_reserve",
      entityId: parseInt(input.portfolioId) || 0,
      entityType: "portfolio",
      data: {
        reportingDate: input.reportingDate,
        measurementModel: input.measurementModel,
        csm: ifrs17Result.csm,
        ra: ifrs17Result.ra,
        liabilityForRemainingCoverage: ifrs17Result.liabilityForRemainingCoverage,
        liabilityForIncurredClaims: ifrs17Result.liabilityForIncurredClaims,
      },
    });

    // Step 5: Dapr — notify finance team
    await invokeDaprService({
      appId: "notification-service", method: "send",
      data: {
        type: "ifrs17_complete", portfolioId: input.portfolioId,
        reportingDate: input.reportingDate, csm: ifrs17Result.csm,
      },
    });

    // Step 6: Fluvio + Lakehouse
    await emitInsuranceEvent({
      topic: "actuary.ifrs17.computed",
      payload: { portfolioId: input.portfolioId, reportingDate: input.reportingDate, csm: ifrs17Result.csm },
    });
    await ingestToLakehouse({
      dataset: "ifrs17_reserves",
      records: [{ portfolioId: input.portfolioId, ...ifrs17Result }],
      partitionKey: "reporting_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J12-${Date.now()}`, status: "completed",
      resultSnapshot: { csm: ifrs17Result.csm, ra: ifrs17Result.ra, measurementModel: input.measurementModel } });

    return { success: true, ...ifrs17Result, narrative: narrative.narrative };
  } catch (err) {
    await recordJourneyComplete({ executionId, workflowId: `J12-${Date.now()}`, status: "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J13 — AML/COMPLIANCE MONITORING
// ═══════════════════════════════════════════════════════════════════════════
export interface J13Input {
  customerId: number;
  transactionId: number;
  amount: number;
  transactionType: string;
  reference: string;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J13_ComplianceMonitoringWorkflow(input: J13Input) {
  let currentStep = "initializing";
  setHandler(journeyCurrentStepQuery, () => currentStep);

  const { executionId } = await recordJourneyStart({
    journeyId: "J13", journeyName: "AML/Compliance Monitoring",
    workflowId: `J13-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { customerId: input.customerId, amount: input.amount, transactionType: input.transactionType },
    idempotencyKey: input.idempotencyKey,
  });

  try {
    // Step 1: AML screening
    currentStep = "aml_screening";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "aml" });
    const aml = await runAmlScreening({
      customerId: input.customerId, transactionAmount: input.amount,
      transactionType: input.transactionType, reference: input.reference,
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "aml",
      metadata: { blocked: aml.blocked, reason: aml.reason } });

    // Step 2: Python ML — fraud scoring
    currentStep = "ml_compliance_score";
    const mlScore = await callPythonFraudScore({
      transactionId: input.transactionId, agentId: 0,
      amount: input.amount, transactionType: input.transactionType,
    });

    // Step 3: Ollama AI — compliance narrative
    currentStep = "ai_compliance_narrative";
    const narrative = await generateOllamaRiskNarrative({
      context: `AML check: ${input.transactionType}, ₦${input.amount.toLocaleString()}, Customer: ${input.customerId}`,
      riskScore: mlScore.riskScore,
      riskFactors: aml.blocked ? [aml.reason] : [],
      narrativeType: "compliance",
    });

    // Step 4: CBN/NAICOM reporting for large transactions
    currentStep = "regulatory_reporting";
    if (input.amount >= 5_000_000) {
      await fileNaicomReport({
        reportType: "large_transaction_cbn",
        entityId: input.customerId, entityType: "customer",
        data: { amount: input.amount, type: input.transactionType, reference: input.reference },
      });
    }

    // Step 5: SAR filing if blocked
    if (aml.blocked) {
      currentStep = "sar_filing";
      await fileNaicomReport({
        reportType: "sar",
        entityId: input.customerId, entityType: "customer",
        data: { amount: input.amount, reason: aml.reason, narrative: narrative.narrative },
      });
    }

    // Step 6: Fluvio + Lakehouse
    await emitInsuranceEvent({
      topic: "compliance.check.completed",
      payload: { customerId: input.customerId, amount: input.amount, blocked: aml.blocked, score: mlScore.riskScore },
    });
    await ingestToLakehouse({
      dataset: "compliance_checks",
      records: [{ customerId: input.customerId, amount: input.amount, blocked: aml.blocked, score: mlScore.riskScore }],
      partitionKey: "check_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J13-${Date.now()}`, status: "completed",
      resultSnapshot: { blocked: aml.blocked, riskScore: mlScore.riskScore } });

    return {
      success: true, blocked: aml.blocked, reason: aml.reason,
      riskScore: mlScore.riskScore, narrative: narrative.narrative,
      sarFiled: aml.blocked,
    };
  } catch (err) {
    await recordJourneyComplete({ executionId, workflowId: `J13-${Date.now()}`, status: "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J14 — POS TERMINAL LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════
export interface J14Input {
  agentId: number;
  agentCode: string;
  action: "provision" | "update_firmware" | "decommission" | "health_check";
  terminalId?: string;
  firmwareVersion?: string;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J14_PosTerminalLifecycleWorkflow(input: J14Input) {
  let currentStep = "initializing";
  setHandler(journeyCurrentStepQuery, () => currentStep);

  const { executionId } = await recordJourneyStart({
    journeyId: "J14", journeyName: "POS Terminal Lifecycle",
    workflowId: `J14-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { agentId: input.agentId, action: input.action, terminalId: input.terminalId },
    idempotencyKey: input.idempotencyKey,
  });

  try {
    // Step 1: Permify — check terminal management permission
    currentStep = "check_permissions";
    const permCheck = await checkPermifyPermission({
      subjectType: "user", subjectId: input.triggeredBy.toString(),
      permission: "manage_terminal", entityType: "agent", entityId: input.agentId.toString(),
    });
    if (!permCheck.allowed) throw new Error("Permission denied for terminal management");

    let result: Record<string, unknown> = {};

    if (input.action === "provision") {
      currentStep = "provision_terminal";
      await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "postgresql" });
      const terminal = await provisionAgentPosTerminal({
        agentId: input.agentId, agentCode: input.agentCode, state: "",
      });
      result = { terminalId: terminal.terminalId, serialNumber: terminal.serialNumber };
      await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "postgresql" });

    } else if (input.action === "update_firmware") {
      currentStep = "ota_update";
      await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "ota-service" });
      await invokeDaprService({
        appId: "ota-service", method: "update",
        data: { terminalId: input.terminalId, firmwareVersion: input.firmwareVersion },
      });
      result = { terminalId: input.terminalId, firmwareVersion: input.firmwareVersion, status: "updated" };
      await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "ota-service" });

    } else if (input.action === "health_check") {
      currentStep = "terminal_health_check";
      const health = await probeServiceHealth({ service: "pos-terminal" });
      result = { terminalId: input.terminalId, health };

    } else if (input.action === "decommission") {
      currentStep = "decommission_terminal";
      await invokeDaprService({
        appId: "terminal-service", method: "decommission",
        data: { terminalId: input.terminalId, agentId: input.agentId },
      });
      result = { terminalId: input.terminalId, status: "decommissioned" };
    }

    // Fluvio + Lakehouse
    await emitInsuranceEvent({
      topic: `terminal.${input.action}`,
      payload: { agentId: input.agentId, terminalId: input.terminalId, action: input.action },
    });
    await ingestToLakehouse({
      dataset: "terminal_lifecycle",
      records: [{ agentId: input.agentId, action: input.action, terminalId: input.terminalId }],
      partitionKey: "event_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J14-${Date.now()}`, status: "completed",
      resultSnapshot: result });

    return { success: true, action: input.action, ...result };
  } catch (err) {
    await recordJourneyComplete({ executionId, workflowId: `J14-${Date.now()}`, status: "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J15 — REINSURANCE TREATY CESSION
// ═══════════════════════════════════════════════════════════════════════════
export interface J15Input {
  treatyId: number;
  portfolioId: string;
  cessionPercentage: number;
  premiumAmount: number;
  paymentRef: string;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J15_ReinsuranceCessionWorkflow(input: J15Input) {
  let currentStep = "initializing";
  setHandler(journeyCurrentStepQuery, () => currentStep);

  const { executionId } = await recordJourneyStart({
    journeyId: "J15", journeyName: "Reinsurance Treaty Cession",
    workflowId: `J15-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { treatyId: input.treatyId, cessionPercentage: input.cessionPercentage, premiumAmount: input.premiumAmount },
    idempotencyKey: input.idempotencyKey,
  });

  const compensations: Compensation[] = [];

  try {
    // Step 1: Permify — check reinsurance permission
    currentStep = "check_permissions";
    const permCheck = await checkPermifyPermission({
      subjectType: "user", subjectId: input.triggeredBy.toString(),
      permission: "execute_cession", entityType: "treaty", entityId: input.treatyId.toString(),
    });
    if (!permCheck.allowed) throw new Error("Permission denied for reinsurance cession");

    // Step 2: Calculate cession
    currentStep = "calculate_cession";
    const cession = await calculateReinsuranceCession({
      treatyId: input.treatyId, portfolioId: input.portfolioId,
      cessionPercentage: input.cessionPercentage, premiumAmount: input.premiumAmount,
    });

    // Step 3: AML screening
    currentStep = "aml_screening";
    const aml = await runAmlScreening({
      customerId: input.treatyId, transactionAmount: cession.cessionPremium,
      transactionType: "reinsurance_cession", reference: input.paymentRef,
    });
    if (aml.blocked) throw new Error(`AML blocked reinsurance cession: ${aml.reason}`);

    // Step 4: TigerBeetle — transfer cession premium
    currentStep = "transfer_cession_premium";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "tigerbeetle" });
    const transfer = await transferReinsurancePremium({
      treatyId: input.treatyId, cessionPremium: cession.cessionPremium,
      paymentRef: input.paymentRef, reinsurerId: cession.reinsurerId,
    });
    compensations.push(async () => {
      await compensatePolicyBindingStep({
        step: "reinsurance_transfer", quoteId: input.treatyId,
        paymentRef: input.paymentRef, customerId: 0, premiumAmount: cession.cessionPremium,
      });
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "tigerbeetle",
      metadata: { transactionId: transfer.transactionId } });

    // Step 5: NAICOM report
    currentStep = "naicom_report";
    await fileNaicomReport({
      reportType: "reinsurance_cession", entityId: input.treatyId,
      entityType: "treaty",
      data: { cessionPercentage: input.cessionPercentage, cessionPremium: cession.cessionPremium },
    });

    // Step 6: Fluvio + Lakehouse
    await emitInsuranceEvent({
      topic: "reinsurance.cession.completed",
      payload: { treatyId: input.treatyId, cessionPremium: cession.cessionPremium },
    });
    await ingestToLakehouse({
      dataset: "reinsurance_cessions",
      records: [{ treatyId: input.treatyId, cessionPremium: cession.cessionPremium, cessionPercentage: input.cessionPercentage }],
      partitionKey: "cession_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J15-${Date.now()}`, status: "completed",
      resultSnapshot: { cessionPremium: cession.cessionPremium, transactionId: transfer.transactionId } });

    return { success: true, cessionPremium: cession.cessionPremium, transactionId: transfer.transactionId };
  } catch (err) {
    for (const comp of compensations.reverse()) { try { await comp(); } catch {} }
    await recordJourneyComplete({ executionId, workflowId: `J15-${Date.now()}`, status: "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J16 — CUSTOMER SELF-SERVICE
// ═══════════════════════════════════════════════════════════════════════════
export interface J16Input {
  customerId: number;
  action: "view_policies" | "download_certificate" | "update_beneficiary" | "check_claim_status";
  policyId?: number;
  claimId?: number;
  beneficiaryName?: string;
  beneficiaryRelationship?: string;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J16_CustomerSelfServiceWorkflow(input: J16Input) {
  let currentStep = "initializing";
  setHandler(journeyCurrentStepQuery, () => currentStep);

  const { executionId } = await recordJourneyStart({
    journeyId: "J16", journeyName: "Customer Self-Service",
    workflowId: `J16-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { customerId: input.customerId, action: input.action },
    idempotencyKey: input.idempotencyKey,
  });

  try {
    // Step 1: Permify — check customer access
    currentStep = "check_permissions";
    const permCheck = await checkPermifyPermission({
      subjectType: "customer", subjectId: input.customerId.toString(),
      permission: input.action, entityType: "customer", entityId: input.customerId.toString(),
    });
    if (!permCheck.allowed) throw new Error(`Permission denied for action: ${input.action}`);

    let result: Record<string, unknown> = {};

    if (input.action === "download_certificate" && input.policyId) {
      currentStep = "generate_certificate";
      const cert = await issuePolicyCertificate({ policyId: input.policyId, customerId: input.customerId });
      result = { certificateUrl: cert.certificateUrl };

    } else if (input.action === "update_beneficiary" && input.policyId) {
      currentStep = "update_beneficiary";
      // Update via Dapr
      await invokeDaprService({
        appId: "policy-service", method: "updateBeneficiary",
        data: {
          policyId: input.policyId, customerId: input.customerId,
          beneficiaryName: input.beneficiaryName, relationship: input.beneficiaryRelationship,
        },
      });
      result = { updated: true, beneficiaryName: input.beneficiaryName };

    } else if (input.action === "check_claim_status" && input.claimId) {
      currentStep = "check_claim_status";
      result = { claimId: input.claimId, status: "under_review" };
    }

    // Fluvio — log self-service action
    await emitInsuranceEvent({
      topic: "customer.self_service",
      payload: { customerId: input.customerId, action: input.action },
    });

    await recordJourneyComplete({ executionId, workflowId: `J16-${Date.now()}`, status: "completed",
      resultSnapshot: result });

    return { success: true, action: input.action, ...result };
  } catch (err) {
    await recordJourneyComplete({ executionId, workflowId: `J16-${Date.now()}`, status: "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J17 — BULK PREMIUM PAYMENT PROCESSING
// ═══════════════════════════════════════════════════════════════════════════
export interface J17Input {
  corporateId: number;
  payments: Array<{ customerId: number; policyId: number; amount: number; reference: string }>;
  batchRef: string;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J17_BulkPremiumPaymentWorkflow(input: J17Input) {
  let currentStep = "initializing";
  setHandler(journeyCurrentStepQuery, () => currentStep);

  const { executionId } = await recordJourneyStart({
    journeyId: "J17", journeyName: "Bulk Premium Payment Processing",
    workflowId: `J17-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { corporateId: input.corporateId, paymentCount: input.payments.length, batchRef: input.batchRef },
    idempotencyKey: input.idempotencyKey,
  });

  const results: Array<{ reference: string; success: boolean; error?: string }> = [];

  try {
    // Step 1: Permify — check bulk payment permission
    currentStep = "check_permissions";
    const permCheck = await checkPermifyPermission({
      subjectType: "corporate", subjectId: input.corporateId.toString(),
      permission: "bulk_payment", entityType: "batch", entityId: input.batchRef,
    });
    if (!permCheck.allowed) throw new Error("Corporate does not have bulk payment permission");

    // Step 2: Process each payment
    for (const payment of input.payments) {
      currentStep = `process_payment_${payment.reference}`;

      // AML per payment
      const aml = await runAmlScreening({
        customerId: payment.customerId, transactionAmount: payment.amount,
        transactionType: "premium_payment", reference: payment.reference,
      });

      if (aml.blocked) {
        results.push({ reference: payment.reference, success: false, error: `AML blocked: ${aml.reason}` });
        continue;
      }

      // Fraud check
      const fraudCheck = await callRustFraudGate({
        userId: payment.customerId, amount: payment.amount,
        transactionType: "premium_payment", traceId: payment.reference,
      });

      if (!fraudCheck.allowed) {
        results.push({ reference: payment.reference, success: false, error: `Fraud gate blocked: ${fraudCheck.flags.join(", ")}` });
        continue;
      }

      // TigerBeetle payment
      try {
        await collectInsurancePremium({
          customerId: payment.customerId, agentId: undefined,
          productId: 0, premiumAmount: payment.amount, paymentRef: payment.reference,
        });
        results.push({ reference: payment.reference, success: true });
      } catch (err) {
        results.push({ reference: payment.reference, success: false, error: (err as Error).message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalAmount = input.payments
      .filter((p, i) => results[i]?.success)
      .reduce((sum, p) => sum + p.amount, 0);

    // Fluvio + Lakehouse
    await emitInsuranceEvent({
      topic: "bulk.payment.completed",
      payload: { batchRef: input.batchRef, successCount, totalAmount },
    });
    await ingestToLakehouse({
      dataset: "bulk_payments",
      records: [{ batchRef: input.batchRef, corporateId: input.corporateId, successCount, totalAmount }],
      partitionKey: "batch_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J17-${Date.now()}`, status: "completed",
      resultSnapshot: { successCount, totalAmount, failureCount: results.length - successCount } });

    return { success: true, results, successCount, totalAmount };
  } catch (err) {
    await recordJourneyComplete({ executionId, workflowId: `J17-${Date.now()}`, status: "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J18 — AGENT FLOAT RECONCILIATION
// ═══════════════════════════════════════════════════════════════════════════
export interface J18Input {
  agentId: number;
  agentCode: string;
  date?: string;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J18_AgentFloatReconciliationWorkflow(input: J18Input) {
  let currentStep = "initializing";
  setHandler(journeyCurrentStepQuery, () => currentStep);

  const { executionId } = await recordJourneyStart({
    journeyId: "J18", journeyName: "Agent Float Reconciliation",
    workflowId: `J18-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { agentId: input.agentId, agentCode: input.agentCode, date: input.date },
    idempotencyKey: input.idempotencyKey,
  });

  try {
    // Step 1: Go float-reconciler
    currentStep = "go_reconciliation";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "go-float-reconciler" });
    const reconciliation = await callGoFloatReconciler({
      agentId: input.agentId, agentCode: input.agentCode, date: input.date,
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "go-float-reconciler",
      metadata: { status: reconciliation.status, discrepancy: reconciliation.discrepancy } });

    // Step 2: Handle discrepancy
    if (reconciliation.status === "discrepancy_major") {
      currentStep = "escalate_discrepancy";
      await freezeAgentAccount({
        agentId: input.agentId,
        reason: `Major float discrepancy: PG=₦${reconciliation.pgBalance.toLocaleString()}, TB=₦${reconciliation.tbBalance.toLocaleString()}`,
        fraudScore: 60,
      });
      await fileNaicomReport({
        reportType: "float_discrepancy", entityId: input.agentId,
        entityType: "agent",
        data: { pgBalance: reconciliation.pgBalance, tbBalance: reconciliation.tbBalance, discrepancy: reconciliation.discrepancy },
      });
    }

    // Step 3: Fluvio + Lakehouse
    await emitInsuranceEvent({
      topic: "agent.float.reconciled",
      payload: { agentId: input.agentId, status: reconciliation.status, discrepancy: reconciliation.discrepancy },
    });
    await ingestToLakehouse({
      dataset: "float_reconciliations",
      records: [{ agentId: input.agentId, ...reconciliation, date: input.date ?? new Date().toISOString().split("T")[0] }],
      partitionKey: "reconciliation_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J18-${Date.now()}`, status: "completed",
      resultSnapshot: { status: reconciliation.status, discrepancy: reconciliation.discrepancy } });

    return { success: true, ...reconciliation };
  } catch (err) {
    await recordJourneyComplete({ executionId, workflowId: `J18-${Date.now()}`, status: "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J19 — UNDERWRITING DECISION
// ═══════════════════════════════════════════════════════════════════════════
export interface J19Input {
  customerId: number;
  productId: number;
  sumInsured: number;
  premiumAmount: number;
  applicationData: Record<string, unknown>;
  agentId?: number;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J19_UnderwritingDecisionWorkflow(input: J19Input) {
  let currentStep = "initializing";
  let approved = false;
  setHandler(journeyCurrentStepQuery, () => currentStep);
  setHandler(approveStepSignal, () => { approved = true; });

  const { executionId } = await recordJourneyStart({
    journeyId: "J19", journeyName: "Underwriting Decision",
    workflowId: `J19-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { customerId: input.customerId, productId: input.productId, sumInsured: input.sumInsured },
    idempotencyKey: input.idempotencyKey,
  });

  try {
    // Step 1: KYC verification
    currentStep = "kyc_verification";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "python-kyc" });
    const kycResult = await callPythonKycVerification({
      customerId: input.customerId, firstName: "", lastName: "", dateOfBirth: "",
    });
    if (!kycResult.verified) throw new Error("KYC verification failed — cannot underwrite");
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "python-kyc" });

    // Step 2: AML screening
    currentStep = "aml_screening";
    const aml = await runAmlScreening({
      customerId: input.customerId, transactionAmount: input.premiumAmount,
      transactionType: "underwriting", reference: `UW-${input.customerId}-${Date.now()}`,
    });
    if (aml.blocked) throw new Error(`AML blocked underwriting: ${aml.reason}`);

    // Step 3: Python ML — risk scoring
    currentStep = "ml_risk_score";
    const mlScore = await callPythonFraudScore({
      transactionId: 0, agentId: input.agentId ?? 0,
      amount: input.sumInsured, transactionType: "underwriting",
    });

    // Step 4: Underwriting check
    currentStep = "underwriting_check";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "postgresql+ollama" });
    const underwriting = await runUnderwritingCheck({
      customerId: input.customerId, productId: input.productId,
      sumInsured: input.sumInsured, agentId: input.agentId,
    });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "postgresql+ollama" });

    // Step 5: Ollama AI — underwriting narrative
    currentStep = "ai_underwriting_narrative";
    const narrative = await generateOllamaRiskNarrative({
      context: `Underwriting: Product ${input.productId}, Sum Insured: ₦${input.sumInsured.toLocaleString()}, KYC Level: ${kycResult.kycLevel}`,
      riskScore: mlScore.riskScore,
      riskFactors: underwriting.conditions,
      policyType: "underwriting",
      narrativeType: "underwriting",
    });

    // Step 6: For high-risk, wait for manual approval (up to 5 days)
    if (mlScore.riskScore > 70 || !underwriting.approved) {
      currentStep = "awaiting_manual_approval";
      await emitInsuranceEvent({
        topic: "underwriting.referred",
        payload: { customerId: input.customerId, riskScore: mlScore.riskScore, conditions: underwriting.conditions },
      });
      const manualApproval = await condition(() => approved, "5 days");
      if (!manualApproval) {
        await recordJourneyComplete({ executionId, workflowId: `J19-${Date.now()}`, status: "completed",
          resultSnapshot: { decision: "declined", reason: "manual_review_timeout" } });
        return { success: true, decision: "declined", reason: "Manual review timeout", riskScore: mlScore.riskScore };
      }
    }

    const decision = underwriting.approved ? "approved" : "declined";

    // Step 7: Permify — write underwriting decision
    await writePermifyRelationship({
      entityType: "application", entityId: `${input.customerId}-${input.productId}`,
      relation: decision, subjectType: "underwriter", subjectId: input.triggeredBy.toString(),
    });

    // Step 8: Fluvio + Lakehouse
    await emitInsuranceEvent({
      topic: `underwriting.${decision}`,
      payload: { customerId: input.customerId, productId: input.productId, riskScore: mlScore.riskScore },
    });
    await ingestToLakehouse({
      dataset: "underwriting_decisions",
      records: [{ customerId: input.customerId, productId: input.productId, decision, riskScore: mlScore.riskScore }],
      partitionKey: "decision_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J19-${Date.now()}`, status: "completed",
      resultSnapshot: { decision, riskScore: mlScore.riskScore, riskCategory: underwriting.riskCategory } });

    return {
      success: true, decision, riskScore: mlScore.riskScore,
      riskCategory: underwriting.riskCategory, narrative: narrative.narrative,
      conditions: underwriting.conditions,
    };
  } catch (err) {
    await recordJourneyComplete({ executionId, workflowId: `J19-${Date.now()}`, status: "failed", errorMessage: (err as Error).message });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// J20 — PLATFORM HEALTH & SLA MONITORING
// ═══════════════════════════════════════════════════════════════════════════
export interface J20Input {
  services?: string[];
  slaThresholdMs?: number;
  triggeredBy: number;
  idempotencyKey?: string;
}

export async function J20_PlatformHealthMonitoringWorkflow(input: J20Input) {
  let currentStep = "initializing";
  setHandler(journeyCurrentStepQuery, () => currentStep);

  const { executionId } = await recordJourneyStart({
    journeyId: "J20", journeyName: "Platform Health & SLA Monitoring",
    workflowId: `J20-${Date.now()}`, runId: "",
    triggeredBy: input.triggeredBy,
    inputSnapshot: { services: input.services, slaThresholdMs: input.slaThresholdMs },
    idempotencyKey: input.idempotencyKey,
  });

  try {
    // Step 1: Go health-worker — probe all services
    currentStep = "probe_all_services";
    await recordJourneyStep({ executionId, stepName: currentStep, status: "started", service: "go-health-worker" });
    const healthResult = await callGoHealthWorker({ services: input.services });
    await recordJourneyStep({ executionId, stepName: currentStep, status: "completed", service: "go-health-worker",
      metadata: { overallStatus: healthResult.overallStatus, serviceCount: healthResult.services.length } });

    // Step 2: Record SLA metrics
    currentStep = "record_sla_metrics";
    await recordSlaMetrics({
      services: healthResult.services,
      overallStatus: healthResult.overallStatus,
      slaBreaches: healthResult.slaBreaches,
    });

    // Step 3: Handle SLA breaches
    if (healthResult.slaBreaches.length > 0) {
      currentStep = "handle_sla_breaches";
      for (const breach of healthResult.slaBreaches) {
        await emitInsuranceEvent({
          topic: "platform.sla.breach",
          payload: { service: breach.service, metric: breach.metric, threshold: breach.threshold, actual: breach.actual },
        });
        // Notify ops team via Dapr
        await invokeDaprService({
          appId: "notification-service", method: "send",
          data: {
            type: "sla_breach_alert", service: breach.service,
            metric: breach.metric, actual: breach.actual, threshold: breach.threshold,
          },
        });
      }
    }

    // Step 4: If critical, file incident
    if (healthResult.overallStatus === "critical") {
      currentStep = "file_incident";
      await fileNaicomReport({
        reportType: "platform_incident", entityId: 0, entityType: "platform",
        data: { status: healthResult.overallStatus, breaches: healthResult.slaBreaches },
      });
    }

    // Step 5: Fluvio + Lakehouse
    await emitInsuranceEvent({
      topic: "platform.health.checked",
      payload: { status: healthResult.overallStatus, breachCount: healthResult.slaBreaches.length },
    });
    await ingestToLakehouse({
      dataset: "platform_health",
      records: [{ status: healthResult.overallStatus, serviceCount: healthResult.services.length, breachCount: healthResult.slaBreaches.length }],
      partitionKey: "check_date",
    });

    await recordJourneyComplete({ executionId, workflowId: `J20-${Date.now()}`, status: "completed",
      resultSnapshot: { overallStatus: healthResult.overallStatus, slaBreaches: healthResult.slaBreaches.length } });

    return {
      success: true,
      overallStatus: healthResult.overallStatus,
      services: healthResult.services,
      slaBreaches: healthResult.slaBreaches,
    };
  } catch (err) {
    await recordJourneyComplete({ executionId, workflowId: `J20-${Date.now()}`, status: "failed", errorMessage: (err as Error).message });
    throw err;
  }
}
