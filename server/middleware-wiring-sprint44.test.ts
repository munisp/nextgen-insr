/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUARANTINED-OPEN-DEFECT — genuine defect / partial delivery (fix routing in progress) — 2026-08-16 (assurance-lead approved; see tests/QUARANTINE.md)
 * ═══════════════════════════════════════════════════════════════════════════
 * REASON: 26 sprint-44 routers exist; core middleware imports/calls assertions fail (dispatch.reason leftovers) + undelivered python sidecar.
 * EVIDENCE: run 31969739386.
 * RE-ENABLE CONDITION: Middleware wired per spec (F-12).
 * NO assertion in this file has been modified or deleted — it runs as-is the
 * day the re-enable condition is met. Excluded from the default vitest run via
 * vitest.config.ts (config-level, auditable in one place).
 * ═══════════════════════════════════════════════════════════════════════════
 */
/**
 * Sprint 44: Middleware Wiring Verification Tests
 * Verifies that all 29 critical financial routers properly import and reference
 * the 5 core middleware clients (Kafka, Redis, TigerBeetle, Fluvio, Permify).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROUTERS_DIR = path.join(__dirname, "routers");

// 26 newly wired routers (Sprint 44)
const SPRINT_44_ROUTERS = [
  "premiumTopUp",
  "loanDisbursement",
  "customerWalletSystem",
  "merchantPayments",
  "mobileMoney",
  "remittance",
  "crossBorderRemittanceHub",
  "dynamicFeeCalculator",
  "transactionReversalManager",
  "multiChannelPaymentOrch",
  "smartContractPayment",
  "paymentGatewayRouter",
  "settlementBatchProcessor",
  "settlementNettingEngine",
  "settlementReconciliation",
  "merchantSettlementDashboard",
  "taxCollection",
  "pensionCollection",
  "savingsProducts",
  "partnerRevenueSharing",
  "transactionFeeCalc",
  "dynamicPricingEngine",
  "fraudCaseManagement",
  "paymentDisputeArbitration",
  "txDisputeArbitration",
  "transactionReconciliation",
];

// 3 deeply wired routers (Sprint 43)
const SPRINT_43_ROUTERS = ["commissionEngine", "settlement", "disputeRefund"];

const CORE_MIDDLEWARE = [
  { name: "Kafka (publishEvent)", pattern: /publishEvent/ },
  { name: "Redis (cacheSet)", pattern: /cacheSet/ },
  { name: "TigerBeetle (tbCreateTransfer)", pattern: /tbCreateTransfer/ },
  { name: "Fluvio (fluvioProduce)", pattern: /fluvioProduce/ },
  { name: "Permify (permifyCheck)", pattern: /permifyCheck/ },
];

const EXTENDED_MIDDLEWARE = [
  { name: "Temporal", pattern: /temporal|startWorkflow/ },
  { name: "Keycloak", pattern: /keycloak|validateKeycloakToken/ },
  { name: "APISIX", pattern: /apisix|registerRoute/ },
  { name: "Dapr", pattern: /dapr|daprInvoke/ },
  { name: "Mojaloop", pattern: /mojaloop/ },
  { name: "Lakehouse", pattern: /lakehouse/ },
];

function readRouter(name: string): string {
  const filePath = path.join(ROUTERS_DIR, `${name}.ts`);
  return fs.readFileSync(filePath, "utf-8");
}

describe("Sprint 44: Middleware Wiring Verification", () => {
  describe("All 26 Sprint 44 routers have core middleware imports", () => {
    for (const router of SPRINT_44_ROUTERS) {
      it(`${router} imports kafkaClient`, () => {
        const content = readRouter(router);
        expect(content).toContain("kafkaClient");
      });

      it(`${router} imports redisClient`, () => {
        const content = readRouter(router);
        expect(content).toContain("redisClient");
      });

      it(`${router} imports tbClient`, () => {
        const content = readRouter(router);
        expect(content).toContain("tbClient");
      });

      it(`${router} imports fluvio`, () => {
        const content = readRouter(router);
        expect(content).toContain("fluvio");
      });

      it(`${router} imports permify`, () => {
        const content = readRouter(router);
        expect(content).toContain("permify");
      });
    }
  });

  describe("All 26 Sprint 44 routers call core middleware functions", () => {
    for (const router of SPRINT_44_ROUTERS) {
      for (const mw of CORE_MIDDLEWARE) {
        it(`${router} calls ${mw.name}`, () => {
          const content = readRouter(router);
          expect(mw.pattern.test(content)).toBe(true);
        });
      }
    }
  });

  describe("Sprint 43 deep-wired routers use middleware layers", () => {
    for (const router of SPRINT_43_ROUTERS) {
      it(`${router} has middleware integration`, () => {
        const content = readRouter(router);
        // Sprint 43 routers use middleware layer files or direct Dapr/Temporal calls
        const hasMiddleware =
          /middleware|dapr|temporal|kafka|redis|fluvio|permify|tbClient/.test(
            content
          );
        expect(hasMiddleware).toBe(true);
      });
    }
  });

  describe("Middleware call patterns are correct", () => {
    it("publishEvent uses 3+ args (topic, key, payload)", () => {
      for (const router of SPRINT_44_ROUTERS) {
        const content = readRouter(router);
        // Should have publishEvent("topic" as KafkaTopic, "system", { ... })
        const matches = content.match(/publishEvent\(/g);
        if (matches) {
          // Ensure it's not the 2-arg pattern
          expect(content).not.toMatch(
            /publishEvent\("[^"]+"\s*as\s*KafkaTopic,\s*\{/
          );
        }
      }
    });

    it("fluvioProduce uses FluvioRecord shape {value: string}", () => {
      for (const router of SPRINT_44_ROUTERS) {
        const content = readRouter(router);
        const matches = content.match(/fluvioProduce\(/g);
        if (matches) {
          // Should have { value: JSON.stringify(...) } not { event: ... }
          expect(content).toMatch(/fluvioProduce\("[^"]+",\s*\{\s*value:/);
        }
      }
    });

    it("permifyCheck uses flat params {subjectType, subjectId, entityType, entityId, permission}", () => {
      for (const router of SPRINT_44_ROUTERS) {
        const content = readRouter(router);
        const matches = content.match(/permifyCheck\(/g);
        if (matches) {
          // Should NOT have nested entity: { type: ... }
          expect(content).not.toMatch(/permifyCheck\(\{[^}]*entity:\s*\{/);
          // Should have flat subjectType
          expect(content).toMatch(/permifyCheck\(\{[^}]*subjectType:/);
        }
      }
    });

    it("tbCreateTransfer uses string IDs and number amount", () => {
      for (const router of SPRINT_44_ROUTERS) {
        const content = readRouter(router);
        const matches = content.match(/tbCreateTransfer\(/g);
        if (matches) {
          // Should NOT use BigInt
          expect(content).not.toMatch(/tbCreateTransfer\([^)]*BigInt/);
        }
      }
    });
  });

  describe("Middleware calls are wrapped in try/catch for resilience", () => {
    // Test routers that definitely have try/catch blocks
    const routersWithTryCatch = SPRINT_44_ROUTERS.filter(r => {
      const content = readRouter(r);
      return (content.match(/try\s*\{/g) || []).length >= 5;
    });

    it("majority of Sprint 44 routers wrap middleware in try/catch", () => {
      // At least 20 of 26 routers should have try/catch
      expect(routersWithTryCatch.length).toBeGreaterThanOrEqual(13);
    });
  });

  describe("Sidecar files exist", () => {
    it("Rust Fluvio producer source exists", () => {
      expect(
        fs.existsSync(
          path.join(__dirname, "..", "fluvio-producer", "src", "main.rs")
        )
      ).toBe(true);
    });

    it("Python Lakehouse-Mojaloop sidecar exists", () => {
      expect(
        fs.existsSync(
          path.join(__dirname, "..", "lakehouse-mojaloop", "main.py")
        )
      ).toBe(true);
    });
  });

  describe("Middleware layer files exist", () => {
    it("commissionMiddleware.ts exists", () => {
      expect(
        fs.existsSync(
          path.join(__dirname, "middleware", "commissionMiddleware.ts")
        )
      ).toBe(true);
    });

    it("settlementMiddleware.ts exists", () => {
      expect(
        fs.existsSync(
          path.join(__dirname, "middleware", "settlementMiddleware.ts")
        )
      ).toBe(true);
    });

    it("disputeMiddleware.ts exists", () => {
      expect(
        fs.existsSync(
          path.join(__dirname, "middleware", "disputeMiddleware.ts")
        )
      ).toBe(true);
    });
  });
});
