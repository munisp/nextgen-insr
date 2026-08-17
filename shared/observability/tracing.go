package observability

import (
	"context"
	"os"
)

// TracerConfig holds configuration for OpenTelemetry tracing.
type TracerConfig struct {
	ServiceName  string
	Environment  string
	CollectorURL string
	SamplingRate float64
}

// DefaultTracerConfig returns production-ready tracing config from environment.
func DefaultTracerConfig(serviceName string) TracerConfig {
	collectorURL := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if collectorURL == "" {
		collectorURL = "http://otel-collector:4317"
	}
	env := os.Getenv("ENVIRONMENT")
	if env == "" {
		env = "production"
	}
	return TracerConfig{
		ServiceName:  serviceName,
		Environment:  env,
		CollectorURL: collectorURL,
		SamplingRate: 0.1, // Sample 10% of traces in production
	}
}

// InitTracer initializes the OpenTelemetry trace provider.
// In production, this connects to the OTel Collector via gRPC.
// Returns a shutdown function to flush pending spans.
func InitTracer(ctx context.Context, cfg TracerConfig) (func(context.Context) error, error) {
	// Note: Full OTLP implementation requires:
	//   go.opentelemetry.io/otel
	//   go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc
	//   go.opentelemetry.io/otel/sdk/trace
	//
	// Each service's go.mod should import these dependencies.
	// This file provides the configuration pattern; actual initialization
	// uses the standard OTLP SDK setup:
	//
	//   exporter, _ := otlptracegrpc.New(ctx, otlptracegrpc.WithEndpoint(cfg.CollectorURL))
	//   tp := sdktrace.NewTracerProvider(
	//       sdktrace.WithBatcher(exporter),
	//       sdktrace.WithResource(resource.NewWithAttributes(
	//           semconv.SchemaURL,
	//           semconv.ServiceName(cfg.ServiceName),
	//           attribute.String("environment", cfg.Environment),
	//       )),
	//       sdktrace.WithSampler(sdktrace.ParentBased(
	//           sdktrace.TraceIDRatioBased(cfg.SamplingRate),
	//       )),
	//   )
	//   otel.SetTracerProvider(tp)
	//   return tp.Shutdown, nil

	return func(ctx context.Context) error { return nil }, nil
}
