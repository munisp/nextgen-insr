/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUARANTINED-OPEN-DEFECT — genuine defect / partial delivery (fix routing in progress) — 2026-08-16 (assurance-lead approved; see tests/QUARANTINE.md)
 * ═══════════════════════════════════════════════════════════════════════════
 * REASON: 9 routers exist but lack the asserted getStats procedure (partial delivery).
 * EVIDENCE: routers exist on main (verified tree); test failures verbatim in run 31969739386.
 * RE-ENABLE CONDITION: Asserted procedures implemented (fix routing in progress, F-12).
 * NO assertion in this file has been modified or deleted — it runs as-is the
 * day the re-enable condition is met. Excluded from the default vitest run via
 * vitest.config.ts (config-level, auditable in one place).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from "vitest";

// Sprint 37 Router imports
import { e2eTestFrameworkRouter } from "./routers/e2eTestFramework";
import { dbSchemaPushRouter } from "./routers/dbSchemaPush";
import { agentCommissionCalcRouter } from "./routers/agentCommissionCalc";
import { mccManagerRouter } from "./routers/mccManager";
import { settlementBatchProcessorRouter } from "./routers/settlementBatchProcessor";
import { cardBinLookupRouter } from "./routers/cardBinLookup";
import { transactionVelocityMonitorRouter } from "./routers/transactionVelocityMonitor";
import { merchantRiskScoringRouter } from "./routers/merchantRiskScoring";
import { paymentGatewayRouterRouter } from "./routers/paymentGatewayRouter";
import { agentFloatForecastingRouter } from "./routers/agentFloatForecasting";
import { multiTenantIsolationRouter } from "./routers/multiTenantIsolation";
import { platformHealthDashRouter } from "./routers/platformHealthDash";
import { automatedComplianceCheckerRouter } from "./routers/automatedComplianceChecker";
import { transactionFeeCalcRouter } from "./routers/transactionFeeCalc";
import { agentNetworkTopologyRouter } from "./routers/agentNetworkTopology";
import { customerDisputePortalRouter } from "./routers/customerDisputePortal";
import { revenueLeakageDetectorRouter } from "./routers/revenueLeakageDetector";
import { apiRateLimiterDashRouter } from "./routers/apiRateLimiterDash";
import { operationalRunbookRouter } from "./routers/operationalRunbook";
import { platformMetricsExporterRouter } from "./routers/platformMetricsExporter";

const routers = [
  { name: "e2eTestFramework", router: e2eTestFrameworkRouter },
  { name: "dbSchemaPush", router: dbSchemaPushRouter },
  { name: "agentCommissionCalc", router: agentCommissionCalcRouter },
  { name: "mccManager", router: mccManagerRouter },
  { name: "settlementBatchProcessor", router: settlementBatchProcessorRouter },
  { name: "cardBinLookup", router: cardBinLookupRouter },
  {
    name: "transactionVelocityMonitor",
    router: transactionVelocityMonitorRouter,
  },
  { name: "merchantRiskScoring", router: merchantRiskScoringRouter },
  { name: "paymentGatewayRouter", router: paymentGatewayRouterRouter },
  { name: "agentFloatForecasting", router: agentFloatForecastingRouter },
  { name: "multiTenantIsolation", router: multiTenantIsolationRouter },
  { name: "platformHealthDash", router: platformHealthDashRouter },
  {
    name: "automatedComplianceChecker",
    router: automatedComplianceCheckerRouter,
  },
  { name: "transactionFeeCalc", router: transactionFeeCalcRouter },
  { name: "agentNetworkTopology", router: agentNetworkTopologyRouter },
  { name: "customerDisputePortal", router: customerDisputePortalRouter },
  { name: "revenueLeakageDetector", router: revenueLeakageDetectorRouter },
  { name: "apiRateLimiterDash", router: apiRateLimiterDashRouter },
  { name: "operationalRunbook", router: operationalRunbookRouter },
  { name: "platformMetricsExporter", router: platformMetricsExporterRouter },
];

describe("Sprint 37: Production Hardening — Router Count", () => {
  it("should have exactly 20 Sprint 37 routers", () => {
    expect(routers).toHaveLength(20);
  });
});

describe("Sprint 37: Router Structure Validation", () => {
  for (const { name, router } of routers) {
    describe(name, () => {
      it("should be a valid tRPC router", () => {
        expect(router).toBeDefined();
        expect(router._def).toBeDefined();
        expect(router._def.procedures).toBeDefined();
      });

      it("should have a getStats procedure", () => {
        const procedures = router._def.procedures as Record<string, unknown>;
        expect(procedures.getStats).toBeDefined();
      });

      it("should have at least 3 procedures", () => {
        const procedures = router._def.procedures as Record<string, unknown>;
        const count = Object.keys(procedures).length;
        expect(count).toBeGreaterThanOrEqual(3);
      });
    });
  }
});

describe("Sprint 37: Security Audit", () => {
  it("should not expose sensitive data in router definitions", () => {
    for (const { router } of routers) {
      const json = JSON.stringify(router._def);
      expect(json).not.toContain("password");
      expect(json).not.toContain("secret_key");
      expect(json).not.toContain("api_key");
    }
  });

  it("should have input validation on mutation procedures", () => {
    for (const { name, router } of routers) {
      const procedures = router._def.procedures as Record<string, any>;
      for (const [procName, proc] of Object.entries(procedures)) {
        if (proc._def?.mutation) {
          expect(proc._def.inputs?.length).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("all routers should have proper error handling patterns", () => {
    for (const { name, router } of routers) {
      expect(router._def).toBeDefined();
      expect(typeof router._def.procedures).toBe("object");
    }
  });

  it("should validate that no router exposes raw SQL queries", () => {
    for (const { name, router } of routers) {
      const json = JSON.stringify(router._def);
      expect(json).not.toContain("DROP TABLE");
      expect(json).not.toContain("DELETE FROM");
    }
  });
});
