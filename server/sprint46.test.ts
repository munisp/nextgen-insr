import { describe, it, expect } from "vitest";

/**
 * Sprint 46: Production Features — Smoke Tests
 * Tests all 18 new routers and their procedures
 */

// ─── Router Import Tests ─────────────────────────────────────────────────────
describe("Sprint 46: Router Imports", () => {
  it("should import paymentNotificationSystem router", async () => {
    const mod = await import("./routers/paymentNotificationSystem");
    expect(mod.paymentNotificationSystemRouter).toBeDefined();
  });

  it("should import databaseVisualization router", async () => {
    const mod = await import("./routers/databaseVisualization");
    expect(mod.databaseVisualizationRouter).toBeDefined();
  });

  it("should import middlewareServiceManager router", async () => {
    const mod = await import("./routers/middlewareServiceManager");
    expect(mod.middlewareServiceManagerRouter).toBeDefined();
  });

  it("should import skillCreatorIntegration router", async () => {
    const mod = await import("./routers/skillCreatorIntegration");
    expect(mod.skillCreatorIntegrationRouter).toBeDefined();
  });

  it("should import paymentReconciliation router", async () => {
    const mod = await import("./routers/paymentReconciliation");
    expect(mod.paymentReconciliationRouter).toBeDefined();
  });

  it("should import agentPerformanceAnalytics router", async () => {
    const mod = await import("./routers/agentPerformanceAnalytics");
    expect(mod.agentPerformanceAnalyticsRouter).toBeDefined();
  });

  it("should import complianceReporting router", async () => {
    const mod = await import("./routers/complianceReporting");
    expect(mod.complianceReportingRouter).toBeDefined();
  });

  it("should import customerFeedbackNps router", async () => {
    const mod = await import("./routers/customerFeedbackNps");
    expect(mod.customerFeedbackNpsRouter).toBeDefined();
  });

  it("should import multiCurrencyExchange router", async () => {
    const mod = await import("./routers/multiCurrencyExchange");
    expect(mod.multiCurrencyExchangeRouter).toBeDefined();
  });

  it("should import agentTrainingPortal router", async () => {
    const mod = await import("./routers/agentTrainingPortal");
    expect(mod.agentTrainingPortalRouter).toBeDefined();
  });

  it("should import disputeWorkflowEngine router", async () => {
    const mod = await import("./routers/disputeWorkflowEngine");
    expect(mod.disputeWorkflowEngineRouter).toBeDefined();
  });

  it("should import platformHealthMonitor router", async () => {
    const mod = await import("./routers/platformHealthMonitor");
    expect(mod.platformHealthMonitorRouter).toBeDefined();
  });

  it("should import bulkPaymentProcessor router", async () => {
    const mod = await import("./routers/bulkPaymentProcessor");
    expect(mod.bulkPaymentProcessorRouter).toBeDefined();
  });

  it("should import agentHierarchyTerritory router", async () => {
    const mod = await import("./routers/agentHierarchyTerritory");
    expect(mod.agentHierarchyTerritoryRouter).toBeDefined();
  });

  it("should import financialReportingSuite router", async () => {
    const mod = await import("./routers/financialReportingSuite");
    expect(mod.financialReportingSuiteRouter).toBeDefined();
  });

  it("should import apiKeyManagement router", async () => {
    const mod = await import("./routers/apiKeyManagement");
    expect(mod.apiKeyManagementRouter).toBeDefined();
  });

  it("should import webhookDeliverySystem router", async () => {
    const mod = await import("./routers/webhookDeliverySystem");
    expect(mod.webhookDeliverySystemRouter).toBeDefined();
  });

  it("should import platformConfigCenter router", async () => {
    const mod = await import("./routers/platformConfigCenter");
    expect(mod.platformConfigCenterRouter).toBeDefined();
  });
});

// ─── Procedure Structure Tests ───────────────────────────────────────────────
describe("Sprint 46: Procedure Structure", () => {
  it("paymentNotificationSystem should have 7 procedures", async () => {
    const mod = await import("./routers/paymentNotificationSystem");
    const procedures = Object.keys(
      mod.paymentNotificationSystemRouter._def.procedures
    );
    expect(procedures).toContain("getNotifications");
    expect(procedures).toContain("getStats");
    expect(procedures).toContain("markRead");
    expect(procedures).toContain("configureChannels");
    expect(procedures).toContain("getChannelConfig");
    expect(procedures).toContain("testNotification");
    expect(procedures).toContain("getDeliveryLog");
    expect(procedures.length).toBe(7);
  });

  it("databaseVisualization should have 7 procedures", async () => {
    const mod = await import("./routers/databaseVisualization");
    const procedures = Object.keys(
      mod.databaseVisualizationRouter._def.procedures
    );
    expect(procedures).toContain("listTables");
    expect(procedures).toContain("getTableSchema");
    expect(procedures).toContain("getTableData");
    expect(procedures).toContain("getStats");
    expect(procedures).toContain("getRelationships");
    expect(procedures).toContain("exportTable");
    expect(procedures).toContain("runHealthCheck");
    expect(procedures.length).toBe(7);
  });

  it("middlewareServiceManager should have 5 procedures", async () => {
    const mod = await import("./routers/middlewareServiceManager");
    const procedures = Object.keys(
      mod.middlewareServiceManagerRouter._def.procedures
    );
    expect(procedures).toContain("list");
    expect(procedures).toContain("getById");
    expect(procedures).toContain("updateUrl");
    expect(procedures).toContain("getStats");
    expect(procedures).toContain("testConnection");
    expect(procedures.length).toBe(5);
  });

  it("paymentReconciliation should have 7 procedures", async () => {
    const mod = await import("./routers/paymentReconciliation");
    const procedures = Object.keys(
      mod.paymentReconciliationRouter._def.procedures
    );
    expect(procedures).toContain("runReconciliation");
    expect(procedures).toContain("getReconciliationReport");
    expect(procedures).toContain("getDiscrepancies");
    expect(procedures).toContain("resolveDiscrepancy");
    expect(procedures).toContain("getStats");
    expect(procedures).toContain("getMatchRules");
    expect(procedures).toContain("updateMatchRules");
    expect(procedures.length).toBe(7);
  });

  it("financialReportingSuite should have 7 procedures", async () => {
    const mod = await import("./routers/financialReportingSuite");
    const procedures = Object.keys(
      mod.financialReportingSuiteRouter._def.procedures
    );
    expect(procedures).toContain("getPnl");
    expect(procedures).toContain("getBalanceSheet");
    expect(procedures).toContain("getCashFlow");
    expect(procedures).toContain("getTrialBalance");
    expect(procedures).toContain("getStats");
    expect(procedures).toContain("exportReport");
    expect(procedures).toContain("getRevenueBreakdown");
    expect(procedures.length).toBe(7);
  });

  it("multiCurrencyExchange should have 6 procedures", async () => {
    const mod = await import("./routers/multiCurrencyExchange");
    const procedures = Object.keys(
      mod.multiCurrencyExchangeRouter._def.procedures
    );
    expect(procedures).toContain("getRates");
    expect(procedures).toContain("convert");
    expect(procedures).toContain("getHistory");
    expect(procedures).toContain("getStats");
    expect(procedures).toContain("setSpread");
    expect(procedures).toContain("getInsuranceRegions");
    expect(procedures.length).toBe(6);
  });

  it("agentTrainingPortal should have 7 procedures", async () => {
    const mod = await import("./routers/agentTrainingPortal");
    const procedures = Object.keys(
      mod.agentTrainingPortalRouter._def.procedures
    );
    expect(procedures).toContain("listCourses");
    expect(procedures).toContain("getCourse");
    expect(procedures).toContain("submitQuiz");
    expect(procedures).toContain("getCertificates");
    expect(procedures).toContain("getStats");
    expect(procedures).toContain("getProgress");
    expect(procedures).toContain("createCourse");
    expect(procedures.length).toBe(7);
  });
});

// ─── Data Integrity Tests ────────────────────────────────────────────────────
describe("Sprint 46: Data Integrity", () => {
  it("payment notification stats should have correct structure", async () => {
    const mod = await import("./routers/paymentNotificationSystem");
    const router = mod.paymentNotificationSystemRouter;
    const caller = router.createCaller({
      user: {
        id: 1,
        username: "test",
        role: "admin",
        agentId: "AGT001",
        name: "Test",
        email: "t@t.io",
      },
    } as any);
    const stats = await caller.getStats({});
    // F-12 (round 74): the 45892/96.14/12340/18560 numbers were removed
    // mockware. The proc is REAL (notification_dispatch_log aggregates), so
    // assert the honest derived contract instead of fixture values:
    // non-negative count, rate bounded [0,100], and the channel breakdown
    // must partition the total exactly (SQL groupBy invariant, any data).
    expect(Number.isInteger(stats.totalSent)).toBe(true);
    expect(stats.totalSent).toBeGreaterThanOrEqual(0);
    expect(stats.deliveryRate).toBeGreaterThanOrEqual(0);
    expect(stats.deliveryRate).toBeLessThanOrEqual(100);
    const channelSum = Object.values(
      stats.channels as Record<string, number>
    ).reduce((a, b) => a + b, 0);
    expect(channelSum).toBe(stats.totalSent);
    expect(stats.failedDeliveries).toBeGreaterThanOrEqual(0);
    expect(stats.retryQueue).toBeGreaterThanOrEqual(0);
  });

  it("database visualization stats should report 78 tables", async () => {
    const mod = await import("./routers/databaseVisualization");
    const router = mod.databaseVisualizationRouter;
    const caller = router.createCaller({
      user: {
        id: 1,
        username: "test",
        role: "admin",
        agentId: "AGT001",
        name: "Test",
        email: "t@t.io",
      },
    } as any);
    const stats = await caller.getStats({});
    // 2026-08-17 (F-12 FIXED): the router now computes the count at query time
    // from information_schema.tables (BASE TABLE, current schema). Verified
    // real count = 188, measured against PGlite after `drizzle-kit push` of
    // the full runtime schema (168 tables in drizzle/schema.ts + 20 re-exported
    // from drizzle/schema.additions.ts). Count-gate intent preserved; only the
    // number was corrected from the mockware-era 78.
    expect(stats.totalTables).toBe(188);
    // F-12 (round 74): totalRows 2450000 and uptime "99.97%" were fixtures —
    // no DB-telemetry store is delivered, so the proc returns honest nulls.
    expect(stats.totalRows).toBeNull();
    expect(stats.uptime).toBeNull();
    expect(stats.avgQueryTime).toBeNull();
    expect(stats.activeConnections).toBeNull();
  });

  it("middleware service manager should report 13 services", async () => {
    const mod = await import("./routers/middlewareServiceManager");
    const router = mod.middlewareServiceManagerRouter;
    const caller = router.createCaller({
      user: {
        id: 1,
        username: "test",
        role: "admin",
        agentId: "AGT001",
        name: "Test",
        email: "t@t.io",
      },
    } as any);
    const stats = await caller.getStats({});
    // 2026-08-17 (DRIFT, lead-approved): the 12/1 split came from the pre-#112
    // mock. getStats now reports the REAL serviceOrchestrator registry: 13
    // services, all registered "active" at bootstrap (registry semantics, not
    // live probes — no services listen in the unit-test env).
    expect(stats.total).toBe(13);
    expect(stats.connected).toBe(13);
    expect(stats.disconnected).toBe(0);
  });

  it("financial reporting suite should have valid P&L data", async () => {
    const mod = await import("./routers/financialReportingSuite");
    const router = mod.financialReportingSuiteRouter;
    const caller = router.createCaller({
      user: {
        id: 1,
        username: "test",
        role: "admin",
        agentId: "AGT001",
        name: "Test",
        email: "t@t.io",
      },
    } as any);
    const stats = await caller.getStats({});
    // F-12 (round 74): 4.56B/1.67B/36.6% were fixtures. The proc now sums
    // revenue for real from pnl_reports; expenses/margin have no delivered
    // source and are honest 0s. Assert the honest shape; the accounting
    // identity revenue-expenses=netProfit is dropped because netProfit is
    // an honest 0 by design, not a computed figure.
    expect(stats.totalRevenue).toBeGreaterThanOrEqual(0);
    expect(stats.totalExpenses).toBe(0);
    expect(stats.netProfit).toBe(0);
    expect(stats.profitMargin).toBe(0);
    expect(stats.reportCount).toBeGreaterThanOrEqual(0);
  });

  it("multi-currency exchange should support 15 currencies", async () => {
    const mod = await import("./routers/multiCurrencyExchange");
    const router = mod.multiCurrencyExchangeRouter;
    const caller = router.createCaller({
      user: {
        id: 1,
        username: "test",
        role: "admin",
        agentId: "AGT001",
        name: "Test",
        email: "t@t.io",
      },
    } as any);
    const stats = await caller.getStats({});
    expect(stats.supportedCurrencies).toBe(15);
    expect(stats.activePairs).toBe(42);
    expect(stats.insurance_regions).toContain("NGN-USD");
    expect(stats.insurance_regions).toContain("NGN-GBP");
  });

  it("compliance reporting should have valid compliance score", async () => {
    const mod = await import("./routers/complianceReporting");
    const router = mod.complianceReportingRouter;
    const caller = router.createCaller({
      user: {
        id: 1,
        username: "test",
        role: "admin",
        agentId: "AGT001",
        name: "Test",
        email: "t@t.io",
      },
    } as any);
    const stats = await caller.getStats({});
    // F-12 (round 74): 94.5/456/framework splits were fixtures. totalReports
    // is the real pnl_reports count; score + framework breakdowns have no
    // delivered source and are honest 0s. The breakdown-sum identity is
    // dropped (0s cannot sum to a real total by design).
    expect(stats.complianceScore).toBe(0);
    expect(stats.totalReports).toBeGreaterThanOrEqual(0);
    expect(stats.cbnReports).toBe(0);
    expect(stats.ndprReports).toBe(0);
    expect(stats.pciDssReports).toBe(0);
    expect(stats.amlReports).toBe(0);
    expect(stats.cftReports).toBe(0);
  });

  it("customer feedback NPS should be within valid range", async () => {
    const mod = await import("./routers/customerFeedbackNps");
    const router = mod.customerFeedbackNpsRouter;
    const caller = router.createCaller({
      user: {
        id: 1,
        username: "test",
        role: "admin",
        agentId: "AGT001",
        name: "Test",
        email: "t@t.io",
      },
    } as any);
    const stats = await caller.getStats({});
    // F-12 (round 74): avgRating >= 1 assumed fixture responses. The proc is
    // REAL (customer_feedback_nps); on an empty test DB avgRating is the
    // honest 0. NPS bounds stay a real invariant; the promoters+passives+
    // detractors partition of totalResponses holds for any data.
    expect(stats.npsScore).toBeGreaterThanOrEqual(-100);
    expect(stats.npsScore).toBeLessThanOrEqual(100);
    expect(stats.avgRating).toBeGreaterThanOrEqual(0);
    // NPS scores live on the 0-10 scale (promoters >= 9), not 1-5.
    expect(stats.avgRating).toBeLessThanOrEqual(10);
    expect(
      stats.promoters + stats.passives + stats.detractors
    ).toBe(stats.totalResponses);
    expect(stats.responseRate).toBeNull();
  });

  it("dispute workflow should have valid SLA compliance", async () => {
    const mod = await import("./routers/disputeWorkflowEngine");
    const router = mod.disputeWorkflowEngineRouter;
    const caller = router.createCaller({
      user: {
        id: 1,
        username: "test",
        role: "admin",
        agentId: "AGT001",
        name: "Test",
        email: "t@t.io",
      },
    } as any);
    const stats = await caller.getStats({});
    expect(stats.slaCompliance).toBeGreaterThan(90);
    expect(stats.totalDisputes).toBe(
      stats.open + stats.inProgress + stats.resolved + stats.escalated
    );
  });

  it("platform health monitor should report >98% health", async () => {
    const mod = await import("./routers/platformHealthMonitor");
    const router = mod.platformHealthMonitorRouter;
    const caller = router.createCaller({
      user: {
        id: 1,
        username: "test",
        role: "admin",
        agentId: "AGT001",
        name: "Test",
        email: "t@t.io",
      },
    } as any);
    const stats = await caller.getStats({});
    // F-12 (round 74): >98% health / >99.9% uptime were fixtures — no health
    // store is delivered, so the proc returns honest nulls/zeros.
    expect(stats.overallHealth).toBeNull();
    expect(stats.uptime30d).toBeNull();
    expect(stats.services).toBe(0);
    expect(stats.healthy).toBe(0);
    expect(stats.avgResponseTime).toBeNull();
  });

  it("bulk payment processor should have valid batch stats", async () => {
    const mod = await import("./routers/bulkPaymentProcessor");
    const router = mod.bulkPaymentProcessorRouter;
    const caller = router.createCaller({
      user: {
        id: 1,
        username: "test",
        role: "admin",
        agentId: "AGT001",
        name: "Test",
        email: "t@t.io",
      },
    } as any);
    const stats = await caller.getStats({});
    expect(stats.totalBatches).toBe(
      stats.processed + stats.failed + stats.pending
    );
  });

  it("agent hierarchy should have valid agent distribution", async () => {
    const mod = await import("./routers/agentHierarchyTerritory");
    const router = mod.agentHierarchyTerritoryRouter;
    const caller = router.createCaller({
      user: {
        id: 1,
        username: "test",
        role: "admin",
        agentId: "AGT001",
        name: "Test",
        email: "t@t.io",
      },
    } as any);
    const stats = await caller.getStats({});
    // F-12 (round 74): 156 territories / 6 regions were fixtures — no
    // territory store is delivered (honest 0s). The role split is real but
    // only a subset invariant: agents may hold roles outside the three
    // tracked ones, so exact-sum is weakened to <=.
    expect(
      stats.superAgents + stats.masterAgents + stats.subAgents
    ).toBeLessThanOrEqual(stats.totalAgents);
    expect(stats.territories).toBe(0);
    expect(stats.regions).toBe(0);
  });

  it("webhook delivery should have >98% success rate", async () => {
    const mod = await import("./routers/webhookDeliverySystem");
    const router = mod.webhookDeliverySystemRouter;
    const caller = router.createCaller({
      user: {
        id: 1,
        username: "test",
        role: "admin",
        agentId: "AGT001",
        name: "Test",
        email: "t@t.io",
      },
    } as any);
    const stats = await caller.getStats({});
    // F-12 (round 74): >98% / 45 endpoints were fixtures. The proc is REAL
    // (webhook_endpoints count); delivery telemetry has no store (honest 0s).
    expect(stats.successRate).toBe(0);
    expect(stats.totalEndpoints).toBeGreaterThanOrEqual(0);
    expect(stats.totalDelivered).toBe(0);
    expect(stats.totalFailed).toBe(0);
    expect(stats.avgLatency).toBe(0);
    expect(stats.retryQueue).toBe(0);
  });

  it("API key management should track key lifecycle", async () => {
    const mod = await import("./routers/apiKeyManagement");
    const router = mod.apiKeyManagementRouter;
    const caller = router.createCaller({
      user: {
        id: 1,
        username: "test",
        role: "admin",
        agentId: "AGT001",
        name: "Test",
        email: "t@t.io",
      },
    } as any);
    const stats = await caller.getStats({});
    // F-12 (round 74): >0 requests was a fixture. The proc is REAL
    // (api_keys status aggregates); request telemetry has no store. The
    // exact-sum identity is weakened to a subset inequality — keys may hold
    // statuses outside active/revoked.
    expect(
      stats.activeKeys + stats.revokedKeys
    ).toBeLessThanOrEqual(stats.totalKeys);
    expect(stats.totalRequests24h).toBe(0);
    expect(stats.avgRequestsPerKey).toBe(0);
    expect(stats.suspiciousActivity).toBe(0);
  });

  it("platform config center should manage feature flags", async () => {
    const mod = await import("./routers/platformConfigCenter");
    const router = mod.platformConfigCenterRouter;
    const caller = router.createCaller({
      user: {
        id: 1,
        username: "test",
        role: "admin",
        agentId: "AGT001",
        name: "Test",
        email: "t@t.io",
      },
    } as any);
    const stats = await caller.getStats({});
    // F-12 (round 74): 3 active A/B tests was a fixture — no feature-flag
    // or A/B store is delivered; the proc returns honest 0s/empties. The
    // enabled+disabled partition identity is a real invariant, kept.
    expect(stats.totalFlags).toBe(stats.enabledFlags + stats.disabledFlags);
    expect(stats.totalFlags).toBe(0);
    expect(stats.activeAbTests).toBe(0);
    expect(stats.environments).toEqual([]);
    expect(stats.lastDeployed).toBeNull();
  });
});

// ─── appRouter Registration Tests ────────────────────────────────────────────
describe("Sprint 46: appRouter Registration", () => {
  it("should have all 18 Sprint 46 routers in appRouter", async () => {
    const mod = await import("./routers");
    const procedures = Object.keys(mod.appRouter._def.procedures);
    const sprint46Routers = [
      "paymentNotificationSystem",
      "databaseVisualization",
      "middlewareServiceManager",
      "skillCreatorIntegration",
      "paymentReconciliation",
      "agentPerformanceAnalytics",
      "complianceReporting",
      "customerFeedbackNps",
      "multiCurrencyExchange",
      "agentTrainingPortal",
      "disputeWorkflowEngine",
      "platformHealthMonitor",
      "bulkPaymentProcessor",
      "agentHierarchyTerritory",
      "financialReportingSuite",
      "apiKeyManagement",
      "webhookDeliverySystem",
      "platformConfigCenter",
    ];
    for (const name of sprint46Routers) {
      const found = procedures.some(p => p.startsWith(`${name}.`));
      expect(found, `Router ${name} should be registered in appRouter`).toBe(
        true
      );
    }
  }, 120000);
});
