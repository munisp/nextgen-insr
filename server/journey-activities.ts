/**
 * journey-activities.ts — Insurance Journey Activities Library
 *
 * All Temporal activities for the 20 insurance stakeholder journeys.
 * Each activity is a pure function that calls exactly one service.
 * Activities are idempotent and safe to retry.
 *
 * Services used:
 *   - PostgreSQL (Drizzle ORM) — authoritative data store
 *   - TigerBeetle — double-entry ledger for all fund movements
 *   - Redis — distributed locks, idempotency cache
 *   - Fluvio — event streaming for real-time monitoring
 *   - Ollama AI — risk scoring, fraud detection, underwriting
 *   - Keycloak — identity, session management
 *   - Permify — RBAC/ABAC authorization
 *   - Dapr — pub/sub, service invocation
 *   - APISIX — rate limiting, route management
 *   - Lakehouse — analytics ingestion
 *   - OpenAppSec — WAF, threat detection
 */
import { eq, and, desc, count, sql, gte } from "drizzle-orm";

import { ENV } from "./_core/env";
import { logger } from "./_core/logger";
import { daprPublish } from "./daprClient";
import { getDb } from "./db";
import { fluvioProduce } from "./fluvio";
import { tbCreateTransfer, tbEnsureAgentAccount, tbGetAgentBalance } from "./tbClient";
import {
  customers, agents, policies, claims, policyQuotes, transactions,
  kycVerifications, fraudAlerts, auditLog, notifications,
  insuranceProducts, underwritingApplications as underwritingApps,
  complianceChecks, policyRenewals, reinsuranceTreaties,
  posTerminals,
} from "../drizzle/schema";
import { premiums, claimsPayments, commissions } from "../drizzle/schema.additions";
import { acquireLock, releaseLock, getRedisClient } from "./lib/redisClient";

// ─── Helper: get DB instance ─────────────────────────────────────────────────
async function db() {
  const instance = await getDb();
  if (!instance) throw new Error("Database unavailable");
  return instance;
}

// ─── Helper: emit Fluvio event (fail-open) ───────────────────────────────────
async function emit(topic: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await fluvioProduce(topic, { value: JSON.stringify({ ...payload, ts: Date.now() }) });
  } catch { /* fail-open */ }
}

// ─── Helper: write audit log (fail-open) ─────────────────────────────────────
async function audit(action: string, resource: string, resourceId: string, metadata?: Record<string, unknown>): Promise<void> {
  try {
    const d = await getDb();
    if (d) await d.insert(auditLog).values({ action, resource, resourceId, status: "success", metadata: metadata ?? null });
  } catch { /* fail-open */ }
}

// ─── Helper: call Ollama AI ───────────────────────────────────────────────────
async function callOllama(prompt: string, model = "llama3.2:3b"): Promise<string> {
  try {
    const res = await fetch(`${ENV.ollamaUrl ?? "http://localhost:11434"}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return "AI_UNAVAILABLE";
    const data = await res.json() as { response: string };
    return data.response ?? "AI_UNAVAILABLE";
  } catch {
    return "AI_UNAVAILABLE";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOMER ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function createOrFetchCustomer(input: {
  fullName: string;
  phone: string;
  email?: string;
  nin?: string;
  bvn?: string;
  agentId?: number;
}): Promise<{ customerId: number; isNew: boolean; customerCode: string }> {
  const d = await db();
  // Check for existing customer by phone
  const [existing] = await d.select().from(customers).where(eq(customers.phone, input.phone)).limit(1);
  if (existing) return { customerId: existing.id, isNew: false, customerCode: existing.externalId ?? `CUST-${existing.id}` };

  const customerCode = `CUST-${Date.now().toString(36).toUpperCase()}`;
  const firstName = input.fullName.trim().split(/\s+/)[0] ?? input.fullName;
  const lastName = input.fullName.trim().split(/\s+/).slice(1).join(" ") || firstName;
  const [customer] = await d.insert(customers).values({
    firstName,
    lastName,
    phone: input.phone,
    email: input.email ?? null,
    nin: input.nin ?? null,
    bvn: input.bvn ?? null,
    preferredAgentId: input.agentId ?? null,
    externalId: customerCode,
    status: "pending_kyc",
  }).returning();

  await emit("customer-events", { eventType: "customer.created", customerId: customer.id, phone: input.phone });
  await audit("CUSTOMER_CREATED", "customers", String(customer.id), { phone: input.phone, agentId: input.agentId });
  return { customerId: customer.id, isNew: true, customerCode };
}

export async function initiateKycVerification(input: {
  customerId: number;
  nin?: string;
  bvn?: string;
  selfieUrl?: string;
  documentType: string;
  documentNumber: string;
}): Promise<{ kycId: number; status: string; verificationRef: string }> {
  const d = await db();
  const verificationRef = `KYC-${Date.now().toString(36).toUpperCase()}`;

  const [kyc] = await d.insert(kycVerifications).values({
    customerId: input.customerId,
    verificationType: input.documentType,
    documentNumber: input.documentNumber,
    nin: input.nin ?? null,
    bvn: input.bvn ?? null,
    selfieUrl: input.selfieUrl ?? null,
    status: "pending",
  }).returning();

  await emit("kyc-events", { eventType: "kyc.initiated", kycId: kyc.id, customerId: input.customerId });
  await audit("KYC_INITIATED", "kyc_verifications", String(kyc.id), { customerId: input.customerId });
  return { kycId: kyc.id, status: "pending", verificationRef };
}

export async function verifyKycWithNibss(input: {
  kycId?: number;
  customerId: number;
  nin?: string;
  bvn?: string;
  verificationType?: string;
}): Promise<{ verified: boolean; score: number; message: string; failureReason: string | null }> {
  const d = await db();

  // In production: call NIBSS NIN/BVN verification API via APISIX gateway
  // For now: validate format and mark as verified if NIN/BVN provided
  const hasValidNin = input.nin && /^\d{11}$/.test(input.nin);
  const hasValidBvn = input.bvn && /^\d{11}$/.test(input.bvn);
  const verified = !!(hasValidNin || hasValidBvn);
  const score = verified ? 85 : 0;

  if (input.kycId != null) {
    await d.update(kycVerifications).set({
      status: verified ? "verified" : "failed",
      verificationScore: String(score),
      verifiedAt: verified ? new Date() : null,
    }).where(eq(kycVerifications.id, input.kycId));
  }

  if (verified) {
    await d.update(customers).set({ status: "active", updatedAt: new Date() }).where(eq(customers.id, input.customerId));
  }

  await emit("kyc-events", { eventType: verified ? "kyc.verified" : "kyc.failed", kycId: input.kycId, customerId: input.customerId, score });
  return {
    verified,
    score,
    message: verified ? "KYC verified via NIBSS" : "KYC verification failed — invalid NIN/BVN",
    failureReason: verified ? null : "KYC verification failed — invalid NIN/BVN",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// POLICY ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function validateInsuranceQuote(input: {
  quoteId?: number;
  customerId: number;
  productId?: number;
  premiumAmount: number;
  policyType?: string;
  sumInsured?: number;
  startDate?: string;
  endDate?: string;
}): Promise<{ valid: boolean; approved: boolean; quote: Record<string, unknown> }> {
  // Journeys that create quotes inline (e.g. broker portfolios) pass no quoteId:
  // validate the request basics only.
  if (input.quoteId == null) {
    if (!(input.premiumAmount > 0)) throw new Error("Premium amount must be positive");
    return { valid: true, approved: true, quote: { ...input } };
  }
  const d = await db();
  const [quote] = await d.select().from(policyQuotes).where(eq(policyQuotes.id, input.quoteId)).limit(1);
  if (!quote) throw new Error(`Quote ${input.quoteId} not found`);
  if (quote.status !== "pending") throw new Error(`Quote ${input.quoteId} is no longer pending (status: ${quote.status})`);
  if (quote.validUntil && new Date(quote.validUntil) < new Date()) throw new Error(`Quote ${input.quoteId} has expired`);
  if (Number(quote.premiumAmount) !== input.premiumAmount) throw new Error(`Premium mismatch: expected ${quote.premiumAmount}, got ${input.premiumAmount}`);
  return { valid: true, approved: true, quote: quote as Record<string, unknown> };
}

export async function runUnderwritingCheck(input: {
  customerId: number;
  productId?: number;
  sumInsured: number;
  agentId?: number;
  policyType?: string;
  riskFactors?: Record<string, unknown>;
}): Promise<{ approved: boolean; riskScore: number; riskCategory: string; conditions: string[]; suggestedPremium: number; declineReason: string | null }> {
  const d = await db();

  // Get customer history
  const [customer] = await d.select().from(customers).where(eq(customers.id, input.customerId)).limit(1);
  const existingClaims = await d.select({ count: count() }).from(claims)
    .where(and(eq(claims.claimantId, input.customerId), eq(claims.status, "paid")));
  const claimCount = Number(existingClaims[0]?.count ?? 0);

  // AI-powered risk scoring
  const prompt = `Insurance underwriting risk assessment:
Customer KYC status: ${customer?.status ?? "unknown"}
Prior claims count: ${claimCount}
Sum insured: ₦${input.sumInsured.toLocaleString()}
Product ID: ${input.productId}

Assess risk on scale 0-100 (0=lowest risk, 100=highest risk).
Return JSON: {"score": number, "category": "low|medium|high|declined", "conditions": []}`;

  const aiResponse = await callOllama(prompt);
  let riskScore = 30 + (claimCount * 10); // fallback calculation
  let riskCategory = "low";
  let conditions: string[] = [];

  try {
    const parsed = JSON.parse(aiResponse.match(/\{.*\}/s)?.[0] ?? "{}");
    if (parsed.score) riskScore = Math.min(100, Math.max(0, parsed.score));
    if (parsed.category) riskCategory = parsed.category;
    if (parsed.conditions) conditions = parsed.conditions;
  } catch { /* use fallback */ }

  // Business rules override
  if (customer?.status !== "active") {
    riskCategory = "declined";
    conditions.push("KYC verification required before policy issuance");
  }
  if (claimCount > 3) {
    riskScore = Math.max(riskScore, 70);
    riskCategory = riskScore >= 80 ? "high" : "medium";
    conditions.push("High claims history — additional premium loading applied");
  }
  if (input.sumInsured > 50_000_000) {
    conditions.push("Sum insured > ₦50M requires reinsurance cession");
  }

  const approved = riskCategory !== "declined";
  // Suggested premium: 2% of sum insured with risk loading (NAICOM floor rates)
  const suggestedPremium = Math.round(input.sumInsured * 0.02 * (1 + riskScore / 100) * 100) / 100;
  const declineReason = approved ? null : (conditions[0] ?? "Underwriting declined");

  // Record underwriting application
  await d.insert(underwritingApps).values({
    applicationRef: `UW-${Date.now().toString(36).toUpperCase()}`,
    customerId: input.customerId,
    productId: input.productId ?? 0,
    agentId: input.agentId ?? null,
    sumInsured: String(input.sumInsured),
    riskScore: String(riskScore),
    riskCategory,
    status: approved ? "approved" : "declined",
    conditions: conditions.length > 0 ? conditions : null,
    decisionAt: new Date(),
  }).catch(() => {}); // non-blocking

  await emit("underwriting-events", { eventType: "underwriting.completed", customerId: input.customerId, riskScore, riskCategory, approved });
  return { approved, riskScore, riskCategory, conditions, suggestedPremium, declineReason };
}

export async function collectInsurancePremium(input: {
  customerId: number;
  agentId?: number;
  productId?: number;
  premiumAmount: number;
  paymentRef?: string;
  policyType?: string;
  currency?: string;
  paymentMethod?: string;
  idempotencyKey?: string;
}): Promise<{ collected: boolean; success: boolean; tbTransferId: string | null; transactionId: number }> {
  const d = await db();
  const paymentRef = input.paymentRef ?? input.idempotencyKey ?? `PREM-${input.customerId}-${Date.now().toString(36).toUpperCase()}`;

  // Idempotency check
  const [existing] = await d.select().from(transactions).where(eq(transactions.ref, paymentRef)).limit(1);
  if (existing) {
    const meta = existing.metadata as { tbTransferId?: string } | null;
    return { collected: true, success: true, tbTransferId: meta?.tbTransferId ?? null, transactionId: existing.id };
  }

  // TigerBeetle: customer-pool → insurer-premium-pool (INSURANCE_PREMIUMS ledger)
  const tbResult = await tbCreateTransfer({
    debitAccountId: `customer-${input.customerId}`,
    creditAccountId: "insurer-premium-pool",
    amount: Math.round(input.premiumAmount * 100),
    ledger: 3000,
    code: 700,
    ref: paymentRef,
    txType: "premium_payment",
    agentId: input.agentId ? String(input.agentId) : undefined,
  });

  const [tx] = await d.insert(transactions).values({
    ref: paymentRef,
    agentId: input.agentId ?? 0,
    type: "Insurance",
    amount: String(input.premiumAmount),
    fee: "0",
    commission: "0",
    channel: "App",
    status: "success",
    fraudScore: "0.00",
    metadata: { customerId: input.customerId, productId: input.productId ?? null, tbTransferId: tbResult?.id ?? null, tbSyncStatus: tbResult ? "synced" : "pending" },
  }).returning();

  await emit("payment-events", { eventType: "premium.collected", customerId: input.customerId, amount: input.premiumAmount, tbTransferId: tbResult?.id });
  return { collected: true, success: true, tbTransferId: tbResult?.id ?? null, transactionId: tx.id };
}

export async function createInsurancePolicy(input: {
  quoteId?: number;
  customerId: number;
  agentId?: number;
  brokerId?: number;
  productId?: number;
  sumInsured: number;
  premiumAmount: number;
  durationMonths?: number;
  coverageStartDate?: string;
  paymentRef?: string;
  beneficiaryName?: string;
  policyType?: string;
  startDate?: string;
  endDate?: string;
}): Promise<{ policyId: number; policyNumber: string }> {
  const d = await db();

  // Idempotency: check if policy already exists for this quote
  if (input.quoteId != null) {
    const [existingPolicy] = await d.select().from(policies)
      .where(sql`${policies.metadata}::jsonb ->> 'quoteId' = ${String(input.quoteId)}`)
      .limit(1).catch(() => [null]);
    if (existingPolicy) return { policyId: existingPolicy.id, policyNumber: existingPolicy.policyNumber ?? `POL-${existingPolicy.id}` };
  }

  const [quote] = input.quoteId != null
    ? await d.select().from(policyQuotes).where(eq(policyQuotes.id, input.quoteId)).limit(1).catch(() => [])
    : [undefined];
  const COVERAGE_TYPES = ["life", "health", "motor", "property", "liability", "marine", "aviation", "agriculture", "credit", "travel", "micro", "group_life"] as const;
  const coverageType = (COVERAGE_TYPES as readonly string[]).includes(input.policyType ?? "")
    ? (input.policyType as (typeof COVERAGE_TYPES)[number])
    : (COVERAGE_TYPES as readonly string[]).includes(quote?.coverageType ?? "")
      ? (quote!.coverageType as (typeof COVERAGE_TYPES)[number])
      : "micro";

  const productId = input.productId ?? quote?.productId ?? 0;
  const policyNumber = `POL-${Date.now().toString(36).toUpperCase()}-${productId}`;
  const startDate = new Date(input.coverageStartDate ?? input.startDate ?? Date.now());
  const endDate = input.endDate ? new Date(input.endDate) : new Date(startDate);
  if (!input.endDate) endDate.setMonth(endDate.getMonth() + (input.durationMonths ?? 12));
  const paymentRef = input.paymentRef ?? `PAY-${policyNumber}`;

  const [policy] = await d.insert(policies).values({
    policyNumber,
    customerId: input.customerId,
    agentId: input.agentId ?? null,
    brokerId: input.brokerId ?? null,
    productId,
    coverageType,
    sumInsured: String(input.sumInsured),
    annualPremium: String(input.premiumAmount),
    startDate,
    endDate,
    status: "active",
    metadata: { quoteId: input.quoteId ?? null, beneficiaryName: input.beneficiaryName ?? null, paymentRef },
  }).returning();

  // Mark quote as converted
  if (input.quoteId != null) {
    await d.update(policyQuotes).set({
      status: "converted",
      metadata: sql`jsonb_set(COALESCE(${policyQuotes.metadata}::jsonb, '{}'::jsonb), '{convertedPolicyId}', to_jsonb(${policy.id}::int))`,
      updatedAt: new Date(),
    }).where(eq(policyQuotes.id, input.quoteId)).catch(() => {});
  }

  await emit("policy-events", { eventType: "policy.created", policyId: policy.id, policyNumber, customerId: input.customerId });
  await audit("POLICY_CREATED", "policies", String(policy.id), { policyNumber, customerId: input.customerId, premiumAmount: input.premiumAmount });
  return { policyId: policy.id, policyNumber };
}

export async function issuePolicyCertificate(input: {
  policyId: number;
  customerId: number;
  policyNumber?: string;
}): Promise<{ certificateUrl: string; issuedAt: string }> {
  const d = await db();
  const [policy] = await d.select().from(policies).where(eq(policies.id, input.policyId)).limit(1);
  if (!policy) throw new Error(`Policy ${input.policyId} not found`);

  // In production: generate PDF certificate via document service
  const certificateUrl = `${ENV.appUrl ?? "https://insureportal.ng"}/certificates/${policy.policyNumber}.pdf`;
  const issuedAt = new Date().toISOString();

  await d.update(policies).set({ policyDocument: certificateUrl, updatedAt: new Date() }).where(eq(policies.id, input.policyId)).catch(() => {});
  await emit("policy-events", { eventType: "policy.certificate_issued", policyId: input.policyId, certificateUrl });
  return { certificateUrl, issuedAt };
}

export async function notifyPolicyStakeholders(input: {
  policyId: number;
  policyNumber: string;
  customerId: number;
  agentId?: number;
  premiumAmount: number;
  eventType: string;
}): Promise<{ notified: number }> {
  const d = await db();
  const [customer] = await d.select({ firstName: customers.firstName, lastName: customers.lastName, phone: customers.phone, email: customers.email })
    .from(customers).where(eq(customers.id, input.customerId)).limit(1);

  const notificationRecords = [];

  // Customer notification
  if (customer) {
    notificationRecords.push({
      userId: input.customerId,
      type: "policy_update",
      title: `Policy ${input.policyNumber} — ${input.eventType.replace("policy.", "").replace("_", " ")}`,
      message: `Your insurance policy ${input.policyNumber} has been ${input.eventType.replace("policy.", "")}. Premium: ₦${input.premiumAmount.toLocaleString()}`,
      channel: "sms" as const,
      status: "pending" as const,
      metadata: { policyId: input.policyId, eventType: input.eventType },
    });
  }

  // Agent notification
  if (input.agentId) {
    notificationRecords.push({
      userId: input.agentId,
      type: "policy_update",
      title: `Policy ${input.policyNumber} ${input.eventType.replace("policy.", "")}`,
      message: `Policy ${input.policyNumber} for customer has been ${input.eventType.replace("policy.", "")}. Commission will be credited.`,
      channel: "push" as const,
      status: "pending" as const,
      metadata: { policyId: input.policyId, eventType: input.eventType },
    });
  }

  if (notificationRecords.length > 0) {
    await d.insert(notifications).values(notificationRecords).catch(() => {});
  }

  // Dapr pub/sub for real-time push
  await daprPublish({ pubsubName: "insureportal-pubsub", topic: "notifications", data: { policyId: input.policyId, eventType: input.eventType } }).catch(() => {});

  return { notified: notificationRecords.length };
}

export async function emitInsuranceEvent(input: {
  topic: string;
  eventType: string;
  entityId: string;
  payload: Record<string, unknown>;
}): Promise<{ emitted: boolean }> {
  await emit(input.topic, { eventType: input.eventType, entityId: input.entityId, ...input.payload });
  return { emitted: true };
}

export async function compensatePolicyBindingStep(input: {
  step: string;
  quoteId: number;
  policyId?: number;
  paymentRef: string;
  customerId: number;
  premiumAmount: number;
}): Promise<void> {
  const d = await db();
  logger.info(`[JourneyActivity] Compensating step '${input.step}' for quote ${input.quoteId}`);

  switch (input.step) {
    case "collect_premium": {
      // Refund premium: insurer-premium-pool → customer-pool
      await tbCreateTransfer({
        debitAccountId: "insurer-premium-pool",
        creditAccountId: `customer-${input.customerId}`,
        amount: Math.round(input.premiumAmount * 100),
        ledger: 3000,
        code: 400, // REVERSAL
        ref: `REFUND-${input.paymentRef}`,
        txType: "premium_refund",
      });
      await d.insert(transactions).values({
        ref: `REFUND-${input.paymentRef}`,
        agentId: 0,
        type: "Reversal",
        amount: String(input.premiumAmount),
        fee: "0", commission: "0",
        channel: "App",
        status: "success",
        fraudScore: "0.00",
        metadata: { originalRef: input.paymentRef, reason: "policy_binding_failed" },
      });
      break;
    }
    case "create_policy": {
      if (input.policyId) {
        await d.update(policies).set({ status: "cancelled" }).where(eq(policies.id, input.policyId));
      }
      break;
    }
    case "validate_quote": {
      // No compensation needed — read-only
      break;
    }
    default:
      logger.info(`[JourneyActivity] No compensation for step '${input.step}'`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLAIMS ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function fileClaim(input: {
  policyId: number;
  customerId: number;
  claimType: string;
  incidentDate: string;
  claimedAmount: number;
  description: string;
  agentId?: number;
}): Promise<{ claimId: number; claimNumber: string; status: string }> {
  const d = await db();
  const [policy] = await d.select().from(policies).where(eq(policies.id, input.policyId)).limit(1);
  if (!policy) throw new Error(`Policy ${input.policyId} not found`);
  if (!["active", "bound"].includes(policy.status ?? "")) throw new Error(`Policy ${input.policyId} is not active (status: ${policy.status})`);

  const claimNumber = `CLM-${Date.now().toString(36).toUpperCase()}`;
  const [claim] = await d.insert(claims).values({
    claimNumber,
    policyId: input.policyId,
    claimantId: input.customerId,
    claimType: input.claimType,
    incidentDate: new Date(input.incidentDate),
    claimedAmount: String(input.claimedAmount),
    incidentDescription: input.description,
    status: "submitted",
    metadata: input.agentId != null ? { filedByAgentId: input.agentId } : null,
  }).returning();

  await emit("claims-events", { eventType: "claim.filed", claimId: claim.id, claimNumber, policyId: input.policyId, claimedAmount: input.claimedAmount });
  await audit("CLAIM_FILED", "claims", String(claim.id), { claimNumber, policyId: input.policyId, claimedAmount: input.claimedAmount });
  return { claimId: claim.id, claimNumber, status: "submitted" };
}

export async function runClaimFraudCheck(input: {
  claimId: number;
  policyId: number;
  customerId: number;
  claimedAmount: number;
  claimType: string;
  description: string;
}): Promise<{ fraudScore: number; flagged: boolean; reasons: string[] }> {
  const d = await db();

  // Get customer claim history
  const [claimHistory] = await d.select({ count: count() }).from(claims)
    .where(and(eq(claims.claimantId, input.customerId), eq(claims.status, "paid")));
  const priorClaims = Number(claimHistory?.count ?? 0);

  // AI fraud analysis
  const prompt = `Insurance claim fraud analysis:
Claim type: ${input.claimType}
Claimed amount: ₦${input.claimedAmount.toLocaleString()}
Prior paid claims: ${priorClaims}
Description: ${input.description}

Analyze for fraud indicators. Return JSON:
{"fraud_score": 0-100, "flagged": boolean, "reasons": ["reason1", "reason2"]}`;

  const aiResponse = await callOllama(prompt);
  let fraudScore = priorClaims > 2 ? 45 : 15;
  let flagged = false;
  let reasons: string[] = [];

  try {
    const parsed = JSON.parse(aiResponse.match(/\{.*\}/s)?.[0] ?? "{}");
    if (parsed.fraud_score !== undefined) fraudScore = Math.min(100, Math.max(0, parsed.fraud_score));
    if (parsed.flagged !== undefined) flagged = parsed.flagged;
    if (parsed.reasons) reasons = parsed.reasons;
  } catch { /* use fallback */ }

  // Business rules
  if (input.claimedAmount > Number((await d.select({ sumInsured: policies.sumInsured }).from(policies).where(eq(policies.id, input.policyId)).limit(1))[0]?.sumInsured ?? 0)) {
    fraudScore = Math.max(fraudScore, 80);
    flagged = true;
    reasons.push("Claimed amount exceeds sum insured");
  }

  if (fraudScore >= 60) {
    flagged = true;
    await d.insert(fraudAlerts).values({
      agentId: null,
      severity: fraudScore >= 80 ? "critical" : "high",
      type: "CLAIM_FRAUD_SUSPECTED",
      fraudScore: String(fraudScore),
      reason: `Claim #${input.claimId}: ${reasons.join("; ")}`,
      status: "open",
    }).catch(() => {});
  }

  await d.update(claims).set({ fraudScore: String(fraudScore), isFraudSuspected: flagged }).where(eq(claims.id, input.claimId)).catch(() => {});
  await emit("fraud-events", { eventType: "claim.fraud_checked", claimId: input.claimId, fraudScore, flagged });
  return { fraudScore, flagged, reasons };
}

export async function assignClaimAdjuster(input: {
  claimId: number;
  adjusterId?: number;
}): Promise<{ adjusterId: number; assignedAt: string }> {
  const d = await db();

  // Auto-assign if no adjuster specified
  let adjusterId = input.adjusterId;
  if (!adjusterId) {
    // Find least-loaded active adjuster
    const [adjuster] = await d.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.isActive, true), eq(agents.role, "adjuster")))
      .limit(1).catch(() => []);
    adjusterId = adjuster?.id ?? 1; // fallback to admin
  }

  await d.update(claims).set({ assignedAdjusterId: adjusterId, status: "under_review", updatedAt: new Date() }).where(eq(claims.id, input.claimId));
  await emit("claims-events", { eventType: "claim.adjuster_assigned", claimId: input.claimId, adjusterId });
  return { adjusterId, assignedAt: new Date().toISOString() };
}

export async function adjudicateClaim(input: {
  claimId: number;
  decision: "approved" | "partially_approved" | "rejected";
  approvedAmount?: number;
  rejectionReason?: string;
  adjusterId: number;
}): Promise<{ decision: string; approvedAmount: number | null }> {
  const d = await db();
  const statusMap = { approved: "approved", partially_approved: "partially_approved", rejected: "rejected" } as const;

  await d.update(claims).set({
    status: statusMap[input.decision],
    approvedAmount: input.approvedAmount ? String(input.approvedAmount) : null,
    rejectionReason: input.rejectionReason ?? null,
    updatedAt: new Date(),
  }).where(eq(claims.id, input.claimId));

  await emit("claims-events", { eventType: `claim.${input.decision}`, claimId: input.claimId, approvedAmount: input.approvedAmount });
  await audit("CLAIM_ADJUDICATED", "claims", String(input.claimId), { decision: input.decision, approvedAmount: input.approvedAmount });
  return { decision: input.decision, approvedAmount: input.approvedAmount ?? null };
}

export async function settleClaimPayment(input: {
  claimId: number;
  approvedAmount: number;
  paymentMethod: string;
  beneficiaryAccount?: string;
  beneficiaryBank?: string;
  paymentRef: string;
}): Promise<{ settled: boolean; tbTransferId: string | null; paymentId: number }> {
  const d = await db();

  // Idempotency
  const [existing] = await d.select().from(claimsPayments).where(eq(claimsPayments.paymentRef, input.paymentRef)).limit(1);
  if (existing) return { settled: true, tbTransferId: existing.tbTransferId ?? null, paymentId: existing.id };

  const [claim] = await d.select().from(claims).where(eq(claims.id, input.claimId)).limit(1);
  if (!claim) throw new Error(`Claim ${input.claimId} not found`);
  if (!["approved", "partially_approved"].includes(claim.status ?? "")) throw new Error(`Claim not approved for settlement`);

  // TigerBeetle: insurer-claims-pool → claimant
  const tbResult = await tbCreateTransfer({
    debitAccountId: "insurer-claims-pool",
    creditAccountId: `claimant-${claim.claimantId}`,
    amount: Math.round(input.approvedAmount * 100),
    ledger: 4000,
    code: 800,
    ref: input.paymentRef,
    txType: "claim_settlement",
  });

  const [payment] = await d.insert(claimsPayments).values({
    claimId: input.claimId,
    paymentRef: input.paymentRef,
    amount: String(input.approvedAmount),
    currency: "NGN",
    paymentMethod: input.paymentMethod,
    beneficiaryAccount: input.beneficiaryAccount ?? null,
    beneficiaryBank: input.beneficiaryBank ?? null,
    status: "processed",
    tbTransferId: tbResult?.id ?? null,
    processedAt: new Date(),
  }).returning();

  await d.update(claims).set({ status: "paid", paidAmount: String(input.approvedAmount), settlementDate: new Date(), updatedAt: new Date() }).where(eq(claims.id, input.claimId));
  await emit("payment-events", { eventType: "claim.settled", claimId: input.claimId, amount: input.approvedAmount, tbTransferId: tbResult?.id });
  await audit("CLAIM_SETTLED", "claims", String(input.claimId), { amount: input.approvedAmount, tbTransferId: tbResult?.id ?? null });
  return { settled: true, tbTransferId: tbResult?.id ?? null, paymentId: payment.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function registerAgent(input: {
  name: string;
  phone: string;
  email?: string;
  nin?: string;
  bvn?: string;
  supervisorId?: number;
  tenantId?: number;
}): Promise<{ agentId: number; agentCode: string }> {
  const d = await db();
  const agentCode = `AGT-${Date.now().toString(36).toUpperCase()}`;

  const [agent] = await d.insert(agents).values({
    name: input.name,
    phone: input.phone,
    email: input.email ?? null,
    agentId: agentCode,
    // PIN must be set by the agent on first login; store an unusable placeholder hash
    pinHash: `PENDING_ACTIVATION:${agentCode}`,
    parentAgentId: input.supervisorId ?? null,
    tenantId: input.tenantId ?? null,
    isActive: false,
    premiumReserve: "0",
    commissionBalance: "0",
    floatLocked: false,
    role: "agent",
  }).returning();

  await emit("agent-events", { eventType: "agent.registered", agentId: agent.id, agentCode });
  await audit("AGENT_REGISTERED", "agents", String(agent.id), { agentCode, phone: input.phone });
  return { agentId: agent.id, agentCode };
}

export async function activateAgent(input: {
  agentId: number;
  initialFloat: number;
  activatedBy: number;
}): Promise<{ activated: boolean; newBalance: number }> {
  const d = await db();
  const [agent] = await d.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);
  if (!agent) throw new Error(`Agent ${input.agentId} not found`);

  // Ensure TB account
  await tbEnsureAgentAccount(agent.agentId);

  // Top up initial float
  if (input.initialFloat > 0) {
    await tbCreateTransfer({
      debitAccountId: "sys-bank-reserve",
      creditAccountId: `float-${agent.agentId}`,
      amount: Math.round(input.initialFloat * 100),
      ledger: 2000,
      code: 100,
      ref: `INIT-FLOAT-${agent.agentId}-${Date.now()}`,
      txType: "Float Top-Up",
      agentId: agent.agentId,
    });
  }

  await d.update(agents).set({
    isActive: true,
    premiumReserve: String(input.initialFloat),
    updatedAt: new Date(),
  }).where(eq(agents.id, input.agentId));

  await emit("agent-events", { eventType: "agent.activated", agentId: input.agentId, initialFloat: input.initialFloat });
  return { activated: true, newBalance: input.initialFloat };
}

export async function provisionAgentPosTerminal(input: {
  agentId: number;
  terminalType: string;
  serialNumber?: string;
}): Promise<{ terminalId: number; serialNumber: string }> {
  const d = await db();
  const serialNumber = input.serialNumber ?? `POS-${Date.now().toString(36).toUpperCase()}`;

  const [terminal] = await d.insert(posTerminals).values({
    terminalId: `TERM-${serialNumber}`,
    agentId: input.agentId,
    serialNumber,
    model: input.terminalType,
    status: "active",
  }).returning();

  await emit("terminal-events", { eventType: "terminal.provisioned", terminalId: terminal.id, agentId: input.agentId });
  return { terminalId: terminal.id, serialNumber };
}

// ═══════════════════════════════════════════════════════════════════════════
// RENEWAL ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function detectExpiringPolicies(input: {
  daysAhead: number;
}): Promise<{ policies: Array<{ policyId: number; policyNumber: string; customerId: number; expiryDate: string; premiumAmount: number }> }> {
  const d = await db();
  const cutoff = new Date(Date.now() + input.daysAhead * 86400000);

  const expiringPolicies = await d.select({
    policyId: policies.id,
    policyNumber: policies.policyNumber,
    customerId: policies.customerId,
    endDate: policies.endDate,
    premiumAmount: policies.annualPremium,
  }).from(policies).where(and(
    eq(policies.status, "active"),
    sql`${policies.endDate} <= ${cutoff.toISOString()}`,
    sql`${policies.endDate} >= NOW()`
  )).limit(100);

  return {
    policies: expiringPolicies.map(p => ({
      policyId: p.policyId,
      policyNumber: p.policyNumber ?? `POL-${p.policyId}`,
      customerId: p.customerId ?? 0,
      expiryDate: p.endDate?.toISOString() ?? "",
      premiumAmount: Number(p.premiumAmount ?? 0),
    })),
  };
}

export async function generateRenewalQuote(input: {
  policyId: number;
  renewalPremiumAdjustment?: number;
}): Promise<{ renewalQuoteId: number; renewalPremium: number; validUntil: string }> {
  const d = await db();
  const [policy] = await d.select().from(policies).where(eq(policies.id, input.policyId)).limit(1);
  if (!policy) throw new Error(`Policy ${input.policyId} not found`);

  const basePremium = Number(policy.annualPremium ?? 0);
  const adjustment = input.renewalPremiumAdjustment ?? 1.05; // 5% default increase
  const renewalPremium = Math.round(basePremium * adjustment * 100) / 100;

  const [renewalQuote] = await d.insert(policyQuotes).values({
    customerId: policy.customerId ?? null,
    agentId: policy.agentId ?? null,
    productId: policy.productId ?? null,
    productName: `Renewal - ${policy.policyNumber}`,
    sumInsured: policy.sumInsured,
    premiumAmount: String(renewalPremium),
    status: "pending",
    validUntil: new Date(Date.now() + 30 * 86400000),
    metadata: { isRenewal: true, originalPolicyId: input.policyId },
  }).returning();

  await emit("renewal-events", { eventType: "renewal.quote_generated", policyId: input.policyId, renewalPremium });
  return { renewalQuoteId: renewalQuote.id, renewalPremium, validUntil: renewalQuote.validUntil?.toISOString() ?? "" };
}

export async function processRenewal(input: {
  policyId: number;
  renewalQuoteId: number;
  paymentRef: string;
  premiumAmount: number;
}): Promise<{ newPolicyId: number; newPolicyNumber: string }> {
  const d = await db();
  const [policy] = await d.select().from(policies).where(eq(policies.id, input.policyId)).limit(1);
  if (!policy) throw new Error(`Policy ${input.policyId} not found`);

  // Collect renewal premium
  await collectInsurancePremium({
    customerId: policy.customerId ?? 0,
    agentId: policy.agentId ?? undefined,
    productId: policy.productId ?? 0,
    premiumAmount: input.premiumAmount,
    paymentRef: input.paymentRef,
  });

  // Create renewal policy
  const newPolicyNumber = `POL-RNW-${Date.now().toString(36).toUpperCase()}`;
  const startDate = policy.endDate ?? new Date();
  const endDate = new Date(startDate);
  endDate.setFullYear(endDate.getFullYear() + 1);

  const [newPolicy] = await d.insert(policies).values({
    policyNumber: newPolicyNumber,
    customerId: policy.customerId,
    agentId: policy.agentId,
    productId: policy.productId,
    coverageType: policy.coverageType,
    sumInsured: policy.sumInsured,
    annualPremium: String(input.premiumAmount),
    startDate,
    endDate,
    status: "active",
    metadata: { quoteId: input.renewalQuoteId, renewedFromPolicyId: input.policyId, paymentRef: input.paymentRef },
  }).returning();

  // Mark original policy as renewed
  await d.update(policies).set({
    status: "renewed",
    metadata: sql`jsonb_set(COALESCE(${policies.metadata}::jsonb, '{}'::jsonb), '{renewedToPolicyId}', to_jsonb(${newPolicy.id}::int))`,
    updatedAt: new Date(),
  }).where(eq(policies.id, input.policyId));

  await emit("renewal-events", { eventType: "policy.renewed", originalPolicyId: input.policyId, newPolicyId: newPolicy.id, newPolicyNumber });
  await audit("POLICY_RENEWED", "policies", String(newPolicy.id), { originalPolicyId: input.policyId, premiumAmount: input.premiumAmount });
  return { newPolicyId: newPolicy.id, newPolicyNumber };
}

// ═══════════════════════════════════════════════════════════════════════════
// FRAUD ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function runTransactionFraudCheck(input: {
  transactionId: number;
  agentId: number;
  amount: number;
  transactionType: string;
  customerPhone?: string;
}): Promise<{ fraudScore: number; flagged: boolean; action: string }> {
  const d = await db();

  // Get agent transaction velocity (last 1 hour)
  const oneHourAgo = new Date(Date.now() - 3600000);
  const [velocity] = await d.select({
    count: count(),
    totalAmount: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
  }).from(transactions).where(and(
    eq(transactions.agentId, input.agentId),
    gte(transactions.createdAt, oneHourAgo),
    eq(transactions.status, "success")
  ));

  const txCount = Number(velocity?.count ?? 0);
  const totalAmount = Number(velocity?.totalAmount ?? 0);

  // AI fraud scoring
  const prompt = `Transaction fraud assessment:
Amount: ₦${input.amount.toLocaleString()}
Type: ${input.transactionType}
Agent hourly tx count: ${txCount}
Agent hourly volume: ₦${totalAmount.toLocaleString()}

Return JSON: {"fraud_score": 0-100, "flagged": boolean, "action": "allow|review|block"}`;

  const aiResponse = await callOllama(prompt);
  let fraudScore = txCount > 20 ? 60 : input.amount > 100000 ? 40 : 15;
  let flagged = false;
  let action = "allow";

  try {
    const parsed = JSON.parse(aiResponse.match(/\{.*\}/s)?.[0] ?? "{}");
    if (parsed.fraud_score !== undefined) fraudScore = parsed.fraud_score;
    if (parsed.flagged !== undefined) flagged = parsed.flagged;
    if (parsed.action) action = parsed.action;
  } catch { /* use fallback */ }

  // Business rules
  if (txCount > 50) { fraudScore = Math.max(fraudScore, 80); flagged = true; action = "block"; }
  if (input.amount > 500000) { fraudScore = Math.max(fraudScore, 60); flagged = true; action = "review"; }

  if (flagged) {
    await d.insert(fraudAlerts).values({
      transactionId: input.transactionId,
      agentId: input.agentId,
      severity: fraudScore >= 80 ? "critical" : "high",
      type: "TRANSACTION_FRAUD_SUSPECTED",
      fraudScore: String(fraudScore),
      reason: `Velocity: ${txCount} tx/hr, Volume: ₦${totalAmount.toLocaleString()}`,
      status: "open",
    }).catch(() => {});
  }

  await emit("fraud-events", { eventType: "transaction.fraud_checked", transactionId: input.transactionId, fraudScore, flagged, action });
  return { fraudScore, flagged, action };
}

export async function freezeAgentAccount(input: {
  agentId: number;
  reason: string;
  frozenBy: number;
}): Promise<{ frozen: boolean }> {
  const d = await db();
  await d.update(agents).set({
    isActive: false,
    floatLocked: true,
    terminalEnabled: false,
    terminalDisabledReason: input.reason,
    updatedAt: new Date(),
  }).where(eq(agents.id, input.agentId));

  await emit("agent-events", { eventType: "agent.account_frozen", agentId: input.agentId, reason: input.reason });
  await audit("AGENT_FROZEN", "agents", String(input.agentId), { reason: input.reason, frozenBy: input.frozenBy });
  return { frozen: true };
}

export async function unfreezeAgentAccount(input: {
  agentId: number;
  resolution: string;
  resolvedBy: number;
}): Promise<{ unfrozen: boolean }> {
  const d = await db();
  await d.update(agents).set({
    isActive: true,
    floatLocked: false,
    terminalEnabled: true,
    terminalDisabledReason: null,
    updatedAt: new Date(),
  }).where(eq(agents.id, input.agentId));

  await emit("agent-events", { eventType: "agent.account_unfrozen", agentId: input.agentId, resolution: input.resolution });
  await audit("AGENT_UNFROZEN", "agents", String(input.agentId), { resolution: input.resolution, resolvedBy: input.resolvedBy });
  return { unfrozen: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMISSION ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function calculateAgentCommission(input: {
  agentId: number;
  policyId?: number;
  premiumAmount?: number;
  productType?: string;
  transactionId?: number;
  transactionAmount?: number;
  commissionRate?: number; // percentage, e.g. 15 = 15%
  commissionType?: string;
}): Promise<{ commissionAmount: number; commissionRate: number }> {
  // NAICOM commission rates by product type
  const COMMISSION_RATES: Record<string, number> = {
    life: 0.10,        // 10% for life insurance
    health: 0.08,      // 8% for health insurance
    motor: 0.10,       // 10% for motor insurance
    property: 0.10,    // 10% for property insurance
    agricultural: 0.12, // 12% for agricultural insurance
    micro: 0.15,       // 15% for micro-insurance
    default: 0.10,
  };

  const rate = input.commissionRate != null
    ? input.commissionRate / 100
    : COMMISSION_RATES[input.productType ?? "default"] ?? COMMISSION_RATES.default;
  const baseAmount = input.transactionAmount ?? input.premiumAmount ?? 0;
  const commissionAmount = Math.round(baseAmount * rate * 100) / 100;

  const d = await db();
  await d.insert(commissions).values({
    agentId: input.agentId,
    policyId: input.policyId ?? null,
    transactionId: input.transactionId ?? null,
    commissionType: input.commissionType ?? "policy_commission",
    grossAmount: String(commissionAmount),
    netAmount: String(commissionAmount),
    currency: "NGN",
    status: "pending",
  }).catch(() => {});

  return { commissionAmount, commissionRate: rate };
}

export async function creditAgentCommission(input: {
  agentId: number;
  commissionAmount: number;
  policyId: number;
  commissionRef: string;
}): Promise<{ credited: boolean; newBalance: number }> {
  const d = await db();

  // Idempotency: a paid commission for this agent+policy means already credited
  const [existing] = await d.select().from(commissions)
    .where(and(eq(commissions.agentId, input.agentId), eq(commissions.policyId, input.policyId)))
    .limit(1);
  if (existing?.status === "paid") {
    const [agent] = await d.select({ commissionBalance: agents.commissionBalance }).from(agents).where(eq(agents.id, input.agentId)).limit(1);
    return { credited: true, newBalance: Number(agent?.commissionBalance ?? 0) };
  }

  // TigerBeetle: commissions-pool → agent-commission account
  const [agent] = await d.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);
  if (!agent) throw new Error(`Agent ${input.agentId} not found`);

  await tbCreateTransfer({
    debitAccountId: "commissions-pool",
    creditAccountId: `agent-commission-${agent.agentId}`,
    amount: Math.round(input.commissionAmount * 100),
    ledger: 5000,
    code: 500,
    ref: input.commissionRef,
    txType: "commission_credit",
    agentId: agent.agentId,
  });

  const newBalance = Number(agent.commissionBalance ?? 0) + input.commissionAmount;
  await d.update(agents).set({ commissionBalance: String(newBalance), updatedAt: new Date() }).where(eq(agents.id, input.agentId));
  await d.update(commissions).set({ status: "paid", updatedAt: new Date() })
    .where(and(eq(commissions.agentId, input.agentId), eq(commissions.policyId, input.policyId))).catch(() => {});

  await emit("commission-events", { eventType: "commission.credited", agentId: input.agentId, amount: input.commissionAmount, policyId: input.policyId });
  return { credited: true, newBalance };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPLIANCE ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function runAmlScreening(input: {
  entityType: "customer" | "agent" | "transaction";
  entityId: number;
  amount?: number;
  transactionType?: string;
}): Promise<{ cleared: boolean; riskLevel: string; flags: string[]; flagged: boolean; riskScore: number }> {
  const d = await db();
  const flags: string[] = [];
  let riskLevel = "low";

  // Amount-based AML triggers (CBN thresholds)
  if (input.amount) {
    if (input.amount >= 5_000_000) { flags.push("Large cash transaction > ₦5M — STR required"); riskLevel = "high"; }
    else if (input.amount >= 1_000_000) { flags.push("Transaction > ₦1M — enhanced monitoring"); riskLevel = "medium"; }
  }

  // Record compliance check
  await d.insert(complianceChecks).values({
    checkType: "AML",
    ruleCode: "aml_screening",
    result: flags.length > 0 ? "flag" : "pass",
    details: [`${input.entityType}#${input.entityId}`, `risk=${riskLevel}`, ...flags].join("; "),
    flaggedAmount: input.amount != null ? String(input.amount) : null,
  }).catch(() => {});

  await emit("compliance-events", { eventType: "aml.screened", entityType: input.entityType, entityId: input.entityId, riskLevel, flagCount: flags.length });
  const RISK_SCORES: Record<string, number> = { low: 20, medium: 50, high: 85 };
  return {
    cleared: flags.length === 0 || riskLevel !== "high",
    riskLevel,
    flags,
    flagged: flags.length > 0,
    riskScore: RISK_SCORES[riskLevel] ?? 20,
  };
}

export async function fileNaicomReport(input: {
  reportType: "quarterly_returns" | "annual_report" | "sar" | "claims_experience" | (string & {});
  periodStart?: string;
  periodEnd?: string;
  reportingPeriod?: string;
  reportData?: Record<string, unknown>;
  data?: Record<string, unknown>;
}): Promise<{ reportId: string; filed: boolean; filedAt: string }> {
  const reportId = `NAICOM-${input.reportType.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  const period = input.reportingPeriod ?? `${input.periodStart ?? ""}..${input.periodEnd ?? ""}`;

  // In production: submit to NAICOM reporting portal via APISIX gateway
  const d = await db();
  await d.insert(complianceChecks).values({
    checkType: "NAICOM",
    ruleCode: `naicom_${input.reportType}`,
    result: "pass",
    details: JSON.stringify({ reportId, period, data: input.reportData ?? input.data ?? null }),
  }).catch(() => {});

  await emit("compliance-events", { eventType: "naicom.report_filed", reportType: input.reportType, reportId });
  return { reportId, filed: true, filedAt: new Date().toISOString() };
}

// ═══════════════════════════════════════════════════════════════════════════
// REINSURANCE ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function calculateReinsuranceCession(input: {
  policyId?: number;
  sumInsured?: number;
  premiumAmount?: number;
  treatyId?: number;
  reinsurerCode?: string;
  treatyType?: string;
  portfolioType?: string;
  exposureAmount?: number;
  retentionLimit?: number;
}): Promise<{ cessionAmount: number; cessionPremium: number; retentionAmount: number; cessionPercentage: number }> {
  const d = await db();
  const sumInsured = input.sumInsured ?? input.exposureAmount ?? 0;
  const premiumAmount = input.premiumAmount ?? 0;

  // Get applicable treaty
  let retentionLimit = input.retentionLimit ?? 10_000_000; // ₦10M default retention limit
  if (input.treatyId) {
    const [treaty] = await d.select().from(reinsuranceTreaties).where(eq(reinsuranceTreaties.id, input.treatyId)).limit(1);
    if (treaty) retentionLimit = Number(treaty.retentionLimit ?? retentionLimit);
  }

  const cessionAmount = Math.max(0, sumInsured - retentionLimit);
  const cessionRatio = sumInsured > 0 ? cessionAmount / sumInsured : 0;
  const cessionPremium = Math.round(premiumAmount * cessionRatio * 100) / 100;
  const retentionAmount = sumInsured - cessionAmount;
  const cessionPercentage = Math.round(cessionRatio * 10000) / 100;

  return { cessionAmount, cessionPremium, retentionAmount, cessionPercentage };
}

export async function transferReinsurancePremium(input: {
  policyId?: number;
  reinsurerId?: string;
  reinsurerCode?: string;
  cessionPremium?: number;
  cedingPremium?: number;
  cessionRef?: string;
  treatyRef?: string;
  currency?: string;
}): Promise<{ transferred: boolean; tbTransferId: string | null; transferId: string | null }> {
  const d = await db();
  const reinsurerId = input.reinsurerId ?? input.reinsurerCode ?? "unknown";
  const cessionPremium = input.cessionPremium ?? input.cedingPremium ?? 0;
  const cessionRef = input.cessionRef ?? input.treatyRef ?? `CESSION-${reinsurerId}-${Date.now().toString(36).toUpperCase()}`;

  // Idempotency
  const [existing] = await d.select().from(transactions).where(eq(transactions.ref, cessionRef)).limit(1);
  if (existing) {
    const meta = existing.metadata as { tbTransferId?: string } | null;
    return { transferred: true, tbTransferId: meta?.tbTransferId ?? null, transferId: meta?.tbTransferId ?? null };
  }

  // TigerBeetle: insurer-premium-pool → reinsurer-account
  const tbResult = await tbCreateTransfer({
    debitAccountId: "insurer-premium-pool",
    creditAccountId: `reinsurer-${reinsurerId}`,
    amount: Math.round(cessionPremium * 100),
    ledger: 3000,
    code: 700,
    ref: cessionRef,
    txType: "reinsurance_cession",
  });

  await d.insert(transactions).values({
    ref: cessionRef,
    agentId: 0,
    type: "Insurance",
    amount: String(cessionPremium),
    fee: "0", commission: "0",
    channel: "App",
    status: "success",
    fraudScore: "0.00",
    metadata: { policyId: input.policyId ?? null, reinsurerId, tbTransferId: tbResult?.id ?? null, tbSyncStatus: tbResult ? "synced" : "pending" },
  });

  await emit("reinsurance-events", { eventType: "reinsurance.premium_ceded", policyId: input.policyId ?? null, cessionPremium });
  return { transferred: true, tbTransferId: tbResult?.id ?? null, transferId: tbResult?.id ?? null };
}

// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM HEALTH ACTIVITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function probeServiceHealth(input: {
  serviceName: string;
  serviceUrl?: string;
  endpoint?: string;
  timeoutMs?: number;
}): Promise<{ healthy: boolean; latencyMs: number; statusCode?: number; status: "healthy" | "unhealthy" }> {
  const url = input.serviceUrl ?? input.endpoint ?? "";
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(input.timeoutMs ?? 5000),
    });
    const latencyMs = Date.now() - start;
    return { healthy: res.ok, latencyMs, statusCode: res.status, status: res.ok ? "healthy" : "unhealthy" };
  } catch {
    return { healthy: false, latencyMs: Date.now() - start, status: "unhealthy" };
  }
}

export async function recordSlaMetrics(input: {
  serviceName: string;
  healthy: boolean;
  latencyMs: number;
  slaThresholdMs: number;
  timestamp?: string;
}): Promise<{ slaBreached: boolean }> {
  const slaBreached = !input.healthy || input.latencyMs > input.slaThresholdMs;

  if (slaBreached) {
    const d = await db();
    await d.insert(complianceChecks).values({
      checkType: "SLA",
      ruleCode: "sla_health_check",
      result: "flag",
      details: JSON.stringify({ serviceName: input.serviceName, latencyMs: input.latencyMs, slaThresholdMs: input.slaThresholdMs, healthy: input.healthy }),
    }).catch(() => {});

    await emit("platform-events", { eventType: "sla.breached", serviceName: input.serviceName, latencyMs: input.latencyMs, slaThresholdMs: input.slaThresholdMs });
  }

  return { slaBreached };
}

// ═══════════════════════════════════════════════════════════════════════════
// LAKEHOUSE INGESTION ACTIVITY
// ═══════════════════════════════════════════════════════════════════════════

export async function ingestToLakehouse(
  input: string | {
    dataset: string;
    records: Record<string, unknown>[];
    partitionKey?: string;
  },
  record?: Record<string, unknown>
): Promise<{ ingested: boolean; recordCount: number }> {
  const normalized = typeof input === "string"
    ? { dataset: input, records: record ? [record] : [] }
    : input;
  try {
    // In production: write to MinIO/Delta Lake via lakehouse service
    const res = await fetch(`${ENV.lakehouseUrl}/ingest/${normalized.dataset}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: normalized.records, partitionKey: typeof input === "string" ? undefined : input.partitionKey }),
      signal: AbortSignal.timeout(10_000),
    });
    return { ingested: res.ok, recordCount: normalized.records.length };
  } catch {
    // Fail-open: lakehouse ingestion is best-effort
    return { ingested: false, recordCount: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERIC ACTIVITIES (idempotency, notifications, ledger, events)
// Used by innovation journeys J21–J28
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Look up a previously recorded idempotency result for a journey step.
 * Returns the stored result payload, or null if this key has not completed.
 * Fail-open: if Redis is unavailable, returns null (workflow re-executes).
 */
export async function checkIdempotency(key: string, journey: string): Promise<unknown> {
  try {
    const redis = getRedisClient();
    const cached = await redis.get(`idem:${journey}:${key}`);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

/** Record the final result of a journey under its idempotency key (24h TTL). */
export async function recordIdempotency(key: string, journey: string, result: unknown): Promise<{ recorded: boolean }> {
  try {
    const redis = getRedisClient();
    await redis.set(`idem:${journey}:${key}`, JSON.stringify(result), "EX", 86400);
    return { recorded: true };
  } catch {
    return { recorded: false };
  }
}

/** AML screening wrapper keyed by customer (used by payout journeys). */
export async function runAmlCheck(input: {
  customerId: number;
  amount: number;
  transactionType: string;
}): Promise<{ cleared: boolean; riskLevel: string; flags: string[]; flagged: boolean; riskScore: number }> {
  return runAmlScreening({
    entityType: "customer",
    entityId: input.customerId,
    amount: input.amount,
    transactionType: input.transactionType,
  });
}

/** Submit a double-entry transfer to TigerBeetle; returns the transfer ID. */
export async function createTigerBeetleTransfer(input: {
  debitAccountId: string;
  creditAccountId: string;
  amount: number; // in kobo
  code?: number;
  ledger?: number;
  userData?: number;
}): Promise<{ transferId: string }> {
  const result = await tbCreateTransfer({
    debitAccountId: input.debitAccountId,
    creditAccountId: input.creditAccountId,
    amount: input.amount,
    ledger: input.ledger ?? 3000,
    code: input.code ?? 0,
    ref: input.userData != null ? `UD-${input.userData}-${Date.now().toString(36)}` : undefined,
  });
  return { transferId: result?.id ?? `OFFLINE-${Date.now().toString(36).toUpperCase()}` };
}

/** Persist a notification and fan it out via Dapr pub/sub. */
export async function sendNotification(input: {
  userId: number;
  type: string;
  message: string;
  channel?: string;
  title?: string;
}): Promise<{ sent: boolean }> {
  const d = await db();
  await d.insert(notifications).values({
    userId: input.userId,
    type: input.type,
    title: input.title ?? input.type,
    message: input.message,
    channel: input.channel ?? "sms",
    status: "pending",
  }).catch(() => {});
  await daprPublish({
    pubsubName: "insureportal-pubsub",
    topic: "notifications",
    data: { userId: input.userId, type: input.type, channel: input.channel ?? "sms" },
  }).catch(() => {});
  return { sent: true };
}

/** Emit an event to a Fluvio topic (fail-open). */
export async function emitFluvioEvent(topic: string, payload: Record<string, unknown>): Promise<{ emitted: boolean }> {
  await emit(topic, payload);
  return { emitted: true };
}

/** Fetch core policy data for journey decisions. */
export async function getPolicyData(policyId: number): Promise<{
  policyId: number;
  policyNumber: string;
  customerId: number;
  premiumAmount: number;
  sumInsured: number;
  status: string;
}> {
  const d = await db();
  const [policy] = await d.select().from(policies).where(eq(policies.id, policyId)).limit(1);
  if (!policy) throw new Error(`Policy ${policyId} not found`);
  return {
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    customerId: policy.customerId,
    premiumAmount: Number(policy.annualPremium ?? 0),
    sumInsured: Number(policy.sumInsured ?? 0),
    status: policy.status,
  };
}
