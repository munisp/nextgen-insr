// @ts-check

/**
 * InsurePortal Insurance Platform — Business Rules Engine Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers all CBN limit checks, float alert thresholds, KYC tier enforcement,
 * fraud scoring, commission calculation, loyalty accrual, tier upgrade
 * eligibility, and reward redemption validation.
 */
import { describe, it, expect } from "vitest";
import {
  checkCbnSingleTxLimit,
  checkCbnDailyLimit,
  checkCbnHourlyCount,
  checkKycTierForTransaction,
  calculateCommission,
  calculateLoyaltyPoints,
  evaluateFloatAlert,
  scoreFraud,
  evaluateTierUpgrade,
  validateRedemption,
  CBN_LIMITS,
  KYC_TIER_LIMITS,
  REWARD_CATALOG,
} from "./lib/businessRules.js";

// ── CBN Single Transaction Limit ──────────────────────────────────────────────
describe("checkCbnSingleTxLimit", () => {
  it("allows Bronze agent with amount below ₦50,000 limit", () => {
    const result = checkCbnSingleTxLimit("Bronze", 49_999);
    expect(result.allowed).toBe(true);
  });

  it("allows Bronze agent with amount at exactly the limit (boundary is inclusive)", () => {
    // The implementation uses strict > so exactly at limit is allowed
    const result = checkCbnSingleTxLimit("Bronze", 50_000);
    expect(result.allowed).toBe(true);
  });

  it("blocks Bronze agent with amount above ₦50,000 limit", () => {
    const result = checkCbnSingleTxLimit("Bronze", 75_000);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("SINGLE_TX_LIMIT");
    expect(result.limit).toBe(50_000);
    expect(result.used).toBe(75_000);
  });

  it("allows Gold agent with amount below ₦500,000 limit", () => {
    const result = checkCbnSingleTxLimit("Gold", 499_999);
    expect(result.allowed).toBe(true);
  });

  it("blocks Gold agent with amount above ₦500,000 limit", () => {
    const result = checkCbnSingleTxLimit("Gold", 600_000);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("SINGLE_TX_LIMIT");
  });

  it("allows Platinum agent with amount up to ₦1,000,000", () => {
    const result = checkCbnSingleTxLimit("Platinum", 999_999);
    expect(result.allowed).toBe(true);
  });

  it("returns allowed=true for unknown tier (fail-open)", () => {
    const result = checkCbnSingleTxLimit("Unknown", 999_999_999);
    expect(result.allowed).toBe(true);
  });
});

// ── CBN Daily Volume Limit ────────────────────────────────────────────────────
describe("checkCbnDailyLimit", () => {
  it("allows Silver agent within ₦1,000,000 daily limit", () => {
    const result = checkCbnDailyLimit("Silver", 500_000, 400_000);
    expect(result.allowed).toBe(true);
  });

  it("blocks Silver agent when projected volume exceeds ₦1,000,000", () => {
    const result = checkCbnDailyLimit("Silver", 800_000, 300_000);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("DAILY_LIMIT");
    expect(result.limit).toBe(1_000_000);
    expect(result.used).toBe(1_100_000);
  });

  it("allows Bronze agent with zero daily volume and small amount", () => {
    const result = checkCbnDailyLimit("Bronze", 0, 50_000);
    expect(result.allowed).toBe(true);
  });

  it("blocks Bronze agent when daily volume would exceed ₦200,000", () => {
    const result = checkCbnDailyLimit("Bronze", 180_000, 30_000);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("DAILY_LIMIT");
  });
});

// ── CBN Hourly Count Limit ────────────────────────────────────────────────────
describe("checkCbnHourlyCount", () => {
  it("allows Bronze agent with count below 10/hr limit", () => {
    const result = checkCbnHourlyCount("Bronze", 9);
    expect(result.allowed).toBe(true);
  });

  it("blocks Bronze agent at exactly the 10/hr limit", () => {
    const result = checkCbnHourlyCount("Bronze", 10);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("HOURLY_LIMIT");
  });

  it("allows Platinum agent with count below 100/hr limit", () => {
    const result = checkCbnHourlyCount("Platinum", 99);
    expect(result.allowed).toBe(true);
  });

  it("blocks Gold agent at exactly the 50/hr limit", () => {
    const result = checkCbnHourlyCount("Gold", 50);
    expect(result.allowed).toBe(false);
  });
});

// ── KYC Tier Enforcement ──────────────────────────────────────────────────────
describe("checkKycTierForTransaction", () => {
  it("allows Tier 1 customer for transaction below ₦50,000", () => {
    const result = checkKycTierForTransaction(1, 49_000);
    expect(result.allowed).toBe(true);
    expect(result.currentTier).toBe(1);
  });

  it("blocks Tier 1 customer for transaction above ₦50,000", () => {
    const result = checkKycTierForTransaction(1, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.upgradeRequired).toBeGreaterThan(1);
  });

  it("allows Tier 2 customer for transaction up to ₦200,000", () => {
    const result = checkKycTierForTransaction(2, 199_000);
    expect(result.allowed).toBe(true);
  });

  it("blocks Tier 2 customer for transaction above ₦200,000", () => {
    const result = checkKycTierForTransaction(2, 250_000);
    expect(result.allowed).toBe(false);
    expect(result.upgradeRequired).toBe(3);
  });

  it("allows Tier 3 customer for transaction up to ₦500,000", () => {
    const result = checkKycTierForTransaction(3, 500_000);
    expect(result.allowed).toBe(true);
  });
});

// ── Commission Calculation ────────────────────────────────────────────────────
describe("calculateCommission", () => {
  it("calculates Bronze Cash In commission at base rate", () => {
    const result = calculateCommission("Cash In", 100_000, "Bronze");
    expect(result.baseRate).toBe(0.005);
    expect(result.tierMultiplier).toBe(1.0);
    expect(result.commissionAmount).toBe(500);
  });

  it("applies Gold tier multiplier (1.2x) to commission", () => {
    const result = calculateCommission("Cash In", 100_000, "Gold");
    expect(result.tierMultiplier).toBe(1.2);
    expect(result.commissionAmount).toBe(600);
  });

  it("applies Platinum tier multiplier (1.35x) to commission", () => {
    const result = calculateCommission("Airtime", 10_000, "Platinum");
    expect(result.baseRate).toBe(0.02);
    expect(result.tierMultiplier).toBe(1.35);
    expect(result.commissionAmount).toBeCloseTo(270, 0);
  });

  it("uses override rate when provided", () => {
    const result = calculateCommission("Cash In", 100_000, "Bronze", 0.01);
    expect(result.baseRate).toBe(0.01);
    expect(result.commissionAmount).toBe(1000);
  });

  it("returns zero commission for unknown transaction type", () => {
    const result = calculateCommission("Unknown Type", 100_000, "Silver");
    expect(result.commissionAmount).toBe(0);
  });

  it("includes a human-readable breakdown string", () => {
    const result = calculateCommission("Transfer", 50_000, "Silver");
    expect(result.breakdown).toContain("₦50,000");
    expect(result.breakdown).toContain("Silver");
  });
});

// ── Loyalty Point Accrual ─────────────────────────────────────────────────────
describe("calculateLoyaltyPoints", () => {
  it("calculates base points for Bronze Cash In", () => {
    const result = calculateLoyaltyPoints("Cash In", 10_000, "Bronze", 0);
    // 10 pts base (10000/1000 * 1.0) × 1.0 Bronze = 10 pts
    expect(result.basePoints).toBe(10);
    expect(result.tierMultiplier).toBe(1.0);
    expect(result.totalPoints).toBe(10);
  });

  it("applies Gold tier multiplier (1.5x) to loyalty points", () => {
    const result = calculateLoyaltyPoints("Cash In", 10_000, "Gold", 0);
    expect(result.tierMultiplier).toBe(1.5);
    expect(result.totalPoints).toBe(15);
  });

  it("applies Platinum tier multiplier (2.0x) to loyalty points", () => {
    const result = calculateLoyaltyPoints("Transfer", 10_000, "Platinum", 0);
    // 20 pts base (10000/1000 * 2.0) × 2.0 = 40 pts
    expect(result.totalPoints).toBe(40);
  });

  it("adds 7-day streak bonus of 25 points", () => {
    const result = calculateLoyaltyPoints("Cash In", 10_000, "Bronze", 7);
    expect(result.streakBonus).toBe(25);
    expect(result.streakLabel).toBe("7-day streak");
  });

  it("adds 30-day streak bonus of 100 points", () => {
    const result = calculateLoyaltyPoints("Cash In", 10_000, "Bronze", 30);
    expect(result.streakBonus).toBe(100);
    expect(result.streakLabel).toBe("30-day streak");
  });

  it("applies highest streak bonus when multiple thresholds met", () => {
    // 45 days should get the 30-day bonus (highest applicable)
    const result = calculateLoyaltyPoints("Cash In", 10_000, "Bronze", 45);
    expect(result.streakBonus).toBe(100);
  });

  it("includes breakdown string with tier and streak info", () => {
    const result = calculateLoyaltyPoints("Airtime", 5_000, "Silver", 7);
    expect(result.breakdown).toContain("Silver");
    expect(result.breakdown).toContain("7-day streak");
  });
});

// ── Float Alert Evaluation ────────────────────────────────────────────────────
describe("evaluateFloatAlert", () => {
  it("returns 'none' level when float is adequate", () => {
    const result = evaluateFloatAlert(500_000, 200_000, "Silver");
    expect(result.level).toBe("none");
  });

  it("returns 'warning' level when float is below 20% of daily volume", () => {
    const result = evaluateFloatAlert(30_000, 200_000, "Silver");
    // 20% of 200k = 40k → 30k is below warning threshold
    expect(result.level).toBe("warning");
    expect(result.recommendedTopUp).toBeGreaterThan(0);
  });

  it("returns 'critical' level when float is below 10% of daily volume", () => {
    const result = evaluateFloatAlert(15_000, 200_000, "Silver");
    // 10% of 200k = 20k → 15k is below critical threshold
    expect(result.level).toBe("critical");
  });

  it("returns 'blocked' level when float is below minimum floor (₦5,000)", () => {
    const result = evaluateFloatAlert(4_000, 200_000, "Silver");
    expect(result.level).toBe("blocked");
  });

  it("includes recommended top-up amount for warning and critical levels", () => {
    const result = evaluateFloatAlert(15_000, 200_000, "Gold");
    expect(result.recommendedTopUp).toBeGreaterThan(0);
  });
});

// ── Fraud Scoring ─────────────────────────────────────────────────────────────
describe("scoreFraud", () => {
  const baseParams = {
    amount: 10_000,
    tier: "Silver",
    hourlyCount: 5,
    dailyVolume: 100_000,
    isOutsideGeofence: false,
    failedPinAttempts: 0,
    isNewCustomer: false,
    isRoundAmount: false,
    timeSinceLastTx: 300,
    customerKycTier: 2,
  };

  it("returns low score for normal transaction", () => {
    const result = scoreFraud(baseParams);
    expect(result.level).toBe("low");
    expect(result.shouldBlock).toBe(false);
    expect(result.shouldAlert).toBe(false);
  });

  it("flags geofence violation with high weight", () => {
    const result = scoreFraud({ ...baseParams, isOutsideGeofence: true });
    expect(result.score).toBeGreaterThanOrEqual(0.3);
    const geoSignal = result.signals.find(s => s.type === "geofence_violation");
    expect(geoSignal).toBeDefined();
  });

  it("raises alert (but not block) for geofence + velocity breach alone", () => {
    // geofence(0.30) + velocity(0.20) = 0.50 → alert but not block
    const result = scoreFraud({
      ...baseParams,
      isOutsideGeofence: true,
      hourlyCount: 18, // >70% of Silver 20/hr limit
    });
    expect(result.shouldAlert).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.5);
  });

  it("blocks transaction with geofence + velocity + pin brute force", () => {
    // geofence(0.30) + velocity(0.20) + pin(0.24) = 0.74 → block
    const result = scoreFraud({
      ...baseParams,
      isOutsideGeofence: true,
      hourlyCount: 18,
      failedPinAttempts: 3,
    });
    expect(result.shouldBlock).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });

  it("flags rapid succession (< 30 seconds)", () => {
    const result = scoreFraud({ ...baseParams, timeSinceLastTx: 10 });
    const signal = result.signals.find(s => s.type === "rapid_succession");
    expect(signal).toBeDefined();
  });

  it("flags PIN brute force with 3+ failed attempts", () => {
    const result = scoreFraud({ ...baseParams, failedPinAttempts: 3 });
    const signal = result.signals.find(s => s.type === "pin_brute_force");
    expect(signal).toBeDefined();
  });

  it("flags round amount structuring for large round amounts", () => {
    const result = scoreFraud({
      ...baseParams,
      amount: 100_000,
      isRoundAmount: true,
    });
    const signal = result.signals.find(
      s => s.type === "round_amount_structuring"
    );
    expect(signal).toBeDefined();
  });

  it("returns score between 0 and 1", () => {
    const result = scoreFraud({
      ...baseParams,
      isOutsideGeofence: true,
      failedPinAttempts: 5,
      hourlyCount: 19,
      isRoundAmount: true,
      timeSinceLastTx: 5,
      amount: 180_000,
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

// ── Tier Upgrade Eligibility ──────────────────────────────────────────────────
describe("evaluateTierUpgrade", () => {
  it("returns eligible=true when all Silver criteria are met", () => {
    const result = evaluateTierUpgrade({
      currentTier: "Bronze",
      monthlyVolume: 600_000,
      monthlyTxCount: 60,
      loyaltyPoints: 6_000,
      kycLevel: 2,
      streakDays: 8,
    });
    expect(result.eligible).toBe(true);
    expect(result.targetTier).toBe("Silver");
  });

  it("returns eligible=false when monthly volume is insufficient", () => {
    const result = evaluateTierUpgrade({
      currentTier: "Bronze",
      monthlyVolume: 300_000, // below 500k requirement
      monthlyTxCount: 60,
      loyaltyPoints: 6_000,
      kycLevel: 2,
      streakDays: 8,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("Monthly volume");
  });

  it("returns eligible=false when KYC level is insufficient for Gold", () => {
    const result = evaluateTierUpgrade({
      currentTier: "Silver",
      monthlyVolume: 3_000_000,
      monthlyTxCount: 200,
      loyaltyPoints: 20_000,
      kycLevel: 1, // below KYC level 2 requirement
      streakDays: 15,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("KYC level");
  });

  it("returns eligible=false for Platinum agents (already max tier)", () => {
    const result = evaluateTierUpgrade({
      currentTier: "Platinum",
      monthlyVolume: 50_000_000,
      monthlyTxCount: 1000,
      loyaltyPoints: 100_000,
      kycLevel: 3,
      streakDays: 60,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("maximum tier");
  });
});

// ── Reward Redemption Validation ──────────────────────────────────────────────
describe("validateRedemption", () => {
  it("validates successful redemption when points are sufficient", () => {
    const result = validateRedemption("airtime_500", 1000);
    expect(result.valid).toBe(true);
    expect(result.reward?.name).toBe("₦500 Airtime");
  });

  it("rejects redemption when points are insufficient", () => {
    const result = validateRedemption("airtime_500", 400);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Insufficient points");
    expect(result.reward).toBeDefined();
  });

  it("rejects redemption for unknown reward ID", () => {
    const result = validateRedemption("nonexistent_reward", 99999);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not found");
  });

  it("validates tier_boost redemption with sufficient points", () => {
    const result = validateRedemption("tier_boost", 30_000);
    expect(result.valid).toBe(true);
    expect(result.reward?.pointsCost).toBe(25_000);
  });

  it("rejects pos_upgrade redemption with insufficient points", () => {
    const result = validateRedemption("pos_upgrade", 40_000);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("50,000 required");
  });
});

// ── CBN Limits Data Integrity ─────────────────────────────────────────────────
describe("CBN_LIMITS data integrity", () => {
  it("has all four tiers defined", () => {
    expect(CBN_LIMITS.Bronze).toBeDefined();
    expect(CBN_LIMITS.Silver).toBeDefined();
    expect(CBN_LIMITS.Gold).toBeDefined();
    expect(CBN_LIMITS.Platinum).toBeDefined();
  });

  it("has increasing limits across tiers", () => {
    expect(CBN_LIMITS.Silver.maxSingleTx).toBeGreaterThan(
      CBN_LIMITS.Bronze.maxSingleTx
    );
    expect(CBN_LIMITS.Gold.maxSingleTx).toBeGreaterThan(
      CBN_LIMITS.Silver.maxSingleTx
    );
    expect(CBN_LIMITS.Platinum.maxSingleTx).toBeGreaterThan(
      CBN_LIMITS.Gold.maxSingleTx
    );
  });

  it("requires BVN for Silver and above", () => {
    expect(CBN_LIMITS.Bronze.requiresBvn).toBe(false);
    expect(CBN_LIMITS.Silver.requiresBvn).toBe(true);
    expect(CBN_LIMITS.Gold.requiresBvn).toBe(true);
    expect(CBN_LIMITS.Platinum.requiresBvn).toBe(true);
  });

  it("requires NIN for Gold and above", () => {
    expect(CBN_LIMITS.Bronze.requiresNin).toBe(false);
    expect(CBN_LIMITS.Silver.requiresNin).toBe(false);
    expect(CBN_LIMITS.Gold.requiresNin).toBe(true);
    expect(CBN_LIMITS.Platinum.requiresNin).toBe(true);
  });
});

// ── KYC Tier Limits Data Integrity ───────────────────────────────────────────
describe("KYC_TIER_LIMITS data integrity", () => {
  it("has tiers 1, 2, and 3 defined", () => {
    expect(KYC_TIER_LIMITS[1]).toBeDefined();
    expect(KYC_TIER_LIMITS[2]).toBeDefined();
    expect(KYC_TIER_LIMITS[3]).toBeDefined();
  });

  it("has increasing limits across KYC tiers", () => {
    expect(KYC_TIER_LIMITS[2].maxSingleTx).toBeGreaterThan(
      KYC_TIER_LIMITS[1].maxSingleTx
    );
    expect(KYC_TIER_LIMITS[3].maxSingleTx).toBeGreaterThan(
      KYC_TIER_LIMITS[2].maxSingleTx
    );
  });
});

// ── Reward Catalog Data Integrity ─────────────────────────────────────────────
describe("REWARD_CATALOG data integrity", () => {
  it("has at least 10 rewards", () => {
    expect(REWARD_CATALOG.length).toBeGreaterThanOrEqual(10);
  });

  it("all rewards have required fields", () => {
    for (const reward of REWARD_CATALOG) {
      expect(reward.id).toBeTruthy();
      expect(reward.name).toBeTruthy();
      expect(reward.pointsCost).toBeGreaterThan(0);
      expect(reward.category).toBeTruthy();
      expect(reward.description).toBeTruthy();
    }
  });

  it("has unique reward IDs", () => {
    const ids = REWARD_CATALOG.map(r => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("has rewards across multiple categories", () => {
    const categories = new Set(REWARD_CATALOG.map(r => r.category));
    expect(categories.size).toBeGreaterThanOrEqual(4);
  });
});
