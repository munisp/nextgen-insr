// @ts-check

/**
 * metrics.test.ts
 * Tests for the Prometheus metrics registry and all exported counters/histograms.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Registry, Counter, Histogram } from "prom-client";

// ── Import the registry and all metrics ──────────────────────────────────────
import {
  registry,
  transactionsTotal,
  transactionErrorsTotal,
  floatLocksTotal,
  disputesRaisedTotal,
  floatTopupRequestsTotal,
  platformCallsTotal,
  fraudAlertsTotal,
  transactionDurationMs,
  platformCallDurationMs,
  httpRequestDurationMs,
} from "./metrics";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract the current value of a counter by label set. */
async function getCounterValue(
  counter: Counter,
  labels: Record<string, string> = {}
): Promise<number> {
  const metrics = await counter.get();
  const match = metrics.values.find(v =>
    Object.entries(labels).every(([k, val]) => v.labels[k] === val)
  );
  return match?.value ?? 0;
}

/** Extract the sum of a histogram by label set. */
async function getHistogramSum(
  histogram: Histogram,
  labels: Record<string, string> = {}
): Promise<number> {
  const metrics = await histogram.get();
  const match = metrics.values.find(
    v =>
      v.metricName?.endsWith("_sum") &&
      Object.entries(labels).every(([k, val]) => v.labels[k] === val)
  );
  return match?.value ?? 0;
}

// ── Registry tests ────────────────────────────────────────────────────────────

describe("Prometheus registry", () => {
  it("is a valid prom-client Registry instance", () => {
    expect(registry).toBeInstanceOf(Registry);
  });

  it("exports metrics in Prometheus text format", async () => {
    const output = await registry.metrics();
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
    // Must contain at least one HELP line
    expect(output).toMatch(/^# HELP /m);
    // Must contain at least one TYPE line
    expect(output).toMatch(/^# TYPE /m);
  });

  it("includes default Node.js metrics with pos_node_ prefix", async () => {
    const output = await registry.metrics();
    expect(output).toContain("pos_node_");
  });

  it("contentType is the standard Prometheus text content type", () => {
    expect(registry.contentType).toContain("text/plain");
  });
});

// ── Counter tests ─────────────────────────────────────────────────────────────

describe("transactionsTotal counter", () => {
  it("increments by 1 for a given label set", async () => {
    const before = await getCounterValue(transactionsTotal, {
      type: "Cash In",
      status: "success",
      channel: "Cash",
    });
    transactionsTotal.labels("Cash In", "success", "Cash").inc();
    const after = await getCounterValue(transactionsTotal, {
      type: "Cash In",
      status: "success",
      channel: "Cash",
    });
    expect(after - before).toBe(1);
  });

  it("tracks different transaction types independently", async () => {
    const beforeCashOut = await getCounterValue(transactionsTotal, {
      type: "Cash Out",
      status: "success",
      channel: "Cash",
    });
    transactionsTotal.labels("Cash Out", "success", "Cash").inc();
    const afterCashOut = await getCounterValue(transactionsTotal, {
      type: "Cash Out",
      status: "success",
      channel: "Cash",
    });
    expect(afterCashOut - beforeCashOut).toBe(1);
  });
});

describe("transactionErrorsTotal counter", () => {
  it("increments on error with reason label", async () => {
    const before = await getCounterValue(transactionErrorsTotal, {
      type: "Transfer",
      reason: "insufficient_float",
    });
    transactionErrorsTotal.labels("Transfer", "insufficient_float").inc();
    const after = await getCounterValue(transactionErrorsTotal, {
      type: "Transfer",
      reason: "insufficient_float",
    });
    expect(after - before).toBe(1);
  });
});

describe("floatLocksTotal counter", () => {
  it("increments with settlement trigger label", async () => {
    const before = await getCounterValue(floatLocksTotal, {
      trigger: "settlement",
    });
    floatLocksTotal.labels("settlement").inc();
    const after = await getCounterValue(floatLocksTotal, {
      trigger: "settlement",
    });
    expect(after - before).toBe(1);
  });
});

describe("disputesRaisedTotal counter", () => {
  it("increments with dispute type label", async () => {
    const before = await getCounterValue(disputesRaisedTotal, {
      type: "transaction",
    });
    disputesRaisedTotal.labels("transaction").inc();
    const after = await getCounterValue(disputesRaisedTotal, {
      type: "transaction",
    });
    expect(after - before).toBe(1);
  });
});

describe("floatTopupRequestsTotal counter", () => {
  it("increments with submitted status label", async () => {
    const before = await getCounterValue(floatTopupRequestsTotal, {
      status: "submitted",
    });
    floatTopupRequestsTotal.labels("submitted").inc();
    const after = await getCounterValue(floatTopupRequestsTotal, {
      status: "submitted",
    });
    expect(after - before).toBe(1);
  });
});

describe("platformCallsTotal counter", () => {
  it("tracks calls per service and status", async () => {
    const before = await getCounterValue(platformCallsTotal, {
      service: "kyc",
      status: "success",
    });
    platformCallsTotal.labels("kyc", "success").inc();
    const after = await getCounterValue(platformCallsTotal, {
      service: "kyc",
      status: "success",
    });
    expect(after - before).toBe(1);
  });
});

describe("fraudAlertsTotal counter", () => {
  it("increments with severity label", async () => {
    const before = await getCounterValue(fraudAlertsTotal, {
      severity: "high",
    });
    fraudAlertsTotal.labels("high").inc();
    const after = await getCounterValue(fraudAlertsTotal, { severity: "high" });
    expect(after - before).toBe(1);
  });
});

// ── Histogram tests ───────────────────────────────────────────────────────────

describe("transactionDurationMs histogram", () => {
  it("records observations and increases sum", async () => {
    const before = await getHistogramSum(transactionDurationMs, {
      type: "Cash In",
    });
    transactionDurationMs.labels("Cash In").observe(250);
    const after = await getHistogramSum(transactionDurationMs, {
      type: "Cash In",
    });
    expect(after - before).toBeCloseTo(250, 1);
  });

  it("appears in registry output with correct metric name", async () => {
    const output = await registry.metrics();
    expect(output).toContain("pos_transaction_duration_ms");
  });
});

describe("platformCallDurationMs histogram", () => {
  it("records per-service latency observations", async () => {
    const before = await getHistogramSum(platformCallDurationMs, {
      service: "float",
    });
    platformCallDurationMs.labels("float").observe(120);
    const after = await getHistogramSum(platformCallDurationMs, {
      service: "float",
    });
    expect(after - before).toBeCloseTo(120, 1);
  });
});

describe("httpRequestDurationMs histogram", () => {
  it("records HTTP request durations with method/route/status labels", async () => {
    const before = await getHistogramSum(httpRequestDurationMs, {
      method: "POST",
      route: "/api/trpc/transactions.create",
      status_code: "200",
    });
    httpRequestDurationMs
      .labels("POST", "/api/trpc/transactions.create", "200")
      .observe(85);
    const after = await getHistogramSum(httpRequestDurationMs, {
      method: "POST",
      route: "/api/trpc/transactions.create",
      status_code: "200",
    });
    expect(after - before).toBeCloseTo(85, 1);
  });
});

// ── Registry completeness test ────────────────────────────────────────────────

describe("registry completeness", () => {
  it("contains all expected metric names", async () => {
    const output = await registry.metrics();
    const expectedMetrics = [
      "pos_transactions_total",
      "pos_transaction_errors_total",
      "pos_float_locks_total",
      "pos_disputes_raised_total",
      "pos_float_topup_requests_total",
      "pos_platform_calls_total",
      "pos_fraud_alerts_total",
      "pos_transaction_duration_ms",
      "pos_platform_call_duration_ms",
      "pos_http_request_duration_ms",
    ];
    for (const name of expectedMetrics) {
      expect(output).toContain(name);
    }
  });
});
