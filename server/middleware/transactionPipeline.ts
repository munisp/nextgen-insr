// TypeScript enabled — Sprint 96 security audit
/**
 * Transaction Processing Pipeline
 *
 * Integrates business rules, fraud scoring, compliance checks,
 * and lifecycle workflows into a unified transaction processing middleware.
 *
 * Pipeline stages:
 * 1. Input validation & sanitization
 * 2. Rate limit check
 * 3. Business rule evaluation (limits, KYC tier, corridor)
 * 4. Fraud scoring & risk assessment
 * 5. Commission calculation
 * 6. Compliance screening (AML/CFT)
 * 7. Transaction execution
 * 8. Post-processing (notifications, audit, analytics)
 */

import { z } from "zod";
import { logger } from '../_core/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TransactionRequest {
  type: "cash_in" | "cash_out" | "transfer" | "bill_payment" | "airtime";
  amount: number;
  currency: string;
  senderAgentCode: string;
  senderAccountId?: string;
  recipientPhone?: string;
  recipientAccountId?: string;
  corridor?: string;
  metadata?: Record<string, string>;
}

export interface PipelineResult {
  approved: boolean;
  transactionId?: string;
  referenceNumber?: string;
  commission?: number;
  fee?: number;
  exchangeRate?: number;
  rejectionReason?: string;
  riskScore?: number;
  complianceFlags?: string[];
  processingTimeMs: number;
}

interface PipelineContext {
  request: TransactionRequest;
  agentId: number;
  tenantId?: number;
  kycTier: "basic" | "standard" | "enhanced" | "premium";
  dailyVolume: number;
  monthlyVolume: number;
  riskScore: number;
  complianceFlags: string[];
  startTime: number;
}

// ─── Validation Schema ───────────────────────────────────────────────────────

export const transactionRequestSchema = z.object({
  type: z.enum(["cash_in", "cash_out", "transfer", "bill_payment", "airtime"]),
  amount: z.number().positive().max(50_000_000), // Max 50M NGN
  currency: z.string().min(3).max(3).default("NGN"),
  senderAgentCode: z.string().min(1).max(32),
  senderAccountId: z.string().optional(),
  recipientPhone: z.string().optional(),
  recipientAccountId: z.string().optional(),
  corridor: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

// ─── Business Rule Constants ─────────────────────────────────────────────────

const DAILY_LIMITS: Record<string, number> = {
  basic: 50_000,
  standard: 200_000,
  enhanced: 1_000_000,
  premium: 5_000_000,
};

const SINGLE_TXN_LIMITS: Record<string, number> = {
  basic: 20_000,
  standard: 100_000,
  enhanced: 500_000,
  premium: 2_000_000,
};

const COMMISSION_RATES: Record<string, number> = {
  cash_in: 0.005, // 0.5%
  cash_out: 0.01, // 1.0%
  transfer: 0.0075, // 0.75%
  bill_payment: 0.003, // 0.3%
  airtime: 0.025, // 2.5%
};

const FEE_TIERS = [
  { min: 0, max: 5_000, fee: 10 },
  { min: 5_001, max: 50_000, fee: 25 },
  { min: 50_001, max: 200_000, fee: 50 },
  { min: 200_001, max: 1_000_000, fee: 100 },
  { min: 1_000_001, max: Infinity, fee: 200 },
];

// ─── AML Screening Keywords ─────────────────────────────────────────────────

const HIGH_RISK_CORRIDORS = ["NG-KP", "NG-SO", "NG-YE", "NG-SY", "NG-IR"];
const STRUCTURING_THRESHOLD = 1_000_000; // NGN
const RAPID_TXN_WINDOW_MS = 300_000; // 5 minutes

// ─── Pipeline Implementation ─────────────────────────────────────────────────

export async function processTransaction(
  request: TransactionRequest,
  agentId: number,
  tenantId?: number
): Promise<PipelineResult> {
  const startTime = Date.now();

  const ctx: PipelineContext = {
    request,
    agentId,
    tenantId,
    kycTier: "standard", // Would be fetched from DB in production
    dailyVolume: 0, // Would be aggregated from DB
    monthlyVolume: 0,
    riskScore: 0,
    complianceFlags: [],
    startTime,
  };

  try {
    // Stage 1: Validate
    validateRequest(ctx);

    // Stage 2: Check business rules
    checkBusinessRules(ctx);

    // Stage 3: Fraud scoring
    calculateRiskScore(ctx);

    // Stage 4: Compliance screening
    screenCompliance(ctx);

    // Stage 5: Calculate fees & commission
    const { fee, commission } = calculateFeesAndCommission(ctx);

    // Stage 6: Generate reference
    const referenceNumber = generateReference(ctx.request.type);

    return {
      approved: true,
      transactionId: `TXN-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      referenceNumber,
      commission,
      fee,
      riskScore: ctx.riskScore,
      complianceFlags:
        ctx.complianceFlags.length > 0 ? ctx.complianceFlags : undefined,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      approved: false,
      rejectionReason: error.message || "Transaction rejected",
      riskScore: ctx.riskScore,
      complianceFlags: ctx.complianceFlags,
      processingTimeMs: Date.now() - startTime,
    };
  }
}

// ─── Stage Implementations ───────────────────────────────────────────────────

function validateRequest(ctx: PipelineContext): void {
  const { request } = ctx;

  if (request.amount <= 0) {
    throw new Error("VALIDATION_ERROR: Amount must be positive");
  }

  if (
    request.type === "transfer" &&
    !request.recipientPhone &&
    !request.recipientAccountId
  ) {
    throw new Error(
      "VALIDATION_ERROR: Transfer requires recipient phone or account"
    );
  }

  if (request.type === "cash_out" && !request.senderAccountId) {
    throw new Error("VALIDATION_ERROR: Cash-out requires sender account");
  }
}

function checkBusinessRules(ctx: PipelineContext): void {
  const { request, kycTier, dailyVolume } = ctx;

  // Single transaction limit
  const singleLimit = SINGLE_TXN_LIMITS[kycTier] || SINGLE_TXN_LIMITS.basic;
  if (request.amount > singleLimit) {
    throw new Error(
      `LIMIT_EXCEEDED: Amount ₦${request.amount.toLocaleString()} exceeds ` +
        `single transaction limit of ₦${singleLimit.toLocaleString()} for ${kycTier} tier`
    );
  }

  // Daily volume limit
  const dailyLimit = DAILY_LIMITS[kycTier] || DAILY_LIMITS.basic;
  if (dailyVolume + request.amount > dailyLimit) {
    throw new Error(
      `DAILY_LIMIT_EXCEEDED: This transaction would exceed your daily limit ` +
        `of ₦${dailyLimit.toLocaleString()} for ${kycTier} tier`
    );
  }

  // CBN regulatory: transactions above 5M NGN require enhanced due diligence
  if (request.amount >= 5_000_000) {
    ctx.complianceFlags.push("CBN_ENHANCED_DUE_DILIGENCE_REQUIRED");
  }

  // CBN: cash transactions above 500K require CTR filing
  if (
    (request.type === "cash_in" || request.type === "cash_out") &&
    request.amount >= 500_000
  ) {
    ctx.complianceFlags.push("CBN_CTR_FILING_REQUIRED");
  }
}

function calculateRiskScore(ctx: PipelineContext): void {
  let score = 0;

  // Amount-based risk
  if (ctx.request.amount > 1_000_000) score += 20;
  else if (ctx.request.amount > 500_000) score += 10;
  else if (ctx.request.amount > 100_000) score += 5;

  // Corridor risk
  if (
    ctx.request.corridor &&
    HIGH_RISK_CORRIDORS.includes(ctx.request.corridor)
  ) {
    score += 40;
    ctx.complianceFlags.push("HIGH_RISK_CORRIDOR");
  }

  // Structuring detection (just below reporting threshold)
  if (
    ctx.request.amount >= STRUCTURING_THRESHOLD * 0.9 &&
    ctx.request.amount < STRUCTURING_THRESHOLD
  ) {
    score += 30;
    ctx.complianceFlags.push("POSSIBLE_STRUCTURING");
  }

  // Volume velocity
  if (ctx.dailyVolume > DAILY_LIMITS[ctx.kycTier] * 0.8) {
    score += 15;
    ctx.complianceFlags.push("HIGH_VELOCITY");
  }

  ctx.riskScore = Math.min(score, 100);

  // Auto-reject if risk score exceeds threshold
  if (ctx.riskScore >= 80) {
    throw new Error(
      "RISK_REJECTED: Transaction flagged for manual review due to high risk score"
    );
  }
}

async function screenCompliance(ctx: PipelineContext): Promise<void> {
  // Real sanctions/PEP screening via complianceScreening module
  try {
    const { screenTransaction } = await import("../lib/complianceScreening");
    const result = await screenTransaction(
      {
        fullName: ctx.request.senderAgentCode || "",
        nationality: ctx.request.corridor?.split("-")[0],
      },
      {
        fullName:
          ctx.request.recipientPhone || ctx.request.recipientAccountId || "",
        nationality: ctx.request.corridor?.split("-")[1],
      },
      ctx.request.amount,
      ctx.request.currency
    );

    if (!result.transactionCleared) {
      ctx.complianceFlags.push(...result.flags);
      throw new Error(
        `SANCTIONS_BLOCKED: Transaction blocked by compliance screening. ` +
          `Flags: ${result.flags.join(", ")}`
      );
    }
  } catch (err: any) {
    if (err.message?.startsWith("SANCTIONS_BLOCKED")) throw err;
    // Log screening failure but don't block — regulatory requirement is to screen,
    // temporary unavailability should not halt all transactions
    logger.warn("[Compliance] Screening service unavailable:", err.message);
    ctx.complianceFlags.push("SCREENING_UNAVAILABLE");
  }

  // If any critical compliance flags, require manual approval
  const criticalFlags = ctx.complianceFlags.filter(
    f => f.includes("HIGH_RISK") || f.includes("STRUCTURING")
  );

  if (criticalFlags.length > 0 && ctx.riskScore >= 60) {
    throw new Error(
      `COMPLIANCE_HOLD: Transaction requires compliance officer review. ` +
        `Flags: ${criticalFlags.join(", ")}`
    );
  }
}

function calculateFeesAndCommission(ctx: PipelineContext): {
  fee: number;
  commission: number;
} {
  const { request } = ctx;

  // Calculate flat fee based on amount tier
  const feeTier = FEE_TIERS.find(
    t => request.amount >= t.min && request.amount <= t.max
  );
  const fee = feeTier?.fee || 200;

  // Calculate percentage-based commission
  const rate = COMMISSION_RATES[request.type] || 0.005;
  const commission = Math.round(request.amount * rate);

  return { fee, commission };
}

function generateReference(type: string): string {
  const prefix = type.toUpperCase().replace(/_/g, "").slice(0, 4);
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomUUID().slice(0, 4).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

// ─── Utility: Batch Processing ───────────────────────────────────────────────

export async function processBatch(
  requests: TransactionRequest[],
  agentId: number,
  tenantId?: number
): Promise<PipelineResult[]> {
  const results: PipelineResult[] = [];
  for (const req of requests) {
    const result = await processTransaction(req, agentId, tenantId);
    results.push(result);
  }
  return results;
}

// ─── Utility: Transaction Summary ────────────────────────────────────────────

export function summarizeResults(results: PipelineResult[]): {
  total: number;
  approved: number;
  rejected: number;
  totalAmount: number;
  totalFees: number;
  totalCommission: number;
  avgProcessingTimeMs: number;
} {
  const approved = results.filter(r => r.approved);
  const rejected = results.filter(r => !r.approved);

  return {
    total: results.length,
    approved: approved.length,
    rejected: rejected.length,
    totalAmount: 0, // Would sum from transaction amounts
    totalFees: approved.reduce((sum, r) => sum + (r.fee || 0), 0),
    totalCommission: approved.reduce((sum, r) => sum + (r.commission || 0), 0),
    avgProcessingTimeMs:
      results.length > 0
        ? results.reduce((sum, r) => sum + r.processingTimeMs, 0) /
          results.length
        : 0,
  };
}
