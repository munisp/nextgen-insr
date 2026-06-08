// TypeScript enabled — Sprint 96 security audit
/**
 * Observability Module — OpenTelemetry Spans + eBPF-Ready Hooks
 * P3-1: Add structured tracing to all 3 engine routers
 *
 * From the 1B Payments article:
 * "eBPF-based observability gives you kernel-level visibility without
 *  modifying application code. But for application-level tracing,
 *  OpenTelemetry spans are the standard."
 *
 * This module provides:
 * 1. Span creation/management for tRPC procedures
 * 2. Automatic latency/error tracking per engine
 * 3. eBPF-compatible metric export format
 * 4. Structured logging with trace context
 */

import logger from "../_core/logger";

// ── Types ────────────────────────────────────────────────────────────────────

interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  serviceName: string;
  startTime: number;
  endTime?: number;
  status: "ok" | "error" | "unset";
  attributes: Record<string, string | number | boolean>;
  events: Array<{
    name: string;
    timestamp: number;
    attributes?: Record<string, unknown>;
  }>;
}

interface EngineMetrics {
  totalOperations: number;
  successCount: number;
  errorCount: number;
  totalLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  latencies: number[];
  operationCounts: Record<string, number>;
  errorsByOperation: Record<string, number>;
}

// ── Span ID Generation ───────────────────────────────────────────────────────

function generateId(length: number = 16): string {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// ── Engine Metrics Store ─────────────────────────────────────────────────────

const engineMetrics: Record<string, EngineMetrics> = {};

function getOrCreateMetrics(engine: string): EngineMetrics {
  if (!engineMetrics[engine]) {
    engineMetrics[engine] = {
      totalOperations: 0,
      successCount: 0,
      errorCount: 0,
      totalLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      latencies: [],
      operationCounts: {},
      errorsByOperation: {},
    };
  }
  return engineMetrics[engine];
}

function calculatePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function updatePercentiles(metrics: EngineMetrics): void {
  // Keep only last 10000 latencies to bound memory
  if (metrics.latencies.length > 10000) {
    metrics.latencies = metrics.latencies.slice(-10000);
  }
  const sorted = [...metrics.latencies].sort((a, b) => a - b);
  metrics.p50LatencyMs = calculatePercentile(sorted, 50);
  metrics.p95LatencyMs = calculatePercentile(sorted, 95);
  metrics.p99LatencyMs = calculatePercentile(sorted, 99);
}

// ── Active Spans ─────────────────────────────────────────────────────────────

const activeSpans = new Map<string, SpanContext>();

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Start a new span for an engine operation.
 */
export function startSpan(
  engine: string,
  operationName: string,
  attributes?: Record<string, string | number | boolean>,
  parentSpanId?: string
): SpanContext {
  const span: SpanContext = {
    traceId: generateId(32),
    spanId: generateId(16),
    parentSpanId,
    operationName,
    serviceName: `insureportal.${engine}`,
    startTime: performance.now(),
    status: "unset",
    attributes: {
      engine: engine,
      operation: operationName,
      ...attributes,
    },
    events: [],
  };

  activeSpans.set(span.spanId, span);
  return span;
}

/**
 * Add an event to an active span.
 */
export function addSpanEvent(
  spanId: string,
  name: string,
  attributes?: Record<string, unknown>
): void {
  const span = activeSpans.get(spanId);
  if (!span) return;
  span.events.push({ name, timestamp: performance.now(), attributes });
}

/**
 * End a span and record metrics.
 */
export function endSpan(
  spanId: string,
  status: "ok" | "error" = "ok",
  errorMessage?: string
): SpanContext | null {
  const span = activeSpans.get(spanId);
  if (!span) return null;

  span.endTime = performance.now();
  span.status = status;
  if (errorMessage) {
    span.attributes["error.message"] = errorMessage;
  }

  const latencyMs = span.endTime - span.startTime;
  const engine = span.attributes["engine"] as string;
  const operation = span.operationName;

  // Update engine metrics
  const metrics = getOrCreateMetrics(engine);
  metrics.totalOperations++;
  metrics.totalLatencyMs += latencyMs;
  metrics.latencies.push(latencyMs);
  metrics.operationCounts[operation] =
    (metrics.operationCounts[operation] || 0) + 1;

  if (status === "ok") {
    metrics.successCount++;
  } else {
    metrics.errorCount++;
    metrics.errorsByOperation[operation] =
      (metrics.errorsByOperation[operation] || 0) + 1;
  }

  // Update percentiles every 100 operations
  if (metrics.totalOperations % 100 === 0) {
    updatePercentiles(metrics);
  }

  activeSpans.delete(spanId);

  // Structured log with trace context (eBPF-compatible format)
  if (latencyMs > 1000) {
    logger.warn(
      `[Trace] SLOW ${engine}.${operation}: ${latencyMs.toFixed(1)}ms [trace=${span.traceId} span=${span.spanId}]`
    );
  }

  return span;
}

/**
 * Wrap an async function with automatic span tracking.
 */
export function withSpan<T>(
  engine: string,
  operationName: string,
  fn: (span: SpanContext) => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  const span = startSpan(engine, operationName, attributes);

  return fn(span).then(
    result => {
      endSpan(span.spanId, "ok");
      return result;
    },
    error => {
      endSpan(span.spanId, "error", error?.message ?? String(error));
      throw error;
    }
  );
}

/**
 * Get metrics for a specific engine.
 */
export function getEngineMetrics(engine: string): EngineMetrics | null {
  const metrics = engineMetrics[engine];
  if (!metrics) return null;
  updatePercentiles(metrics);
  return { ...metrics };
}

/**
 * Get metrics for all engines.
 */
export function getAllEngineMetrics(): Record<string, EngineMetrics> {
  for (const engine of Object.keys(engineMetrics)) {
    updatePercentiles(engineMetrics[engine]);
  }
  return { ...engineMetrics };
}

/**
 * Export metrics in Prometheus/eBPF-compatible format.
 */
export function exportPrometheusMetrics(): string {
  const lines: string[] = [];

  for (const [engine, metrics] of Object.entries(engineMetrics)) {
    updatePercentiles(metrics);
    const prefix = `fiveforlink_${engine.replace(/[^a-zA-Z0-9_]/g, "_")}`;

    lines.push(
      `# HELP ${prefix}_operations_total Total operations for ${engine}`
    );
    lines.push(`# TYPE ${prefix}_operations_total counter`);
    lines.push(`${prefix}_operations_total ${metrics.totalOperations}`);

    lines.push(`# HELP ${prefix}_errors_total Total errors for ${engine}`);
    lines.push(`# TYPE ${prefix}_errors_total counter`);
    lines.push(`${prefix}_errors_total ${metrics.errorCount}`);

    lines.push(`# HELP ${prefix}_latency_p50_ms P50 latency in ms`);
    lines.push(`# TYPE ${prefix}_latency_p50_ms gauge`);
    lines.push(`${prefix}_latency_p50_ms ${metrics.p50LatencyMs.toFixed(1)}`);

    lines.push(`# HELP ${prefix}_latency_p95_ms P95 latency in ms`);
    lines.push(`# TYPE ${prefix}_latency_p95_ms gauge`);
    lines.push(`${prefix}_latency_p95_ms ${metrics.p95LatencyMs.toFixed(1)}`);

    lines.push(`# HELP ${prefix}_latency_p99_ms P99 latency in ms`);
    lines.push(`# TYPE ${prefix}_latency_p99_ms gauge`);
    lines.push(`${prefix}_latency_p99_ms ${metrics.p99LatencyMs.toFixed(1)}`);

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Reset all metrics (for testing).
 */
export function resetMetrics(): void {
  for (const key of Object.keys(engineMetrics)) {
    delete engineMetrics[key];
  }
  activeSpans.clear();
}

// ── Pre-configured Engine Tracers ────────────────────────────────────────────

/** Settlement Engine tracer */
export const settlementTracer = {
  startSpan: (op: string, attrs?: Record<string, string | number | boolean>) =>
    startSpan("settlement", op, attrs),
  withSpan: <T>(
    op: string,
    fn: (span: SpanContext) => Promise<T>,
    attrs?: Record<string, string | number | boolean>
  ) => withSpan("settlement", op, fn, attrs),
};

/** Dispute Resolution Engine tracer */
export const disputeTracer = {
  startSpan: (op: string, attrs?: Record<string, string | number | boolean>) =>
    startSpan("dispute", op, attrs),
  withSpan: <T>(
    op: string,
    fn: (span: SpanContext) => Promise<T>,
    attrs?: Record<string, string | number | boolean>
  ) => withSpan("dispute", op, fn, attrs),
};

/** Commission Engine tracer */
export const commissionTracer = {
  startSpan: (op: string, attrs?: Record<string, string | number | boolean>) =>
    startSpan("commission", op, attrs),
  withSpan: <T>(
    op: string,
    fn: (span: SpanContext) => Promise<T>,
    attrs?: Record<string, string | number | boolean>
  ) => withSpan("commission", op, fn, attrs),
};
