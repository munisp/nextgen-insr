// Package observability provides shared Prometheus metrics and OpenTelemetry
// tracing instrumentation for all InsureTech microservices.
package observability

import (
	"fmt"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	HTTPRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "insuretech",
			Name:      "http_requests_total",
			Help:      "Total number of HTTP requests processed",
		},
		[]string{"service", "method", "path", "status"},
	)

	HTTPRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "insuretech",
			Name:      "http_request_duration_seconds",
			Help:      "HTTP request latency in seconds",
			Buckets:   []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10},
		},
		[]string{"service", "method", "path"},
	)

	HTTPConnectionsActive = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Namespace: "insuretech",
			Name:      "http_connections_active",
			Help:      "Number of active HTTP connections",
		},
		[]string{"service"},
	)

	DBPoolActive = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Namespace: "insuretech",
			Name:      "db_pool_active",
			Help:      "Number of active database connections",
		},
		[]string{"service"},
	)

	DBPoolIdle = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Namespace: "insuretech",
			Name:      "db_pool_idle",
			Help:      "Number of idle database connections",
		},
		[]string{"service"},
	)

	DBQueryDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "insuretech",
			Name:      "db_query_duration_seconds",
			Help:      "Database query duration in seconds",
			Buckets:   []float64{.001, .005, .01, .025, .05, .1, .25, .5, 1, 5},
		},
		[]string{"service", "operation"},
	)

	KafkaMessagesPublished = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "insuretech",
			Name:      "kafka_messages_published_total",
			Help:      "Total Kafka messages published",
		},
		[]string{"service", "topic"},
	)

	KafkaMessagesConsumed = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "insuretech",
			Name:      "kafka_messages_consumed_total",
			Help:      "Total Kafka messages consumed",
		},
		[]string{"service", "topic", "consumer_group"},
	)

	ClaimsSubmitted = prometheus.NewCounter(prometheus.CounterOpts{
		Namespace: "insuretech",
		Name:      "claims_submitted_total",
		Help:      "Total claims submitted",
	})

	ClaimsApproved = prometheus.NewCounter(prometheus.CounterOpts{
		Namespace: "insuretech",
		Name:      "claims_approved_total",
		Help:      "Total claims approved",
	})

	ClaimsRejected = prometheus.NewCounter(prometheus.CounterOpts{
		Namespace: "insuretech",
		Name:      "claims_rejected_total",
		Help:      "Total claims rejected",
	})

	ClaimsEscalated = prometheus.NewCounter(prometheus.CounterOpts{
		Namespace: "insuretech",
		Name:      "claims_escalated_total",
		Help:      "Total claims escalated to manual review",
	})

	PoliciesIssued = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "insuretech",
			Name:      "policies_issued_total",
			Help:      "Total policies issued",
		},
		[]string{"product_type"},
	)
)

func init() {
	prometheus.MustRegister(
		HTTPRequestsTotal,
		HTTPRequestDuration,
		HTTPConnectionsActive,
		DBPoolActive,
		DBPoolIdle,
		DBQueryDuration,
		KafkaMessagesPublished,
		KafkaMessagesConsumed,
		ClaimsSubmitted,
		ClaimsApproved,
		ClaimsRejected,
		ClaimsEscalated,
		PoliciesIssued,
	)
}

// MetricsHandler returns an http.Handler that serves Prometheus metrics.
func MetricsHandler() http.Handler {
	return promhttp.Handler()
}

// InstrumentHandler wraps an HTTP handler with request metrics.
func InstrumentHandler(serviceName string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		HTTPConnectionsActive.WithLabelValues(serviceName).Inc()
		defer HTTPConnectionsActive.WithLabelValues(serviceName).Dec()

		rw := &responseWriter{ResponseWriter: w, statusCode: 200}
		next.ServeHTTP(rw, r)

		duration := time.Since(start).Seconds()
		status := fmt.Sprintf("%d", rw.statusCode)

		HTTPRequestsTotal.WithLabelValues(serviceName, r.Method, r.URL.Path, status).Inc()
		HTTPRequestDuration.WithLabelValues(serviceName, r.Method, r.URL.Path).Observe(duration)
	})
}

type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}
