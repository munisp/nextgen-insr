/**
 * OpenTelemetry Instrumentation for InsurePortal
 * Must be imported BEFORE any other modules to ensure proper instrumentation.
 * 
 * Usage: import './instrumentation' at the top of server/_core/index.ts
 * 
 * Exports metrics and traces to:
 * - Prometheus (metrics): http://localhost:9464/metrics
 * - OTLP (traces): configured via OTEL_EXPORTER_OTLP_ENDPOINT
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

const OTEL_ENABLED = process.env.OTEL_ENABLED !== "false";
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "insureportal-api";
const SERVICE_VERSION = process.env.npm_package_version || "1.0.0";
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318";
const PROMETHEUS_PORT = parseInt(process.env.PROMETHEUS_METRICS_PORT || "9464", 10);

let sdk: NodeSDK | undefined;

if (OTEL_ENABLED) {
  const resource = // @ts-ignore - Resource import type mismatch
 new Resource({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
    "deployment.environment": process.env.NODE_ENV || "development",
    "service.namespace": "insureportal",
  });

  const prometheusExporter = new PrometheusExporter({
    port: PROMETHEUS_PORT,
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${OTLP_ENDPOINT}/v1/traces`,
  });

  sdk = new NodeSDK({
    resource,
    metricReader: prometheusExporter,
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-http": {
          // @ts-ignore
      ignoreIncomingPaths: ["/health", "/metrics", "/favicon.ico"],
        },
        "@opentelemetry/instrumentation-express": { enabled: true },
        "@opentelemetry/instrumentation-pg": { enabled: true },
        "@opentelemetry/instrumentation-ioredis": { enabled: true },
        "@opentelemetry/instrumentation-dns": { enabled: false },
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  sdk.start();
  console.log(`[OTel] Instrumentation active — Prometheus :${PROMETHEUS_PORT}, traces → ${OTLP_ENDPOINT}`);
}

// Graceful shutdown
process.on("SIGTERM", () => {
  sdk?.shutdown().then(
    () => console.log("[OTel] Shutdown complete"),
    (err) => console.error("[OTel] Shutdown error", err)
  );
});

export { sdk };
