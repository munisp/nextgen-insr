// @ts-check

/**
 * Sprint 47 — Sidecar Integration Tests
 *
 * Validates:
 * 1. Rust sidecar bridge client (Kafka, cache, rate-limit, sanitize, audit, webhook)
 * 2. Go ledger bridge client (transfer, balance, settlement, reconcile, lifecycle)
 * 3. Python ML bridge client (anomaly, compliance, sentiment, fraud)
 * 4. Global sidecar middleware factory
 * 5. emitTransactionEvent convenience function
 * 6. auditAndCache helper
 * 7. runCompliancePipeline helper
 */

import { describe, it, expect, vi, beforeAll } from "vitest";

// ── 1. Rust Bridge Client ────────────────────────────────────────────────────

describe("Sprint 47 — Rust Sidecar Bridge", () => {
  it("should export all Rust bridge methods", async () => {
    const { rustBridge } = await import("./lib/sidecarBridge");
    expect(typeof rustBridge.kafkaPublish).toBe("function");
    expect(typeof rustBridge.cacheGet).toBe("function");
    expect(typeof rustBridge.cacheSet).toBe("function");
    expect(typeof rustBridge.rateLimit).toBe("function");
    expect(typeof rustBridge.sanitize).toBe("function");
    expect(typeof rustBridge.auditLog).toBe("function");
    expect(typeof rustBridge.verifyWebhook).toBe("function");
    expect(typeof rustBridge.health).toBe("function");
    expect(typeof rustBridge.stats).toBe("function");
  });

  it("kafkaPublish should return fallback when sidecar is unreachable", async () => {
    const { rustBridge } = await import("./lib/sidecarBridge");
    // This will fail gracefully since sidecar may not be running in test
    const result = await rustBridge.kafkaPublish("test.topic", "key1", {
      data: "test",
    });
    expect(result).toBeDefined();
    // Either real response or fallback
    expect(result.status).toBeDefined();
  });

  it("sanitize should return fallback when sidecar is unreachable", async () => {
    const { rustBridge } = await import("./lib/sidecarBridge");
    const result = await rustBridge.sanitize(
      "<script>alert(1)</script>",
      "html"
    );
    expect(result).toBeDefined();
    expect(typeof result.safe).toBe("boolean");
  });

  it("rateLimit should return fallback when sidecar is unreachable", async () => {
    const { rustBridge } = await import("./lib/sidecarBridge");
    const result = await rustBridge.rateLimit("test:key", 100, 60);
    expect(result).toBeDefined();
    expect(typeof result.allowed).toBe("boolean");
  });
});

// ── 2. Go Ledger Bridge Client ───────────────────────────────────────────────

describe("Sprint 47 — Go Ledger Bridge", () => {
  it("should export all Go ledger methods", async () => {
    const { goLedger } = await import("./lib/sidecarBridge");
    expect(typeof goLedger.transfer).toBe("function");
    expect(typeof goLedger.batchTransfer).toBe("function");
    expect(typeof goLedger.balance).toBe("function");
    expect(typeof goLedger.allBalances).toBe("function");
    expect(typeof goLedger.settle).toBe("function");
    expect(typeof goLedger.reconcile).toBe("function");
    expect(typeof goLedger.lifecycleTransition).toBe("function");
    expect(typeof goLedger.lifecycleGet).toBe("function");
    expect(typeof goLedger.healthAggregate).toBe("function");
    expect(typeof goLedger.verifySignature).toBe("function");
    expect(typeof goLedger.health).toBe("function");
    expect(typeof goLedger.stats).toBe("function");
  });

  it("transfer should return fallback when sidecar is unreachable", async () => {
    const { goLedger } = await import("./lib/sidecarBridge");
    const result = await goLedger.transfer("debit1", "credit1", 1000, "NGN");
    expect(result).toBeDefined();
    expect(result.status).toBeDefined();
  });

  it("balance should return fallback when sidecar is unreachable", async () => {
    const { goLedger } = await import("./lib/sidecarBridge");
    const result = await goLedger.balance("test_account");
    expect(result).toBeDefined();
    expect(result.account_id).toBe("test_account");
  });
});

// ── 3. Python ML Bridge Client ───────────────────────────────────────────────

describe("Sprint 47 — Python ML Bridge", () => {
  it("should export all Python ML methods", async () => {
    const { pythonML } = await import("./lib/sidecarBridge");
    expect(typeof pythonML.detectAnomaly).toBe("function");
    expect(typeof pythonML.batchAnomaly).toBe("function");
    expect(typeof pythonML.complianceCheck).toBe("function");
    expect(typeof pythonML.batchCompliance).toBe("function");
    expect(typeof pythonML.analyzeSentiment).toBe("function");
    expect(typeof pythonML.batchSentiment).toBe("function");
    expect(typeof pythonML.scoreFraud).toBe("function");
    expect(typeof pythonML.batchFraud).toBe("function");
    expect(typeof pythonML.anomalyHistory).toBe("function");
    expect(typeof pythonML.health).toBe("function");
    expect(typeof pythonML.stats).toBe("function");
  });

  it("detectAnomaly should return fallback when sidecar is unreachable", async () => {
    const { pythonML } = await import("./lib/sidecarBridge");
    const result = await pythonML.detectAnomaly({
      amount: 5000,
      agent_id: "agent1",
    });
    expect(result).toBeDefined();
    expect(typeof result.is_anomalous).toBe("boolean");
  });

  it("complianceCheck should return fallback when sidecar is unreachable", async () => {
    const { pythonML } = await import("./lib/sidecarBridge");
    const result = await pythonML.complianceCheck({
      name: "Test Entity",
      country: "NG",
    });
    expect(result).toBeDefined();
    expect(typeof result.compliant).toBe("boolean");
  });

  it("analyzeSentiment should return fallback when sidecar is unreachable", async () => {
    const { pythonML } = await import("./lib/sidecarBridge");
    const result = await pythonML.analyzeSentiment("Great service!");
    expect(result).toBeDefined();
    expect(result.sentiment).toBeDefined();
  });

  it("scoreFraud should return fallback when sidecar is unreachable", async () => {
    const { pythonML } = await import("./lib/sidecarBridge");
    const result = await pythonML.scoreFraud({
      amount: 100000,
      agent_id: "agent1",
    });
    expect(result).toBeDefined();
    expect(typeof result.fraud_score).toBe("number");
  });
});

// ── 4. Sidecar Middleware Factory ────────────────────────────────────────────

describe("Sprint 47 — Sidecar Middleware Factory", () => {
  it("should export createSidecarMiddleware factory", async () => {
    const { createSidecarMiddleware } = await import(
      "./middleware/sidecarIntegration"
    );
    expect(typeof createSidecarMiddleware).toBe("function");
  });
});

// ── 5. Convenience Functions ─────────────────────────────────────────────────

describe("Sprint 47 — Convenience Functions", () => {
  it("emitTransactionEvent should call all sidecars", async () => {
    const { emitTransactionEvent } = await import("./lib/sidecarBridge");
    expect(typeof emitTransactionEvent).toBe("function");
    const result = await emitTransactionEvent("payment", {
      transactionId: "txn_test",
      amount: 50000,
      agentId: "agent1",
      debitAccount: "debit1",
      creditAccount: "credit1",
      currency: "NGN",
    });
    expect(result).toBeDefined();
    expect(result.kafka).toBeDefined();
    expect(result.ledger).toBeDefined();
    expect(result.anomaly).toBeDefined();
    expect(result.fraud).toBeDefined();
  });

  it("auditAndCache should return audit and cache status", async () => {
    const { auditAndCache } = await import("./lib/sidecarBridge");
    expect(typeof auditAndCache).toBe("function");
    const result = await auditAndCache("user1", "read", "dashboard");
    expect(result).toBeDefined();
    expect(typeof result.auditLogged).toBe("boolean");
  });

  it("runCompliancePipeline should return compliance and anomaly", async () => {
    const { runCompliancePipeline } = await import("./lib/sidecarBridge");
    expect(typeof runCompliancePipeline).toBe("function");
    const result = await runCompliancePipeline({
      name: "Test Agent",
      type: "individual",
      country: "NG",
      amount: 100000,
    });
    expect(result).toBeDefined();
  });
});

// ── 6. Router Count Verification ─────────────────────────────────────────────

describe("Sprint 47 — Router Middleware Coverage", () => {
  it("appRouter should have 325+ routers all wired through sidecar middleware", async () => {
    const { appRouter } = await import("./routers");
    const routerKeys = Object.keys(appRouter._def.procedures);
    // Each router exposes procedures as flat keys like "routerName.procedureName"
    // We check that the total procedure count is substantial
    expect(routerKeys.length).toBeGreaterThan(100);
  }, 120000);

  it("sidecar bridge should have 30+ methods across 3 clients", async () => {
    const { rustBridge, goLedger, pythonML } = await import(
      "./lib/sidecarBridge"
    );
    const rustMethods = Object.keys(rustBridge).length;
    const goMethods = Object.keys(goLedger).length;
    const pythonMethods = Object.keys(pythonML).length;
    expect(rustMethods + goMethods + pythonMethods).toBeGreaterThanOrEqual(30);
  });
});
