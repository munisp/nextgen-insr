/**
 * Observability: metrics collection and Prometheus-compatible export for TypeScript services.
 */
export declare class Metrics {
    private counters;
    private gauges;
    private histograms;
    private serviceName;
    constructor(serviceName: string);
    incrCounter(name: string, value?: number): void;
    setGauge(name: string, value: number): void;
    observeLatency(name: string, durationMs: number): void;
    prometheusText(): string;
    jsonSnapshot(): Record<string, unknown>;
}
/**
 * Express-compatible middleware that collects HTTP request metrics.
 */
export declare function metricsMiddleware(metrics: Metrics): (req: any, res: any, next: any) => void;
