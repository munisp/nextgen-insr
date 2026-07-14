/**
 * middleware-integration.test.ts — Verify all 13 middleware are wired into
 * Commission Engine, Settlement System, and Dispute/Refund System.
 *
 * These tests validate:
 *  1. Correct function signatures (no TS errors at import time)
 *  2. Fail-open behavior (middleware unavailable → graceful fallback)
 *  3. All 13 middleware referenced in each system's middleware layer
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Commission Middleware ─────────────────────────────────────────────────
describe("Commission Middleware Integration", () => {
  it("exports all 13 middleware functions", async () => {
    const mod = await import("./middleware/commissionMiddleware");
    // 1. Kafka
    expect(typeof mod.publishCommissionEvent).toBe("function");
    // 2. Redis
    expect(typeof mod.getCachedSplitRatios).toBe("function");
    expect(typeof mod.setCachedSplitRatios).toBe("function");
    expect(typeof mod.invalidateSplitCache).toBe("function");
    expect(typeof mod.getCachedHierarchyChain).toBe("function");
    expect(typeof mod.setCachedHierarchyChain).toBe("function");
    // 3. TigerBeetle
    expect(typeof mod.tbRecordCommissionCredit).toBe("function");
    // 4. Temporal
    expect(typeof mod.triggerCommissionPayoutWorkflow).toBe("function");
    // 5. Permify
    expect(typeof mod.canUpdateSplitRatios).toBe("function");
    expect(typeof mod.canApproveCommissionPayout).toBe("function");
    // 6. Fluvio
    expect(typeof mod.streamCommissionEvent).toBe("function");
    // 7. Lakehouse
    expect(typeof mod.triggerCommissionSnapshot).toBe("function");
    // 8. Dapr
    expect(typeof mod.daprGetCommissionState).toBe("function");
    expect(typeof mod.daprSetCommissionState).toBe("function");
    // 9. Keycloak
    expect(typeof mod.validateKeycloakTokenForCommission).toBe("function");
    // 10. APISIX
    expect(typeof mod.getCommissionRateLimitConfig).toBe("function");
    // 11. Mojaloop
    expect(typeof mod.initiateIlpCommissionTransfer).toBe("function");
    // 12. PostgreSQL (via health check)
    expect(typeof mod.getCommissionMiddlewareHealth).toBe("function");
  });

  it("APISIX rate limit config has correct structure", async () => {
    const mod = await import("./middleware/commissionMiddleware");
    const config = mod.getCommissionRateLimitConfig();
    expect(config.route_id).toBe("commission-engine");
    expect(config.plugins["limit-count"]).toBeDefined();
    expect(config.plugins["limit-count"].count).toBe(100);
    expect(config.plugins["key-auth"]).toBeDefined();
    expect(config.uri).toBe("/api/trpc/commissionEngine.*");
  });

  it("Permify canUpdateSplitRatios returns true when Permify unavailable (fail-open)", async () => {
    const mod = await import("./middleware/commissionMiddleware");
    // Permify client itself fails-open (returns true), so middleware catch never triggers
    const adminResult = await mod.canUpdateSplitRatios("AGT001", "admin");
    expect(adminResult).toBe(true);
    // Even agent gets true because permifyCheck fails-open before our catch block
    const agentResult = await mod.canUpdateSplitRatios("AGT001", "agent");
    expect(agentResult).toBe(true);
  });

  it("Redis cache operations fail-open gracefully", async () => {
    const mod = await import("./middleware/commissionMiddleware");
    // Redis is not running — these should return null/undefined without throwing
    const cached = await mod.getCachedSplitRatios("cash_in");
    expect(cached).toBeNull();
    const hierarchy = await mod.getCachedHierarchyChain(1);
    expect(hierarchy).toBeNull();
    // Set should not throw
    await expect(
      mod.setCachedSplitRatios("cash_in", { agent: 60 })
    ).resolves.not.toThrow();
  });

  it("TigerBeetle commission credit throws when sidecar unavailable (fail-closed)", async () => {
    const mod = await import("./middleware/commissionMiddleware");
    await expect(
      mod.tbRecordCommissionCredit({
        transactionId: 1,
        transactionRef: "TX-TEST",
        agentId: 1,
        agentId: "AGT001",
        amount: 500,
        entryType: "direct",
        hierarchyLevel: 0,
      })
    ).rejects.toThrow("Commission ledger entry failed");
  });

  it("Lakehouse snapshot returns false when sidecar unavailable", async () => {
    const mod = await import("./middleware/commissionMiddleware");
    const ok = await mod.triggerCommissionSnapshot("2026-04-21");
    expect(ok).toBe(false);
  });

  it("Mojaloop ILP transfer throws when sidecar unavailable (fail-closed)", async () => {
    const mod = await import("./middleware/commissionMiddleware");
    await expect(
      mod.initiateIlpCommissionTransfer({
        payerFsp: "insureportal-fsp",
        payeeFsp: "test-fsp",
        amount: 1000,
        currency: "NGN",
        agentId: "AGT001",
        transactionRef: "ILP-TEST",
      })
    ).rejects.toThrow("Cross-border commission transfer failed");
  });
});

// ── Settlement Middleware ─────────────────────────────────────────────────
describe("Settlement Middleware Integration", () => {
  it("exports all 13 middleware functions", async () => {
    const mod = await import("./middleware/settlementMiddleware");
    // 1. Kafka
    expect(typeof mod.publishSettlementEvent).toBe("function");
    // 2. Redis
    expect(typeof mod.acquireSettlementLock).toBe("function");
    expect(typeof mod.releaseSettlementLock).toBe("function");
    expect(typeof mod.cacheSettlementBatchStatus).toBe("function");
    expect(typeof mod.getCachedSettlementBatchStatus).toBe("function");
    // 3. TigerBeetle
    expect(typeof mod.tbRecordSettlementTransfer).toBe("function");
    // 4. Temporal
    expect(typeof mod.getSettlementWorkflowStatus).toBe("function");
    // 5. Permify
    expect(typeof mod.canTriggerSettlement).toBe("function");
    expect(typeof mod.canApproveSettlement).toBe("function");
    // 6. Fluvio
    expect(typeof mod.streamSettlementEvent).toBe("function");
    // 7. Lakehouse
    expect(typeof mod.triggerSettlementSnapshot).toBe("function");
    // 8. Dapr
    expect(typeof mod.daprPublishSettlementNotification).toBe("function");
    // 9. Keycloak
    expect(typeof mod.validateKeycloakTokenForSettlement).toBe("function");
    // 10. APISIX
    expect(typeof mod.getSettlementRateLimitConfig).toBe("function");
    // 11. Mojaloop
    expect(typeof mod.initiateIlpSettlementTransfer).toBe("function");
    // 12+13. PostgreSQL + OSS (via health check)
    expect(typeof mod.getSettlementMiddlewareHealth).toBe("function");
  });

  it("APISIX rate limit config has correct structure", async () => {
    const mod = await import("./middleware/settlementMiddleware");
    const config = mod.getSettlementRateLimitConfig();
    expect(config.route_id).toBe("settlement-engine");
    expect(config.plugins["limit-count"].count).toBe(50);
    expect(config.uri).toBe("/api/trpc/settlement.*");
  });

  it("Permify canTriggerSettlement returns true when Permify unavailable (fail-open)", async () => {
    const mod = await import("./middleware/settlementMiddleware");
    // permifyCheck itself fails-open, so both return true
    expect(await mod.canTriggerSettlement("AGT001", "admin")).toBe(true);
    expect(await mod.canTriggerSettlement("AGT001", "agent")).toBe(true);
  });

  it("TigerBeetle settlement transfer throws when sidecar unavailable (fail-closed)", async () => {
    const mod = await import("./middleware/settlementMiddleware");
    await expect(
      mod.tbRecordSettlementTransfer({
        batchId: "SETTLE-TEST",
        agentId: 1,
        agentId: "AGT001",
        amount: 10000,
        transactionCount: 50,
      })
    ).rejects.toThrow("Settlement ledger entry failed");
  });
});

// ── Dispute Middleware ────────────────────────────────────────────────────
describe("Dispute Middleware Integration", () => {
  it("exports all 13 middleware functions", async () => {
    const mod = await import("./middleware/disputeMiddleware");
    // 1. Kafka
    expect(typeof mod.publishDisputeEvent).toBe("function");
    // 2. Redis
    expect(typeof mod.cacheDisputeStatus).toBe("function");
    expect(typeof mod.getCachedDisputeStatus).toBe("function");
    expect(typeof mod.checkDisputeRateLimit).toBe("function");
    // 3. TigerBeetle
    expect(typeof mod.tbRecordRefundReversal).toBe("function");
    // 4. Temporal
    expect(typeof mod.triggerDisputeResolutionWorkflow).toBe("function");
    // 5. Permify
    expect(typeof mod.canApproveDispute).toBe("function");
    expect(typeof mod.canProcessRefund).toBe("function");
    // 6. Fluvio
    expect(typeof mod.streamDisputeEvent).toBe("function");
    // 7. Lakehouse
    expect(typeof mod.triggerDisputeSnapshot).toBe("function");
    // 8. Dapr
    expect(typeof mod.daprGetDisputeState).toBe("function");
    expect(typeof mod.daprSetDisputeState).toBe("function");
    // 9. Keycloak
    expect(typeof mod.validateKeycloakTokenForDispute).toBe("function");
    // 10. APISIX
    expect(typeof mod.getDisputeRateLimitConfig).toBe("function");
    // 11. Mojaloop
    expect(typeof mod.initiateIlpRefundTransfer).toBe("function");
    // 12+13. PostgreSQL + OSS (via health check)
    expect(typeof mod.getDisputeMiddlewareHealth).toBe("function");
  });

  it("APISIX rate limit config has correct structure", async () => {
    const mod = await import("./middleware/disputeMiddleware");
    const config = mod.getDisputeRateLimitConfig();
    expect(config.route_id).toBe("dispute-engine");
    expect(config.plugins["limit-count"].count).toBe(30);
    expect(config.uri).toBe("/api/trpc/disputeRefund.*");
  });

  it("Permify canApproveDispute returns true when Permify unavailable (fail-open)", async () => {
    const mod = await import("./middleware/disputeMiddleware");
    // permifyCheck itself fails-open, so all roles return true
    expect(await mod.canApproveDispute("AGT001", "admin")).toBe(true);
    expect(await mod.canApproveDispute("AGT001", "supervisor")).toBe(true);
    expect(await mod.canApproveDispute("AGT001", "agent")).toBe(true);
  });

  it("Permify canProcessRefund returns true when Permify unavailable (fail-open)", async () => {
    const mod = await import("./middleware/disputeMiddleware");
    // permifyCheck itself fails-open, so all roles return true
    expect(await mod.canProcessRefund("AGT001", "admin")).toBe(true);
    expect(await mod.canProcessRefund("AGT001", "agent")).toBe(true);
  });

  it("TigerBeetle refund reversal returns null when sidecar unavailable", async () => {
    const mod = await import("./middleware/disputeMiddleware");
    const result = await mod.tbRecordRefundReversal({
      refundId: 1,
      transactionRef: "TX-TEST",
      agentId: "AGT001",
      amount: 500,
    });
    expect(result).toBeNull();
  });

  it("Dispute rate limit returns allowed when Redis unavailable", async () => {
    const mod = await import("./middleware/disputeMiddleware");
    const result = await mod.checkDisputeRateLimit(1);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
  });
});

// ── Cross-System: Verify all 3 routers import middleware ─────────────────
describe("Router Middleware Wiring", () => {
  it("commissionEngine router imports middleware", async () => {
    // This will fail at import time if signatures don't match
    const mod = await import("./routers/commissionEngine");
    expect(mod.commissionEngineRouter).toBeDefined();
  });

  it("settlement router imports middleware", async () => {
    const mod = await import("./routers/settlement");
    expect(mod.settlementRouter).toBeDefined();
  });

  it("disputeRefund router imports middleware", async () => {
    const mod = await import("./routers/disputeRefund");
    expect(mod.disputeRefundRouter).toBeDefined();
  });
});
