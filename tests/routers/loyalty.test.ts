import { describe, it, expect } from "vitest";

// ─── Tier logic (mirrors server/routers/loyalty.ts) ──────────────────────────
const TIER_THRESHOLDS = { Bronze: 0, Silver: 5000, Gold: 15000, Platinum: 50000 } as const;
type Tier = keyof typeof TIER_THRESHOLDS;

function getTier(points: number): Tier {
  if (points >= 50000) return "Platinum";
  if (points >= 15000) return "Gold";
  if (points >= 5000) return "Silver";
  return "Bronze";
}

function calculatePointsForPremium(premium: number, tier: Tier): number {
  const multipliers: Record<Tier, number> = {
    Bronze: 1,
    Silver: 1.5,
    Gold: 2,
    Platinum: 3,
  };
  return Math.floor((premium / 100) * multipliers[tier]);
}

function canRedeemReward(agentPoints: number, rewardCost: number, tier: Tier): boolean {
  if (agentPoints < rewardCost) return false;
  const minTierForHighRewards: Record<string, Tier> = {
    "commission_boost": "Silver",
    "float_waiver": "Silver",
    "portal_upgrade": "Gold",
  };
  return true;
}

describe("Loyalty & Rewards System", () => {
  describe("Tier Classification", () => {
    it("should classify zero points as Bronze", () => {
      expect(getTier(0)).toBe("Bronze");
    });

    it("should classify 4999 points as Bronze", () => {
      expect(getTier(4999)).toBe("Bronze");
    });

    it("should classify 5000 points as Silver", () => {
      expect(getTier(5000)).toBe("Silver");
    });

    it("should classify 14999 points as Silver", () => {
      expect(getTier(14999)).toBe("Silver");
    });

    it("should classify 15000 points as Gold", () => {
      expect(getTier(15000)).toBe("Gold");
    });

    it("should classify 49999 points as Gold", () => {
      expect(getTier(49999)).toBe("Gold");
    });

    it("should classify 50000 points as Platinum", () => {
      expect(getTier(50000)).toBe("Platinum");
    });

    it("should classify 100000 points as Platinum", () => {
      expect(getTier(100000)).toBe("Platinum");
    });
  });

  describe("Points Calculation", () => {
    it("should award 1 point per ₦100 premium for Bronze agents", () => {
      expect(calculatePointsForPremium(10000, "Bronze")).toBe(100);
    });

    it("should award 1.5x points for Silver agents", () => {
      expect(calculatePointsForPremium(10000, "Silver")).toBe(150);
    });

    it("should award 2x points for Gold agents", () => {
      expect(calculatePointsForPremium(10000, "Gold")).toBe(200);
    });

    it("should award 3x points for Platinum agents", () => {
      expect(calculatePointsForPremium(10000, "Platinum")).toBe(300);
    });

    it("should floor fractional points", () => {
      expect(calculatePointsForPremium(150, "Bronze")).toBe(1);
    });

    it("should return 0 for sub-₦100 premium at Bronze", () => {
      expect(calculatePointsForPremium(50, "Bronze")).toBe(0);
    });
  });

  describe("Reward Redemption", () => {
    it("should allow redemption when agent has enough points", () => {
      expect(canRedeemReward(5000, 500, "Silver")).toBe(true);
    });

    it("should block redemption when insufficient points", () => {
      expect(canRedeemReward(400, 500, "Bronze")).toBe(false);
    });

    it("should allow exact point match", () => {
      expect(canRedeemReward(500, 500, "Bronze")).toBe(true);
    });
  });
});
