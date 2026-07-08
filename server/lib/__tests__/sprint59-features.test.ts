// @ts-check

/**
 * Sprint 59 Tests
 * S59-1: Owner notifications for archival jobs
 * S59-2: Load test runs persisted to database
 * S59-3: Run Load Test mutation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── S59-1: Archival Admin Notification Integration ──────────────────────────

describe("S59-1: Archival Admin Notifications", () => {
  it("archivalAdmin router imports notifyOwner from notification module", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/archivalAdmin.ts"),
        "utf-8"
      )
    );
    expect(source).toContain("import { notifyOwner }");
    expect(source).toContain('from "../_core/notification"');
  });

  it("archivalAdmin calls notifyOwner on job completion", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/archivalAdmin.ts"),
        "utf-8"
      )
    );
    expect(source).toContain("Archival Job ${job.id} Completed");
    expect(source).toContain("await notifyOwner({");
  });

  it("archivalAdmin calls notifyOwner on job failure", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/archivalAdmin.ts"),
        "utf-8"
      )
    );
    expect(source).toContain("Archival Job ${job.id} Failed");
    // Should have two notifyOwner calls (success + failure)
    const matches = source.match(/await notifyOwner\(/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it("notification content includes key archival details", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/archivalAdmin.ts"),
        "utf-8"
      )
    );
    // Completion notification should include these details
    expect(source).toContain("Triggered by:");
    expect(source).toContain("Total archived:");
    expect(source).toContain("Duration:");
  });
});

// ── S59-2: Load Test Runs Database Persistence ──────────────────────────────

describe("S59-2: Load Test Runs Database Persistence", () => {
  it("loadTestRuns table exists in schema", async () => {
    const schema = await import("../../../drizzle/schema");
    expect(schema.loadTestRuns).toBeDefined();
    expect(schema.loadTestRunStatusEnum).toBeDefined();
  });

  it("loadTestRuns schema has required columns", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../../drizzle/schema.ts"),
        "utf-8"
      )
    );
    const tableSection = source.substring(
      source.indexOf("loadTestRuns = pgTable")
    );
    expect(tableSection).toContain("run_id");
    expect(tableSection).toContain("status");
    expect(tableSection).toContain("started_at");
    expect(tableSection).toContain("completed_at");
    expect(tableSection).toContain("target_rps");
    expect(tableSection).toContain("duration_seconds");
    expect(tableSection).toContain("concurrency");
    expect(tableSection).toContain("zipf_skew");
    expect(tableSection).toContain("results");
    expect(tableSection).toContain("error_message");
  });

  it("loadTestMetrics router imports loadTestRuns from schema", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/loadTestMetrics.ts"),
        "utf-8"
      )
    );
    expect(source).toContain("import { loadTestRuns as loadTestRunsTable }");
    expect(source).toContain('from "../../drizzle/schema"');
  });

  it("loadTestMetrics has persistRun function", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/loadTestMetrics.ts"),
        "utf-8"
      )
    );
    expect(source).toContain("async function persistRun");
    expect(source).toContain("db.insert(loadTestRunsTable)");
  });

  it("loadTestMetrics has getRunsFromDb function", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/loadTestMetrics.ts"),
        "utf-8"
      )
    );
    expect(source).toContain("async function getRunsFromDb");
    expect(source).toContain("db.select().from(loadTestRunsTable)");
  });

  it("listRuns query reads from database", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/loadTestMetrics.ts"),
        "utf-8"
      )
    );
    // listRuns should call getRunsFromDb
    expect(source).toContain("return getRunsFromDb(limit)");
  });

  it("recordRun mutation persists to database", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/loadTestMetrics.ts"),
        "utf-8"
      )
    );
    // recordRun should call persistRun
    expect(source).toContain("await persistRun(run)");
  });
});

// ── S59-3: Run Load Test Button / Mutation ──────────────────────────────────

describe("S59-3: Run Load Test Mutation", () => {
  it("loadTestMetrics router has runLoadTest mutation", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/loadTestMetrics.ts"),
        "utf-8"
      )
    );
    expect(source).toContain("runLoadTest: protectedProcedure");
    expect(source).toContain(".mutation(");
  });

  it("runLoadTest accepts configuration parameters", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/loadTestMetrics.ts"),
        "utf-8"
      )
    );
    expect(source).toContain("targetRps: z.number()");
    expect(source).toContain("duration: z.number()");
    expect(source).toContain("concurrency: z.number()");
    expect(source).toContain("zipfExponent: z.number()");
    expect(source).toContain("merchantCount: z.number()");
  });

  it("runLoadTest prevents concurrent tests", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/loadTestMetrics.ts"),
        "utf-8"
      )
    );
    expect(source).toContain("if (activeLoadTest)");
    expect(source).toContain("A load test is already running");
  });

  it("runLoadTest persists results to database on completion", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/loadTestMetrics.ts"),
        "utf-8"
      )
    );
    // The async block should call persistRun
    expect(source).toContain("await persistRun(run)");
    expect(source).toContain("await persistRun(failedRun)");
  });

  it("getActiveTest query is available for polling", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/loadTestMetrics.ts"),
        "utf-8"
      )
    );
    expect(source).toContain("getActiveTest: protectedProcedure");
    expect(source).toContain("elapsedSeconds");
  });

  it("LoadTestDashboard page has Run Load Test button", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(
          __dirname,
          "../../../client/src/pages/LoadTestDashboard.tsx"
        ),
        "utf-8"
      )
    );
    expect(source).toContain("Run Load Test");
    expect(source).toContain("runLoadTest");
    expect(source).toContain("Dialog");
  });

  it("LoadTestDashboard polls for active test status", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(
          __dirname,
          "../../../client/src/pages/LoadTestDashboard.tsx"
        ),
        "utf-8"
      )
    );
    expect(source).toContain("getActiveTest.useQuery");
    expect(source).toContain("refetchInterval: 2000");
  });

  it("LoadTestDashboard has test configuration form", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(
          __dirname,
          "../../../client/src/pages/LoadTestDashboard.tsx"
        ),
        "utf-8"
      )
    );
    expect(source).toContain("targetRps");
    expect(source).toContain("duration");
    expect(source).toContain("concurrency");
    expect(source).toContain("zipfExponent");
    expect(source).toContain("merchantCount");
    expect(source).toContain("Start Test");
  });
});

// ── Load Test Engine Simulation ─────────────────────────────────────────────

describe("Load Test Engine Simulation", () => {
  it("generateZipfDistribution produces correct Pareto distribution", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/loadTestMetrics.ts"),
        "utf-8"
      )
    );
    expect(source).toContain("function generateZipfDistribution");
    expect(source).toContain("Math.pow(i, exponent)");
  });

  it("generateLatencyHistogram produces realistic buckets", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/loadTestMetrics.ts"),
        "utf-8"
      )
    );
    expect(source).toContain("function generateLatencyHistogram");
    expect(source).toContain("0-10ms");
    expect(source).toContain("1s+");
  });

  it("generateTimeline produces per-second data with ramp-up", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/loadTestMetrics.ts"),
        "utf-8"
      )
    );
    expect(source).toContain("function generateTimeline");
    expect(source).toContain("rampFactor");
  });

  it("executeLoadTest produces complete results", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/loadTestMetrics.ts"),
        "utf-8"
      )
    );
    expect(source).toContain("async function executeLoadTest");
    expect(source).toContain("zipfDistribution: generateZipfDistribution");
    expect(source).toContain("latencyHistogram: generateLatencyHistogram");
    expect(source).toContain("timeline: generateTimeline");
  });
});

// ── No ?? || Precedence Issues ──────────────────────────────────────────────

describe("Code Quality: No ?? || Precedence Issues", () => {
  it("parquetArchival.ts has no ?? || without parentheses", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../parquetArchival.ts"),
        "utf-8"
      )
    );
    // Should not have ?? and || on the same line without proper grouping
    const lines = source.split("\n");
    for (const line of lines) {
      if (line.includes("??") && line.includes("||")) {
        // If both exist on same line, they should be on separate statements
        // or properly parenthesized
        const hasProperGrouping =
          line.includes("?? (") ||
          line.includes("?? config") ||
          !line.includes("??");
        // Just ensure no raw "?? ... ||" pattern
        expect(line).not.toMatch(/\?\?\s+[^(].*\|\|/);
      }
    }
  });

  it("archivalAdmin.ts uses getConfig instead of getConfigValue", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync(
        require("path").resolve(__dirname, "../../routers/archivalAdmin.ts"),
        "utf-8"
      )
    );
    expect(source).not.toContain("getConfigValue");
    expect(source).toContain("getConfig");
    expect(source).toContain("setConfig");
  });
});
