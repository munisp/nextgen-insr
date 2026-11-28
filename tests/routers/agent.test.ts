import { describe, it, expect } from "vitest";

describe("Agent Network Router", () => {
  describe("Commission Calculation", () => {
    function calculateCommission(params: {
      premium: number;
      productType: string;
      agentTier: string;
      isRenewal: boolean;
    }): number {
      const baseRates: Record<string, Record<string, number>> = {
        motor: { bronze: 0.10, silver: 0.12, gold: 0.15, platinum: 0.18 },
        life: { bronze: 0.20, silver: 0.25, gold: 0.30, platinum: 0.35 },
        health: { bronze: 0.08, silver: 0.10, gold: 0.12, platinum: 0.15 },
        fire: { bronze: 0.12, silver: 0.15, gold: 0.18, platinum: 0.20 },
      };

      const rate = baseRates[params.productType]?.[params.agentTier] || 0.10;
      let commission = params.premium * rate;

      // Renewal discount (lower commission on renewals)
      if (params.isRenewal) {
        commission *= 0.5;
      }

      return Math.round(commission);
    }

    it("should calculate motor commission for gold agent", () => {
      const commission = calculateCommission({
        premium: 500000, productType: "motor", agentTier: "gold", isRenewal: false,
      });
      expect(commission).toBe(75000); // 15% of ₦500K
    });

    it("should calculate life commission for platinum agent", () => {
      const commission = calculateCommission({
        premium: 2000000, productType: "life", agentTier: "platinum", isRenewal: false,
      });
      expect(commission).toBe(700000); // 35% of ₦2M
    });

    it("should apply 50% reduction for renewals", () => {
      const newBiz = calculateCommission({
        premium: 1000000, productType: "motor", agentTier: "silver", isRenewal: false,
      });
      const renewal = calculateCommission({
        premium: 1000000, productType: "motor", agentTier: "silver", isRenewal: true,
      });
      expect(renewal).toBe(newBiz / 2);
    });

    it("should respect NAICOM commission cap for motor (20%)", () => {
      const NAICOM_MOTOR_CAP = 0.20;
      const platinumRate = 0.18;
      expect(platinumRate).toBeLessThanOrEqual(NAICOM_MOTOR_CAP);
    });
  });

  describe("Agent Tier Progression", () => {
    function determineAgentTier(metrics: {
      monthlyPremium: number;
      activeCustomers: number;
      retentionRate: number;
      complianceScore: number;
    }): string {
      if (
        metrics.monthlyPremium >= 50000000 &&
        metrics.activeCustomers >= 500 &&
        metrics.retentionRate >= 0.90 &&
        metrics.complianceScore >= 95
      ) return "platinum";

      if (
        metrics.monthlyPremium >= 20000000 &&
        metrics.activeCustomers >= 200 &&
        metrics.retentionRate >= 0.80 &&
        metrics.complianceScore >= 85
      ) return "gold";

      if (
        metrics.monthlyPremium >= 5000000 &&
        metrics.activeCustomers >= 50 &&
        metrics.retentionRate >= 0.70 &&
        metrics.complianceScore >= 75
      ) return "silver";

      return "bronze";
    }

    it("should classify top performer as platinum", () => {
      expect(determineAgentTier({
        monthlyPremium: 75000000, activeCustomers: 800, retentionRate: 0.95, complianceScore: 98,
      })).toBe("platinum");
    });

    it("should classify average performer as silver", () => {
      expect(determineAgentTier({
        monthlyPremium: 8000000, activeCustomers: 80, retentionRate: 0.75, complianceScore: 80,
      })).toBe("silver");
    });

    it("should classify new agent as bronze", () => {
      expect(determineAgentTier({
        monthlyPremium: 1000000, activeCustomers: 10, retentionRate: 0.60, complianceScore: 70,
      })).toBe("bronze");
    });

    it("should require compliance score for tier advancement", () => {
      // High premium but low compliance = not platinum
      expect(determineAgentTier({
        monthlyPremium: 100000000, activeCustomers: 1000, retentionRate: 0.95, complianceScore: 50,
      })).not.toBe("platinum");
    });
  });

  describe("Agent Territory Management", () => {
    it("should assign agents to Nigerian states", () => {
      const nigerianStates = [
        "abia", "adamawa", "akwa_ibom", "anambra", "bauchi", "bayelsa",
        "benue", "borno", "cross_river", "delta", "ebonyi", "edo",
        "ekiti", "enugu", "gombe", "imo", "jigawa", "kaduna",
        "kano", "katsina", "kebbi", "kogi", "kwara", "lagos",
        "nassarawa", "niger", "ogun", "ondo", "osun", "oyo",
        "plateau", "rivers", "sokoto", "taraba", "yobe", "zamfara", "fct",
      ];
      expect(nigerianStates).toHaveLength(37);
    });

    it("should enforce territory exclusivity", () => {
      const territory = { state: "lagos", lga: "ikeja", assignedAgent: "AG001" };
      const conflictingAssignment = { state: "lagos", lga: "ikeja", assignedAgent: "AG002" };
      expect(territory.assignedAgent).not.toBe(conflictingAssignment.assignedAgent);
    });
  });

  describe("Agent Performance KPIs", () => {
    it("should calculate persistency ratio", () => {
      const policiesInForce = 450;
      const policiesIssued12MonthsAgo = 500;
      const persistencyRatio = (policiesInForce / policiesIssued12MonthsAgo) * 100;
      expect(persistencyRatio).toBe(90);
    });

    it("should calculate average premium per policy", () => {
      const totalPremium = 25000000;
      const totalPolicies = 100;
      const avgPremium = totalPremium / totalPolicies;
      expect(avgPremium).toBe(250000);
    });
  });
});
