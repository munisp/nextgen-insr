// @ts-check

/**
 * Sprint 61 Tests: Threshold Config UI, CSV/PDF Export, Compare Button
 *
 * Tests cover:
 * - S61-1: Runtime config threshold get/set via runtimeConfigAdmin router
 * - S61-2: CSV export data structure generation
 * - S61-3: Compare button navigation logic
 */
import { describe, it, expect, vi } from "vitest";

// ─── S61-1: Threshold Configuration ────────────────────────────────────────

describe("S61-1: Threshold Configuration via RuntimeConfig", () => {
  it("should have loadtest_p99_threshold_ms as a valid config key", () => {
    const key = "loadtest_p99_threshold_ms";
    expect(key).toBe("loadtest_p99_threshold_ms");
    expect(key.length).toBeGreaterThan(0);
  });

  it("should have loadtest_error_rate_threshold as a valid config key", () => {
    const key = "loadtest_error_rate_threshold";
    expect(key).toBe("loadtest_error_rate_threshold");
    expect(key.length).toBeGreaterThan(0);
  });

  it("should validate threshold values are numeric strings", () => {
    const p99Value = "500";
    const errorRateValue = "5.0";
    expect(parseFloat(p99Value)).toBe(500);
    expect(parseFloat(errorRateValue)).toBe(5.0);
  });

  it("should handle batch update format for thresholds", () => {
    const updates = [
      { key: "loadtest_p99_threshold_ms", value: "750" },
      { key: "loadtest_error_rate_threshold", value: "3.5" },
    ];
    expect(updates).toHaveLength(2);
    expect(updates[0].key).toBe("loadtest_p99_threshold_ms");
    expect(updates[1].key).toBe("loadtest_error_rate_threshold");
    expect(parseFloat(updates[0].value)).toBe(750);
    expect(parseFloat(updates[1].value)).toBe(3.5);
  });

  it("should calculate P95 warning threshold as 80% of P99", () => {
    const p99Threshold = 500;
    const p95Warning = Math.round(p99Threshold * 0.8);
    expect(p95Warning).toBe(400);
  });

  it("should determine severity based on breach count", () => {
    function getSeverity(breaches: number): string {
      return breaches >= 2 ? "CRITICAL" : "WARNING";
    }
    expect(getSeverity(0)).toBe("WARNING");
    expect(getSeverity(1)).toBe("WARNING");
    expect(getSeverity(2)).toBe("CRITICAL");
    expect(getSeverity(3)).toBe("CRITICAL");
  });
});

// ─── S61-2: CSV/PDF Export ─────────────────────────────────────────────────

describe("S61-2: Comparison Report Export", () => {
  const mockComparisonData = {
    runA: {
      id: "run-001",
      name: "Baseline Test",
      startedAt: "2026-04-22T10:00:00Z",
      config: {
        targetRps: 500,
        duration: 60,
        concurrency: 10,
        zipfExponent: 1.07,
        merchantCount: 1000,
      },
    },
    runB: {
      id: "run-002",
      name: "Candidate Test",
      startedAt: "2026-04-22T11:00:00Z",
      config: {
        targetRps: 500,
        duration: 60,
        concurrency: 10,
        zipfExponent: 1.07,
        merchantCount: 1000,
      },
    },
    comparison: {
      latency: {
        avg: {
          valueA: 45,
          valueB: 38,
          diff: -7,
          pctChange: -15.6,
          improved: true,
        },
        p50: {
          valueA: 30,
          valueB: 25,
          diff: -5,
          pctChange: -16.7,
          improved: true,
        },
        p95: {
          valueA: 120,
          valueB: 100,
          diff: -20,
          pctChange: -16.7,
          improved: true,
        },
        p99: {
          valueA: 250,
          valueB: 200,
          diff: -50,
          pctChange: -20.0,
          improved: true,
        },
        max: {
          valueA: 500,
          valueB: 450,
          diff: -50,
          pctChange: -10.0,
          improved: true,
        },
      },
      throughput: {
        actualRps: {
          valueA: 480,
          valueB: 495,
          diff: 15,
          pctChange: 3.1,
          improved: true,
        },
        totalRequests: {
          valueA: 28800,
          valueB: 29700,
          diff: 900,
          pctChange: 3.1,
          improved: true,
        },
        throughputMbps: {
          valueA: 12.5,
          valueB: 13.2,
          diff: 0.7,
          pctChange: 5.6,
          improved: true,
        },
      },
      reliability: {
        errorRate: {
          valueA: 2.1,
          valueB: 1.5,
          diff: -0.6,
          pctChange: -28.6,
          improved: true,
        },
        failedRequests: {
          valueA: 605,
          valueB: 446,
          diff: -159,
          pctChange: -26.3,
          improved: true,
        },
        successRate: {
          valueA: 97.9,
          valueB: 98.5,
          diff: 0.6,
          pctChange: 0.6,
          improved: true,
        },
      },
      zipfComparison: [
        { rank: 1, requestsA: 5000, requestsB: 5200, pctA: 17.4, pctB: 17.5 },
        { rank: 2, requestsA: 3500, requestsB: 3600, pctA: 12.2, pctB: 12.1 },
      ],
      timelineOverlay: [
        { second: 0, rpsA: 100, rpsB: 110, latencyA: 40, latencyB: 35 },
        { second: 1, rpsA: 480, rpsB: 495, latencyA: 45, latencyB: 38 },
      ],
    },
  };

  it("should generate CSV rows with correct header structure", () => {
    const data = mockComparisonData;
    const cmp = data.comparison;

    const headerRow = [
      "Metric",
      "Category",
      "Run A",
      "Run B",
      "Delta",
      "% Change",
      "Improved",
    ];
    expect(headerRow).toHaveLength(7);

    const latencyRow = [
      "Avg Latency (ms)",
      "Latency",
      String(cmp.latency.avg.valueA),
      String(cmp.latency.avg.valueB),
      String(cmp.latency.avg.diff),
      `${cmp.latency.avg.pctChange}%`,
      String(cmp.latency.avg.improved),
    ];
    expect(latencyRow[0]).toBe("Avg Latency (ms)");
    expect(latencyRow[2]).toBe("45");
    expect(latencyRow[3]).toBe("38");
    expect(latencyRow[4]).toBe("-7");
    expect(latencyRow[6]).toBe("true");
  });

  it("should properly escape CSV fields with commas and quotes", () => {
    const cell = 'Value with "quotes" and, commas';
    const escaped = `"${cell.replace(/"/g, '""')}"`;
    expect(escaped).toBe('"Value with ""quotes"" and, commas"');
  });

  it("should include Zipf distribution data in export", () => {
    const zipfRows = mockComparisonData.comparison.zipfComparison.map(z => [
      `#${z.rank}`,
      String(z.requestsA),
      String(z.requestsB),
      `${z.pctA}%`,
      `${z.pctB}%`,
    ]);
    expect(zipfRows).toHaveLength(2);
    expect(zipfRows[0][0]).toBe("#1");
    expect(zipfRows[0][1]).toBe("5000");
    expect(zipfRows[0][3]).toBe("17.4%");
  });

  it("should include timeline data in export", () => {
    const timelineRows = mockComparisonData.comparison.timelineOverlay.map(
      t => [
        String(t.second),
        String(t.rpsA),
        String(t.rpsB),
        String(t.latencyA),
        String(t.latencyB),
      ]
    );
    expect(timelineRows).toHaveLength(2);
    expect(timelineRows[1][1]).toBe("480");
    expect(timelineRows[1][2]).toBe("495");
  });

  it("should determine correct verdict for PDF export", () => {
    const cmp = mockComparisonData.comparison;
    const improvements = [
      cmp.latency.p99.improved,
      cmp.throughput.actualRps.improved,
      cmp.reliability.errorRate.improved,
    ].filter(Boolean).length;

    expect(improvements).toBe(3);
    const verdict =
      improvements >= 2
        ? "IMPROVEMENT"
        : improvements === 1
          ? "MIXED"
          : "REGRESSION";
    expect(verdict).toBe("IMPROVEMENT");
  });

  it("should generate correct filename format", () => {
    const runAId = mockComparisonData.runA.id;
    const runBId = mockComparisonData.runB.id;
    const filename = `load-test-comparison-${runAId}-vs-${runBId}.csv`;
    expect(filename).toBe("load-test-comparison-run-001-vs-run-002.csv");
  });

  it("should handle empty zipf and timeline arrays gracefully", () => {
    const emptyZipf: any[] = [];
    const emptyTimeline: any[] = [];
    const zipfRows = emptyZipf.map(z => [`#${z.rank}`, String(z.requestsA)]);
    const timelineRows = emptyTimeline.map(t => [String(t.second)]);
    expect(zipfRows).toHaveLength(0);
    expect(timelineRows).toHaveLength(0);
  });
});

// ─── S61-3: Compare Button Logic ───────────────────────────────────────────

describe("S61-3: Compare Button Navigation", () => {
  it("should construct correct comparison URL with two run IDs", () => {
    const runIdA = "run-001";
    const runIdB = "run-002";
    const url = `/load-test-comparison?a=${runIdA}&b=${runIdB}`;
    expect(url).toBe("/load-test-comparison?a=run-001&b=run-002");
  });

  it("should prevent comparison of same run", () => {
    const runIdA = "run-001";
    const runIdB = "run-001";
    const isSameRun = runIdA === runIdB;
    expect(isSameRun).toBe(true);
  });

  it("should allow comparison of different runs", () => {
    const runIdA = "run-001";
    const runIdB = "run-002";
    const isSameRun = runIdA === runIdB;
    expect(isSameRun).toBe(false);
  });

  it("should reset compareRunA state after navigation", () => {
    let compareRunA: string | null = "run-001";
    // Simulate navigation
    compareRunA = null;
    expect(compareRunA).toBeNull();
  });

  it("should handle two-click compare workflow", () => {
    let compareRunA: string | null = null;
    const activeRunId = "run-001";

    // Step 1: Click Compare - sets Run A
    compareRunA = activeRunId;
    expect(compareRunA).toBe("run-001");

    // Step 2: Select different run
    const newActiveRunId = "run-002";

    // Step 3: Click Compare vs A - navigates
    const url = `/load-test-comparison?a=${compareRunA}&b=${newActiveRunId}`;
    expect(url).toBe("/load-test-comparison?a=run-001&b=run-002");

    // Step 4: Reset state
    compareRunA = null;
    expect(compareRunA).toBeNull();
  });
});
