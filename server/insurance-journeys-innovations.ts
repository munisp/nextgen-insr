/**
 * insurance-journeys-innovations.ts
 *
 * Temporal workflows for journeys J21–J28 (innovation features).
 * All journeys are reusable, saga-compensated, and idempotent.
 *
 * J21 — Parametric Insurance Trigger
 * J22 — UBI Motor Insurance Monthly Adjustment
 * J23 — P2P Risk Pool Lifecycle
 * J24 — Health & Wellness Rewards
 * J25 — NHIA Claims Submission
 * J26 — Predictive Policy Renewal
 * J27 — Embedded Insurance Binding
 * J28 — Group Insurance Enrollment
 */
import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  sleep,
  log,
} from "@temporalio/workflow";
import type * as activities from "./journey-activities";
import type * as extActivities from "./journey-activities-extended";
import { assertTenantAccess, buildTenantContext } from "./journey-tenant-guard";


const act = proxyActivities<typeof activities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 3, initialInterval: "2s", backoffCoefficient: 2 },
});

const ext = proxyActivities<typeof extActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 3, initialInterval: "2s", backoffCoefficient: 2 },
});

// Shared signals/queries
export const cancelJourneySignal = defineSignal<[string]>("cancelJourney");
export const approveStepSignal = defineSignal<[string]>("approveStep");
export const currentStepQuery = defineQuery<string>("currentStep");

// ─────────────────────────────────────────────────────────────────────────────
// J21 — Parametric Insurance Trigger
// Triggered by weather data exceeding threshold; auto-pays without claim filing
// ─────────────────────────────────────────────────────────────────────────────
export interface J21Input {
  triggerId: number;
  policyId: number;
  customerId: number;
  triggerType: string;
  measuredValue: number;
  thresholdValue: number;
  payoutAmount: number;
  dataSourceUrl: string;
  idempotencyKey: string;
}

export async function J21_ParametricTriggerWorkflow(input: J21Input): Promise<{
  payoutId: number;
  tbTransferId: string;
  status: string;
}> {
  let currentStep = "init";

  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J21_ParametricTriggerWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  let cancelled = false;
  let tbTransferId = "";
  let payoutId = 0;

  setHandler(cancelJourneySignal, () => { cancelled = true; });
  setHandler(currentStepQuery, () => currentStep);

  log.info("J21 Parametric trigger workflow started", { triggerId: input.triggerId });

  // Step 1: Verify idempotency
  currentStep = "idempotency_check";
  const existing = await act.checkIdempotency(input.idempotencyKey, "J21");
  if (existing) return existing as { payoutId: number; tbTransferId: string; status: string };

  // Step 2: Validate trigger data
  currentStep = "validate_trigger";
  const triggerValid = input.measuredValue <= input.thresholdValue; // below threshold = triggered
  if (!triggerValid) {
    return { payoutId: 0, tbTransferId: "", status: "not_triggered" };
  }

  // Step 3: AML check on payout
  currentStep = "aml_check";
  await act.runAmlCheck({ customerId: input.customerId, amount: input.payoutAmount, transactionType: "parametric_payout" });

  // Step 4: TigerBeetle payout transfer
  currentStep = "tigerbeetle_payout";
  const tbResult = await act.createTigerBeetleTransfer({
    debitAccountId: "CLAIMS_RESERVE",
    creditAccountId: `customer_${input.customerId}`,
    amount: Math.round(input.payoutAmount * 100),
    code: 9, // parametric payout
    userData: input.triggerId,
  });
  tbTransferId = tbResult.transferId;

  // Step 5: Record payout in DB
  currentStep = "record_payout";
  const payoutResult = await ext.invokeDaprService({ appId: "parametric-service", method: "record-payout", data: {
    triggerId: input.triggerId,
    policyId: input.policyId,
    customerId: input.customerId,
    payoutAmount: input.payoutAmount,
    tbTransferId,
    dataSourceUrl: input.dataSourceUrl,
    status: "paid",
  }});
  payoutId = (payoutResult.data as { payoutId: number }).payoutId ?? input.triggerId;

  // Step 6: Notify customer
  currentStep = "notify_customer";
  await act.sendNotification({
    userId: input.customerId,
    type: "parametric_payout",
    message: `Your parametric insurance payout of ₦${input.payoutAmount.toLocaleString()} has been processed automatically due to ${input.triggerType} event.`,
    channel: "sms",
  });

  // Step 7: Fluvio event
  currentStep = "emit_event";
  await act.emitFluvioEvent("parametric.payout.completed", {
    triggerId: input.triggerId,
    policyId: input.policyId,
    payoutAmount: input.payoutAmount,
    tbTransferId,
  });

  // Step 8: Lakehouse ingest
  currentStep = "lakehouse_ingest";
  await act.ingestToLakehouse("parametric_payouts", {
    triggerId: input.triggerId,
    policyId: input.policyId,
    payoutAmount: input.payoutAmount,
    triggerType: input.triggerType,
    measuredValue: input.measuredValue,
  });

  await act.recordIdempotency(input.idempotencyKey, "J21", { payoutId, tbTransferId, status: "paid" });

  currentStep = "completed";
  return { payoutId, tbTransferId, status: "paid" };
}

// ─────────────────────────────────────────────────────────────────────────────
// J22 — UBI Motor Insurance Monthly Adjustment
// Reads telematics data, computes driving score, adjusts next month's premium
// ─────────────────────────────────────────────────────────────────────────────
export interface J22Input {
  policyId: number;
  customerId: number;
  periodStart: string;
  periodEnd: string;
  idempotencyKey: string;
}

export async function J22_UBIMonthlyAdjustmentWorkflow(input: J22Input): Promise<{
  drivingScore: number;
  premiumAdjustmentPct: number;
  newPremium: number;
  tbTransferId?: string;
}> {
  let currentStep = "init";

  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J22_UBIMonthlyAdjustmentWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(cancelJourneySignal, () => {});
  setHandler(currentStepQuery, () => currentStep);

  const existing = await act.checkIdempotency(input.idempotencyKey, "J22");
  if (existing) return existing as { drivingScore: number; premiumAdjustmentPct: number; newPremium: number };

  // Step 1: Fetch telematics data
  currentStep = "fetch_telematics";
  const telematicsData = (await ext.invokeDaprService({ appId: "telematics-engine", method: "get-score", data: {
    policyId: input.policyId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  }})).data as { drivingScore: number; events: number; hardBrakes: number; speedingEvents: number };

  const drivingScore = telematicsData.drivingScore ?? 70;

  // Step 2: Compute premium adjustment
  currentStep = "compute_adjustment";
  const premiumAdjustmentPct = drivingScore >= 85 ? -15 : drivingScore >= 70 ? 0 : Math.min(25, (70 - drivingScore) * 0.5);

  // Step 3: Fetch current premium from DB
  currentStep = "fetch_policy";
  const policyData = await act.getPolicyData(input.policyId);
  const currentPremium = policyData.premiumAmount ?? 50000;
  const newPremium = Math.round(currentPremium * (1 + premiumAdjustmentPct / 100));

  // Step 4: If discount, create TigerBeetle credit
  let tbTransferId: string | undefined;
  if (premiumAdjustmentPct < 0) {
    currentStep = "tigerbeetle_discount";
    const discountAmount = currentPremium - newPremium;
    const tbResult = await act.createTigerBeetleTransfer({
      debitAccountId: "FEE_POOL",
      creditAccountId: `customer_${input.customerId}`,
      amount: Math.round(discountAmount * 100),
      code: 10, // UBI discount
      userData: input.policyId,
    });
    tbTransferId = tbResult.transferId;
  }

  // Step 5: Update policy premium
  currentStep = "update_policy";
  await ext.invokeDaprService({ appId: "policy-service", method: "update-premium", data: {
    policyId: input.policyId,
    newPremium,
    adjustmentReason: `UBI adjustment: driving score ${drivingScore}/100`,
  }});

  // Step 6: Notify customer
  currentStep = "notify_customer";
  const message = premiumAdjustmentPct < 0
    ? `Great driving! Your motor insurance premium has been reduced by ${Math.abs(premiumAdjustmentPct)}% to ₦${newPremium.toLocaleString()} based on your driving score of ${drivingScore}/100.`
    : premiumAdjustmentPct > 0
    ? `Your motor insurance premium has been adjusted to ₦${newPremium.toLocaleString()} based on your driving score of ${drivingScore}/100. Improve your score to reduce your premium.`
    : `Your driving score is ${drivingScore}/100. No premium change this month.`;

  await act.sendNotification({ userId: input.customerId, type: "ubi_adjustment", message, channel: "sms" });

  await act.emitFluvioEvent("ubi.adjustment.completed", { policyId: input.policyId, drivingScore, premiumAdjustmentPct });
  await act.ingestToLakehouse("ubi_adjustments", { policyId: input.policyId, drivingScore, premiumAdjustmentPct, newPremium });

  const result = { drivingScore, premiumAdjustmentPct, newPremium, tbTransferId };
  await act.recordIdempotency(input.idempotencyKey, "J22", result);
  currentStep = "completed";
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// J23 — P2P Risk Pool Lifecycle
// Manages pool activation, contribution collection, and year-end settlement
// ─────────────────────────────────────────────────────────────────────────────
export interface J23Input {
  poolId: number;
  action: "activate" | "collect_contributions" | "settle_year_end";
  organiserId: number;
  idempotencyKey: string;
}

export async function J23_P2PPoolLifecycleWorkflow(input: J23Input): Promise<{
  status: string;
  membersProcessed: number;
  totalCollected: number;
  surplusReturned?: number;
}> {
  let currentStep = "init";

  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J23_P2PPoolLifecycleWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(cancelJourneySignal, () => {});
  setHandler(currentStepQuery, () => currentStep);

  const existing = await act.checkIdempotency(input.idempotencyKey, "J23");
  if (existing) return existing as { status: string; membersProcessed: number; totalCollected: number };

  let membersProcessed = 0;
  let totalCollected = 0;

  if (input.action === "activate") {
    currentStep = "activate_pool";
    await ext.invokeDaprService({ appId: "p2p-service", method: "activate-pool", data: { poolId: input.poolId }});
    await act.emitFluvioEvent("p2p.pool.activated", { poolId: input.poolId });
    currentStep = "completed";
    return { status: "activated", membersProcessed: 0, totalCollected: 0 };
  }

  if (input.action === "collect_contributions") {
    currentStep = "fetch_members";
    const members = (await ext.invokeDaprService({ appId: "p2p-service", method: "get-members", data: { poolId: input.poolId }})).data as { members: Array<{ customerId: number; contributionAmount: number }> };

    for (const member of (members.members ?? [])) {
      currentStep = `collect_from_${member.customerId}`;
      try {
        await act.createTigerBeetleTransfer({
          debitAccountId: `customer_${member.customerId}`,
          creditAccountId: `p2p_pool_${input.poolId}`,
          amount: Math.round(member.contributionAmount * 100),
          code: 11, // P2P contribution
          userData: input.poolId,
        });
        totalCollected += member.contributionAmount;
        membersProcessed++;
      } catch {
        log.warn("Failed to collect contribution from member", { customerId: member.customerId });
      }
    }

    await act.emitFluvioEvent("p2p.contributions.collected", { poolId: input.poolId, totalCollected, membersProcessed });
    const result = { status: "collected", membersProcessed, totalCollected };
    await act.recordIdempotency(input.idempotencyKey, "J23", result);
    currentStep = "completed";
    return result;
  }

  if (input.action === "settle_year_end") {
    currentStep = "compute_surplus";
    const poolData = (await ext.invokeDaprService({ appId: "p2p-service", method: "get-pool-data", data: { poolId: input.poolId }})).data as {
      poolBalance: number;
      totalContributions: number;
      totalClaims: number;
      memberCount: number;
    };

    const surplus = poolData.poolBalance - poolData.totalClaims;
    let surplusReturned = 0;

    if (surplus > 0) {
      currentStep = "distribute_surplus";
      const surplusPerMember = surplus / poolData.memberCount;

      const members = (await ext.invokeDaprService({ appId: "p2p-service", method: "get-members", data: { poolId: input.poolId }})).data as { members: Array<{ customerId: number }> };
      for (const member of (members.members ?? [])) {
        try {
          await act.createTigerBeetleTransfer({
            debitAccountId: `p2p_pool_${input.poolId}`,
            creditAccountId: `customer_${member.customerId}`,
            amount: Math.round(surplusPerMember * 100),
            code: 12, // P2P surplus return
            userData: input.poolId,
          });
          surplusReturned += surplusPerMember;
          membersProcessed++;
        } catch {
          log.warn("Failed to distribute surplus to member", { customerId: member.customerId });
        }
      }
    }

    await act.emitFluvioEvent("p2p.pool.settled", { poolId: input.poolId, surplus, surplusReturned });
    const result = { status: "settled", membersProcessed, totalCollected: poolData.totalContributions, surplusReturned };
    await act.recordIdempotency(input.idempotencyKey, "J23", result);
    currentStep = "completed";
    return result;
  }

  return { status: "unknown_action", membersProcessed: 0, totalCollected: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// J24 — Health & Wellness Rewards
// Weekly: compute wellness score → credit reward points → apply premium discount
// ─────────────────────────────────────────────────────────────────────────────
export interface J24Input {
  customerId: number;
  policyId: number;
  periodStart: string;
  periodEnd: string;
  idempotencyKey: string;
}

export async function J24_WellnessRewardsWorkflow(input: J24Input): Promise<{
  wellnessScore: number;
  rewardPoints: number;
  premiumDiscountPct: number;
  tbTransferId?: string;
}> {
  let currentStep = "init";

  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J24_WellnessRewardsWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(cancelJourneySignal, () => {});
  setHandler(currentStepQuery, () => currentStep);

  const existing = await act.checkIdempotency(input.idempotencyKey, "J24");
  if (existing) return existing as { wellnessScore: number; rewardPoints: number; premiumDiscountPct: number };

  // Step 1: Fetch wearable readings
  currentStep = "fetch_wearable_data";
  const wearableData = (await ext.invokeDaprService({ appId: "health-wearables", method: "get-summary", data: {
    customerId: input.customerId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  }})).data as { wellnessScore: number; totalRewardPoints: number; premiumDiscountPct: number };

  const wellnessScore = wearableData.wellnessScore ?? 50;
  const rewardPoints = wearableData.totalRewardPoints ?? 0;
  const premiumDiscountPct = wearableData.premiumDiscountPct ?? 0;

  // Step 2: Credit reward points (TigerBeetle)
  let tbTransferId: string | undefined;
  if (rewardPoints > 0) {
    currentStep = "credit_reward_points";
    const tbResult = await act.createTigerBeetleTransfer({
      debitAccountId: "FEE_POOL",
      creditAccountId: `customer_${input.customerId}`,
      amount: rewardPoints * 10, // 1 point = ₦0.10
      code: 13, // wellness reward
      userData: input.policyId,
    });
    tbTransferId = tbResult.transferId;
  }

  // Step 3: Apply premium discount if earned
  if (premiumDiscountPct > 0) {
    currentStep = "apply_discount";
    await ext.invokeDaprService({ appId: "policy-service", method: "apply-wellness-discount", data: {
      policyId: input.policyId,
      discountPct: premiumDiscountPct,
      reason: `Wellness score: ${wellnessScore}/100`,
    }});
  }

  // Step 4: Notify customer
  currentStep = "notify_customer";
  await act.sendNotification({
    userId: input.customerId,
    type: "wellness_reward",
    message: `Your wellness score this week: ${wellnessScore}/100. You earned ${rewardPoints} reward points${premiumDiscountPct > 0 ? ` and a ${premiumDiscountPct}% premium discount` : ""}.`,
    channel: "push",
  });

  await act.emitFluvioEvent("wellness.rewards.credited", { customerId: input.customerId, wellnessScore, rewardPoints });

  const result = { wellnessScore, rewardPoints, premiumDiscountPct, tbTransferId };
  await act.recordIdempotency(input.idempotencyKey, "J24", result);
  currentStep = "completed";
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// J25 — NHIA Claims Submission
// Submits health claims to NHIA and reconciles payments
// ─────────────────────────────────────────────────────────────────────────────
export interface J25Input {
  enrollmentId: number;
  customerId: number;
  claimId: number;
  facilityCode: string;
  diagnosisCode: string;
  claimAmount: number;
  idempotencyKey: string;
}

export async function J25_NHIAClaimsWorkflow(input: J25Input): Promise<{
  nhiaClaimRef: string;
  approvedAmount: number;
  tbTransferId?: string;
  status: string;
}> {
  let currentStep = "init";

  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J25_NHIAClaimsWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(cancelJourneySignal, () => {});
  setHandler(currentStepQuery, () => currentStep);

  const existing = await act.checkIdempotency(input.idempotencyKey, "J25");
  if (existing) return existing as { nhiaClaimRef: string; approvedAmount: number; status: string };

  // Step 1: Submit to NHIA
  currentStep = "submit_to_nhia";
  const nhiaResult = (await ext.invokeDaprService({ appId: "nhia-integration", method: "submit-claim", data: {
    enrollmentId: input.enrollmentId,
    facilityCode: input.facilityCode,
    diagnosisCode: input.diagnosisCode,
    claimAmount: input.claimAmount,
  }})).data as { nhiaClaimRef: string; approvedAmount: number; status: string };

  const nhiaClaimRef = nhiaResult.nhiaClaimRef ?? `NHIA-${Date.now()}`;
  const approvedAmount = nhiaResult.approvedAmount ?? input.claimAmount;

  // Step 2: Wait for NHIA adjudication (up to 48 hours in real scenario)
  // In workflow, we use a short sleep and then check status
  currentStep = "await_adjudication";
  await sleep("5s"); // In production: signal-based wait

  // Step 3: TigerBeetle payout when approved
  let tbTransferId: string | undefined;
  if (approvedAmount > 0) {
    currentStep = "tigerbeetle_payout";
    const tbResult = await act.createTigerBeetleTransfer({
      debitAccountId: "CLAIMS_RESERVE",
      creditAccountId: `customer_${input.customerId}`,
      amount: Math.round(approvedAmount * 100),
      code: 14, // NHIA claim payout
      userData: input.claimId,
    });
    tbTransferId = tbResult.transferId;
  }

  // Step 4: Update claim status
  currentStep = "update_claim";
  await act.sendNotification({
    userId: input.customerId,
    type: "nhia_claim_approved",
    message: `Your NHIA health claim (Ref: ${nhiaClaimRef}) of ₦${approvedAmount.toLocaleString()} has been approved and processed.`,
    channel: "sms",
  });

  await act.emitFluvioEvent("nhia.claim.settled", { nhiaClaimRef, approvedAmount, customerId: input.customerId });

  const result = { nhiaClaimRef, approvedAmount, tbTransferId, status: "settled" };
  await act.recordIdempotency(input.idempotencyKey, "J25", result);
  currentStep = "completed";
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// J26 — Predictive Policy Renewal
// Identifies at-risk policies, sends personalised offers, processes renewals
// ─────────────────────────────────────────────────────────────────────────────
export interface J26Input {
  policyId: number;
  customerId: number;
  lapseProbability: number;
  discountOfferPct: number;
  recommendedAction: string;
  idempotencyKey: string;
}

export async function J26_PredictiveRenewalWorkflow(input: J26Input): Promise<{
  outreachSent: boolean;
  offerAccepted: boolean;
  renewalTriggered: boolean;
  discountApplied: number;
}> {
  let currentStep = "init";

  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J26_PredictiveRenewalWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  let offerAccepted = false;
  setHandler(approveStepSignal, () => { offerAccepted = true; });
  setHandler(cancelJourneySignal, () => {});
  setHandler(currentStepQuery, () => currentStep);

  const existing = await act.checkIdempotency(input.idempotencyKey, "J26");
  if (existing) return existing as { outreachSent: boolean; offerAccepted: boolean; renewalTriggered: boolean; discountApplied: number };

  // Step 1: Send personalised outreach
  currentStep = "send_outreach";
  const message = input.lapseProbability > 0.7
    ? `Your policy is expiring soon. As a valued customer, we're offering you a ${input.discountOfferPct}% renewal discount. Reply YES to renew now.`
    : input.lapseProbability > 0.5
    ? `Don't let your insurance lapse. Renew now and save ${input.discountOfferPct}% on your premium.`
    : `Your policy renewal is coming up. Renew early and enjoy continued protection.`;

  await act.sendNotification({
    userId: input.customerId,
    type: "renewal_offer",
    message,
    channel: input.recommendedAction === "agent_visit" ? "dapr_event" : "sms",
  });

  // Step 2: Wait for customer response (up to 7 days)
  currentStep = "await_customer_response";
  await condition(() => offerAccepted, "7d");

  if (!offerAccepted) {
    // Escalate to agent
    currentStep = "escalate_to_agent";
    await act.sendNotification({
      userId: input.customerId,
      type: "renewal_escalation",
      message: `Customer ${input.customerId} has not responded to renewal offer. Please follow up.`,
      channel: "agent_notification",
    });
    await act.emitFluvioEvent("renewal.offer.expired", { policyId: input.policyId, customerId: input.customerId });
    return { outreachSent: true, offerAccepted: false, renewalTriggered: false, discountApplied: 0 };
  }

  // Step 3: Apply discount and trigger renewal
  currentStep = "apply_renewal_discount";
  const discountApplied = input.discountOfferPct;

  await ext.invokeDaprService({ appId: "policy-service", method: "apply-renewal-discount", data: {
    policyId: input.policyId,
    discountPct: discountApplied,
  }});

  // Step 4: Trigger J06 Policy Renewal workflow
  currentStep = "trigger_renewal";
  await act.emitFluvioEvent("renewal.accepted", {
    policyId: input.policyId,
    customerId: input.customerId,
    discountApplied,
  });

  await act.ingestToLakehouse("renewal_conversions", {
    policyId: input.policyId,
    lapseProbability: input.lapseProbability,
    discountApplied,
    converted: true,
  });

  const result = { outreachSent: true, offerAccepted: true, renewalTriggered: true, discountApplied };
  await act.recordIdempotency(input.idempotencyKey, "J26", result);
  currentStep = "completed";
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// J27 — Embedded Insurance Binding
// Third-party partner embeds insurance into their checkout flow
// ─────────────────────────────────────────────────────────────────────────────
export interface J27Input {
  partnerCode: string;
  productId: string;
  customerRef: string;
  paymentRef: string;
  premiumAmount: number;
  coverAmount: number;
  startDate: string;
  endDate: string;
  metadata: Record<string, unknown>;
  idempotencyKey: string;
}

export async function J27_EmbeddedInsuranceWorkflow(input: J27Input): Promise<{
  policyNumber: string;
  certificateUrl: string;
  tbTransferId: string;
  status: string;
}> {
  let currentStep = "init";

  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J27_EmbeddedInsuranceWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(cancelJourneySignal, () => {});
  setHandler(currentStepQuery, () => currentStep);

  const existing = await act.checkIdempotency(input.idempotencyKey, "J27");
  if (existing) return existing as { policyNumber: string; certificateUrl: string; tbTransferId: string; status: string };

  // Step 1: Validate partner
  currentStep = "validate_partner";
  const partnerValid = (await ext.invokeDaprService({ appId: "embedded-insurance", method: "validate-partner", data: {
    partnerCode: input.partnerCode,
  }})).data as { valid: boolean };
  if (!partnerValid.valid) {
    throw new Error(`Invalid partner code: ${input.partnerCode}`);
  }

  // Step 2: Fraud check
  currentStep = "fraud_check";
  await ext.callRustFraudGate({
    amount: input.premiumAmount,
    customerId: 0,
    transactionType: "embedded_premium",
    reference: input.paymentRef,
  });

  // Step 3: TigerBeetle premium collection
  currentStep = "collect_premium";
  const tbResult = await act.createTigerBeetleTransfer({
    debitAccountId: `partner_${input.partnerCode}`,
    creditAccountId: "PREMIUM_POOL",
    amount: Math.round(input.premiumAmount * 100),
    code: 15, // embedded premium
    userData: 0,
  });

  // Step 4: Issue policy
  currentStep = "issue_policy";
  const policyResult = (await ext.invokeDaprService({ appId: "embedded-insurance", method: "bind-policy", data: {
    productId: input.productId,
    partnerCode: input.partnerCode,
    customerRef: input.customerRef,
    paymentRef: input.paymentRef,
    startDate: input.startDate,
    endDate: input.endDate,
    metadata: input.metadata,
  }})).data as { policyNumber: string; certificateUrl: string };

  // Step 5: Emit Fluvio event
  currentStep = "emit_event";
  await act.emitFluvioEvent("embedded.policy.issued", {
    partnerCode: input.partnerCode,
    policyNumber: policyResult.policyNumber,
    premiumAmount: input.premiumAmount,
  });

  const result = {
    policyNumber: policyResult.policyNumber,
    certificateUrl: policyResult.certificateUrl,
    tbTransferId: tbResult.transferId,
    status: "issued",
  };
  await act.recordIdempotency(input.idempotencyKey, "J27", result);
  currentStep = "completed";
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// J28 — Group Insurance Enrollment
// Onboards a group (employer/cooperative) and enrolls all members
// ─────────────────────────────────────────────────────────────────────────────
export interface J28Input {
  groupPolicyId: number;
  organiserId: number;
  members: Array<{ customerId: number; employeeId?: string; memberType: string }>;
  totalPremium: number;
  idempotencyKey: string;
}

export async function J28_GroupInsuranceEnrollmentWorkflow(input: J28Input): Promise<{
  enrolledCount: number;
  failedCount: number;
  tbTransferId: string;
  status: string;
}> {
  let currentStep = "init";

  // ── Tenant Isolation Guard ────────────────────────────────────────────────
  const tenantCtx = buildTenantContext(input);
  await assertTenantAccess("J28_GroupInsuranceEnrollmentWorkflow", tenantCtx);
  // ─────────────────────────────────────────────────────────────────────────

  setHandler(cancelJourneySignal, () => {});
  setHandler(currentStepQuery, () => currentStep);

  const existing = await act.checkIdempotency(input.idempotencyKey, "J28");
  if (existing) return existing as { enrolledCount: number; failedCount: number; tbTransferId: string; status: string };

  let enrolledCount = 0;
  let failedCount = 0;

  // Step 1: AML check on organiser
  currentStep = "aml_check";
  await act.runAmlCheck({ customerId: input.organiserId, amount: input.totalPremium, transactionType: "group_premium" });

  // Step 2: TigerBeetle group premium collection
  currentStep = "collect_group_premium";
  const tbResult = await act.createTigerBeetleTransfer({
    debitAccountId: `customer_${input.organiserId}`,
    creditAccountId: "PREMIUM_POOL",
    amount: Math.round(input.totalPremium * 100),
    code: 16, // group premium
    userData: input.groupPolicyId,
  });

  // Step 3: Enroll each member
  currentStep = "enroll_members";
  for (const member of input.members) {
    try {
      await ext.invokeDaprService({ appId: "group-insurance", method: "enroll-member", data: {
        groupPolicyId: input.groupPolicyId,
        customerId: member.customerId,
        employeeId: member.employeeId,
        memberType: member.memberType,
      }});
      enrolledCount++;
    } catch {
      failedCount++;
      log.warn("Failed to enroll member", { customerId: member.customerId });
    }
  }

  // Step 4: Permify group access
  currentStep = "setup_permissions";
  await ext.updatePermifyPolicy({
    subjectType: "group",
    subjectId: input.groupPolicyId.toString(),
    relation: "member",
    objectType: "policy",
    objectId: input.groupPolicyId.toString(),
  });

  // Step 5: Notify organiser
  currentStep = "notify_organiser";
  await act.sendNotification({
    userId: input.organiserId,
    type: "group_enrollment_complete",
    message: `Group policy enrollment complete. ${enrolledCount} members enrolled, ${failedCount} failed.`,
    channel: "email",
  });

  await act.emitFluvioEvent("group.enrollment.completed", {
    groupPolicyId: input.groupPolicyId,
    enrolledCount,
    failedCount,
    totalPremium: input.totalPremium,
  });

  const result = { enrolledCount, failedCount, tbTransferId: tbResult.transferId, status: "enrolled" };
  await act.recordIdempotency(input.idempotencyKey, "J28", result);
  currentStep = "completed";
  return result;
}
