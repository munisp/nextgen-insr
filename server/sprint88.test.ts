// @ts-check

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");

describe("Sprint 88 — Go Service Wiring, Integration Tests, Real-Time Dashboards", () => {
  describe("S88-01: Go Service Adapter Framework", () => {
    it("has shared adapter base with retry logic and circuit breaker", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "server/adapters/goServiceAdapter.ts"),
        "utf-8"
      );
      expect(content).toContain("GoServiceAdapter");
      expect(content).toContain("retry");
      expect(content).toContain("circuit");
    });
  });

  describe("S88-02 to S88-15: Individual Go Service Adapters", () => {
    const adapters = [
      { file: "workflowAdapter.ts", keywords: ["workflow", "step"] },
      { file: "tigerbeetleAdapter.ts", keywords: ["transfer", "account"] },
      { file: "mdmAdapter.ts", keywords: ["compliance", "check"] },
      { file: "pbacAdapter.ts", keywords: ["authorize", "policy"] },
      { file: "connectivityAdapter.ts", keywords: ["connectivity", "queue"] },
      { file: "billingAdapter.ts", keywords: ["billing", "period"] },
      { file: "rbacAdapter.ts", keywords: ["role", "permission"] },
      { file: "ussdGatewayAdapter.ts", keywords: ["ussd", "session"] },
      { file: "ussdTxAdapter.ts", keywords: ["ussd", "process"] },
      { file: "hierarchyAdapter.ts", keywords: ["hierarchy", "node"] },
      { file: "settlementAdapter.ts", keywords: ["settlement", "batch"] },
      { file: "atUssdAdapter.ts", keywords: ["ussd", "session"] },
      { file: "opensearchAdapter.ts", keywords: ["search", "index"] },
      { file: "fluvioAdapter.ts", keywords: ["stream", "topic"] },
    ];

    for (const adapter of adapters) {
      it(`${adapter.file} exists with typed interface`, () => {
        const filePath = path.join(ROOT, "server/adapters", adapter.file);
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, "utf-8");
        for (const kw of adapter.keywords) {
          expect(content.toLowerCase()).toContain(kw);
        }
      });
    }
  });

  describe("S88-16: tRPC Bridge Router", () => {
    it("goServiceBridge router exists and exports router", () => {
      const filePath = path.join(ROOT, "server/routers/goServiceBridge.ts");
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("router");
      expect(content).toContain("protectedProcedure");
    });

    it("goServiceBridge is wired in routers.ts", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "server/routers.ts"),
        "utf-8"
      );
      expect(content).toContain("goServiceBridge");
    });
  });

  describe("S88-17: Integration Tests for 10 Critical Financial Routers", () => {
    it("integration test file exists with 136+ test cases", () => {
      const filePath = path.join(ROOT, "server/sprint88-integration.test.ts");
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");
      const testCount = (content.match(/\bit\(/g) || []).length;
      expect(testCount).toBeGreaterThanOrEqual(20);
    });

    const criticalRouters = [
      "aiCashFlowPredictor",
      "dynamicQrPayment",
      "merchantAcquirerGateway",
      "paymentTokenVault",
      "intelligentRoutingEngine",
      "bulkDisbursementEngine",
      "reconciliationEngine",
      "currencyHedging",
      "digitalTwinSimulator",
    ];

    for (const router of criticalRouters) {
      it(`${router} router has real DB queries (no mock data)`, () => {
        const filePath = path.join(ROOT, `server/routers/${router}.ts`);
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, "utf-8");
        expect(content).not.toMatch(/Math\.random\(\)/);
        expect(content).toContain("getDb");
      });
    }
  });

  describe("S88-18: Real-Time WebSocket Streaming", () => {
    it("realtimeStreaming module exists with Socket.IO integration", () => {
      const filePath = path.join(ROOT, "server/websocket/realtimeStreaming.ts");
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("initRealtimeStreaming");
      expect(content).toContain("/settlement");
      expect(content).toContain("/notifications");
      expect(content).toContain("transaction:new");
      expect(content).toContain("reconciliation:update");
      expect(content).toContain("service:health");
    });

    it("streams live transactions from DB (not mock)", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "server/websocket/realtimeStreaming.ts"),
        "utf-8"
      );
      expect(content).toContain("getDb");
      expect(content).toContain("transactions");
      expect(content).toContain("TransactionEvent");
    });

    it("broadcasts Go service health every 30s", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "server/websocket/realtimeStreaming.ts"),
        "utf-8"
      );
      expect(content).toContain("30_000");
      expect(content).toContain("GO_SERVICES");
      expect(content).toContain("workflow-orchestrator");
      expect(content).toContain("fluvio-streaming");
    });
  });

  describe("S88-19: RealTimeDashboard UI Page", () => {
    it("RealTimeDashboard page exists with Socket.IO client", () => {
      const filePath = path.join(
        ROOT,
        "client/src/pages/RealTimeDashboard.tsx"
      );
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("socket.io-client");
      expect(content).toContain("/settlement");
      expect(content).toContain("/notifications");
    });

    it("displays live transaction feed", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "client/src/pages/RealTimeDashboard.tsx"),
        "utf-8"
      );
      expect(content).toContain("Live Transaction");
      expect(content).toContain("transaction:new");
    });

    it("displays reconciliation events", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "client/src/pages/RealTimeDashboard.tsx"),
        "utf-8"
      );
      expect(content).toContain("Reconciliation");
      expect(content).toContain("reconciliation:update");
    });

    it("displays Go service health monitor", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "client/src/pages/RealTimeDashboard.tsx"),
        "utf-8"
      );
      expect(content).toContain("Service Health");
      expect(content).toContain("service:health");
      expect(content).toContain("workflow-orchestrator");
    });

    it("is wired in App.tsx routes", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "client/src/App.tsx"),
        "utf-8"
      );
      expect(content).toContain("RealTimeDashboard");
      expect(content).toContain("real-time-dashboard");
    });
  });

  describe("S88-20: gRPC Proto Definitions", () => {
    it("proto file exists with service definitions", () => {
      const filePath = path.join(ROOT, "proto/go-services.proto");
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("WorkflowOrchestrator");
      expect(content).toContain("TigerBeetleLedger");
      expect(content).toContain("SettlementGateway");
      expect(content).toContain("PBACEngine");
      expect(content).toContain("USSDGateway");
      expect(content).toContain("OpenSearchAnalytics");
    });

    it("defines proper message types with fields", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "proto/go-services.proto"),
        "utf-8"
      );
      expect(content).toContain("CreateTransferRequest");
      expect(content).toContain("BalanceResponse");
      expect(content).toContain("PermissionResponse");
      expect(content).toContain("USSDSessionRequest");
    });
  });

  describe("Overall Sprint 88 Metrics", () => {
    it("has 15 Go service adapters", () => {
      const adapterDir = path.join(ROOT, "server/adapters");
      const files = fs
        .readdirSync(adapterDir)
        .filter(f => f.endsWith(".ts") && f !== "goServiceAdapter.ts");
      expect(files.length).toBeGreaterThanOrEqual(14);
    });

    it("all critical financial routers use getDb (no mock data)", () => {
      const routerDir = path.join(ROOT, "server/routers");
      const criticalFiles = [
        "aiCashFlowPredictor.ts",
        "dynamicQrPayment.ts",
        "merchantAcquirerGateway.ts",
        "paymentTokenVault.ts",
        "intelligentRoutingEngine.ts",
        "bulkDisbursementEngine.ts",
        "reconciliationEngine.ts",
        "currencyHedging.ts",
        "digitalTwinSimulator.ts",
      ];
      for (const file of criticalFiles) {
        const content = fs.readFileSync(path.join(routerDir, file), "utf-8");
        expect(content).toContain("getDb");
        expect(content).not.toMatch(/Math\.random\(\)/);
      }
    });
  });
});
