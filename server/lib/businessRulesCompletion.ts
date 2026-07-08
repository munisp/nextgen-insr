// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * Sprint 65 F6-F10: Business Rules & Domain Logic Completion
 * - F6: Transaction reversal workflow with approval chain
 * - F7: Agent commission clawback on reversed transactions
 * - F8: KYC document expiry monitoring and renewal alerts
 * - F9: Multi-currency settlement with FX rate locking
 * - F10: Merchant category code (MCC) validation and risk scoring
 */

// ============================================================
// F6: Transaction Reversal Workflow with Approval Chain
// ============================================================

export type ReversalStatus =
  | "pending"
  | "l1_approved"
  | "l2_approved"
  | "executed"
  | "rejected"
  | "expired";

export interface ReversalRequest {
  id: string;
  transactionRef: string;
  amount: number;
  currency: string;
  reason: string;
  requestedBy: string;
  requestedAt: Date;
  status: ReversalStatus;
  approvals: ReversalApproval[];
  executedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
}

export interface ReversalApproval {
  level: "L1" | "L2" | "L3";
  approvedBy: string;
  approvedAt: Date;
  notes?: string;
}

const REVERSAL_THRESHOLDS = {
  autoApprove: 500, // Auto-approve reversals under ₦500
  l1Only: 50000, // L1 approval only for ₦500-₦50,000
  l2Required: 500000, // L1+L2 for ₦50,000-₦500,000
  l3Required: Infinity, // L1+L2+L3 for ₦500,000+
};

export function getRequiredApprovalLevel(
  amount: number
): "auto" | "L1" | "L2" | "L3" {
  if (amount <= REVERSAL_THRESHOLDS.autoApprove) return "auto";
  if (amount <= REVERSAL_THRESHOLDS.l1Only) return "L1";
  if (amount <= REVERSAL_THRESHOLDS.l2Required) return "L2";
  return "L3";
}

export function canApproveReversal(
  request: ReversalRequest,
  approverLevel: "L1" | "L2" | "L3"
): { allowed: boolean; reason: string } {
  if (request.status === "executed" || request.status === "rejected") {
    return { allowed: false, reason: "Reversal already finalized" };
  }

  if (request.status === "expired") {
    return {
      allowed: false,
      reason: "Reversal request has expired (24h window)",
    };
  }

  const requiredLevel = getRequiredApprovalLevel(request.amount);
  if (requiredLevel === "auto") {
    return { allowed: true, reason: "Auto-approved (under threshold)" };
  }

  const existingLevels = request.approvals.map(a => a.level);

  if (approverLevel === "L1" && !existingLevels.includes("L1")) {
    return { allowed: true, reason: "L1 approval needed" };
  }
  if (
    approverLevel === "L2" &&
    existingLevels.includes("L1") &&
    !existingLevels.includes("L2")
  ) {
    return { allowed: true, reason: "L2 approval needed (L1 complete)" };
  }
  if (
    approverLevel === "L3" &&
    existingLevels.includes("L1") &&
    existingLevels.includes("L2") &&
    !existingLevels.includes("L3")
  ) {
    return { allowed: true, reason: "L3 approval needed (L1+L2 complete)" };
  }

  return {
    allowed: false,
    reason: `Cannot approve at ${approverLevel} level in current state`,
  };
}

export function processReversalApproval(
  request: ReversalRequest,
  approval: ReversalApproval
): ReversalRequest {
  const updated = { ...request, approvals: [...request.approvals, approval] };
  const requiredLevel = getRequiredApprovalLevel(request.amount);
  const levels = updated.approvals.map(a => a.level);

  if (
    requiredLevel === "auto" ||
    (requiredLevel === "L1" && levels.includes("L1"))
  ) {
    updated.status = "executed";
    updated.executedAt = new Date();
  } else if (
    requiredLevel === "L2" &&
    levels.includes("L1") &&
    levels.includes("L2")
  ) {
    updated.status = "executed";
    updated.executedAt = new Date();
  } else if (
    requiredLevel === "L3" &&
    levels.includes("L1") &&
    levels.includes("L2") &&
    levels.includes("L3")
  ) {
    updated.status = "executed";
    updated.executedAt = new Date();
  } else if (levels.includes("L1") && !levels.includes("L2")) {
    updated.status = "l1_approved";
  } else if (levels.includes("L2") && !levels.includes("L3")) {
    updated.status = "l2_approved";
  }

  return updated;
}

// ============================================================
// F7: Agent Commission Clawback on Reversed Transactions
// ============================================================

export interface ClawbackResult {
  agentId: string;
  originalCommission: number;
  clawbackAmount: number;
  penaltyRate: number;
  netClawback: number;
  reason: string;
  processedAt: Date;
}

const CLAWBACK_RULES = {
  withinSameDay: { rate: 1.0, penalty: 0 }, // Full clawback, no penalty
  within3Days: { rate: 1.0, penalty: 0.05 }, // Full clawback + 5% penalty
  within7Days: { rate: 0.75, penalty: 0.1 }, // 75% clawback + 10% penalty
  within30Days: { rate: 0.5, penalty: 0.15 }, // 50% clawback + 15% penalty
  beyond30Days: { rate: 0.25, penalty: 0.2 }, // 25% clawback + 20% penalty
};

export function calculateClawback(
  agentId: string,
  originalCommission: number,
  transactionDate: Date,
  reversalDate: Date = new Date(),
  reason: string = "Transaction reversal"
): ClawbackResult {
  const daysDiff = Math.floor(
    (reversalDate.getTime() - transactionDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  let rule;
  if (daysDiff === 0) rule = CLAWBACK_RULES.withinSameDay;
  else if (daysDiff <= 3) rule = CLAWBACK_RULES.within3Days;
  else if (daysDiff <= 7) rule = CLAWBACK_RULES.within7Days;
  else if (daysDiff <= 30) rule = CLAWBACK_RULES.within30Days;
  else rule = CLAWBACK_RULES.beyond30Days;

  const clawbackAmount = originalCommission * rule.rate;
  const penaltyAmount = originalCommission * rule.penalty;

  return {
    agentId,
    originalCommission,
    clawbackAmount,
    penaltyRate: rule.penalty,
    netClawback: clawbackAmount + penaltyAmount,
    reason: `${reason} (${daysDiff} days after transaction)`,
    processedAt: new Date(),
  };
}

// ============================================================
// F8: KYC Document Expiry Monitoring and Renewal Alerts
// ============================================================

export type KycDocType =
  | "national_id"
  | "passport"
  | "drivers_license"
  | "utility_bill"
  | "bank_statement"
  | "cac_certificate";

export interface KycDocument {
  id: string;
  agentId: string;
  docType: KycDocType;
  documentNumber: string;
  issuedAt: Date;
  expiresAt: Date;
  status: "valid" | "expiring_soon" | "expired" | "pending_renewal";
}

export interface KycExpiryAlert {
  documentId: string;
  agentId: string;
  docType: KycDocType;
  daysUntilExpiry: number;
  severity: "info" | "warning" | "critical";
  message: string;
  alertedAt: Date;
}

const KYC_EXPIRY_THRESHOLDS = {
  critical: 7, // 7 days or less
  warning: 30, // 30 days or less
  info: 90, // 90 days or less
};

const KYC_VALIDITY_PERIODS: Record<KycDocType, number> = {
  national_id: 3650, // 10 years
  passport: 1825, // 5 years
  drivers_license: 1095, // 3 years
  utility_bill: 90, // 3 months
  bank_statement: 90, // 3 months
  cac_certificate: 365, // 1 year
};

export function checkKycExpiry(
  doc: KycDocument,
  now: Date = new Date()
): KycExpiryAlert | null {
  const daysUntilExpiry = Math.floor(
    (doc.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysUntilExpiry > KYC_EXPIRY_THRESHOLDS.info) return null;

  let severity: "info" | "warning" | "critical";
  if (daysUntilExpiry <= 0) severity = "critical";
  else if (daysUntilExpiry <= KYC_EXPIRY_THRESHOLDS.critical)
    severity = "critical";
  else if (daysUntilExpiry <= KYC_EXPIRY_THRESHOLDS.warning)
    severity = "warning";
  else severity = "info";

  const message =
    daysUntilExpiry <= 0
      ? `${doc.docType} (${doc.documentNumber}) has EXPIRED ${Math.abs(daysUntilExpiry)} days ago`
      : `${doc.docType} (${doc.documentNumber}) expires in ${daysUntilExpiry} days`;

  return {
    documentId: doc.id,
    agentId: doc.agentId,
    docType: doc.docType,
    daysUntilExpiry,
    severity,
    message,
    alertedAt: now,
  };
}

export function getKycValidityPeriod(docType: KycDocType): number {
  return KYC_VALIDITY_PERIODS[docType];
}

export function batchCheckKycExpiry(
  documents: KycDocument[]
): KycExpiryAlert[] {
  const now = new Date();
  return documents
    .map(doc => checkKycExpiry(doc, now))
    .filter((alert): alert is KycExpiryAlert => alert !== null)
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
}

// ============================================================
// F9: Multi-Currency Settlement with FX Rate Locking
// ============================================================

export interface FxRate {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  lockedAt: Date;
  expiresAt: Date;
  source: string;
}

export interface MultiCurrencySettlement {
  id: string;
  originalAmount: number;
  originalCurrency: string;
  settlementAmount: number;
  settlementCurrency: string;
  fxRate: number;
  fxRateLockedAt: Date;
  fxSpread: number;
  totalFees: number;
  netSettlement: number;
}

// CBN-aligned FX rates (Central Bank of Nigeria reference rates)
const BASE_FX_RATES: Record<string, Record<string, number>> = {
  NGN: {
    USD: 0.000625,
    GBP: 0.0005,
    EUR: 0.000575,
    GHS: 0.0075,
    KES: 0.0813,
    XOF: 0.375,
  },
  USD: { NGN: 1600.0, GBP: 0.8, EUR: 0.92, GHS: 12.0, KES: 130.0, XOF: 600.0 },
  GBP: { NGN: 2000.0, USD: 1.25, EUR: 1.15, GHS: 15.0, KES: 162.5, XOF: 750.0 },
  EUR: {
    NGN: 1739.13,
    USD: 1.087,
    GBP: 0.87,
    GHS: 13.04,
    KES: 141.3,
    XOF: 652.17,
  },
};

const FX_LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const FX_SPREAD_BPS = 50; // 50 basis points (0.5%)

export function lockFxRate(
  baseCurrency: string,
  quoteCurrency: string
): FxRate | null {
  if (baseCurrency === quoteCurrency) {
    return {
      baseCurrency,
      quoteCurrency,
      rate: 1.0,
      lockedAt: new Date(),
      expiresAt: new Date(Date.now() + FX_LOCK_DURATION_MS),
      source: "identity",
    };
  }

  const rate = BASE_FX_RATES[baseCurrency]?.[quoteCurrency];
  if (!rate) return null;

  // Add small random variance (±0.1%) to simulate market movement
  const variance = 1 + (Math.random() - 0.5) * 0.002;
  const adjustedRate = rate * variance;

  return {
    baseCurrency,
    quoteCurrency,
    rate: Math.round(adjustedRate * 10000) / 10000,
    lockedAt: new Date(),
    expiresAt: new Date(Date.now() + FX_LOCK_DURATION_MS),
    source: "CBN_reference",
  };
}

export function calculateMultiCurrencySettlement(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  fxRate: FxRate
): MultiCurrencySettlement {
  const now = new Date();
  if (now > fxRate.expiresAt) {
    throw new Error("FX rate has expired — please lock a new rate");
  }

  const grossSettlement = amount * fxRate.rate;
  const spread = grossSettlement * (FX_SPREAD_BPS / 10000);
  const fees = Math.max(spread, 0.01); // Minimum fee
  const netSettlement = grossSettlement - fees;

  return {
    id: `MCY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    originalAmount: amount,
    originalCurrency: fromCurrency,
    settlementAmount: Math.round(grossSettlement * 100) / 100,
    settlementCurrency: toCurrency,
    fxRate: fxRate.rate,
    fxRateLockedAt: fxRate.lockedAt,
    fxSpread: FX_SPREAD_BPS,
    totalFees: Math.round(fees * 100) / 100,
    netSettlement: Math.round(netSettlement * 100) / 100,
  };
}

export function getSupportedCurrencies(): string[] {
  return Object.keys(BASE_FX_RATES);
}

// ============================================================
// F10: Merchant Category Code (MCC) Validation and Risk Scoring
// ============================================================

export interface MccEntry {
  code: string;
  description: string;
  category: string;
  riskLevel: "low" | "medium" | "high" | "prohibited";
  maxTransactionAmount: number;
  requiresEnhancedDueDiligence: boolean;
}

const MCC_DATABASE: MccEntry[] = [
  // Low risk
  {
    code: "5411",
    description: "Grocery Stores, Supermarkets",
    category: "retail",
    riskLevel: "low",
    maxTransactionAmount: 5000000,
    requiresEnhancedDueDiligence: false,
  },
  {
    code: "5541",
    description: "Service Stations (Fuel)",
    category: "fuel",
    riskLevel: "low",
    maxTransactionAmount: 2000000,
    requiresEnhancedDueDiligence: false,
  },
  {
    code: "5812",
    description: "Eating Places, Restaurants",
    category: "food",
    riskLevel: "low",
    maxTransactionAmount: 1000000,
    requiresEnhancedDueDiligence: false,
  },
  {
    code: "5912",
    description: "Drug Stores, Pharmacies",
    category: "health",
    riskLevel: "low",
    maxTransactionAmount: 3000000,
    requiresEnhancedDueDiligence: false,
  },
  {
    code: "5999",
    description: "Miscellaneous Retail Stores",
    category: "retail",
    riskLevel: "low",
    maxTransactionAmount: 5000000,
    requiresEnhancedDueDiligence: false,
  },
  // Medium risk
  {
    code: "5944",
    description: "Jewelry, Watch, Clock Shops",
    category: "luxury",
    riskLevel: "medium",
    maxTransactionAmount: 10000000,
    requiresEnhancedDueDiligence: true,
  },
  {
    code: "5511",
    description: "Automobile Dealers (New & Used)",
    category: "automotive",
    riskLevel: "medium",
    maxTransactionAmount: 50000000,
    requiresEnhancedDueDiligence: true,
  },
  {
    code: "6012",
    description: "Financial Institutions",
    category: "finance",
    riskLevel: "medium",
    maxTransactionAmount: 100000000,
    requiresEnhancedDueDiligence: true,
  },
  {
    code: "4722",
    description: "Travel Agencies",
    category: "travel",
    riskLevel: "medium",
    maxTransactionAmount: 20000000,
    requiresEnhancedDueDiligence: false,
  },
  // High risk
  {
    code: "5933",
    description: "Pawn Shops",
    category: "pawn",
    riskLevel: "high",
    maxTransactionAmount: 5000000,
    requiresEnhancedDueDiligence: true,
  },
  {
    code: "5993",
    description: "Cigar Stores and Stands",
    category: "tobacco",
    riskLevel: "high",
    maxTransactionAmount: 1000000,
    requiresEnhancedDueDiligence: true,
  },
  {
    code: "7995",
    description: "Betting/Casino Gambling",
    category: "gambling",
    riskLevel: "high",
    maxTransactionAmount: 500000,
    requiresEnhancedDueDiligence: true,
  },
  {
    code: "6051",
    description: "Non-FI Money Orders",
    category: "money_services",
    riskLevel: "high",
    maxTransactionAmount: 2000000,
    requiresEnhancedDueDiligence: true,
  },
  // Prohibited
  {
    code: "5962",
    description: "Direct Marketing - Travel",
    category: "telemarketing",
    riskLevel: "prohibited",
    maxTransactionAmount: 0,
    requiresEnhancedDueDiligence: true,
  },
];

export interface MccValidationResult {
  valid: boolean;
  mcc: MccEntry | null;
  riskScore: number;
  flags: string[];
  recommendation: "approve" | "review" | "decline" | "block";
}

export function validateMcc(
  code: string,
  transactionAmount: number = 0
): MccValidationResult {
  const mcc = MCC_DATABASE.find(m => m.code === code);
  const flags: string[] = [];

  if (!mcc) {
    return {
      valid: false,
      mcc: null,
      riskScore: 50,
      flags: ["Unknown MCC code — manual review required"],
      recommendation: "review",
    };
  }

  if (mcc.riskLevel === "prohibited") {
    return {
      valid: false,
      mcc,
      riskScore: 100,
      flags: ["Prohibited merchant category"],
      recommendation: "block",
    };
  }

  let riskScore = 0;
  if (mcc.riskLevel === "low") riskScore = 10;
  else if (mcc.riskLevel === "medium") riskScore = 40;
  else if (mcc.riskLevel === "high") riskScore = 70;

  if (transactionAmount > mcc.maxTransactionAmount) {
    riskScore += 20;
    flags.push(
      `Amount ₦${transactionAmount.toLocaleString()} exceeds MCC limit ₦${mcc.maxTransactionAmount.toLocaleString()}`
    );
  }

  if (mcc.requiresEnhancedDueDiligence) {
    riskScore += 10;
    flags.push("Enhanced due diligence required");
  }

  let recommendation: "approve" | "review" | "decline" | "block";
  if (riskScore <= 30) recommendation = "approve";
  else if (riskScore <= 60) recommendation = "review";
  else if (riskScore <= 85) recommendation = "decline";
  else recommendation = "block";

  return {
    valid: true,
    mcc,
    riskScore: Math.min(riskScore, 100),
    flags,
    recommendation,
  };
}

export function getMccByCode(code: string): MccEntry | undefined {
  return MCC_DATABASE.find(m => m.code === code);
}

export function getMccByCategory(category: string): MccEntry[] {
  return MCC_DATABASE.filter(m => m.category === category);
}

export function getHighRiskMccs(): MccEntry[] {
  return MCC_DATABASE.filter(
    m => m.riskLevel === "high" || m.riskLevel === "prohibited"
  );
}
