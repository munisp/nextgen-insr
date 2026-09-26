// metrics.go — Q5 (2026-09-25). Hand-rolled Prometheus text exposition
// (no extra dependency): atomic counters + /metrics handler.
package main

import (
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
)

type Counter struct{ v atomic.Int64 }

func (c *Counter) Inc()         { c.v.Add(1) }
func (c *Counter) Value() int64 { return c.v.Load() }

type Metrics struct {
	EventsEvaluated       Counter
	EventsFired           Counter
	EventsDataUnavailable Counter
	EventsPublished       Counter
	PublishErrors         Counter
	DedupeSkips           Counter
	RedisFallbacks        Counter
	FraudErrors           Counter
	EvaluationErrors      Counter
}

func NewMetrics() *Metrics { return &Metrics{} }

func (m *Metrics) Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b strings.Builder
		write := func(name, help string, v int64) {
			fmt.Fprintf(&b, "# HELP %s %s\n# TYPE %s counter\n%s %d\n", name, help, name, name, v)
		}
		write("parametric_events_evaluated_total", "Parametric trigger evaluations persisted.", m.EventsEvaluated.Value())
		write("parametric_events_fired_total", "Evaluations that fired.", m.EventsFired.Value())
		write("parametric_events_data_unavailable_total", "Evaluations recorded data_unavailable (fail-closed, no firing).", m.EventsDataUnavailable.Value())
		write("parametric_events_published_total", "Successful downstream publishes (kafka/fluvio/opensearch).", m.EventsPublished.Value())
		write("parametric_publish_errors_total", "Downstream publish failures (DB row remains source of truth).", m.PublishErrors.Value())
		write("parametric_dedupe_skips_total", "Evaluations skipped as duplicates (redis SETNX or DB conflict).", m.DedupeSkips.Value())
		write("parametric_redis_fallbacks_total", "Times redis dedupe was unavailable and DB uniqueness guard was used.", m.RedisFallbacks.Value())
		write("parametric_fraud_errors_total", "Dapr fraud scoring failures (score=null, fail-closed).", m.FraudErrors.Value())
		write("parametric_evaluation_errors_total", "Trigger evaluation errors.", m.EvaluationErrors.Value())
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		_, _ = w.Write([]byte(b.String()))
	}
}
