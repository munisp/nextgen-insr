package infra

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"go.uber.org/zap"
)

// Metrics provides Prometheus-compatible metrics collection.
type Metrics struct {
	mu       sync.RWMutex
	counters map[string]*atomic.Int64
	gauges   map[string]*atomic.Int64
	hists    map[string]*Histogram
	service  string
	logger   *zap.Logger
}

// Histogram tracks value distributions for latency metrics.
type Histogram struct {
	mu     sync.Mutex
	count  int64
	sum    float64
	min    float64
	max    float64
	p50    float64
	p99    float64
	values []float64
}

// NewMetrics creates a new metrics collector for a service.
func NewMetrics(logger *zap.Logger, serviceName string) *Metrics {
	return &Metrics{
		counters: make(map[string]*atomic.Int64),
		gauges:   make(map[string]*atomic.Int64),
		hists:    make(map[string]*Histogram),
		service:  serviceName,
		logger:   logger,
	}
}

// IncrCounter increments a counter metric by 1.
func (m *Metrics) IncrCounter(name string) {
	m.mu.Lock()
	if _, ok := m.counters[name]; !ok {
		m.counters[name] = &atomic.Int64{}
	}
	m.mu.Unlock()

	m.mu.RLock()
	m.counters[name].Add(1)
	m.mu.RUnlock()
}

// IncrCounterBy increments a counter by n.
func (m *Metrics) IncrCounterBy(name string, n int64) {
	m.mu.Lock()
	if _, ok := m.counters[name]; !ok {
		m.counters[name] = &atomic.Int64{}
	}
	m.mu.Unlock()

	m.mu.RLock()
	m.counters[name].Add(n)
	m.mu.RUnlock()
}

// SetGauge sets a gauge metric value.
func (m *Metrics) SetGauge(name string, value int64) {
	m.mu.Lock()
	if _, ok := m.gauges[name]; !ok {
		m.gauges[name] = &atomic.Int64{}
	}
	m.mu.Unlock()

	m.mu.RLock()
	m.gauges[name].Store(value)
	m.mu.RUnlock()
}

// ObserveLatency records a latency observation in milliseconds.
func (m *Metrics) ObserveLatency(name string, durationMs float64) {
	m.mu.Lock()
	if _, ok := m.hists[name]; !ok {
		m.hists[name] = &Histogram{min: durationMs, max: durationMs}
	}
	m.mu.Unlock()

	m.mu.RLock()
	h := m.hists[name]
	m.mu.RUnlock()

	h.mu.Lock()
	h.count++
	h.sum += durationMs
	if durationMs < h.min {
		h.min = durationMs
	}
	if durationMs > h.max {
		h.max = durationMs
	}
	if len(h.values) < 10000 {
		h.values = append(h.values, durationMs)
	}
	h.mu.Unlock()
}

// MetricsHandler returns an HTTP handler that exposes metrics in Prometheus text format.
func (m *Metrics) MetricsHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")

		m.mu.RLock()
		defer m.mu.RUnlock()

		for name, counter := range m.counters {
			fmt.Fprintf(w, "# TYPE %s_%s counter\n", m.service, name)
			fmt.Fprintf(w, "%s_%s %d\n", m.service, name, counter.Load())
		}

		for name, gauge := range m.gauges {
			fmt.Fprintf(w, "# TYPE %s_%s gauge\n", m.service, name)
			fmt.Fprintf(w, "%s_%s %d\n", m.service, name, gauge.Load())
		}

		for name, hist := range m.hists {
			hist.mu.Lock()
			fmt.Fprintf(w, "# TYPE %s_%s summary\n", m.service, name)
			fmt.Fprintf(w, "%s_%s_count %d\n", m.service, name, hist.count)
			fmt.Fprintf(w, "%s_%s_sum %.2f\n", m.service, name, hist.sum)
			if hist.count > 0 {
				fmt.Fprintf(w, "%s_%s_min %.2f\n", m.service, name, hist.min)
				fmt.Fprintf(w, "%s_%s_max %.2f\n", m.service, name, hist.max)
				fmt.Fprintf(w, "%s_%s_avg %.2f\n", m.service, name, hist.sum/float64(hist.count))
			}
			hist.mu.Unlock()
		}
	}
}

// MetricsJSONHandler returns metrics as JSON for dashboard consumption.
func (m *Metrics) MetricsJSONHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		m.mu.RLock()
		defer m.mu.RUnlock()

		result := map[string]interface{}{
			"service":   m.service,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
			"counters":  map[string]int64{},
			"gauges":    map[string]int64{},
			"latencies": map[string]interface{}{},
		}

		counters := result["counters"].(map[string]int64)
		for name, counter := range m.counters {
			counters[name] = counter.Load()
		}

		gauges := result["gauges"].(map[string]int64)
		for name, gauge := range m.gauges {
			gauges[name] = gauge.Load()
		}

		latencies := result["latencies"].(map[string]interface{})
		for name, hist := range m.hists {
			hist.mu.Lock()
			entry := map[string]interface{}{
				"count": hist.count,
				"sum":   hist.sum,
			}
			if hist.count > 0 {
				entry["min"] = hist.min
				entry["max"] = hist.max
				entry["avg"] = hist.sum / float64(hist.count)
			}
			hist.mu.Unlock()
			latencies[name] = entry
		}

		json.NewEncoder(w).Encode(result)
	}
}

// MetricsMiddleware wraps an http.Handler to collect request metrics.
func MetricsMiddleware(metrics *Metrics, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(rw, r)

		duration := time.Since(start).Seconds() * 1000
		metrics.IncrCounter("http_requests_total")
		metrics.ObserveLatency("http_request_duration_ms", duration)

		if rw.statusCode >= 400 && rw.statusCode < 500 {
			metrics.IncrCounter("http_client_errors_total")
		} else if rw.statusCode >= 500 {
			metrics.IncrCounter("http_server_errors_total")
		}
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
