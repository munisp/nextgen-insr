// @ts-check
/**
 * Performance Regression Detection System
 *
 * Innovation: Automated, continuous performance benchmarking that
 * detects regressions before they reach production. Uses statistical
 * analysis to distinguish between noise and real performance changes.
 *
 * Features:
 * - Baseline performance tracking with historical data
 * - Statistical significance testing (p-value calculation)
 * - Automatic regression detection with configurable thresholds
 * - Performance budget enforcement per endpoint
 * - Trend analysis and prediction
 * - Integration with CI/CD pipelines
 */
import { logger } from "../_core/logger";

export interface PerfMeasurement {
  endpoint: string;
  method: string;
  durationMs: number;
  timestamp: Date;
  metrics: {
    cpuUsage?: number;
    memoryUsage?: number;
    queryCount?: number;
    cacheHit?: boolean;
  };
  tags?: Record<string, string>;
}

export interface PerformanceBaseline {
  endpoint: string;
  p50: number;
  p95: number;
  p99: number;
  sampleCount: number;
  lastUpdated: Date;
  trend: "improving" | "stable" | "degrading";
  trendScore: number; // -100 to +100
}

export interface RegressionAlert {
  endpoint: string;
  method: string;
  baselineP95: number;
  currentP95: number;
  regressionPercent: number;
  statisticalSignificance: number; // p-value
  severity: "info" | "warning" | "critical";
  recommendation: string;
}

// ── Statistical Helpers ─────────────────────────────────────────────────────

function calculatePercentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function calculateStdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((sum, v) => sum + v, 0) / squaredDiffs.length;
  return Math.sqrt(avgSquaredDiff);
}

// Approximate p-value calculation using z-test
function calculatePValue(baselineMean: number, baselineStd: number, currentMean: number, sampleSize: number): number {
  if (baselineStd === 0 || sampleSize === 0) return 1;
  const standardError = baselineStd / Math.sqrt(sampleSize);
  const zScore = Math.abs(currentMean - baselineMean) / standardError;
  // Approximation of p-value from z-score (two-tailed)
  const pValue = 2 * (1 - normalCDF(zScore));
  return pValue;
}

function normalCDF(x: number): number {
  // Approximation of the standard normal CDF
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);

  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return 0.5 * (1 + sign * y);
}

// ── Trend Analysis ──────────────────────────────────────────────────────────

function calculateTrend(measurements: PerfMeasurement[]): "improving" | "stable" | "degrading" {
  if (measurements.length < 10) return "stable";

  // Split into two halves and compare
  const half = Math.floor(measurements.length / 2);
  const firstHalf = measurements.slice(0, half);
  const secondHalf = measurements.slice(half);

  const firstMean = calculateMean(firstHalf.map(m => m.durationMs));
  const secondMean = calculateMean(secondHalf.map(m => m.durationMs));

  const changePercent = ((secondMean - firstMean) / firstMean) * 100;

  if (changePercent < -5) return "improving";
  if (changePercent > 5) return "degrading";
  return "stable";
}

function calculateTrendScore(measurements: PerfMeasurement[]): number {
  const trend = calculateTrend(measurements);
  if (trend === "improving") return -50;
  if (trend === "degrading") return 50;
  return 0;
}

// ── Baseline Management ─────────────────────────────────────────────────────

const measurementHistory: Map<string, PerfMeasurement[]> = new Map();

export function recordMeasurement(measurement: PerfMeasurement): void {
  const key = `${measurement.method}:${measurement.endpoint}`;
  const measurements = measurementHistory.get(key) || [];
  measurements.push(measurement);

  // Keep last 1000 measurements per endpoint
  if (measurements.length > 1000) {
    measurements.shift();
  }

  measurementHistory.set(key, measurements);
}

export function getBaseline(endpoint: string, method: string): PerformanceBaseline | null {
  const key = `${method}:${endpoint}`;
  const measurements = measurementHistory.get(key);

  if (!measurements || measurements.length < 30) {
    return null; // Not enough data for baseline
  }

  const durations = measurements.map(m => m.durationMs).sort((a, b) => a - b);
  const mean = calculateMean(durations);
  const stddev = calculateStdDev(durations, mean);

  return {
    endpoint,
    p50: calculatePercentile(durations, 50),
    p95: calculatePercentile(durations, 95),
    p99: calculatePercentile(durations, 99),
    sampleCount: measurements.length,
    lastUpdated: measurements[measurements.length - 1].timestamp,
    trend: calculateTrend(measurements),
    trendScore: calculateTrendScore(measurements),
  };
}

// ── Regression Detection ────────────────────────────────────────────────────

export function detectRegression(
  endpoint: string,
  method: string,
  currentDuration: number,
  options: { significanceLevel?: number; warningThreshold?: number; criticalThreshold?: number } = {}
): RegressionAlert | null {
  const {
    significanceLevel = 0.05,
    warningThreshold = 20,
    criticalThreshold = 50,
  } = options;

  const baseline = getBaseline(endpoint, method);
  if (!baseline) return null;

  const regressionPercent = ((currentDuration - baseline.p95) / baseline.p95) * 100;

  // Check statistical significance
  const measurements = measurementHistory.get(`${method}:${endpoint}`) || [];
  const pValue = calculatePValue(baseline.p50, baseline.p95 - baseline.p50, currentDuration, measurements.length);

  if (pValue > significanceLevel) {
    return null; // Not statistically significant - likely noise
  }

  // Determine severity
  let severity: "info" | "warning" | "critical" = "info";
  let recommendation = "Monitor the situation";

  if (regressionPercent >= criticalThreshold) {
    severity = "critical";
    recommendation = "Immediate investigation required. Consider rollback.";
  } else if (regressionPercent >= warningThreshold) {
    severity = "warning";
    recommendation = "Investigate recent changes. Check for inefficient queries or code paths.";
  }

  return {
    endpoint,
    method,
    baselineP95: baseline.p95,
    currentP95: currentDuration,
    regressionPercent: Math.round(regressionPercent * 100) / 100,
    statisticalSignificance: pValue,
    severity,
    recommendation,
  };
}

// ── Performance Budgets ─────────────────────────────────────────────────────

export interface PerformanceBudget {
  endpoint: string;
  method: string;
  maxP95: number;
  maxP99: number;
  minRequestsPerMinute?: number;
  tags?: Record<string, string>;
}

const performanceBudgets: PerformanceBudget[] = [];

export function addPerformanceBudget(budget: PerformanceBudget): void {
  performanceBudgets.push(budget);
  logger.info(
    { endpoint: budget.endpoint, maxP95: budget.maxP95 },
    "[PerfRegression] Performance budget added"
  );
}

export function checkPerformanceBudgets(
  endpoint: string,
  method: string,
  p95: number,
  p99: number
): { passed: boolean; violations: string[] } {
  const violations: string[] = [];
  let passed = true;

  const matchingBudgets = performanceBudgets.filter(
    b => b.endpoint === endpoint && b.method === method
  );

  for (const budget of matchingBudgets) {
    if (p95 > budget.maxP95) {
      violations.push(`P95 ${p95.toFixed(0)}ms exceeds budget ${budget.maxP95}ms`);
      passed = false;
    }
    if (p99 > budget.maxP99) {
      violations.push(`P99 ${p99.toFixed(0)}ms exceeds budget ${budget.maxP99}ms`);
      passed = false;
    }
  }

  if (!passed) {
    logger.warn(
      { endpoint, method, violations },
      "[PerfRegression] Performance budget violated"
    );
  }

  return { passed, violations };
}

// ── CI/CD Integration ───────────────────────────────────────────────────────

export function generateCIReport(measurements: PerfMeasurement[]): string {
  const endpoints = new Map<string, number[]>();

  for (const m of measurements) {
    const key = `${m.method}:${m.endpoint}`;
    const durations = endpoints.get(key) || [];
    durations.push(m.durationMs);
    endpoints.set(key, durations);
  }

  let report = `# Performance Regression Report\n\n`;
  report += `Generated: ${new Date().toISOString()}\n`;
  report += `Total measurements: ${measurements.length}\n\n`;

  report += `## Endpoints Analyzed\n\n`;
  report += `| Endpoint | Method | P50 (ms) | P95 (ms) | P99 (ms) | Trend |\n`;
  report += `|----------|--------|----------|----------|----------|-------|\n`;

  for (const [key, durations] of endpoints) {
    const sorted = durations.sort((a, b) => a - b);
    const [method, endpoint] = key.split(":");
    report += `| ${endpoint} | ${method} | `;
    report += `${calculatePercentile(sorted, 50).toFixed(0)} | `;
    report += `${calculatePercentile(sorted, 95).toFixed(0)} | `;
    report += `${calculatePercentile(sorted, 99).toFixed(0)} | `;

    const trend = calculateTrend(
      Array.from({ length: durations.length }, (_, i) => ({
        endpoint,
        method,
        durationMs: durations[i],
        timestamp: new Date(),
      }))
    );
    report += `${trend} |\n`;
  }

  return report;
}

// ── Initialization ──────────────────────────────────────────────────────────

export function initializePerformanceTracking(
  defaults: Partial<PerformanceBudget>[] = []
): void {
  logger.info("[PerfRegression] Performance tracking initialized");

  // Add default budgets for critical endpoints
  defaults.forEach(default => {
    addPerformanceBudget({
      endpoint: default.endpoint!,
      method: default.method || "GET",
      maxP95: default.maxP95 || 500,
      maxP99: default.maxP99 || 1000,
      tags: default.tags,
    });
  });
}

export default {
  recordMeasurement,
  getBaseline,
  detectRegression,
  addPerformanceBudget,
  checkPerformanceBudgets,
  generateCIReport,
  initializePerformanceTracking,
  calculatePercentile,
  calculateMean,
  calculateStdDev,
};
