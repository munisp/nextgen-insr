/**
 * telemetry.ts — OpenTelemetry distributed tracing for 54Link POS Shell
 *
 * Instruments:
 *  - HTTP requests (Express)
 *  - Database queries (pg / drizzle)
 *  - tRPC procedures (via HTTP instrumentation)
 *
 * Activated only when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * Exports traces to an OTLP-compatible collector (Jaeger, Tempo, etc.)
 *
 * Environment variables:
 *  - OTEL_EXPORTER_OTLP_ENDPOINT  e.g. http://jaeger:4318
 *  - OTEL_SERVICE_NAME             defaults to "pos-shell"
 *  - OTEL_SERVICE_VERSION          defaults to "1.0.0"
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { logger } from './_core/logger';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (!endpoint) {
  logger.warn(
    "[OTel] OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing disabled."
  );
} else {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "pos-shell",
      [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION ?? "1.0.0",
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Reduce noise from internal file system operations
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  sdk.start();
  logger.info(`[OTel] Tracing initialised → ${endpoint}`);

  process.on("SIGTERM", () => {
    sdk.shutdown().catch(err => logger.error("[OTel] Shutdown error:", err));
  });
}

export {};
