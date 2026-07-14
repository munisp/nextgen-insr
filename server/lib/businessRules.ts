// TypeScript enabled — Sprint 96 security audit
/**
 * InsurePortal Insurance Platform — Business Rules Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralised enforcement of CBN-mandated insurance regulations, internal
 * risk policies, and commercial rules. All rules are data-driven and can be
 * overridden via the systemConfig table without a code deploy.
 *
 * Sections:
 *  1. CBN Transaction Limits (per tier, per channel)
 *  2. Float Balance Alerts & Enforcement
 *  3. KYC Tier Enforcement (BVN, NIN, document checks)
 *  4. Fraud Scoring Rules (velocity, geolocation, amount pattern)
 *  5. Commission Calculation (tiered, type-specific)
 *  6. Loyalty Point Accrual (tier multipliers, streak bonuses)
 *  7. Agent Lifecycle Transitions (suspension, reinstatement, tier upgrade)
 */

// ── CBN Transaction Limits ────────────────────────────────────────────────────

/**
 * CBN Guidelines for Agent Banking (2023 Circular):
 * - Tier 1 (Bronze): ₦50,000 single, ₦200,000 daily, 10 tx/hr
 * - Tier 2 (Silver): ₦200,000 single, ₦1,000,000 daily, 20 tx/hr
 * - Tier 3 (Gold):   ₦500,000 single, ₦5,000,000 daily, 50 tx/hr
 * - Tier 4 (Platinum): ₦1,000,000 single, ₦20,000,000 daily, 100 tx/hr
 */
export const CBN_LIMITS: Record<
  string,
  {
    maxSingleTx: number;
    maxDailyVolume: number;
    maxHourlyCount: number;
    maxMonthlyVolume: number;
    requiresBvn: boolean;
    requiresNin: boolean;
  }
> = {
  Bronze: {
    maxSingleTx: 50_000,
    maxDailyVolume: 200_000,
    maxHourlyCount: 10,
    maxMonthlyVolume: 3_000_000,
    requiresBvn: false,
    requiresNin: false,
  },
  Silver: {
    maxSingleTx: 200_000,
    maxDailyVolume: 1_000_000,
    maxHourlyCount: 20,
    maxMonthlyVolume: 15_000_000,
    requiresBvn: true,
    requiresNin: false,
  },
  Gold: {
    maxSingleTx: 500_000,
    maxDailyVolume: 5_000_000,
    maxHourlyCount: 50,
    maxMonthlyVolume: 75_000_000,
    requiresBvn: true,
    requiresNin: true,
  },
  Platinum: {
    maxSingleTx: 1_000_000,
    maxDailyVolume: 20_000_000,
    maxHourlyCount: 100,
    maxMonthlyVolume: 300_000_000,
    requiresBvn: true,
    requiresNin: true,
  },
};

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  code?:
    | "SINGLE_TX_LIMIT"
    | "DAILY_LIMIT"
    | "HOURLY_LIMIT"
    | "MONTHLY_LIMIT"
    | "KYC_REQUIRED";
  limit?: number;
  used?: number;
}

export function checkCbnSingleTxLimit(
  tier: string,
  amount: number
): LimitCheckResult {
  const limits = CBN_LIMITS[tier];
  if (!limits) return { allowed: true };
  if (amount > limits.maxSingleTx) {
    return {
      allowed: false,
      code: "SINGLE_TX_LIMIT",
      reason: `Single transaction ₦${amount.toLocaleString()} exceeds ${tier} CBN limit of ₦${limits.maxSingleTx.toLocaleString()}`,
      limit: limits.maxSingleTx,
      used: amount,
    };
  }
  return { allowed: true };
}

export function checkCbnDailyLimit(
  tier: string,
  currentDailyVolume: number,
  newAmount: number
): LimitCheckResult {
  const limits = CBN_LIMITS[tier];
  if (!limits) return { allowed: true };
  const projected = currentDailyVolume + newAmount;
  if (projected > limits.maxDailyVolume) {
    return {
      allowed: false,
      code: "DAILY_LIMIT",
      reason: `Daily volume ₦${projected.toLocaleString()} would exceed ${tier} CBN limit of ₦${limits.maxDailyVolume.toLocaleString()}`,
      limit: limits.maxDailyVolume,
      used: projected,
    };
  }
  return { allowed: true };
}

export function checkCbnHourlyCount(
  tier: string,
  currentHourlyCount: number
): LimitCheckResult {
  const limits = CBN_LIMITS[tier];
  if (!limits) return { allowed: true };
  if (currentHourlyCount >= limits.maxHourlyCount) {
    return {
      allowed: false,
      code: "HOURLY_LIMIT",
      reason: `Hourly transaction count (${currentHourlyCount}) has reached ${tier} CBN limit of ${limits.maxHourlyCount}/hr`,
      limit: limits.maxHourlyCount,
      used: currentHourlyCount,
    };
  }
  return { allowed: true };
}

// ── Float Balance Alerts ──────────────────────────────────────────────────────

export const FLOAT_ALERT_THRESHOLDS = {
  /** Warn agent when float drops below this percentage of their typical daily volume */
  WARNING_PCT: 0.2,
  /** Critical alert — agent should immediately request top-up */
  CRITICAL_PCT: 0.1,
  /** Absolute minimum floor — transactions blocked below this */
  MINIMUM_FLOOR: 5_000,
};

export type FloatAlertLevel = "none" | "warning" | "critical" | "blocked";

export interface FloatAlertResult {
  level: FloatAlertLevel;
  message: string;
  currentBalance: number;
  recommendedTopUp?: number;
}

export function evaluateFloatAlert(
  currentBalance: number,
  avgDailyVolume: number,
  tier: string
): FloatAlertResult {
  const limits = CBN_LIMITS[tier];
  const referenceVolume =
    avgDailyVolume || (limits?.maxDailyVolume ?? 200_000) * 0.3;

  if (currentBalance < FLOAT_ALERT_THRESHOLDS.MINIMUM_FLOOR) {
    return {
      level: "blocked",
      message: `Float balance ₦${currentBalance.toLocaleString()} is below minimum floor of ₦${FLOAT_ALERT_THRESHOLDS.MINIMUM_FLOOR.toLocaleString()}. Transactions are blocked.`,
      currentBalance,
      recommendedTopUp: referenceVolume * 0.5,
    };
  }

  const criticalThreshold =
    referenceVolume * FLOAT_ALERT_THRESHOLDS.CRITICAL_PCT;
  const warningThreshold = referenceVolume * FLOAT_ALERT_THRESHOLDS.WARNING_PCT;

  if (currentBalance < criticalThreshold) {
    return {
      level: "critical",
      message: `Float balance ₦${currentBalance.toLocaleString()} is critically low. Request a top-up immediately.`,
      currentBalance,
      recommendedTopUp: referenceVolume * 0.5,
    };
  }

  if (currentBalance < warningThreshold) {
    return {
      level: "warning",
      message: `Float balance ₦${currentBalance.toLocaleString()} is running low. Consider requesting a top-up.`,
      currentBalance,
      recommendedTopUp: referenceVolume * 0.3,
    };
  }

  return {
    level: "none",
    message: "Float balance is adequate.",
    currentBalance,
  };
}

// ── KYC Tier Enforcement ──────────────────────────────────────────────────────

/**
 * CBN KYC tiers for agent banking customers:
 * - Tier 1: Phone number only — max ₦50,000 single, ₦300,000 daily
 * - Tier 2: BVN verified — max ₦200,000 single, ₦1,000,000 daily
 * - Tier 3: BVN + NIN + document — max ₦500,000 single, ₦5,000,000 daily
 */
export const KYC_TIER_LIMITS: Record<
  number,
  {
    maxSingleTx: number;
    maxDailyBalance: number;
    maxAccountBalance: number;
    description: string;
  }
> = {
  1: {
    maxSingleTx: 50_000,
    maxDailyBalance: 300_000,
    maxAccountBalance: 300_000,
    description: "Phone only — basic KYC",
  },
  2: {
    maxSingleTx: 200_000,
    maxDailyBalance: 1_000_000,
    maxAccountBalance: 1_000_000,
    description: "BVN verified — standard KYC",
  },
  3: {
    maxSingleTx: 500_000,
    maxDailyBalance: 5_000_000,
    maxAccountBalance: 5_000_000,
    description: "Full KYC — BVN + NIN + document",
  },
};

export interface KycCheckResult {
  allowed: boolean;
  reason?: string;
  upgradeRequired?: number;
  currentTier: number;
}

export function checkKycTierForTransaction(
  customerKycTier: number,
  amount: number
): KycCheckResult {
  const tierLimits = KYC_TIER_LIMITS[customerKycTier] ?? KYC_TIER_LIMITS[1];

  if (amount > tierLimits.maxSingleTx) {
    // Find the minimum tier that would allow this transaction
    const requiredTier = Object.entries(KYC_TIER_LIMITS).find(
      ([, limits]) => limits.maxSingleTx >= amount
    );
    return {
      allowed: false,
      currentTier: customerKycTier,
      reason: `Transaction amount ₦${amount.toLocaleString()} exceeds Tier ${customerKycTier} KYC limit of ₦${tierLimits.maxSingleTx.toLocaleString()}`,
      upgradeRequired: requiredTier ? Number(requiredTier[0]) : 3,
    };
  }

  return { allowed: true, currentTier: customerKycTier };
}

// ── Fraud Scoring Rules ───────────────────────────────────────────────────────

export interface FraudSignal {
  type: string;
  weight: number;
  description: string;
}

export interface FraudScoringResult {
  score: number; // 0.0 – 1.0
  level: "low" | "medium" | "high" | "critical";
  signals: FraudSignal[];
  shouldBlock: boolean;
  shouldAlert: boolean;
}

/**
 * Rule-based fraud scoring. Returns a composite score 0–1.
 * Score >= 0.7 → block transaction and raise alert.
 * Score >= 0.5 → raise alert but allow (with supervisor review flag).
 */
export function scoreFraud(params: {
  amount: number;
  tier: string;
  hourlyCount: number;
  dailyVolume: number;
  isOutsideGeofence: boolean;
  failedPinAttempts: number;
  isNewCustomer: boolean;
  isRoundAmount: boolean;
  timeSinceLastTx: number; // seconds
  customerKycTier: number;
}): FraudScoringResult {
  const signals: FraudSignal[] = [];
  let score = 0;

  const limits = CBN_LIMITS[params.tier];
  const maxSingle = limits?.maxSingleTx ?? 200_000;

  // Large single transaction (>80% of tier limit)
  if (params.amount > maxSingle * 0.8) {
    const weight = (params.amount / maxSingle) * 0.25;
    signals.push({
      type: "large_amount",
      weight,
      description: `Amount is ${Math.round((params.amount / maxSingle) * 100)}% of tier limit`,
    });
    score += weight;
  }

  // Velocity breach (>70% of hourly limit)
  const maxHourly = limits?.maxHourlyCount ?? 20;
  if (params.hourlyCount > maxHourly * 0.7) {
    const weight = 0.2;
    signals.push({
      type: "velocity_breach",
      weight,
      description: `${params.hourlyCount} transactions in the last hour (limit: ${maxHourly})`,
    });
    score += weight;
  }

  // Outside geofence
  if (params.isOutsideGeofence) {
    signals.push({
      type: "geofence_violation",
      weight: 0.3,
      description: "Transaction originated outside assigned geofence zone",
    });
    score += 0.3;
  }

  // Failed PIN attempts
  if (params.failedPinAttempts >= 3) {
    const weight = Math.min(params.failedPinAttempts * 0.08, 0.25);
    signals.push({
      type: "pin_brute_force",
      weight,
      description: `${params.failedPinAttempts} failed PIN attempts before this transaction`,
    });
    score += weight;
  }

  // Round amount (common in structuring)
  if (params.isRoundAmount && params.amount >= 50_000) {
    signals.push({
      type: "round_amount_structuring",
      weight: 0.1,
      description: "Suspiciously round large amount — possible structuring",
    });
    score += 0.1;
  }

  // Rapid successive transactions (< 30 seconds apart)
  if (params.timeSinceLastTx < 30 && params.timeSinceLastTx >= 0) {
    signals.push({
      type: "rapid_succession",
      weight: 0.15,
      description: `Transaction ${params.timeSinceLastTx}s after previous — possible automation`,
    });
    score += 0.15;
  }

  // Low KYC customer with high amount
  if (params.customerKycTier === 1 && params.amount > 30_000) {
    signals.push({
      type: "kyc_amount_mismatch",
      weight: 0.15,
      description: "Tier 1 KYC customer with high transaction amount",
    });
    score += 0.15;
  }

  // New customer with large amount
  if (params.isNewCustomer && params.amount > 100_000) {
    signals.push({
      type: "new_customer_large_amount",
      weight: 0.1,
      description: "First-time customer with large transaction",
    });
    score += 0.1;
  }

  const finalScore = Math.min(score, 1.0);
  const level: FraudScoringResult["level"] =
    finalScore >= 0.8
      ? "critical"
      : finalScore >= 0.6
        ? "high"
        : finalScore >= 0.4
          ? "medium"
          : "low";

  return {
    score: Math.round(finalScore * 100) / 100,
    level,
    signals,
    shouldBlock: finalScore >= 0.7,
    shouldAlert: finalScore >= 0.5,
  };
}

// ── Commission Calculation ────────────────────────────────────────────────────

/**
 * Commission rates by transaction type (% of transaction amount).
 * These are the default rates; overridden by commissionRules table.
 */
export const DEFAULT_COMMISSION_RATES: Record<string, number> = {
  "Cash In": 0.005, // 0.50%
  "Cash Out": 0.0075, // 0.75%
  Transfer: 0.003, // 0.30%
  Airtime: 0.02, // 2.00%
  "Bill Payment": 0.01, // 1.00%
  "Card Payment": 0.0025, // 0.25%
  "QR Payment": 0.0025, // 0.25%
  "NFC Payment": 0.0025, // 0.25%
};

/** Tier multipliers applied on top of base commission rates */
export const TIER_COMMISSION_MULTIPLIERS: Record<string, number> = {
  Bronze: 1.0,
  Silver: 1.1,
  Gold: 1.2,
  Platinum: 1.35,
};

export interface CommissionResult {
  baseRate: number;
  tierMultiplier: number;
  effectiveRate: number;
  commissionAmount: number;
  breakdown: string;
}

export function calculateCommission(
  txType: string,
  amount: number,
  agentTier: string,
  overrideRate?: number
): CommissionResult {
  const baseRate = overrideRate ?? DEFAULT_COMMISSION_RATES[txType] ?? 0;
  const multiplier = TIER_COMMISSION_MULTIPLIERS[agentTier] ?? 1.0;
  const effectiveRate = baseRate * multiplier;
  const commissionAmount = Math.round(amount * effectiveRate * 100) / 100;

  return {
    baseRate,
    tierMultiplier: multiplier,
    effectiveRate,
    commissionAmount,
    breakdown: `₦${amount.toLocaleString()} × ${(effectiveRate * 100).toFixed(3)}% (${(baseRate * 100).toFixed(2)}% base × ${multiplier}x ${agentTier} multiplier) = ₦${commissionAmount.toLocaleString()}`,
  };
}

// ── Loyalty Point Accrual ─────────────────────────────────────────────────────

/**
 * Points earned per ₦1,000 transacted, by transaction type.
 */
export const LOYALTY_EARN_RATES: Record<string, number> = {
  "Cash In": 1.0,
  "Cash Out": 1.5,
  Transfer: 2.0,
  Airtime: 3.0,
  "Bill Payment": 2.5,
  "Card Payment": 1.0,
  "QR Payment": 1.5,
  "NFC Payment": 2.0,
};

/** Tier multipliers for loyalty point accrual */
export const TIER_LOYALTY_MULTIPLIERS: Record<string, number> = {
  Bronze: 1.0,
  Silver: 1.25,
  Gold: 1.5,
  Platinum: 2.0,
};

/** Streak bonuses: consecutive days active → bonus points per transaction */
export const STREAK_BONUSES: Array<{
  minDays: number;
  bonusPoints: number;
  label: string;
}> = [
  { minDays: 30, bonusPoints: 100, label: "30-day streak" },
  { minDays: 14, bonusPoints: 50, label: "14-day streak" },
  { minDays: 7, bonusPoints: 25, label: "7-day streak" },
  { minDays: 3, bonusPoints: 10, label: "3-day streak" },
];

export interface LoyaltyAccrualResult {
  basePoints: number;
  tierMultiplier: number;
  streakBonus: number;
  totalPoints: number;
  streakLabel?: string;
  breakdown: string;
}

export function calculateLoyaltyPoints(
  txType: string,
  amount: number,
  agentTier: string,
  streakDays: number
): LoyaltyAccrualResult {
  const earnRate = LOYALTY_EARN_RATES[txType] ?? 1.0;
  const tierMultiplier = TIER_LOYALTY_MULTIPLIERS[agentTier] ?? 1.0;
  const basePoints = Math.floor((amount / 1000) * earnRate);
  const tieredPoints = Math.floor(basePoints * tierMultiplier);

  const streakBonus = STREAK_BONUSES.find(b => streakDays >= b.minDays);
  const bonusPoints = streakBonus?.bonusPoints ?? 0;
  const totalPoints = tieredPoints + bonusPoints;

  return {
    basePoints,
    tierMultiplier,
    streakBonus: bonusPoints,
    totalPoints,
    streakLabel: streakBonus?.label,
    breakdown: `${basePoints} base × ${tierMultiplier}x ${agentTier} = ${tieredPoints} pts${bonusPoints > 0 ? ` + ${bonusPoints} ${streakBonus?.label} bonus` : ""} = ${totalPoints} pts`,
  };
}

// ── Agent Lifecycle Transitions ───────────────────────────────────────────────

export type AgentStatus =
  | "active"
  | "suspended"
  | "probation"
  | "terminated"
  | "pending_kyc";

export interface LifecycleTransitionResult {
  allowed: boolean;
  newStatus?: AgentStatus;
  reason: string;
  requiresApproval: boolean;
  notifyAgent: boolean;
  notifySupervisor: boolean;
}

export function evaluateAgentSuspension(params: {
  currentStatus: AgentStatus;
  fraudAlertCount: number;
  unresolvedDisputeCount: number;
  consecutiveFailedDays: number;
  premiumReserve: number;
  kycExpired: boolean;
}): LifecycleTransitionResult {
  if (params.kycExpired) {
    return {
      allowed: true,
      newStatus: "pending_kyc",
      reason:
        "Agent KYC documents have expired — transactions blocked until renewal",
      requiresApproval: false,
      notifyAgent: true,
      notifySupervisor: true,
    };
  }

  if (params.fraudAlertCount >= 5) {
    return {
      allowed: true,
      newStatus: "suspended",
      reason: `Agent has ${params.fraudAlertCount} unresolved fraud alerts — automatic suspension triggered`,
      requiresApproval: true,
      notifyAgent: true,
      notifySupervisor: true,
    };
  }

  if (params.unresolvedDisputeCount >= 10) {
    return {
      allowed: true,
      newStatus: "probation",
      reason: `Agent has ${params.unresolvedDisputeCount} unresolved disputes — placed on probation`,
      requiresApproval: true,
      notifyAgent: true,
      notifySupervisor: true,
    };
  }

  if (params.consecutiveFailedDays >= 7) {
    return {
      allowed: true,
      newStatus: "probation",
      reason: `Agent has been inactive for ${params.consecutiveFailedDays} consecutive days`,
      requiresApproval: false,
      notifyAgent: true,
      notifySupervisor: false,
    };
  }

  return {
    allowed: false,
    reason: "No suspension criteria met",
    requiresApproval: false,
    notifyAgent: false,
    notifySupervisor: false,
  };
}

export function evaluateTierUpgrade(params: {
  currentTier: string;
  monthlyVolume: number;
  monthlyTxCount: number;
  loyaltyPoints: number;
  kycLevel: number;
  streakDays: number;
}): { eligible: boolean; targetTier?: string; reason: string } {
  const UPGRADE_CRITERIA: Record<
    string,
    {
      minMonthlyVolume: number;
      minMonthlyTxCount: number;
      minLoyaltyPoints: number;
      minKycLevel: number;
      minStreakDays: number;
    }
  > = {
    Silver: {
      minMonthlyVolume: 500_000,
      minMonthlyTxCount: 50,
      minLoyaltyPoints: 5_000,
      minKycLevel: 2,
      minStreakDays: 7,
    },
    Gold: {
      minMonthlyVolume: 2_000_000,
      minMonthlyTxCount: 150,
      minLoyaltyPoints: 15_000,
      minKycLevel: 2,
      minStreakDays: 14,
    },
    Platinum: {
      minMonthlyVolume: 10_000_000,
      minMonthlyTxCount: 500,
      minLoyaltyPoints: 50_000,
      minKycLevel: 3,
      minStreakDays: 30,
    },
  };

  const tierOrder = ["Bronze", "Silver", "Gold", "Platinum"];
  const currentIdx = tierOrder.indexOf(params.currentTier);
  if (currentIdx === -1 || currentIdx === tierOrder.length - 1) {
    return {
      eligible: false,
      reason: "Already at maximum tier or unknown tier",
    };
  }

  const nextTier = tierOrder[currentIdx + 1];
  const criteria = UPGRADE_CRITERIA[nextTier];
  if (!criteria)
    return { eligible: false, reason: "No upgrade criteria defined" };

  const checks = [
    {
      met: params.monthlyVolume >= criteria.minMonthlyVolume,
      label: `Monthly volume ₦${params.monthlyVolume.toLocaleString()} / ₦${criteria.minMonthlyVolume.toLocaleString()} required`,
    },
    {
      met: params.monthlyTxCount >= criteria.minMonthlyTxCount,
      label: `Monthly tx count ${params.monthlyTxCount} / ${criteria.minMonthlyTxCount} required`,
    },
    {
      met: params.loyaltyPoints >= criteria.minLoyaltyPoints,
      label: `Loyalty points ${params.loyaltyPoints.toLocaleString()} / ${criteria.minLoyaltyPoints.toLocaleString()} required`,
    },
    {
      met: params.kycLevel >= criteria.minKycLevel,
      label: `KYC level ${params.kycLevel} / ${criteria.minKycLevel} required`,
    },
    {
      met: params.streakDays >= criteria.minStreakDays,
      label: `Streak ${params.streakDays} / ${criteria.minStreakDays} days required`,
    },
  ];

  const unmet = checks.filter(c => !c.met);
  if (unmet.length === 0) {
    return {
      eligible: true,
      targetTier: nextTier,
      reason: `All criteria met for ${nextTier} tier upgrade`,
    };
  }

  return {
    eligible: false,
    reason: `Not yet eligible for ${nextTier}: ${unmet.map(c => c.label).join("; ")}`,
  };
}

// ── Reward Catalog ────────────────────────────────────────────────────────────

export const REWARD_CATALOG = [
  {
    id: "airtime_500",
    name: "₦500 Airtime",
    pointsCost: 500,
    category: "airtime",
    description: "₦500 airtime for any Nigerian network",
  },
  {
    id: "airtime_1000",
    name: "₦1,000 Airtime",
    pointsCost: 1_000,
    category: "airtime",
    description: "₦1,000 airtime for any Nigerian network",
  },
  {
    id: "data_1gb",
    name: "1GB Data Bundle",
    pointsCost: 1_500,
    category: "data",
    description: "1GB data bundle for MTN, Airtel, or Glo",
  },
  {
    id: "data_5gb",
    name: "5GB Data Bundle",
    pointsCost: 6_000,
    category: "data",
    description: "5GB data bundle — valid 30 days",
  },
  {
    id: "float_5k",
    name: "₦5,000 Float Credit",
    pointsCost: 4_500,
    category: "float",
    description: "₦5,000 credited directly to your premium reserve",
  },
  {
    id: "float_20k",
    name: "₦20,000 Float Credit",
    pointsCost: 17_000,
    category: "float",
    description: "₦20,000 credited directly to your premium reserve",
  },
  {
    id: "cashback_1k",
    name: "₦1,000 Cash Back",
    pointsCost: 2_000,
    category: "cashback",
    description: "₦1,000 cash back on your next settlement",
  },
  {
    id: "cashback_5k",
    name: "₦5,000 Cash Back",
    pointsCost: 9_000,
    category: "cashback",
    description: "₦5,000 cash back on your next settlement",
  },
  {
    id: "fee_waiver_1d",
    name: "1-Day Fee Waiver",
    pointsCost: 3_000,
    category: "fee_waiver",
    description: "All transaction fees waived for 24 hours",
  },
  {
    id: "tier_boost",
    name: "Tier Boost (30 days)",
    pointsCost: 25_000,
    category: "tier",
    description: "Operate at the next tier level for 30 days",
  },
  {
    id: "training_cert",
    name: "Training Certificate",
    pointsCost: 5_000,
    category: "training",
    description: "CBN-accredited agent banking training certificate",
  },
  {
    id: "pos_upgrade",
    name: "POS Terminal Upgrade",
    pointsCost: 50_000,
    category: "hardware",
    description: "Upgrade to next-generation POS terminal",
  },
];

export function validateRedemption(
  rewardId: string,
  agentPoints: number
): { valid: boolean; reward?: (typeof REWARD_CATALOG)[0]; reason?: string } {
  const reward = REWARD_CATALOG.find(r => r.id === rewardId);
  if (!reward)
    return {
      valid: false,
      reason: `Reward '${rewardId}' not found in catalog`,
    };
  if (agentPoints < reward.pointsCost) {
    return {
      valid: false,
      reward,
      reason: `Insufficient points: ${agentPoints.toLocaleString()} available, ${reward.pointsCost.toLocaleString()} required`,
    };
  }
  return { valid: true, reward };
}
