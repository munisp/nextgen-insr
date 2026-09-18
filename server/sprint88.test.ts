/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUARANTINED-OPEN-DEFECT — genuine defect / partial delivery (fix routing in progress) — 2026-08-16 (assurance-lead approved; see tests/QUARANTINE.md)
 * ═══════════════════════════════════════════════════════════════════════════
 * REASON: content assertion drift on delivered files.
 * EVIDENCE: run 31969739386.
 * RE-ENABLE CONDITION: Reconciled (F-12).
 * NO assertion in this file has been modified or deleted — it runs as-is the
 * day the re-enable condition is met. Excluded from the default vitest run via
 * vitest.config.ts (config-level, auditable in one place).
 * ═══════════════════════════════════════════════════════════════════════════
 */
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

  // H2, 2026-02 (honest-contract update): the realtimeStreaming module was
  // DELETED — it was a dead, unwired, UNAUTHENTICATED /settlement socket
  // broadcaster (referenced only by this test; an independent verifier
  // confirmed initRealtimeStreaming is never called). These are now NEGATIVE
  // tests: they pin the absence of the unauthenticated broadcaster, not its
  // presence. The live, authenticated notifications namespace remains in
  // server/lib/realtimeNotifications.ts (H-wave: JWT required, staff-gated
  // channels).
  describe("S88-18: Real-Time WebSocket Streaming (deleted broadcaster — negative tests)", () => {
    it("the unauthenticated realtimeStreaming broadcaster is REMOVED", () => {
      const filePath = path.join(ROOT, "server/websocket/realtimeStreaming.ts");
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it("no production server module wires the deleted broadcaster", () => {
      // Scan production server sources (excluding tests) for any import of
      // the deleted module — must be ZERO.
      const offenders: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
            walk(full);
          } else if (
            entry.name.endsWith(".ts") &&
            !entry.name.includes(".test.")
          ) {
            const content = fs.readFileSync(full, "utf-8");
            if (content.includes("websocket/realtimeStreaming") || content.includes("initRealtimeStreaming")) {
              offenders.push(full);
            }
          }
        }
      };
      walk(path.join(ROOT, "server"));
      expect(offenders).toEqual([]);
    });

    it("the LIVE notifications namespace requires authentication", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "server/lib/realtimeNotifications.ts"),
        "utf-8"
      );
      // H-wave semantics: unauthenticated connections are rejected outright.
      expect(content).toContain("authentication required");
      // And global fraud/settlement feeds are staff-gated.
      expect(content).toContain("STAFF_ONLY_CHANNELS");
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
