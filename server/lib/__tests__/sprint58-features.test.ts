// @ts-check

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 1. Socket.IO Settlement Namespace Wiring ────────────────────────────────

describe("Socket.IO Settlement Namespace", () => {
  it("should export initSocketIO function from socket.ts", async () => {
    const socketModule = await import("../../socket");
    expect(typeof socketModule.initSocketIO).toBe("function");
  });

  it("should export getIO/setIO from socketSingleton", async () => {
    const mod = await import("../../socketSingleton");
    expect(typeof mod.getIO).toBe("function");
    expect(typeof mod.setIO).toBe("function");
  });
});

// ─── 2. Batch Progress Reporter ──────────────────────────────────────────────

describe("Batch Progress Reporter", () => {
  it("should export startBatchProgress", async () => {
    const mod = await import("../batchProgressReporter");
    expect(typeof mod.startBatchProgress).toBe("function");
  });

  it("should export reportProgress", async () => {
    const mod = await import("../batchProgressReporter");
    expect(typeof mod.reportProgress).toBe("function");
  });

  it("should export completeBatchProgress", async () => {
    const mod = await import("../batchProgressReporter");
    expect(typeof mod.completeBatchProgress).toBe("function");
  });

  it("should export failBatchProgress", async () => {
    const mod = await import("../batchProgressReporter");
    expect(typeof mod.failBatchProgress).toBe("function");
  });

  it("should export getBatchProgress and getAllBatchProgress", async () => {
    const mod = await import("../batchProgressReporter");
    expect(typeof mod.getBatchProgress).toBe("function");
    expect(typeof mod.getAllBatchProgress).toBe("function");
  });

  it("should export createSocketIOProgressHandler", async () => {
    const mod = await import("../batchProgressReporter");
    expect(typeof mod.createSocketIOProgressHandler).toBe("function");
  });

  it("should start tracking a batch and report progress", async () => {
    const { startBatchProgress, reportProgress, completeBatchProgress } =
      await import("../batchProgressReporter");

    const progressEvents: any[] = [];
    const tracker = await startBatchProgress("test-s58-001", 100, event => {
      progressEvents.push(event);
    });

    expect(tracker.batchId).toBe("test-s58-001");
    expect(tracker.total).toBe(100);
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
    expect(progressEvents[0].type).toBe("batch.started");

    // reportProgress returns null unless at report interval boundary
    // Report enough to hit the total (which always triggers an event)
    reportProgress("test-s58-001", 99);
    const progressEvent = reportProgress("test-s58-001", 1); // hits total=100
    // Even if individual reports return null, the callback captures events
    expect(progressEvents.length).toBeGreaterThanOrEqual(2);

    const completeEvent = completeBatchProgress("test-s58-001");
    expect(completeEvent).toBeDefined();
    expect(completeEvent!.type).toBe("batch.completed");
  });

  it("should report failure", async () => {
    const { startBatchProgress, failBatchProgress } = await import(
      "../batchProgressReporter"
    );

    await startBatchProgress("test-s58-fail", 100);
    const failEvent = failBatchProgress("test-s58-fail", "Simulated error");
    expect(failEvent).toBeDefined();
    expect(failEvent!.type).toBe("batch.failed");
  });
});

// ─── 3. Archival Admin Router ────────────────────────────────────────────────

describe("Archival Admin Router", () => {
  it("should export archivalAdminRouter", async () => {
    const mod = await import("../../routers/archivalAdmin");
    expect(mod.archivalAdminRouter).toBeDefined();
  });

  it("should have getStats procedure", async () => {
    const mod = await import("../../routers/archivalAdmin");
    expect(mod.archivalAdminRouter._def.procedures.getStats).toBeDefined();
  });

  it("should have triggerArchival procedure", async () => {
    const mod = await import("../../routers/archivalAdmin");
    expect(
      mod.archivalAdminRouter._def.procedures.triggerArchival
    ).toBeDefined();
  });

  it("should have updateSchedule procedure", async () => {
    const mod = await import("../../routers/archivalAdmin");
    expect(
      mod.archivalAdminRouter._def.procedures.updateSchedule
    ).toBeDefined();
  });

  it("should have getHistory procedure", async () => {
    const mod = await import("../../routers/archivalAdmin");
    expect(mod.archivalAdminRouter._def.procedures.getHistory).toBeDefined();
  });
});

// ─── 4. Load Test Metrics Router ─────────────────────────────────────────────

describe("Load Test Metrics Router", () => {
  it("should export loadTestMetricsRouter", async () => {
    const mod = await import("../../routers/loadTestMetrics");
    expect(mod.loadTestMetricsRouter).toBeDefined();
  });

  it("should have listRuns procedure", async () => {
    const mod = await import("../../routers/loadTestMetrics");
    expect(mod.loadTestMetricsRouter._def.procedures.listRuns).toBeDefined();
  });

  it("should have getRunDetails procedure", async () => {
    const mod = await import("../../routers/loadTestMetrics");
    expect(
      mod.loadTestMetricsRouter._def.procedures.getRunDetails
    ).toBeDefined();
  });

  it("should have getEngineMetrics procedure", async () => {
    const mod = await import("../../routers/loadTestMetrics");
    expect(
      mod.loadTestMetricsRouter._def.procedures.getEngineMetrics
    ).toBeDefined();
  });

  it("should have getPrometheusMetrics procedure", async () => {
    const mod = await import("../../routers/loadTestMetrics");
    expect(
      mod.loadTestMetricsRouter._def.procedures.getPrometheusMetrics
    ).toBeDefined();
  });

  it("should have recordRun procedure", async () => {
    const mod = await import("../../routers/loadTestMetrics");
    expect(mod.loadTestMetricsRouter._def.procedures.recordRun).toBeDefined();
  });
});

// ─── 5. Runtime Config ───────────────────────────────────────────────────────

describe("Runtime Config", () => {
  it("should export getConfig and setConfig", async () => {
    const mod = await import("../runtimeConfig");
    expect(typeof mod.getConfig).toBe("function");
    expect(typeof mod.setConfig).toBe("function");
  });

  it("should export getConfigNumber helper", async () => {
    const mod = await import("../runtimeConfig");
    expect(typeof mod.getConfigNumber).toBe("function");
  });

  it("should export getAllConfig", async () => {
    const mod = await import("../runtimeConfig");
    expect(typeof mod.getAllConfig).toBe("function");
  });

  it("should return 0 for non-existent numeric keys (coerces NaN to 0)", async () => {
    const { getConfigNumber } = await import("../runtimeConfig");
    // getConfigNumber returns 0 for NaN/blank per implementation
    const val = await getConfigNumber("nonexistent_key_sprint58_test");
    expect(val).toBe(0);
  });
});

// ─── 6. Observability Module ─────────────────────────────────────────────────

describe("Observability Module", () => {
  it("should export startSpan", async () => {
    const mod = await import("../observability");
    expect(typeof mod.startSpan).toBe("function");
  });

  it("should export endSpan", async () => {
    const mod = await import("../observability");
    expect(typeof mod.endSpan).toBe("function");
  });

  it("should export withSpan", async () => {
    const mod = await import("../observability");
    expect(typeof mod.withSpan).toBe("function");
  });

  it("should export getAllEngineMetrics", async () => {
    const mod = await import("../observability");
    expect(typeof mod.getAllEngineMetrics).toBe("function");
  });

  it("should export exportPrometheusMetrics", async () => {
    const mod = await import("../observability");
    expect(typeof mod.exportPrometheusMetrics).toBe("function");
  });

  it("should export engine tracers", async () => {
    const mod = await import("../observability");
    expect(mod.settlementTracer).toBeDefined();
    expect(mod.disputeTracer).toBeDefined();
    expect(mod.commissionTracer).toBeDefined();
  });

  it("should start and end spans correctly", async () => {
    const { startSpan, endSpan, getAllEngineMetrics, resetMetrics } =
      await import("../observability");

    // Reset to get clean state
    resetMetrics();

    // startSpan returns a SpanContext object, not a string
    const span = startSpan("test_engine_s58", "test_operation");
    expect(span).toBeDefined();
    expect(span.spanId).toBeDefined();
    expect(typeof span.spanId).toBe("string");
    expect(span.operationName).toBe("test_operation");

    const endedSpan = endSpan(span.spanId, "ok");
    expect(endedSpan).toBeDefined();
    expect(endedSpan!.status).toBe("ok");

    // Check metrics were recorded
    const metrics = getAllEngineMetrics();
    expect(metrics["test_engine_s58"]).toBeDefined();
    expect(metrics["test_engine_s58"].totalOperations).toBeGreaterThanOrEqual(
      1
    );
  });

  it("should export Prometheus-format metrics after recording spans", async () => {
    const { startSpan, endSpan, exportPrometheusMetrics } = await import(
      "../observability"
    );

    // Record a span so there are metrics to export
    const span = startSpan("prom_test_engine", "prom_test_op");
    endSpan(span.spanId, "ok");

    const output = exportPrometheusMetrics();
    expect(typeof output).toBe("string");
    expect(output).toContain("operations_total");
  });
});

// ─── 7. Bulk Insert Module ───────────────────────────────────────────────────

describe("Bulk Insert Module", () => {
  it("should export bulkInsertValues", async () => {
    const mod = await import("../bulkInsert");
    expect(typeof mod.bulkInsertValues).toBe("function");
  });

  it("should export bulkInsertCopy", async () => {
    const mod = await import("../bulkInsert");
    expect(typeof mod.bulkInsertCopy).toBe("function");
  });

  it("should export bulkInsertSettlements", async () => {
    const mod = await import("../bulkInsert");
    expect(typeof mod.bulkInsertSettlements).toBe("function");
  });

  it("should export benchmarkBulkInsert", async () => {
    const mod = await import("../bulkInsert");
    expect(typeof mod.benchmarkBulkInsert).toBe("function");
  });
});

// ─── 8. Parquet Archival Module ──────────────────────────────────────────────

describe("Parquet Archival Module", () => {
  it("should export archiveSettlements", async () => {
    const mod = await import("../parquetArchival");
    expect(typeof mod.archiveSettlements).toBe("function");
  });

  it("should export archiveReconciliationBatches", async () => {
    const mod = await import("../parquetArchival");
    expect(typeof mod.archiveReconciliationBatches).toBe("function");
  });

  it("should export runArchivalJob", async () => {
    const mod = await import("../parquetArchival");
    expect(typeof mod.runArchivalJob).toBe("function");
  });

  it("should export getArchivalStats", async () => {
    const mod = await import("../parquetArchival");
    expect(typeof mod.getArchivalStats).toBe("function");
  });
});
