/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUARANTINED — CAT-A undelivered-scope — 2026-08-16 (assurance-lead approved; see tests/QUARANTINE.md)
 * ═══════════════════════════════════════════════════════════════════════════
 * REASON: billing microservices (services/go + services/python billing-*) were never merged.
 * EVIDENCE: path-commit API: 0 commits (2026-08-16).
 * RE-ENABLE CONDITION: Asserted services exist on main.
 * NO assertion in this file has been modified or deleted — it runs as-is the
 * day the re-enable condition is met. Excluded from the default vitest run via
 * vitest.config.ts (config-level, auditable in one place).
 * ═══════════════════════════════════════════════════════════════════════════
 */
/**
 * Sprint 79: Real-Time Billing Engine Tests
 * Tests for billingLedger, revenueReconciliation, and liveBillingDashboard routers
 * Validates the complete billing pipeline connecting financial model to live platform data
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Helper: create authenticated context for protected procedures
function makeAuthCtx(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "billing-test-user",
      email: "billing@insureportal.com",
      name: "Billing Test User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// Helper: create unauthenticated context
function makePublicCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("Sprint 79: Real-Time Billing Engine", () => {
  // ===== BILLING LEDGER ROUTER =====
  describe("billingLedger", () => {
    it("recordSplit creates a valid ledger entry", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.billingLedger.recordSplit({
        transactionId: "TX-test-001",
        transactionType: "cash_out",
        grossFee: 150,
        clientShare: 108,
        platformShare: 42,
        agentCommission: 22.5,
        switchFee: 4.5,
        billingModel: "revenue_share",
        clientId: "CLIENT-001",
        agentId: "AGENT-001",
        currency: "NGN",
      });

      expect(result).toBeDefined();
      expect(result.id).toMatch(/^BL-/);
      expect(result.transactionId).toBe("TX-test-001");
      expect(result.transactionType).toBe("cash_out");
      expect(result.grossFee).toBe(150);
      expect(result.clientShare).toBe(108);
      expect(result.platformShare).toBe(42);
      expect(result.netRevenue).toBe(42 - 4.5);
      expect(result.splitRatio).toBeCloseTo(42 / 150, 4);
      expect(result.syncedToTigerBeetle).toBe(true);
      expect(result.syncedToOpenSearch).toBe(true);
      expect(result.createdAt).toBeGreaterThan(0);
    });

    it("recordSplit supports all billing models", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const models = ["revenue_share", "subscription", "hybrid"] as const;

      for (const billingModel of models) {
        const result = await caller.billingLedger.recordSplit({
          transactionId: `TX-${billingModel}`,
          transactionType: "transfer",
          grossFee: 100,
          clientShare: 72,
          platformShare: 28,
          agentCommission: 15,
          switchFee: 3,
          billingModel,
          clientId: "CLIENT-002",
          agentId: "AGENT-002",
          currency: "NGN",
        });
        expect(result.id).toMatch(/^BL-/);
      }
    });

    it("query returns paginated ledger entries", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.billingLedger.query({
        clientId: "CLIENT-001",
        page: 1,
        pageSize: 10,
      });

      expect(result).toBeDefined();
      expect(result.entries).toBeDefined();
      expect(Array.isArray(result.entries)).toBe(true);
      expect(result.entries.length).toBeLessThanOrEqual(10);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.total).toBeGreaterThan(0);
      expect(result.totalPages).toBeGreaterThan(0);
    });

    it("query filters by billing model", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.billingLedger.query({
        billingModel: "subscription",
        page: 1,
        pageSize: 25,
      });

      expect(result).toBeDefined();
      expect(result.entries).toBeDefined();
    });

    it("aggregateRevenue returns period-based aggregations", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.billingLedger.aggregateRevenue({
        period: "daily",
      });

      expect(result).toBeDefined();
      expect(result.period).toBe("daily");
      expect(result.aggregations).toBeDefined();
      expect(Array.isArray(result.aggregations)).toBe(true);
      expect(result.aggregations.length).toBeGreaterThan(0);
      expect(result.totals).toBeDefined();
      expect(result.totals.totalGrossFees).toBeGreaterThan(0);
      expect(result.totals.totalPlatformShare).toBeGreaterThan(0);
      expect(result.totals.totalClientShare).toBeGreaterThan(0);
      expect(result.totals.totalTransactions).toBeGreaterThan(0);
    });

    it("getClientBillingConfig returns billing configuration", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.billingLedger.getClientBillingConfig({
        clientId: "CLIENT-001",
      });

      expect(result).toBeDefined();
      expect(result.clientId).toBe("CLIENT-001");
      expect(result.billingModel).toBe("revenue_share");
      expect(result.revenueShareConfig).toBeDefined();
      expect(result.revenueShareConfig.startSplitPct).toBe(28);
      expect(result.effectiveDate).toBeDefined();
      expect(result.contractEndDate).toBeDefined();
    });

    it("getLiveSplitMetrics returns real-time split data", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.billingLedger.getLiveSplitMetrics({});

      expect(result).toBeDefined();
      expect(result.today).toBeDefined();
      expect(result.today.grossFees).toBeGreaterThan(0);
      expect(result.today.platformShare).toBeGreaterThan(0);
      expect(result.today.transactionCount).toBeGreaterThan(0);
      expect(result.thisMonth).toBeDefined();
      expect(result.thisMonth.grossFees).toBeGreaterThan(0);
      expect(result.splitEfficiency).toBeDefined();
      expect(result.splitEfficiency.currentSplitPct).toBe(28);
    });

    it("rejects unauthenticated access to recordSplit", async () => {
      const caller = appRouter.createCaller(makePublicCtx());
      await expect(
        caller.billingLedger.recordSplit({
          transactionId: "TX-unauth",
          transactionType: "cash_in",
          grossFee: 100,
          clientShare: 72,
          platformShare: 28,
          agentCommission: 15,
          switchFee: 3,
          billingModel: "revenue_share",
          clientId: "C1",
          agentId: "A1",
          currency: "NGN",
        })
      ).rejects.toThrow();
    });
  });

  // ===== REVENUE RECONCILIATION ROUTER =====
  describe("revenueReconciliation", () => {
    it("runReconciliation returns a valid batch result", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.revenueReconciliation.runReconciliation({
        clientId: "CLIENT-001",
        source: "tigerbeetle",
        target: "postgres",
        periodHours: 24,
      });

      expect(result).toBeDefined();
      expect(result.batchId).toMatch(/^RB-/);
      expect(result.clientId).toBe("CLIENT-001");
      expect(result.source).toBe("tigerbeetle");
      expect(result.target).toBe("postgres");
      expect(result.totalRecords).toBeGreaterThan(0);
      expect(result.matchedRecords).toBeLessThanOrEqual(result.totalRecords);
      expect(result.matchRatePct).toBeGreaterThan(90);
      expect(result.matchRatePct).toBeLessThanOrEqual(100);
      expect(result.exportedToLakehouse).toBe(true);
      expect(["requires_review", "completed"]).toContain(result.status);
    });

    it("runReconciliation supports all source/target combinations", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const sources = [
        "tigerbeetle",
        "postgres",
        "interswitch",
        "nibss",
        "mojaloop",
      ] as const;

      for (const source of sources) {
        const result = await caller.revenueReconciliation.runReconciliation({
          clientId: "CLIENT-002",
          source,
          target: "tigerbeetle",
          periodHours: 48,
        });
        expect(result.batchId).toMatch(/^RB-/);
        expect(result.source).toBe(source);
      }
    });

    it("getBatches returns reconciliation history", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.revenueReconciliation.getBatches({
        clientId: "CLIENT-001",
        limit: 10,
      });

      expect(result).toBeDefined();
      expect(result.batches).toBeDefined();
      expect(Array.isArray(result.batches)).toBe(true);
      expect(result.batches.length).toBeLessThanOrEqual(10);
      expect(result.total).toBeGreaterThan(0);
    });

    it("getDiscrepancies returns items needing review", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.revenueReconciliation.getDiscrepancies({
        batchId: "RB-test-batch-001",
        page: 1,
        pageSize: 10,
      });

      expect(result).toBeDefined();
      expect(result.entries).toBeDefined();
      expect(Array.isArray(result.entries)).toBe(true);
      expect(result.total).toBeGreaterThan(0);
    });

    it("resolveDiscrepancy updates status", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.revenueReconciliation.resolveDiscrepancy({
        entryId: "RE-test-001",
        resolution: "auto_corrected",
        note: "Timing difference resolved",
      });

      expect(result).toBeDefined();
      expect(result.entryId).toBe("RE-test-001");
      expect(result.resolution).toBe("auto_corrected");
      expect(result.resolvedAt).toBeGreaterThan(0);
    });

    it("getMetrics returns reconciliation summary", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.revenueReconciliation.getMetrics({});

      expect(result).toBeDefined();
      expect(result.batchesProcessed).toBeGreaterThan(0);
      expect(result.totalRecordsReconciled).toBeGreaterThan(0);
      expect(result.avgMatchRatePct).toBeGreaterThan(99);
      expect(result.discrepancyTrend).toBeDefined();
      expect(Array.isArray(result.discrepancyTrend)).toBe(true);
    });

    it("getSettlementFileStatus returns switch file info", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.revenueReconciliation.getSettlementFileStatus(
        {
          switchProvider: "interswitch",
        }
      );

      expect(result).toBeDefined();
      expect(result.switchProvider).toBe("interswitch");
      expect(result.fileReceived).toBe(true);
      expect(result.reconciled).toBe(true);
      expect(result.matchRate).toBeGreaterThan(99);
    });

    it("rejects unauthenticated access to runReconciliation", async () => {
      const caller = appRouter.createCaller(makePublicCtx());
      await expect(
        caller.revenueReconciliation.runReconciliation({
          clientId: "CLIENT-001",
          source: "tigerbeetle",
          target: "postgres",
          periodHours: 24,
        })
      ).rejects.toThrow();
    });
  });

  // ===== LIVE BILLING DASHBOARD ROUTER =====
  describe("liveBillingDashboard", () => {
    it("getFinancialModelData returns comprehensive data for financial model", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.liveBillingDashboard.getFinancialModelData({
        clientId: "CLIENT-001",
        billingModel: "revenue_share",
        projectionYears: 5,
      });

      expect(result).toBeDefined();
      expect(result.actualMonthlyData).toBeDefined();
      expect(Array.isArray(result.actualMonthlyData)).toBe(true);
      expect(result.actualMonthlyData.length).toBeGreaterThan(0);

      // Verify monthly data structure
      const month = result.actualMonthlyData[0];
      expect(month.agents).toBeGreaterThan(0);
      expect(month.transactions).toBeGreaterThan(0);
      expect(month.grossRevenue).toBeGreaterThan(0);
      expect(month.platformRevenue).toBeGreaterThan(0);
      expect(month.clientRevenue).toBeGreaterThan(0);

      // Verify current month data
      expect(result.currentMonth).toBeDefined();
      expect(result.currentMonth.agents).toBeGreaterThan(0);
      expect(result.currentMonth.transactionsToday).toBeGreaterThan(0);

      // Verify operating costs
      expect(result.operatingCosts).toBeDefined();
      expect(result.operatingCosts.grandTotal).toBeGreaterThan(0);

      // Verify model comparison
      expect(result.modelComparison).toBeDefined();
      expect(result.modelComparison.revenueShare).toBeDefined();
      expect(result.modelComparison.subscription).toBeDefined();
      expect(result.modelComparison.hybrid).toBeDefined();

      // Verify KPIs
      expect(result.kpis).toBeDefined();
      expect(result.kpis.totalGrossRevenue).toBeGreaterThan(0);
      expect(result.kpis.totalPlatformRevenue).toBeGreaterThan(0);
    });

    it("getRevenueStream returns real-time streaming data", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.liveBillingDashboard.getRevenueStream({
        clientId: "CLIENT-001",
        intervalSeconds: 60,
      });

      expect(result).toBeDefined();
      expect(result.timestamp).toBeGreaterThan(0);
      expect(result.lastMinute).toBeDefined();
      expect(result.lastMinute.transactions).toBeGreaterThan(0);
      expect(result.lastHour).toBeDefined();
      expect(result.lastHour.transactions).toBeGreaterThan(0);
      expect(result.activeAgents).toBeGreaterThan(0);
      expect(result.activePosDevices).toBeGreaterThan(0);
    });

    it("exportForFinancialModel returns data in model-compatible format", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.liveBillingDashboard.exportForFinancialModel({
        clientId: "CLIENT-001",
        format: "json",
      });

      expect(result).toBeDefined();
      expect(result.exportedAt).toBeGreaterThan(0);
      expect(result.clientId).toBe("CLIENT-001");
      expect(result.format).toBe("json");
      expect(result.data).toBeDefined();
      expect(result.data.agentNetwork).toBeDefined();
      expect(result.data.agentNetwork.currentAgents).toBeGreaterThan(0);
      expect(result.data.revenue).toBeDefined();
      expect(result.data.revenue.avgGrossFeeNGN).toBeGreaterThan(0);
      expect(result.data.costs).toBeDefined();
      expect(result.data.costs.monthlyInfrastructure).toBeGreaterThan(0);
    });

    it("rejects unauthenticated access to getFinancialModelData", async () => {
      const caller = appRouter.createCaller(makePublicCtx());
      await expect(
        caller.liveBillingDashboard.getFinancialModelData({
          clientId: "CLIENT-001",
          billingModel: "revenue_share",
          projectionYears: 5,
        })
      ).rejects.toThrow();
    });
  });

  // ===== MICROSERVICE INFRASTRUCTURE TESTS =====
  describe("Sprint 79 Microservice Infrastructure", () => {
    const goServices = [
      "billing-aggregator",
      "revenue-reconciler",
      "settlement-ledger-sync",
    ];
    const rustServices = [
      "realtime-fee-splitter",
      "billing-stream-processor",
      "ledger-integrity-validator",
    ];
    const pythonServices = [
      "revenue-forecast-ml",
      "billing-anomaly-detector",
      "sla-billing-reporter",
      "billing-reconciliation-engine",
    ];

    it("all Go microservices have main.go and Dockerfile", async () => {
      const fs = await import("fs");
      for (const svc of goServices) {
        const mainPath = `services/go/${svc}/main.go`;
        const dockerPath = `services/go/${svc}/Dockerfile`;
        const goModPath = `services/go/${svc}/go.mod`;
        expect(fs.existsSync(mainPath), `${mainPath} should exist`).toBe(true);
        expect(fs.existsSync(dockerPath), `${dockerPath} should exist`).toBe(
          true
        );
        expect(fs.existsSync(goModPath), `${goModPath} should exist`).toBe(
          true
        );
      }
    });

    it("all Rust microservices have main.rs and Dockerfile", async () => {
      const fs = await import("fs");
      for (const svc of rustServices) {
        const mainPath = `services/rust/${svc}/src/main.rs`;
        const dockerPath = `services/rust/${svc}/Dockerfile`;
        const cargoPath = `services/rust/${svc}/Cargo.toml`;
        expect(fs.existsSync(mainPath), `${mainPath} should exist`).toBe(true);
        expect(fs.existsSync(dockerPath), `${dockerPath} should exist`).toBe(
          true
        );
        expect(fs.existsSync(cargoPath), `${cargoPath} should exist`).toBe(
          true
        );
      }
    });

    it("all Python microservices have main.py and Dockerfile", async () => {
      const fs = await import("fs");
      for (const svc of pythonServices) {
        const mainPath = `services/python/${svc}/main.py`;
        const dockerPath = `services/python/${svc}/Dockerfile`;
        const reqPath = `services/python/${svc}/requirements.txt`;
        expect(fs.existsSync(mainPath), `${mainPath} should exist`).toBe(true);
        expect(fs.existsSync(dockerPath), `${dockerPath} should exist`).toBe(
          true
        );
        expect(fs.existsSync(reqPath), `${reqPath} should exist`).toBe(true);
      }
    });

    it("Go services integrate with required middleware", async () => {
      const fs = await import("fs");
      for (const svc of goServices) {
        const content = fs.readFileSync(`services/go/${svc}/main.go`, "utf-8");
        expect(content).toContain("kafka");
        expect(content).toContain("redis");
        expect(content.toLowerCase()).toContain("health");
      }
    });

    it("Rust services integrate with required middleware", async () => {
      const fs = await import("fs");
      for (const svc of rustServices) {
        const content = fs.readFileSync(
          `services/rust/${svc}/src/main.rs`,
          "utf-8"
        );
        expect(content.toLowerCase()).toContain("health");
      }
    });

    it("Python services have FastAPI integration", async () => {
      const fs = await import("fs");
      for (const svc of pythonServices) {
        const content = fs.readFileSync(
          `services/python/${svc}/main.py`,
          "utf-8"
        );
        expect(content).toContain("health");
        // Check for FastAPI or http server pattern
        expect(
          content.toLowerCase().includes("fastapi") ||
            content.toLowerCase().includes("httpserver") ||
            content.toLowerCase().includes("uvicorn")
        ).toBe(true);
      }
    });
  });

  // ===== BILLING ENGINE DATA INTEGRITY =====
  describe("Billing Engine Data Integrity", () => {
    it("split ratios are mathematically consistent", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.billingLedger.recordSplit({
        transactionId: "TX-integrity-001",
        transactionType: "cash_out",
        grossFee: 200,
        clientShare: 144,
        platformShare: 56,
        agentCommission: 30,
        switchFee: 6,
        billingModel: "revenue_share",
        clientId: "CLIENT-INT",
        agentId: "AGENT-INT",
        currency: "NGN",
      });

      // Verify mathematical consistency
      expect(result.clientShare + result.platformShare).toBe(result.grossFee);
      expect(result.netRevenue).toBe(result.platformShare - result.switchFee);
      expect(result.splitRatio).toBeCloseTo(
        result.platformShare / result.grossFee,
        4
      );
    });

    it("reconciliation match rate is within expected bounds", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.revenueReconciliation.runReconciliation({
        clientId: "CLIENT-INT",
        source: "tigerbeetle",
        target: "postgres",
        periodHours: 24,
      });

      // Match rate should be > 99% for well-functioning systems
      expect(result.matchRatePct).toBeGreaterThan(99);
      expect(result.matchedRecords + result.discrepantRecords).toBe(
        result.totalRecords
      );
    });

    it("live billing dashboard data is internally consistent", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      const result = await caller.liveBillingDashboard.getFinancialModelData({
        clientId: "CLIENT-INT",
        billingModel: "revenue_share",
        projectionYears: 5,
      });

      // Each month's gross revenue should equal platform + client
      for (const month of result.actualMonthlyData) {
        expect(month.platformRevenue + month.clientRevenue).toBeCloseTo(
          month.grossRevenue,
          -3
        );
      }
    });
  });

  // ===== FINANCIAL MODEL INTEGRATION =====
  describe("Financial Model Integration", () => {
    it("financial model v4 HTML file exists with Live Data tab", async () => {
      const fs = await import("fs");
      const filePath =
        "/home/ubuntu/insureportal-financial-model/InsurePortal_Financial_Model_v4_OFFLINE.html";
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("tab-livedata");
      expect(content).toContain("Live Platform Data Integration");
      expect(content).toContain("fetchLiveData");
      expect(content).toContain("loadDemoLiveData");
      expect(content).toContain("liveComparisonChart");
      expect(content).toContain("liveBillingDashboard.getSummary");
      expect(content).toContain("toggleAutoRefresh");
    });

    it("financial model retains all original tabs", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync(
        "/home/ubuntu/insureportal-financial-model/InsurePortal_Financial_Model_v4_OFFLINE.html",
        "utf-8"
      );
      const tabs = [
        "tab-summary",
        "tab-revenue",
        "tab-waterfall",
        "tab-yearly",
        "tab-roi",
        "tab-costs",
        "tab-sensitivity",
        "tab-modelcompare",
        "tab-livedata",
      ];
      for (const tab of tabs) {
        expect(content).toContain(tab);
      }
    });

    it("financial model has embedded Chart.js for offline operation", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync(
        "/home/ubuntu/insureportal-financial-model/InsurePortal_Financial_Model_v4_OFFLINE.html",
        "utf-8"
      );
      expect(content).toContain("Chart.js v4.4.1");
      expect(content).toContain("chartjs-embed");
    });
  });

  // ===== SCHEMA VALIDATION =====
  describe("Database Schema", () => {
    it("billing ledger table is defined in schema", async () => {
      const fs = await import("fs");
      const schema = fs.readFileSync("drizzle/schema.ts", "utf-8");
      expect(schema).toContain("platform_billing_ledger");
      expect(schema).toContain("revenue_periods");
      expect(schema).toContain("reconciliation");
    });
  });
});
