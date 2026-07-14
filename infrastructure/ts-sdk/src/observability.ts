/**
 * Observability: metrics collection and Prometheus-compatible export for TypeScript services.
 */

export class Metrics {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, HistogramData> = new Map();
  private serviceName: string;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  incrCounter(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) || 0) + value);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  observeLatency(name: string, durationMs: number): void {
    let h = this.histograms.get(name);
    if (!h) {
      h = { count: 0, sum: 0, min: durationMs, max: durationMs };
      this.histograms.set(name, h);
    }
    h.count++;
    h.sum += durationMs;
    h.min = Math.min(h.min, durationMs);
    h.max = Math.max(h.max, durationMs);
  }

  prometheusText(): string {
    const lines: string[] = [];

    for (const [name, value] of this.counters) {
      lines.push(`# TYPE ${this.serviceName}_${name} counter`);
      lines.push(`${this.serviceName}_${name} ${value}`);
    }

    for (const [name, value] of this.gauges) {
      lines.push(`# TYPE ${this.serviceName}_${name} gauge`);
      lines.push(`${this.serviceName}_${name} ${value}`);
    }

    for (const [name, h] of this.histograms) {
      lines.push(`# TYPE ${this.serviceName}_${name} summary`);
      lines.push(`${this.serviceName}_${name}_count ${h.count}`);
      lines.push(`${this.serviceName}_${name}_sum ${h.sum.toFixed(2)}`);
      if (h.count > 0) {
        lines.push(`${this.serviceName}_${name}_min ${h.min.toFixed(2)}`);
        lines.push(`${this.serviceName}_${name}_max ${h.max.toFixed(2)}`);
        lines.push(`${this.serviceName}_${name}_avg ${(h.sum / h.count).toFixed(2)}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  jsonSnapshot(): Record<string, unknown> {
    const latencies: Record<string, unknown> = {};
    for (const [name, h] of this.histograms) {
      latencies[name] = {
        count: h.count,
        sum: h.sum,
        min: h.min,
        max: h.max,
        avg: h.count > 0 ? h.sum / h.count : 0,
      };
    }

    return {
      service: this.serviceName,
      timestamp: new Date().toISOString(),
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      latencies,
    };
  }
}

interface HistogramData {
  count: number;
  sum: number;
  min: number;
  max: number;
}

/**
 * Express-compatible middleware that collects HTTP request metrics.
 */
export function metricsMiddleware(metrics: Metrics) {
  return (req: any, res: any, next: any) => {
    const start = Date.now();

    const originalEnd = res.end;
    res.end = function (...args: any[]) {
      const duration = Date.now() - start;
      metrics.incrCounter('http_requests_total');
      metrics.observeLatency('http_request_duration_ms', duration);

      if (res.statusCode >= 400 && res.statusCode < 500) {
        metrics.incrCounter('http_client_errors_total');
      } else if (res.statusCode >= 500) {
        metrics.incrCounter('http_server_errors_total');
      }

      originalEnd.apply(res, args);
    };

    next();
  };
}
