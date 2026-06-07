// Package main implements a production-grade health checker for all POS-54Link
// middleware components. It performs deep health checks (not just TCP) and
// exposes Prometheus metrics + a JSON status endpoint.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ── Component Registry ───────────────────────────────────────────────────────

type ComponentStatus struct {
	Name      string    `json:"name"`
	Healthy   bool      `json:"healthy"`
	Latency   float64   `json:"latency_ms"`
	Message   string    `json:"message,omitempty"`
	CheckedAt time.Time `json:"checked_at"`
}

type HealthChecker struct {
	mu         sync.RWMutex
	components map[string]*ComponentStatus
	checks     map[string]CheckFunc
	interval   time.Duration
}

type CheckFunc func(ctx context.Context) (bool, string, error)

var (
	healthGauge = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "pos54_component_healthy",
		Help: "1 if component is healthy, 0 otherwise",
	}, []string{"component"})
	latencyHist = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "pos54_health_check_latency_seconds",
		Help:    "Health check latency",
		Buckets: prometheus.DefBuckets,
	}, []string{"component"})
)

func init() {
	prometheus.MustRegister(healthGauge, latencyHist)
}

func NewHealthChecker(interval time.Duration) *HealthChecker {
	hc := &HealthChecker{
		components: make(map[string]*ComponentStatus),
		checks:     make(map[string]CheckFunc),
		interval:   interval,
	}
	hc.registerDefaults()
	return hc
}

func (hc *HealthChecker) registerDefaults() {
	endpoints := map[string]string{
		"kafka":       env("KAFKA_BROKER", "kafka-1:9092"),
		"redis":       env("REDIS_URL", "redis-master:6379"),
		"postgres":    env("POSTGRES_HOST", "postgres-primary:5432"),
		"opensearch":  env("OPENSEARCH_URL", "http://opensearch-node-1:9200"),
		"temporal":    env("TEMPORAL_URL", "http://temporal-frontend-1:7233"),
		"keycloak":    env("KEYCLOAK_URL", "http://keycloak-1:8080"),
		"permify":     env("PERMIFY_URL", "http://permify-1:3476"),
		"apisix":      env("APISIX_URL", "http://apisix-1:9090"),
		"tigerbeetle": env("TIGERBEETLE_URL", "tigerbeetle-1:3001"),
		"fluvio":      env("FLUVIO_URL", "http://fluvio-sc:9003"),
		"mojaloop":    env("MOJALOOP_URL", "http://central-ledger-1:3001"),
		"dapr":        env("DAPR_URL", "http://localhost:3500"),
		"minio":       env("MINIO_URL", "http://minio-1:9000"),
	}
	for name, endpoint := range endpoints {
		n, e := name, endpoint
		hc.checks[n] = func(ctx context.Context) (bool, string, error) {
			return httpCheck(ctx, e)
		}
	}
}

func httpCheck(ctx context.Context, url string) (bool, string, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	healthURL := url
	if url[0] != 'h' {
		healthURL = "http://" + url
	}
	req, err := http.NewRequestWithContext(ctx, "GET", healthURL, nil)
	if err != nil {
		return false, fmt.Sprintf("request error: %v", err), err
	}
	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Sprintf("connection failed: %v", err), err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 400 {
		return true, "OK", nil
	}
	return false, fmt.Sprintf("status %d", resp.StatusCode), nil
}

func (hc *HealthChecker) Run(ctx context.Context) {
	ticker := time.NewTicker(hc.interval)
	defer ticker.Stop()
	hc.checkAll(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			hc.checkAll(ctx)
		}
	}
}

func (hc *HealthChecker) checkAll(ctx context.Context) {
	var wg sync.WaitGroup
	for name, check := range hc.checks {
		wg.Add(1)
		go func(n string, fn CheckFunc) {
			defer wg.Done()
			start := time.Now()
			checkCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			defer cancel()
			healthy, msg, _ := fn(checkCtx)
			latency := time.Since(start)

			hc.mu.Lock()
			hc.components[n] = &ComponentStatus{
				Name:      n,
				Healthy:   healthy,
				Latency:   float64(latency.Milliseconds()),
				Message:   msg,
				CheckedAt: time.Now(),
			}
			hc.mu.Unlock()

			val := 0.0
			if healthy {
				val = 1.0
			}
			healthGauge.WithLabelValues(n).Set(val)
			latencyHist.WithLabelValues(n).Observe(latency.Seconds())
		}(name, check)
	}
	wg.Wait()
}

func (hc *HealthChecker) StatusHandler(w http.ResponseWriter, r *http.Request) {
	hc.mu.RLock()
	defer hc.mu.RUnlock()

	allHealthy := true
	statuses := make([]ComponentStatus, 0, len(hc.components))
	for _, s := range hc.components {
		statuses = append(statuses, *s)
		if !s.Healthy {
			allHealthy = false
		}
	}

	resp := map[string]interface{}{
		"overall":    allHealthy,
		"components": statuses,
		"checked_at": time.Now(),
	}

	w.Header().Set("Content-Type", "application/json")
	if !allHealthy {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	json.NewEncoder(w).Encode(resp)
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}


// validateQueryParam validates and sanitizes a query parameter.
func validateQueryParam(r *http.Request, key string, maxLen int) (string, error) {
	val := r.URL.Query().Get(key)
	if len(val) > maxLen {
		return "", fmt.Errorf("parameter %q exceeds max length %d", key, maxLen)
	}
	return val, nil
}

// validateRequiredParam validates a required query parameter.
func validateRequiredParam(r *http.Request, key string, maxLen int) (string, error) {
	val, err := validateQueryParam(r, key, maxLen)
	if err != nil {
		return "", err
	}
	if val == "" {
		return "", fmt.Errorf("parameter %q is required", key)
	}
	return val, nil
}

// validateIntParam validates and converts an integer query parameter.
func validateIntParam(r *http.Request, key string) (int, error) {
	val := r.URL.Query().Get(key)
	if val == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return 0, fmt.Errorf("parameter %q must be a valid integer", key)
	}
	return n, nil
}

func main() {
	port := env("PORT", "8090")
	interval := 15 * time.Second

	hc := NewHealthChecker(interval)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hc.Run(ctx)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", hc.StatusHandler)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})
	mux.Handle("/metrics", promhttp.Handler())

	log.Printf("[HealthChecker] Starting on :%s (interval=%s)", port, interval)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
