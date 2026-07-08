// @ts-check

/**
 * Sprint 60 Tests
 * S60-1: Load test comparison view (compareRuns query)
 * S60-2: P99 threshold notifications for load tests
 * S60-3: Background archival cron worker
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── S60-1: Load Test Comparison View ────────────────────────────────────────

describe("S60-1: Load Test Comparison View", () => {
  const routerSrc = fs.readFileSync(
    path.resolve(__dirname, "../../routers/loadTestMetrics.ts"),
    "utf-8"
  );

  it("loadTestMetrics router has compareRuns query", () => {
    expect(routerSrc).toContain("compareRuns: protectedProcedure");
    expect(routerSrc).toContain(".query(");
  });

  it("compareRuns accepts runIdA and runIdB inputs", () => {
    expect(routerSrc).toContain("runIdA: z.string()");
    expect(routerSrc).toContain("runIdB: z.string()");
  });

  it("comparison includes latency deltas", () => {
    expect(routerSrc).toContain("latency: {");
    expect(routerSrc).toContain("avg: delta(rA.avgLatencyMs, rB.avgLatencyMs)");
    expect(routerSrc).toContain("p50: delta(rA.p50LatencyMs, rB.p50LatencyMs)");
    expect(routerSrc).toContain("p95: delta(rA.p95LatencyMs, rB.p95LatencyMs)");
    expect(routerSrc).toContain("p99: delta(rA.p99LatencyMs, rB.p99LatencyMs)");
  });

  it("comparison includes throughput deltas (higher is better)", () => {
    expect(routerSrc).toContain("throughput: {");
    expect(routerSrc).toContain(
      "actualRps: deltaHigherBetter(rA.actualRps, rB.actualRps)"
    );
    expect(routerSrc).toContain(
      "totalRequests: deltaHigherBetter(rA.totalRequests, rB.totalRequests)"
    );
  });

  it("comparison includes reliability deltas", () => {
    expect(routerSrc).toContain("reliability: {");
    expect(routerSrc).toContain("errorRate: delta(rA.errorRate, rB.errorRate)");
    expect(routerSrc).toContain(
      "failedRequests: delta(rA.failedRequests, rB.failedRequests)"
    );
  });

  it("comparison includes zipf distribution overlay", () => {
    expect(routerSrc).toContain("zipfComparison:");
    expect(routerSrc).toContain("requestsA: dA.requestCount");
    expect(routerSrc).toContain("requestsB: dB?.requestCount");
  });

  it("comparison includes timeline overlay", () => {
    expect(routerSrc).toContain("timelineOverlay:");
    expect(routerSrc).toContain("rpsA: tA.rps");
    expect(routerSrc).toContain("rpsB: tB?.rps");
    expect(routerSrc).toContain("latencyA: tA.avgLatencyMs");
    expect(routerSrc).toContain("latencyB: tB?.avgLatencyMs");
  });

  it("delta function calculates pctChange correctly", () => {
    expect(routerSrc).toContain(
      "pctChange: a !== 0 ? Math.round(((b - a) / a) * 10000) / 100 : 0"
    );
  });

  it("LoadTestComparison page exists with selectors and charts", () => {
    const pageSrc = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../client/src/pages/LoadTestComparison.tsx"
      ),
      "utf-8"
    );
    expect(pageSrc).toContain("LoadTestComparison");
    expect(pageSrc).toContain("Run A (Baseline)");
    expect(pageSrc).toContain("Run B (Candidate)");
    expect(pageSrc).toContain("DualSparkline");
    expect(pageSrc).toContain("OverlayBarChart");
    expect(pageSrc).toContain("DeltaCell");
    expect(pageSrc).toContain("compareRuns");
  });

  it("Comparison page is registered in App.tsx", () => {
    const appSrc = fs.readFileSync(
      path.resolve(__dirname, "../../../client/src/App.tsx"),
      "utf-8"
    );
    expect(appSrc).toContain("LoadTestComparison");
    expect(appSrc).toContain("/load-test-comparison");
  });

  it("Comparison page shows improvement verdict", () => {
    const pageSrc = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../client/src/pages/LoadTestComparison.tsx"
      ),
      "utf-8"
    );
    expect(pageSrc).toContain("Run B is an improvement");
    expect(pageSrc).toContain("Mixed results");
    expect(pageSrc).toContain("Run B is a regression");
  });
});

// ── S60-2: P99 Threshold Notifications ──────────────────────────────────────

describe("S60-2: P99 Threshold Notifications", () => {
  const routerSrc = fs.readFileSync(
    path.resolve(__dirname, "../../routers/loadTestMetrics.ts"),
    "utf-8"
  );

  it("checkP99ThresholdAndNotify function exists", () => {
    expect(routerSrc).toContain("async function checkP99ThresholdAndNotify");
  });

  it("reads P99 threshold from runtime config", () => {
    expect(routerSrc).toContain('getConfig("loadtest_p99_threshold_ms")');
    expect(routerSrc).toContain("p99Threshold");
  });

  it("reads error rate threshold from runtime config", () => {
    expect(routerSrc).toContain('getConfig("loadtest_error_rate_threshold")');
    expect(routerSrc).toContain("errorThreshold");
  });

  it("checks P99 latency against threshold", () => {
    expect(routerSrc).toContain("run.results.p99LatencyMs > p99Threshold");
  });

  it("checks error rate against threshold", () => {
    expect(routerSrc).toContain("run.results.errorRate > errorThreshold");
  });

  it("checks P95 approaching P99 threshold (80% warning)", () => {
    expect(routerSrc).toContain(
      "run.results.p95LatencyMs > p99Threshold * 0.8"
    );
  });

  it("sends CRITICAL notification for multiple violations", () => {
    expect(routerSrc).toContain(
      'violations.length >= 2 ? "CRITICAL" : "WARNING"'
    );
  });

  it("calls notifyOwner with threshold breach details", () => {
    expect(routerSrc).toContain("await notifyOwner({");
    expect(routerSrc).toContain("Threshold Breach");
    expect(routerSrc).toContain("threshold violation(s)");
  });

  it("is called after runLoadTest completion", () => {
    expect(routerSrc).toContain(
      "// S60-2: Check P99 threshold and notify owner if breached"
    );
    const matches = routerSrc.match(/await checkP99ThresholdAndNotify\(run\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2); // runLoadTest + recordRun
  });

  it("logs when all thresholds pass", () => {
    expect(routerSrc).toContain("passed all thresholds");
  });

  it("imports notifyOwner from notification module", () => {
    expect(routerSrc).toContain(
      'import { notifyOwner } from "../_core/notification"'
    );
  });

  it("imports getConfig from runtimeConfig", () => {
    expect(routerSrc).toContain(
      'import { getConfig, getConfigNumber, setConfig } from "../lib/runtimeConfig"'
    );
  });
});

// ── S60-3: Archival Cron Worker ─────────────────────────────────────────────

describe("S60-3: Archival Cron Worker", () => {
  it("archivalCronWorker module exists", () => {
    const workerPath = path.resolve(__dirname, "../archivalCronWorker.ts");
    expect(fs.existsSync(workerPath)).toBe(true);
  });

  const workerSrc = fs.readFileSync(
    path.resolve(__dirname, "../archivalCronWorker.ts"),
    "utf-8"
  );

  it("exports startArchivalCronWorker and stopArchivalCronWorker", () => {
    expect(workerSrc).toContain("export function startArchivalCronWorker");
    expect(workerSrc).toContain("export function stopArchivalCronWorker");
  });

  it("exports isArchivalRunning for status checks", () => {
    expect(workerSrc).toContain("export function isArchivalRunning");
  });

  it("polls every 60 seconds", () => {
    expect(workerSrc).toContain("60_000");
    expect(workerSrc).toContain("setInterval");
  });

  it("checks if schedule is enabled via runtime config", () => {
    expect(workerSrc).toContain('getConfig("archival_schedule_enabled")');
    expect(workerSrc).toContain('=== "true"');
  });

  it("reads cron expression from runtime config", () => {
    expect(workerSrc).toContain('getConfig("archival_schedule_cron")');
  });

  it("has parseCron function for cron expression parsing", () => {
    expect(workerSrc).toContain("function parseCron");
    expect(workerSrc).toContain("minute:");
    expect(workerSrc).toContain("hour:");
    expect(workerSrc).toContain("dayOfMonth:");
    expect(workerSrc).toContain("dayOfWeek:");
  });

  it("has matchesCron function for time matching", () => {
    expect(workerSrc).toContain("function matchesCron");
    expect(workerSrc).toContain("date.getMinutes()");
    expect(workerSrc).toContain("date.getHours()");
    expect(workerSrc).toContain("date.getDay()");
  });

  it("prevents double-trigger within the same minute", () => {
    expect(workerSrc).toContain("lastCheckMinute");
    expect(workerSrc).toContain(
      "if (currentMinute === lastCheckMinute) return"
    );
  });

  it("prevents concurrent runs", () => {
    expect(workerSrc).toContain("if (isRunning)");
    expect(workerSrc).toContain("Skipping check");
  });

  it("calls runArchivalJob with config from runtime config", () => {
    expect(workerSrc).toContain("runArchivalJob(");
    expect(workerSrc).toContain("retentionDays");
    expect(workerSrc).toContain("deleteAfterArchive");
  });

  it("updates archival_last_run on completion", () => {
    expect(workerSrc).toContain('setConfig("archival_last_run"');
  });

  it("sends owner notification on success", () => {
    expect(workerSrc).toContain("Scheduled Archival Completed");
    expect(workerSrc).toContain("await notifyOwner(");
  });

  it("sends owner notification on failure", () => {
    expect(workerSrc).toContain("Scheduled Archival FAILED");
  });

  it("is wired into server startup in index.ts", () => {
    const indexSrc = fs.readFileSync(
      path.resolve(__dirname, "../../_core/index.ts"),
      "utf-8"
    );
    expect(indexSrc).toContain("startArchivalCronWorker");
    expect(indexSrc).toContain("stopArchivalCronWorker");
  });

  it("is wired into graceful shutdown in index.ts", () => {
    const indexSrc = fs.readFileSync(
      path.resolve(__dirname, "../../_core/index.ts"),
      "utf-8"
    );
    expect(indexSrc).toContain("stopArchivalCronWorker()");
    expect(indexSrc).toContain("Phase 0: Stop background workers");
  });
});

// ── Cron Parsing Unit Tests ─────────────────────────────────────────────────

describe("Cron Parsing Logic", () => {
  // Import the exported test helpers
  let parseCron: any;
  let matchesCron: any;

  beforeEach(async () => {
    const mod = await import("../archivalCronWorker");
    parseCron = mod.parseCron;
    matchesCron = mod.matchesCron;
  });

  it("parseCron parses standard 5-field cron", () => {
    const result = parseCron("0 2 * * 0");
    expect(result).toEqual({
      minute: 0,
      hour: 2,
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: 0,
    });
  });

  it("parseCron parses daily cron", () => {
    const result = parseCron("30 3 * * *");
    expect(result).toEqual({
      minute: 30,
      hour: 3,
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: "*",
    });
  });

  it("parseCron returns null for invalid cron", () => {
    expect(parseCron("invalid")).toBeNull();
    expect(parseCron("0 2")).toBeNull();
  });

  it("matchesCron matches correct time", () => {
    const cron = parseCron("0 2 * * *")!;
    const date = new Date(2026, 3, 22, 2, 0, 0); // April 22, 2026 at 02:00
    expect(matchesCron(cron, date)).toBe(true);
  });

  it("matchesCron rejects wrong hour", () => {
    const cron = parseCron("0 2 * * *")!;
    const date = new Date(2026, 3, 22, 3, 0, 0); // 03:00 instead of 02:00
    expect(matchesCron(cron, date)).toBe(false);
  });

  it("matchesCron rejects wrong minute", () => {
    const cron = parseCron("30 2 * * *")!;
    const date = new Date(2026, 3, 22, 2, 0, 0); // minute 0 instead of 30
    expect(matchesCron(cron, date)).toBe(false);
  });

  it("matchesCron matches day of week", () => {
    const cron = parseCron("0 2 * * 0")!; // Sunday
    const sunday = new Date(2026, 3, 19, 2, 0, 0); // April 19, 2026 is a Sunday
    const monday = new Date(2026, 3, 20, 2, 0, 0); // April 20, 2026 is a Monday
    expect(matchesCron(cron, sunday)).toBe(true);
    expect(matchesCron(cron, monday)).toBe(false);
  });

  it("matchesCron handles all-wildcard cron", () => {
    const cron = parseCron("* * * * *")!;
    const anyDate = new Date();
    expect(matchesCron(cron, anyDate)).toBe(true);
  });
});
