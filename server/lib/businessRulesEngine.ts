// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * Business Rules Engine — InsurePortal Insurance Platform
 *
 * Production-grade business logic for:
 * 1. Transaction limits per agent tier (daily/monthly caps)
 * 2. KYC level-based transaction limits
 * 3. Automatic fraud scoring on transactions
 * 4. Commission calculation with tier-based rates
 * 5. AML screening triggers
 * 6. Velocity checks
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Tier Transaction Limits
// ═══════════════════════════════════════════════════════════════════════════════
export type AgentTier = "basic" | "standard" | "premium" | "enterprise";

export interface TransactionLimits {
  singleTransactionMax: number;
  dailyMax: number;
  monthlyMax: number;
  dailyCount: number;
  monthlyCount: number;
}

const AGENT_TIER_LIMITS: Record<AgentTier, TransactionLimits> = {
  basic: {
    singleTransactionMax: 50_000, // ₦50,000
    dailyMax: 200_000, // ₦200,000
    monthlyMax: 3_000_000, // ₦3,000,000
    dailyCount: 50,
    monthlyCount: 500,
  },
  standard: {
    singleTransactionMax: 200_000, // ₦200,000
    dailyMax: 1_000_000, // ₦1,000,000
    monthlyMax: 15_000_000, // ₦15,000,000
    dailyCount: 200,
    monthlyCount: 2000,
  },
  premium: {
    singleTransactionMax: 500_000, // ₦500,000
    dailyMax: 5_000_000, // ₦5,000,000
    monthlyMax: 50_000_000, // ₦50,000,000
    dailyCount: 500,
    monthlyCount: 5000,
  },
  enterprise: {
    singleTransactionMax: 2_000_000, // ₦2,000,000
    dailyMax: 20_000_000, // ₦20,000,000
    monthlyMax: 200_000_000, // ₦200,000,000
    dailyCount: 2000,
    monthlyCount: 20000,
  },
};

export function getAgentTierLimits(tier: AgentTier): TransactionLimits {
  return AGENT_TIER_LIMITS[tier] || AGENT_TIER_LIMITS.basic;
}

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  remainingDaily?: number;
  remainingMonthly?: number;
}

export function checkTransactionLimits(
  tier: AgentTier,
  amount: number,
  dailyTotal: number,
  monthlyTotal: number,
  dailyCount: number,
  monthlyCount: number
): LimitCheckResult {
  const limits = getAgentTierLimits(tier);

  if (amount > limits.singleTransactionMax) {
    return {
      allowed: false,
      reason: `Amount exceeds single transaction limit of ₦${limits.singleTransactionMax.toLocaleString()}`,
    };
  }
  if (dailyTotal + amount > limits.dailyMax) {
    return {
      allowed: false,
      reason: `Would exceed daily limit of ₦${limits.dailyMax.toLocaleString()}`,
      remainingDaily: limits.dailyMax - dailyTotal,
    };
  }
  if (monthlyTotal + amount > limits.monthlyMax) {
    return {
      allowed: false,
      reason: `Would exceed monthly limit of ₦${limits.monthlyMax.toLocaleString()}`,
      remainingMonthly: limits.monthlyMax - monthlyTotal,
    };
  }
  if (dailyCount >= limits.dailyCount) {
    return {
      allowed: false,
      reason: `Daily transaction count limit reached (${limits.dailyCount})`,
    };
  }
  if (monthlyCount >= limits.monthlyCount) {
    return {
      allowed: false,
      reason: `Monthly transaction count limit reached (${limits.monthlyCount})`,
    };
  }
  return {
    allowed: true,
    remainingDaily: limits.dailyMax - dailyTotal - amount,
    remainingMonthly: limits.monthlyMax - monthlyTotal - amount,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// KYC Level Transaction Limits
// ═══════════════════════════════════════════════════════════════════════════════
export type KycLevel = "none" | "basic" | "standard" | "enhanced" | "full";

const KYC_LEVEL_LIMITS: Record<
  KycLevel,
  { singleMax: number; dailyMax: number; monthlyMax: number }
> = {
  none: { singleMax: 10_000, dailyMax: 20_000, monthlyMax: 100_000 },
  basic: { singleMax: 50_000, dailyMax: 200_000, monthlyMax: 1_000_000 },
  standard: { singleMax: 200_000, dailyMax: 1_000_000, monthlyMax: 10_000_000 },
  enhanced: {
    singleMax: 1_000_000,
    dailyMax: 5_000_000,
    monthlyMax: 50_000_000,
  },
  full: { singleMax: 5_000_000, dailyMax: 20_000_000, monthlyMax: 200_000_000 },
};

export function checkKycLimits(
  kycLevel: KycLevel,
  amount: number,
  dailyTotal: number,
  monthlyTotal: number
): LimitCheckResult {
  const limits = KYC_LEVEL_LIMITS[kycLevel] || KYC_LEVEL_LIMITS.none;
  if (amount > limits.singleMax)
    return {
      allowed: false,
      reason: `KYC level ${kycLevel}: amount exceeds ₦${limits.singleMax.toLocaleString()} limit`,
    };
  if (dailyTotal + amount > limits.dailyMax)
    return {
      allowed: false,
      reason: `KYC level ${kycLevel}: daily limit exceeded`,
    };
  if (monthlyTotal + amount > limits.monthlyMax)
    return {
      allowed: false,
      reason: `KYC level ${kycLevel}: monthly limit exceeded`,
    };
  return { allowed: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fraud Scoring Engine
// ═══════════════════════════════════════════════════════════════════════════════
export interface FraudScoreInput {
  amount: number;
  transactionType: "cash_in" | "cash_out" | "transfer" | "bill_payment";
  agentId: string;
  customerId?: string;
  deviceId?: string;
  ipAddress?: string;
  location?: { lat: number; lng: number };
  timeOfDay: number; // 0-23
  dayOfWeek: number; // 0-6
  recentTransactionCount: number; // last hour
  isNewCustomer: boolean;
  isNewDevice: boolean;
  isNewLocation: boolean;
  previousFraudFlags: number;
}

export interface FraudScoreResult {
  score: number; // 0-100
  riskLevel: "low" | "medium" | "high" | "critical";
  flags: string[];
  requiresReview: boolean;
  autoBlock: boolean;
}

export function calculateFraudScore(input: FraudScoreInput): FraudScoreResult {
  let score = 0;
  const flags: string[] = [];

  // Amount-based scoring
  if (input.amount > 1_000_000) {
    score += 15;
    flags.push("high_amount");
  } else if (input.amount > 500_000) {
    score += 10;
    flags.push("elevated_amount");
  } else if (input.amount > 200_000) {
    score += 5;
  }

  // Time-based scoring (unusual hours)
  if (input.timeOfDay >= 0 && input.timeOfDay < 5) {
    score += 20;
    flags.push("unusual_hour");
  } else if (input.timeOfDay >= 22 || input.timeOfDay < 6) {
    score += 10;
    flags.push("late_night");
  }

  // Velocity scoring
  if (input.recentTransactionCount > 20) {
    score += 25;
    flags.push("high_velocity");
  } else if (input.recentTransactionCount > 10) {
    score += 15;
    flags.push("elevated_velocity");
  } else if (input.recentTransactionCount > 5) {
    score += 5;
  }

  // New entity scoring
  if (input.isNewCustomer) {
    score += 10;
    flags.push("new_customer");
  }
  if (input.isNewDevice) {
    score += 15;
    flags.push("new_device");
  }
  if (input.isNewLocation) {
    score += 10;
    flags.push("new_location");
  }

  // Previous fraud history
  if (input.previousFraudFlags > 3) {
    score += 25;
    flags.push("repeat_offender");
  } else if (input.previousFraudFlags > 0) {
    score += 10;
    flags.push("prior_flags");
  }

  // Cash-out is higher risk than premium collection
  if (input.transactionType === "cash_out") {
    score += 5;
  }
  if (input.transactionType === "transfer") {
    score += 3;
  }

  // Cap at 100
  score = Math.min(score, 100);

  const riskLevel =
    score >= 80
      ? "critical"
      : score >= 60
        ? "high"
        : score >= 40
          ? "medium"
          : "low";

  return {
    score,
    riskLevel,
    flags,
    requiresReview: score >= 40,
    autoBlock: score >= 80,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Commission Calculation Engine
// ═══════════════════════════════════════════════════════════════════════════════
export type CommissionTier =
  | "starter"
  | "bronze"
  | "silver"
  | "gold"
  | "platinum";

interface CommissionRate {
  percentage: number;
  minAmount: number;
  maxAmount: number;
  flatFee: number;
}

const COMMISSION_RATES: Record<
  CommissionTier,
  Record<string, CommissionRate>
> = {
  starter: {
    cash_in: { percentage: 0.5, minAmount: 25, maxAmount: 500, flatFee: 0 },
    cash_out: { percentage: 0.75, minAmount: 50, maxAmount: 750, flatFee: 0 },
    transfer: { percentage: 0.3, minAmount: 20, maxAmount: 300, flatFee: 10 },
    bill_payment: {
      percentage: 0.2,
      minAmount: 10,
      maxAmount: 200,
      flatFee: 5,
    },
  },
  bronze: {
    cash_in: { percentage: 0.6, minAmount: 30, maxAmount: 600, flatFee: 0 },
    cash_out: { percentage: 0.85, minAmount: 50, maxAmount: 850, flatFee: 0 },
    transfer: { percentage: 0.35, minAmount: 25, maxAmount: 350, flatFee: 10 },
    bill_payment: {
      percentage: 0.25,
      minAmount: 15,
      maxAmount: 250,
      flatFee: 5,
    },
  },
  silver: {
    cash_in: { percentage: 0.7, minAmount: 35, maxAmount: 700, flatFee: 0 },
    cash_out: { percentage: 1.0, minAmount: 75, maxAmount: 1000, flatFee: 0 },
    transfer: { percentage: 0.4, minAmount: 30, maxAmount: 400, flatFee: 10 },
    bill_payment: {
      percentage: 0.3,
      minAmount: 20,
      maxAmount: 300,
      flatFee: 5,
    },
  },
  gold: {
    cash_in: { percentage: 0.8, minAmount: 40, maxAmount: 800, flatFee: 0 },
    cash_out: { percentage: 1.15, minAmount: 100, maxAmount: 1150, flatFee: 0 },
    transfer: { percentage: 0.45, minAmount: 35, maxAmount: 450, flatFee: 10 },
    bill_payment: {
      percentage: 0.35,
      minAmount: 25,
      maxAmount: 350,
      flatFee: 5,
    },
  },
  platinum: {
    cash_in: { percentage: 1.0, minAmount: 50, maxAmount: 1000, flatFee: 0 },
    cash_out: { percentage: 1.3, minAmount: 125, maxAmount: 1300, flatFee: 0 },
    transfer: { percentage: 0.5, minAmount: 40, maxAmount: 500, flatFee: 10 },
    bill_payment: {
      percentage: 0.4,
      minAmount: 30,
      maxAmount: 400,
      flatFee: 5,
    },
  },
};

export interface CommissionResult {
  grossCommission: number;
  platformFee: number;
  netCommission: number;
  tier: CommissionTier;
  rate: number;
}

export function calculateCommission(
  tier: CommissionTier,
  transactionType: string,
  amount: number
): CommissionResult {
  const rates = COMMISSION_RATES[tier] || COMMISSION_RATES.starter;
  const rate = rates[transactionType] || rates.cash_in;

  let commission = (amount * rate.percentage) / 100 + rate.flatFee;
  commission = Math.max(rate.minAmount, Math.min(rate.maxAmount, commission));

  const platformFee = commission * 0.2; // 20% platform cut
  const netCommission = commission - platformFee;

  return {
    grossCommission: Math.round(commission * 100) / 100,
    platformFee: Math.round(platformFee * 100) / 100,
    netCommission: Math.round(netCommission * 100) / 100,
    tier,
    rate: rate.percentage,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AML Screening Triggers
// ═══════════════════════════════════════════════════════════════════════════════
export interface AmlScreeningResult {
  triggered: boolean;
  reasons: string[];
  reportRequired: boolean;
  ctrRequired: boolean; // Currency Transaction Report
  sarRequired: boolean; // Suspicious Activity Report
}

export function checkAmlTriggers(
  amount: number,
  transactionType: string,
  dailyTotal: number,
  isInternational: boolean,
  destinationCountry?: string
): AmlScreeningResult {
  const reasons: string[] = [];
  let reportRequired = false;
  let ctrRequired = false;
  let sarRequired = false;

  // CTR threshold (CBN: ₦5,000,000 for individuals, ₦10,000,000 for corporates)
  if (amount >= 5_000_000 || dailyTotal + amount >= 5_000_000) {
    ctrRequired = true;
    reasons.push("CTR threshold exceeded (₦5M individual limit)");
    reportRequired = true;
  }

  // Structuring detection (multiple transactions just below threshold)
  if (amount >= 4_000_000 && amount < 5_000_000) {
    reasons.push("Potential structuring: amount near CTR threshold");
    sarRequired = true;
    reportRequired = true;
  }

  // High-risk countries (FATF grey/black list)
  const highRiskCountries = ["IR", "KP", "MM", "SY", "YE", "AF"];
  if (destinationCountry && highRiskCountries.includes(destinationCountry)) {
    reasons.push(`High-risk destination country: ${destinationCountry}`);
    sarRequired = true;
    reportRequired = true;
  }

  // International transfers above threshold
  if (isInternational && amount >= 1_000_000) {
    reasons.push("International transfer above ₦1M threshold");
    reportRequired = true;
  }

  return {
    triggered: reasons.length > 0,
    reasons,
    reportRequired,
    ctrRequired,
    sarRequired,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Velocity Checks
// ═══════════════════════════════════════════════════════════════════════════════
export interface VelocityCheckResult {
  allowed: boolean;
  reason?: string;
  cooldownSeconds?: number;
}

export function checkVelocity(
  transactionsLastMinute: number,
  transactionsLastHour: number,
  uniqueCustomersLastHour: number
): VelocityCheckResult {
  if (transactionsLastMinute > 5) {
    return {
      allowed: false,
      reason: "Too many transactions per minute (max 5)",
      cooldownSeconds: 60,
    };
  }
  if (transactionsLastHour > 100) {
    return {
      allowed: false,
      reason: "Hourly transaction limit reached (max 100)",
      cooldownSeconds: 300,
    };
  }
  if (uniqueCustomersLastHour > 50) {
    return {
      allowed: false,
      reason: "Too many unique customers per hour (max 50)",
      cooldownSeconds: 600,
    };
  }
  return { allowed: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 69: DISPUTE ESCALATION WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════════
export type DisputeStatus =
  | "opened"
  | "under_review"
  | "evidence_requested"
  | "evidence_submitted"
  | "mediation"
  | "escalated_to_supervisor"
  | "escalated_to_cbn"
  | "resolved_for_customer"
  | "resolved_for_merchant"
  | "closed";

export interface DisputeEscalationRule {
  fromStatus: DisputeStatus;
  toStatus: DisputeStatus;
  condition: string;
  slaHours: number;
  autoEscalate: boolean;
  notifyParties: string[];
}

const DISPUTE_ESCALATION_RULES: DisputeEscalationRule[] = [
  {
    fromStatus: "opened",
    toStatus: "under_review",
    condition: "auto_on_create",
    slaHours: 2,
    autoEscalate: true,
    notifyParties: ["support_agent", "customer"],
  },
  {
    fromStatus: "under_review",
    toStatus: "evidence_requested",
    condition: "need_more_info",
    slaHours: 24,
    autoEscalate: false,
    notifyParties: ["merchant", "customer"],
  },
  {
    fromStatus: "evidence_requested",
    toStatus: "evidence_submitted",
    condition: "evidence_received",
    slaHours: 72,
    autoEscalate: true,
    notifyParties: ["support_agent"],
  },
  {
    fromStatus: "evidence_submitted",
    toStatus: "mediation",
    condition: "conflicting_evidence",
    slaHours: 48,
    autoEscalate: false,
    notifyParties: ["mediator", "customer", "merchant"],
  },
  {
    fromStatus: "under_review",
    toStatus: "escalated_to_supervisor",
    condition: "sla_breached_or_high_value",
    slaHours: 4,
    autoEscalate: true,
    notifyParties: ["supervisor", "customer"],
  },
  {
    fromStatus: "escalated_to_supervisor",
    toStatus: "escalated_to_cbn",
    condition: "unresolved_after_7_days",
    slaHours: 168,
    autoEscalate: true,
    notifyParties: ["cbn_officer", "compliance", "customer"],
  },
  {
    fromStatus: "mediation",
    toStatus: "resolved_for_customer",
    condition: "merchant_at_fault",
    slaHours: 0,
    autoEscalate: false,
    notifyParties: ["customer", "merchant", "finance"],
  },
  {
    fromStatus: "mediation",
    toStatus: "resolved_for_merchant",
    condition: "customer_at_fault",
    slaHours: 0,
    autoEscalate: false,
    notifyParties: ["customer", "merchant"],
  },
];

export function getNextDisputeStatus(
  currentStatus: DisputeStatus,
  condition: string
): DisputeEscalationRule | null {
  return (
    DISPUTE_ESCALATION_RULES.find(
      r => r.fromStatus === currentStatus && r.condition === condition
    ) || null
  );
}

export function getDisputeSLA(status: DisputeStatus): number {
  const rule = DISPUTE_ESCALATION_RULES.find(r => r.fromStatus === status);
  return rule?.slaHours || 24;
}

export function shouldAutoEscalate(
  currentStatus: DisputeStatus,
  lastUpdatedAt: Date
): {
  shouldEscalate: boolean;
  nextStatus: DisputeStatus | null;
  reason: string;
} {
  const rule = DISPUTE_ESCALATION_RULES.find(
    r => r.fromStatus === currentStatus && r.autoEscalate
  );
  if (!rule)
    return {
      shouldEscalate: false,
      nextStatus: null,
      reason: "No auto-escalation rule",
    };
  const hoursSinceUpdate =
    (Date.now() - lastUpdatedAt.getTime()) / (1000 * 60 * 60);
  if (hoursSinceUpdate >= rule.slaHours) {
    return {
      shouldEscalate: true,
      nextStatus: rule.toStatus,
      reason: `SLA breached: ${hoursSinceUpdate.toFixed(1)}h > ${rule.slaHours}h limit`,
    };
  }
  return {
    shouldEscalate: false,
    nextStatus: null,
    reason: `Within SLA: ${hoursSinceUpdate.toFixed(1)}h / ${rule.slaHours}h`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 69: KYC VERIFICATION STATE MACHINE
// ═══════════════════════════════════════════════════════════════════════════════
export type KYCVerificationStatus =
  | "not_started"
  | "documents_submitted"
  | "identity_verified"
  | "address_verified"
  | "bvn_verified"
  | "video_kyc_pending"
  | "video_kyc_completed"
  | "under_review"
  | "approved"
  | "rejected"
  | "expired"
  | "suspended";

export interface KYCTransition {
  from: KYCVerificationStatus;
  to: KYCVerificationStatus;
  requiredDocuments: string[];
  validationRules: string[];
}

const KYC_STATE_MACHINE: KYCTransition[] = [
  {
    from: "not_started",
    to: "documents_submitted",
    requiredDocuments: ["national_id", "utility_bill"],
    validationRules: ["doc_not_expired", "doc_readable"],
  },
  {
    from: "documents_submitted",
    to: "identity_verified",
    requiredDocuments: [],
    validationRules: ["bvn_match", "name_match", "dob_match"],
  },
  {
    from: "identity_verified",
    to: "address_verified",
    requiredDocuments: ["proof_of_address"],
    validationRules: ["address_within_6_months"],
  },
  {
    from: "address_verified",
    to: "bvn_verified",
    requiredDocuments: [],
    validationRules: ["bvn_active", "bvn_not_flagged"],
  },
  {
    from: "bvn_verified",
    to: "video_kyc_pending",
    requiredDocuments: [],
    validationRules: ["tier_requires_video"],
  },
  {
    from: "video_kyc_pending",
    to: "video_kyc_completed",
    requiredDocuments: ["video_recording"],
    validationRules: ["face_match_score_gt_90", "liveness_check_passed"],
  },
  {
    from: "video_kyc_completed",
    to: "under_review",
    requiredDocuments: [],
    validationRules: [],
  },
  {
    from: "bvn_verified",
    to: "under_review",
    requiredDocuments: [],
    validationRules: ["tier_1_only"],
  },
  {
    from: "under_review",
    to: "approved",
    requiredDocuments: [],
    validationRules: ["all_checks_passed", "no_sanctions_match"],
  },
  {
    from: "under_review",
    to: "rejected",
    requiredDocuments: [],
    validationRules: ["check_failed"],
  },
  {
    from: "approved",
    to: "expired",
    requiredDocuments: [],
    validationRules: ["kyc_older_than_365_days"],
  },
  {
    from: "rejected",
    to: "documents_submitted",
    requiredDocuments: ["corrected_documents"],
    validationRules: ["rejection_appeal_period"],
  },
];

export function getValidKYCTransitions(
  currentStatus: KYCVerificationStatus
): KYCTransition[] {
  return KYC_STATE_MACHINE.filter(t => t.from === currentStatus);
}

export function canTransitionKYC(
  from: KYCVerificationStatus,
  to: KYCVerificationStatus
): KYCTransition | null {
  return KYC_STATE_MACHINE.find(t => t.from === from && t.to === to) || null;
}

export function getKYCCompletionPercentage(
  status: KYCVerificationStatus
): number {
  const map: Record<KYCVerificationStatus, number> = {
    not_started: 0,
    documents_submitted: 15,
    identity_verified: 30,
    address_verified: 45,
    bvn_verified: 60,
    video_kyc_pending: 70,
    video_kyc_completed: 80,
    under_review: 90,
    approved: 100,
    rejected: 0,
    expired: 0,
    suspended: 0,
  };
  return map[status] || 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 69: SETTLEMENT BATCH PROCESSING RULES
// ═══════════════════════════════════════════════════════════════════════════════
export interface SettlementBatch {
  batchId: string;
  totalAmount: number;
  transactionCount: number;
  currency: string;
  merchantId: string;
}

export function evaluateSettlementRules(batch: SettlementBatch): {
  actions: string[];
  canAutoProcess: boolean;
} {
  const actions: string[] = [];
  if (batch.totalAmount > 10_000_000) actions.push("hold_for_manual_review");
  if (batch.transactionCount > 1000) actions.push("flag_for_fraud_review");
  if (batch.currency !== "NGN") actions.push("apply_cross_border_compliance");
  const hour = new Date().getHours();
  if (batch.totalAmount <= 1_000_000 && hour < 14)
    actions.push("process_same_day");
  const day = new Date().getDay();
  if (day === 0 || day === 6) actions.push("defer_to_next_business_day");
  const canAutoProcess =
    !actions.includes("hold_for_manual_review") &&
    !actions.includes("flag_for_fraud_review");
  return { actions, canAutoProcess };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 69: AGENT ONBOARDING PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════
export type AgentOnboardingStage =
  | "application_submitted"
  | "background_check"
  | "training_assigned"
  | "training_completed"
  | "device_assigned"
  | "territory_assigned"
  | "float_allocated"
  | "activated"
  | "probation"
  | "fully_active";

export function getAgentOnboardingNextStage(
  current: AgentOnboardingStage
): AgentOnboardingStage | null {
  const pipeline: AgentOnboardingStage[] = [
    "application_submitted",
    "background_check",
    "training_assigned",
    "training_completed",
    "device_assigned",
    "territory_assigned",
    "float_allocated",
    "activated",
    "probation",
    "fully_active",
  ];
  const idx = pipeline.indexOf(current);
  return idx >= 0 && idx < pipeline.length - 1 ? pipeline[idx + 1] : null;
}

export function getAgentOnboardingProgress(
  stage: AgentOnboardingStage
): number {
  const stages: AgentOnboardingStage[] = [
    "application_submitted",
    "background_check",
    "training_assigned",
    "training_completed",
    "device_assigned",
    "territory_assigned",
    "float_allocated",
    "activated",
    "probation",
    "fully_active",
  ];
  return Math.round(((stages.indexOf(stage) + 1) / stages.length) * 100);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 69: MERCHANT ACTIVATION FLOW
// ═══════════════════════════════════════════════════════════════════════════════
export type MerchantActivationStage =
  | "registered"
  | "kyc_pending"
  | "kyc_approved"
  | "contract_signed"
  | "terminal_assigned"
  | "integration_testing"
  | "live_pilot"
  | "fully_active"
  | "suspended"
  | "deactivated";

export function getMerchantActivationNextStage(
  current: MerchantActivationStage
): MerchantActivationStage | null {
  const pipeline: MerchantActivationStage[] = [
    "registered",
    "kyc_pending",
    "kyc_approved",
    "contract_signed",
    "terminal_assigned",
    "integration_testing",
    "live_pilot",
    "fully_active",
  ];
  const idx = pipeline.indexOf(current);
  return idx >= 0 && idx < pipeline.length - 1 ? pipeline[idx + 1] : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 69: TRANSACTION VALIDATION (CBN Regulations)
// ═══════════════════════════════════════════════════════════════════════════════
export function validateTransactionCBN(tx: {
  amount: number;
  currency: string;
  senderBalance: number;
  recipientExists: boolean;
  senderKycLevel: number;
  dailyTotal: number;
}): { isValid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const kycLimits: Record<number, number> = {
    0: 50_000,
    1: 200_000,
    2: 5_000_000,
    3: 50_000_000,
  };

  if (tx.amount <= 0) errors.push("Transaction amount must be positive");
  if (tx.amount > tx.senderBalance) errors.push("Insufficient balance");
  if (!tx.recipientExists) errors.push("Recipient account not found");
  const limit = kycLimits[tx.senderKycLevel] || kycLimits[0];
  if (tx.amount > limit)
    errors.push(
      `Amount exceeds KYC level ${tx.senderKycLevel} limit of ${limit.toLocaleString()} ${tx.currency}`
    );
  if (tx.dailyTotal + tx.amount > limit * 3)
    errors.push("Daily transaction limit exceeded");
  if (tx.amount > limit * 0.8)
    warnings.push("Transaction approaching KYC limit");

  return { isValid: errors.length === 0, errors, warnings };
}

// Export all rules for testing
export const RULES = {
  DISPUTE_ESCALATION: DISPUTE_ESCALATION_RULES,
  KYC_STATE_MACHINE,
  AGENT_TIER_LIMITS,
  COMMISSION_RATES,
};
