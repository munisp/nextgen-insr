// Package main implements a circuit breaker proxy for InsurePortal middleware.
// Wraps upstream services with configurable failure thresholds, half-open
// probing, exponential backoff, and Prometheus metrics.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ── Circuit Breaker States ───────────────────────────────────────────────────

type State int

const (
	Closed   State = iota // Normal operation
	Open                  // Rejecting requests
	HalfOpen              // Probing with limited requests
)

func (s State) String() string {
	switch s {
	case Closed:
		return "closed"
	case Open:
		return "open"
	case HalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

type CircuitBreaker struct {
	mu               sync.RWMutex
	name             string
	state            State
	failureCount     int
	successCount     int
	failureThreshold int
	successThreshold int
	timeout          time.Duration
	lastFailure      time.Time
	halfOpenMax      int
	halfOpenCount    int
}

type CBConfig struct {
	Name             string        `json:"name"`
	FailureThreshold int           `json:"failure_threshold"`
	SuccessThreshold int           `json:"success_threshold"`
	Timeout          time.Duration `json:"timeout"`
	HalfOpenMax      int           `json:"half_open_max"`
}

var (
	cbStateGauge = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "pos54_circuit_breaker_state",
		Help: "Circuit breaker state: 0=closed, 1=open, 2=half-open",
	}, []string{"service"})
	cbFailureCounter = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "pos54_circuit_breaker_failures_total",
		Help: "Total circuit breaker failures",
	}, []string{"service"})
	cbRejectedCounter = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "pos54_circuit_breaker_rejected_total",
		Help: "Total requests rejected by circuit breaker",
	}, []string{"service"})
)

func init() {
	prometheus.MustRegister(cbStateGauge, cbFailureCounter, cbRejectedCounter)
}

func NewCircuitBreaker(cfg CBConfig) *CircuitBreaker {
	if cfg.FailureThreshold == 0 {
		cfg.FailureThreshold = 5
	}
	if cfg.SuccessThreshold == 0 {
		cfg.SuccessThreshold = 3
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Second
	}
	if cfg.HalfOpenMax == 0 {
		cfg.HalfOpenMax = 1
	}
	return &CircuitBreaker{
		name:             cfg.Name,
		state:            Closed,
		failureThreshold: cfg.FailureThreshold,
		successThreshold: cfg.SuccessThreshold,
		timeout:          cfg.Timeout,
		halfOpenMax:      cfg.HalfOpenMax,
	}
}

func (cb *CircuitBreaker) Allow() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case Closed:
		return true
	case Open:
		if time.Since(cb.lastFailure) > cb.timeout {
			cb.state = HalfOpen
			cb.halfOpenCount = 0
			cb.successCount = 0
			cbStateGauge.WithLabelValues(cb.name).Set(2)
			log.Printf("[CB:%s] Transitioning to half-open", cb.name)
			return true
		}
		cbRejectedCounter.WithLabelValues(cb.name).Inc()
		return false
	case HalfOpen:
		if cb.halfOpenCount < cb.halfOpenMax {
			cb.halfOpenCount++
			return true
		}
		cbRejectedCounter.WithLabelValues(cb.name).Inc()
		return false
	}
	return false
}

func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	if cb.state == HalfOpen {
		cb.successCount++
		if cb.successCount >= cb.successThreshold {
			cb.state = Closed
			cb.failureCount = 0
			cbStateGauge.WithLabelValues(cb.name).Set(0)
			log.Printf("[CB:%s] Recovered → closed", cb.name)
		}
	} else {
		cb.failureCount = 0
	}
}

func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.failureCount++
	cb.lastFailure = time.Now()
	cbFailureCounter.WithLabelValues(cb.name).Inc()

	if cb.state == HalfOpen || cb.failureCount >= cb.failureThreshold {
		cb.state = Open
		cbStateGauge.WithLabelValues(cb.name).Set(1)
		log.Printf("[CB:%s] Tripped → open (failures=%d)", cb.name, cb.failureCount)
	}
}

func (cb *CircuitBreaker) Status() map[string]interface{} {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	return map[string]interface{}{
		"name":           cb.name,
		"state":          cb.state.String(),
		"failure_count":  cb.failureCount,
		"success_count":  cb.successCount,
		"last_failure":   cb.lastFailure,
		"timeout_sec":    cb.timeout.Seconds(),
	}
}

// ── Proxy Manager ────────────────────────────────────────────────────────────

type ProxyManager struct {
	breakers map[string]*CircuitBreaker
	proxies  map[string]*httputil.ReverseProxy
}

func NewProxyManager() *ProxyManager {
	pm := &ProxyManager{
		breakers: make(map[string]*CircuitBreaker),
		proxies:  make(map[string]*httputil.ReverseProxy),
	}
	services := map[string]string{
		"transaction-service": envOr("TRANSACTION_SVC_URL", "http://localhost:3001"),
		"kyc-service":        envOr("KYC_SVC_URL", "http://localhost:3002"),
		"settlement-service": envOr("SETTLEMENT_SVC_URL", "http://localhost:3003"),
		"fraud-service":      envOr("FRAUD_SVC_URL", "http://localhost:3004"),
		"notification-svc":   envOr("NOTIFICATION_SVC_URL", "http://localhost:3005"),
	}
	for name, upstream := range services {
		u, _ := url.Parse(upstream)
		pm.proxies[name] = httputil.NewSingleHostReverseProxy(u)
		pm.breakers[name] = NewCircuitBreaker(CBConfig{
			Name:             name,
			FailureThreshold: 5,
			SuccessThreshold: 3,
			Timeout:          30 * time.Second,
			HalfOpenMax:      2,
		})
	}
	return pm
}

func (pm *ProxyManager) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	svc := r.Header.Get("X-Target-Service")
	if svc == "" {
		http.Error(w, "X-Target-Service header required", http.StatusBadRequest)
		return
	}
	cb, ok := pm.breakers[svc]
	if !ok {
		http.Error(w, fmt.Sprintf("Unknown service: %s", svc), http.StatusNotFound)
		return
	}
	if !cb.Allow() {
		w.Header().Set("Retry-After", "30")
		http.Error(w, fmt.Sprintf("Circuit open for %s", svc), http.StatusServiceUnavailable)
		return
	}
	proxy := pm.proxies[svc]
	rw := &statusRecorder{ResponseWriter: w, statusCode: 200}
	proxy.ServeHTTP(rw, r)
	if rw.statusCode >= 500 {
		cb.RecordFailure()
	} else {
		cb.RecordSuccess()
	}
}

func (pm *ProxyManager) StatusHandler(w http.ResponseWriter, r *http.Request) {
	statuses := make([]map[string]interface{}, 0)
	for _, cb := range pm.breakers {
		statuses = append(statuses, cb.Status())
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"circuit_breakers": statuses,
		"timestamp":        time.Now(),
	})
}

type statusRecorder struct {
	http.ResponseWriter
	statusCode int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.statusCode = code
	r.ResponseWriter.WriteHeader(code)
}

func envOr(key, fallback string) string {
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
	_ = context.Background()
	port := envOr("PORT", "8091")
	pm := NewProxyManager()

	mux := http.NewServeMux()
	mux.Handle("/proxy/", pm)
	mux.HandleFunc("/status", pm.StatusHandler)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})
	mux.Handle("/metrics", promhttp.Handler())

	log.Printf("[CircuitBreaker] Starting proxy on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
