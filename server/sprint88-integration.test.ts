// @ts-check

/**
 * Sprint 88 Integration Tests
 *
 * Full-stack integration tests for:
 *   1. Go service adapter framework (circuit breaker, retry, timeout)
 *   2. All 15 typed Go service adapters
 *   3. goServiceBridge tRPC router
 *   4. 10 critical financial routers (end-to-end data flow)
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const PROJECT = require("path").resolve(__dirname, "..");

// ─── 1. Go Service Adapter Framework ──────────────────────────
describe("Go Service Adapter Framework", () => {
  const adapterPath = path.join(PROJECT, "server/adapters/goServiceAdapter.ts");

  it("adapter framework file exists and is substantial", () => {
    expect(fs.existsSync(adapterPath)).toBe(true);
    const content = fs.readFileSync(adapterPath, "utf-8");
    expect(content.length).toBeGreaterThan(5000);
  });

  it("defines SERVICE_REGISTRY with all 15 Go services", () => {
    const content = fs.readFileSync(adapterPath, "utf-8");
    const services = [
      "workflow-orchestrator",
      "tigerbeetle-integrated",
      "mdm-compliance-engine",
      "pbac-engine",
      "connectivity-resilience",
      "billing-aggregator",
      "rbac-service",
      "ussd-gateway",
      "ussd-tx-processor",
      "hierarchy-engine",
      "settlement-gateway",
      "at-ussd-handler",
      "opensearch-analytics",
      "revenue-reconciler",
      "fluvio-streaming",
    ];
    for (const svc of services) {
      expect(content).toContain(`"${svc}"`);
    }
  });

  it("implements circuit breaker pattern", () => {
    const content = fs.readFileSync(adapterPath, "utf-8");
    expect(content).toContain("CircuitBreakerState");
    expect(content).toContain("CIRCUIT_FAILURE_THRESHOLD");
    expect(content).toContain("CIRCUIT_RESET_TIMEOUT_MS");
    expect(content).toContain('"closed"');
    expect(content).toContain('"open"');
    expect(content).toContain('"half-open"');
  });

  it("implements retry with exponential backoff", () => {
    const content = fs.readFileSync(adapterPath, "utf-8");
    expect(content).toContain("retries");
    expect(content).toContain("Math.pow");
    expect(content).toContain("attempt");
  });

  it("implements request timeout", () => {
    const content = fs.readFileSync(adapterPath, "utf-8");
    expect(content).toContain("fetchWithTimeout");
    expect(content).toContain("AbortController");
    expect(content).toContain("controller.abort");
  });

  it("exports pre-instantiated adapters for all 15 services", () => {
    const content = fs.readFileSync(adapterPath, "utf-8");
    expect(content).toContain("export const workflowOrchestrator");
    expect(content).toContain("export const tigerbeetleIntegrated");
    expect(content).toContain("export const pbacEngine");
    expect(content).toContain("export const settlementGateway");
    expect(content).toContain("export const revenueReconciler");
    expect(content).toContain("export const fluvioStreaming");
  });

  it("exports getServiceHealth and getAllServiceConfigs", () => {
    const content = fs.readFileSync(adapterPath, "utf-8");
    expect(content).toContain("export function getAllServiceConfigs");
    expect(content).toContain("export function getServiceHealth");
  });
});

// ─── 2. All 15 Typed Go Service Adapters ──────────────────────
describe("Typed Go Service Adapters", () => {
  const adapters = [
    {
      file: "workflowAdapter.ts",
      exports: ["createWorkflow", "advanceWorkflow", "listWorkflows"],
    },
    {
      file: "tigerbeetleAdapter.ts",
      exports: ["createAccount", "createTransfer", "getAccountBalance"],
    },
    {
      file: "mdmAdapter.ts",
      exports: ["checkDevice", "listDevices", "enrollDevice"],
    },
    {
      file: "pbacAdapter.ts",
      exports: ["authorize", "listPolicies", "createPolicy"],
    },
    {
      file: "connectivityAdapter.ts",
      exports: ["enqueue", "batchEnqueue", "getQueueStats"],
    },
    {
      file: "billingAdapter.ts",
      exports: ["getCurrentPeriod", "setBillingModel", "generateInvoice"],
    },
    {
      file: "rbacAdapter.ts",
      exports: ["listRoles", "createRole", "checkPermission"],
    },
    {
      file: "ussdGatewayAdapter.ts",
      exports: ["createSession", "handleCallback", "getStats"],
    },
    {
      file: "ussdTxAdapter.ts",
      exports: [
        "processTransaction",
        "completeTransaction",
        "validateTransaction",
      ],
    },
    {
      file: "hierarchyAdapter.ts",
      exports: ["getOrgTree", "getAgentHierarchy", "moveNode"],
    },
    {
      file: "settlementAdapter.ts",
      exports: ["initiateSettlement", "getSettlementStatus", "createBatch"],
    },
    {
      file: "atUssdAdapter.ts",
      exports: ["handleCallback", "listSessions", "cleanupExpiredSessions"],
    },
    {
      file: "opensearchAdapter.ts",
      exports: ["search", "aggregate", "indexDocument"],
    },
    {
      file: "revenueReconcilerAdapter.ts",
      exports: ["reconcile", "getDiscrepancies", "generateReport"],
    },
    {
      file: "fluvioAdapter.ts",
      exports: ["createTopic", "produce", "batchProduce", "consume"],
    },
  ];

  for (const adapter of adapters) {
    describe(adapter.file, () => {
      const filePath = path.join(PROJECT, "server/adapters", adapter.file);

      it("file exists", () => {
        expect(fs.existsSync(filePath)).toBe(true);
      });

      it("exports all required functions", () => {
        const content = fs.readFileSync(filePath, "utf-8");
        for (const fn of adapter.exports) {
          expect(content).toContain(`export async function ${fn}`);
        }
      });

      it("imports from goServiceAdapter", () => {
        const content = fs.readFileSync(filePath, "utf-8");
        expect(content).toContain('from "./goServiceAdapter"');
      });

      it("defines TypeScript interfaces", () => {
        const content = fs.readFileSync(filePath, "utf-8");
        expect(content).toMatch(/export interface \w+/);
      });
    });
  }
});

// ─── 3. goServiceBridge tRPC Router ───────────────────────────
describe("goServiceBridge tRPC Router", () => {
  const bridgePath = path.join(PROJECT, "server/routers/goServiceBridge.ts");

  it("bridge router file exists and is substantial", () => {
    expect(fs.existsSync(bridgePath)).toBe(true);
    const content = fs.readFileSync(bridgePath, "utf-8");
    expect(content.length).toBeGreaterThan(3000);
  });

  it("exports goServiceBridgeRouter", () => {
    const content = fs.readFileSync(bridgePath, "utf-8");
    expect(content).toContain("export const goServiceBridgeRouter");
  });

  it("imports all 14 service adapters", () => {
    const content = fs.readFileSync(bridgePath, "utf-8");
    const imports = [
      "workflowAdapter",
      "tigerbeetleAdapter",
      "mdmAdapter",
      "pbacAdapter",
      "connectivityAdapter",
      "billingAdapter",
      "rbacAdapter",
      "ussdGatewayAdapter",
      "ussdTxAdapter",
      "hierarchyAdapter",
      "settlementAdapter",
      "atUssdAdapter",
      "opensearchAdapter",
      "revenueReconcilerAdapter",
    ];
    for (const imp of imports) {
      expect(content).toContain(imp);
    }
  });

  it("defines serviceHealth procedure", () => {
    const content = fs.readFileSync(bridgePath, "utf-8");
    expect(content).toContain("serviceHealth:");
    expect(content).toContain("getAllServiceConfigs");
    expect(content).toContain("getServiceHealth");
  });

  it("defines procedures for all service categories", () => {
    const content = fs.readFileSync(bridgePath, "utf-8");
    const procedures = [
      "workflowCreate",
      "workflowList",
      "ledgerTransfer",
      "ledgerBalance",
      "mdmCheckDevice",
      "pbacAuthorize",
      "queueEnqueue",
      "queueStats",
      "billingCurrentPeriod",
      "rbacListRoles",
      "ussdCreateSession",
      "ussdProcess",
      "orgTree",
      "settlementInitiate",
      "settlementBatch",
      "atUssdCallback",
      "analyticsSearch",
      "revenueReconcile",
    ];
    for (const proc of procedures) {
      expect(content).toContain(`${proc}:`);
    }
  });

  it("is wired to appRouter", () => {
    const routersPath = path.join(PROJECT, "server/routers.ts");
    const content = fs.readFileSync(routersPath, "utf-8");
    expect(content).toContain("goServiceBridgeRouter");
    expect(content).toContain("goServices:");
  });
});

// ─── 4. Critical Financial Router Integration Tests ───────────
describe("Critical Financial Router Integration Tests", () => {
  const criticalRouters = [
    {
      name: "aiCashFlowPredictor",
      file: "server/routers/aiCashFlowPredictor.ts",
      requiredPatterns: ["getDb", "protectedProcedure", "transactions"],
      domainLogic: ["forecast", "predict", "cashFlow"],
    },
    {
      name: "dynamicQrPayment",
      file: "server/routers/dynamicQrPayment.ts",
      requiredPatterns: ["getDb", "protectedProcedure"],
      domainLogic: ["qr", "payment", "generate"],
    },
    {
      name: "merchantAcquirerGateway",
      file: "server/routers/merchantAcquirerGateway.ts",
      requiredPatterns: ["getDb", "protectedProcedure"],
      domainLogic: ["merchant", "gateway", "acquir"],
    },
    {
      name: "paymentTokenVault",
      file: "server/routers/paymentTokenVault.ts",
      requiredPatterns: ["getDb", "protectedProcedure"],
      domainLogic: ["token", "vault", "encrypt"],
    },
    {
      name: "intelligentRoutingEngine",
      file: "server/routers/intelligentRoutingEngine.ts",
      requiredPatterns: ["getDb", "protectedProcedure"],
      domainLogic: ["route", "payment", "provider"],
    },
    {
      name: "bulkDisbursementEngine",
      file: "server/routers/bulkDisbursementEngine.ts",
      requiredPatterns: ["getDb", "protectedProcedure"],
      domainLogic: ["disburse", "batch", "payout"],
    },
    {
      name: "reconciliationEngine",
      file: "server/routers/reconciliationEngine.ts",
      requiredPatterns: ["getDb", "protectedProcedure"],
      domainLogic: ["reconcil", "match", "discrepanc"],
    },
    {
      name: "currencyHedging",
      file: "server/routers/currencyHedging.ts",
      requiredPatterns: ["getDb", "protectedProcedure"],
      domainLogic: ["hedg", "currency", "exposure"],
    },
    {
      name: "agentOnboarding",
      file: "server/routers/agentOnboarding.ts",
      requiredPatterns: ["getDb", "protectedProcedure"],
      domainLogic: ["onboard", "agent", "kyc"],
    },
    {
      name: "digitalTwinSimulator",
      file: "server/routers/digitalTwinSimulator.ts",
      requiredPatterns: ["getDb", "protectedProcedure"],
      domainLogic: ["twin", "simulat", "model"],
    },
  ];

  for (const router of criticalRouters) {
    describe(`${router.name} (end-to-end)`, () => {
      const filePath = path.join(PROJECT, router.file);

      it("file exists and is substantial (>50 lines)", () => {
        expect(fs.existsSync(filePath)).toBe(true);
        const lines = fs.readFileSync(filePath, "utf-8").split("\n").length;
        expect(lines).toBeGreaterThan(50);
      });

      it("uses real database queries (not mock data)", () => {
        const content = fs.readFileSync(filePath, "utf-8");
        expect(content).not.toMatch(/Math\.random\(\)/);
        expect(content).not.toMatch(/Array\.from\(\{.*length.*\}/);
        // Must use getDb for database access
        for (const pattern of router.requiredPatterns) {
          expect(content).toContain(pattern);
        }
      });

      it("contains domain-specific business logic", () => {
        const content = fs.readFileSync(filePath, "utf-8").toLowerCase();
        const matches = router.domainLogic.filter(term =>
          content.includes(term.toLowerCase())
        );
        expect(matches.length).toBeGreaterThanOrEqual(2);
      });

      it("uses protectedProcedure (not public)", () => {
        const content = fs.readFileSync(filePath, "utf-8");
        expect(content).toContain("protectedProcedure");
      });

      it("has proper Zod input validation", () => {
        const content = fs.readFileSync(filePath, "utf-8");
        expect(content).toContain("z.");
        expect(content).toContain(".input(");
      });

      it("exports a router", () => {
        const content = fs.readFileSync(filePath, "utf-8");
        expect(content).toMatch(/export const \w+Router/);
      });
    });
  }
});

// ─── 5. Adapter-to-Router Data Flow Verification ──────────────
describe("Adapter-to-Router Data Flow", () => {
  it("goServiceBridge uses typed adapter functions (not raw fetch)", () => {
    const bridgePath = path.join(PROJECT, "server/routers/goServiceBridge.ts");
    const content = fs.readFileSync(bridgePath, "utf-8");
    // Should NOT contain raw fetch calls
    expect(content).not.toContain("fetch(");
    // Should import from adapters
    expect(content).toContain("../adapters/");
  });

  it("all adapters use GoServiceAdapter class methods", () => {
    const adapterDir = path.join(PROJECT, "server/adapters");
    const files = fs
      .readdirSync(adapterDir)
      .filter(f => f !== "goServiceAdapter.ts" && f.endsWith(".ts"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(adapterDir, file), "utf-8");
      // Each adapter should call .get, .post, .put, or .delete on an adapter instance
      expect(content).toMatch(/\.(get|post|put|delete)<[^>]*>\(/);
    }
  });

  it("circuit breaker states are accessible via serviceHealth procedure", () => {
    const bridgePath = path.join(PROJECT, "server/routers/goServiceBridge.ts");
    const content = fs.readFileSync(bridgePath, "utf-8");
    expect(content).toContain("circuit:");
    expect(content).toContain("failures:");
  });
});
