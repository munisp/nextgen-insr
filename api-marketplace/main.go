package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync/atomic"
	"time"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// API Marketplace — developer portal for open insurance APIs
// Business Rules:
// - API tiers: Free (100 req/day), Standard (10K req/day), Enterprise (unlimited)
// - Monetization: Per-call billing via TigerBeetle, monthly invoicing
// - Sandbox: Full test environment with synthetic data
// - Rate limiting: Per-tier via APISIX
// - Documentation: OpenAPI 3.0 specs auto-generated
// - Partner onboarding: Self-service with API key generation


// Prometheus-compatible metrics
var (
	metricsRequestCount    int64
	metricsErrorCount      int64
	metricsStartTime       = time.Now()
)

func metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&metricsRequestCount, 1)
		wrapped := &metricsResponseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		if wrapped.statusCode >= 400 {
			atomic.AddInt64(&metricsErrorCount, 1)
		}
	})
}

type metricsResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (mrw *metricsResponseWriter) WriteHeader(code int) {
	mrw.statusCode = code
	mrw.ResponseWriter.WriteHeader(code)
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	uptime := time.Since(metricsStartTime).Seconds()
	reqCount := atomic.LoadInt64(&metricsRequestCount)
	errCount := atomic.LoadInt64(&metricsErrorCount)
	fmt.Fprintf(w, "# HELP http_requests_total Total HTTP requests\n")
	fmt.Fprintf(w, "# TYPE http_requests_total counter\n")
	fmt.Fprintf(w, "http_requests_total %d\n", reqCount)
	fmt.Fprintf(w, "# HELP http_errors_total Total HTTP errors (4xx/5xx)\n")
	fmt.Fprintf(w, "# TYPE http_errors_total counter\n")
	fmt.Fprintf(w, "http_errors_total %d\n", errCount)
	fmt.Fprintf(w, "# HELP process_uptime_seconds Process uptime\n")
	fmt.Fprintf(w, "# TYPE process_uptime_seconds gauge\n")
	fmt.Fprintf(w, "process_uptime_seconds %.2f\n", uptime)
}

var kafkaRestURL string

func initKafka() {
	kafkaRestURL = os.Getenv("KAFKA_REST_URL")
	if kafkaRestURL == "" {
		kafkaRestURL = "http://localhost:8082"
	}
	log.Printf("Kafka REST proxy configured at %s", kafkaRestURL)
}

func publishEvent(topic string, key string, payload interface{}) {
	if kafkaRestURL == "" {
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("WARN: kafka marshal error: %v", err)
		return
	}
	msg := map[string]interface{}{
		"records": []map[string]interface{}{
			{"key": key, "value": string(data)},
		},
	}
	body, _ := json.Marshal(msg)
	resp, err := http.Post(kafkaRestURL+"/topics/"+topic, "application/vnd.kafka.json.v2+json", bytes.NewReader(body))
	if err != nil {
		log.Printf("WARN: kafka publish error: %v", err)
		return
	}
	defer resp.Body.Close()
}

func main() {
	initKafka()
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Use(metricsMiddleware)
	r.Get("/metrics", metricsHandler)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "api-marketplace"})
	})
	r.Get("/api/v1/catalog", apiCatalog)
	r.Post("/api/v1/subscribe", subscribe)
	r.Get("/api/v1/usage/{apiKey}", getUsage)
	port := os.Getenv("PORT")
	if port == "" { port = "8098" }
	log.Printf("API Marketplace starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func apiCatalog(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"apis": []map[string]interface{}{
			{"name": "Policy API", "version": "v2", "endpoints": 12, "pricing": "₦5/call", "category": "core"},
			{"name": "Claims API", "version": "v1", "endpoints": 8, "pricing": "₦10/call", "category": "core"},
			{"name": "KYC Verification", "version": "v1", "endpoints": 5, "pricing": "₦25/call", "category": "identity"},
			{"name": "Risk Scoring", "version": "v1", "endpoints": 3, "pricing": "₦15/call", "category": "analytics"},
			{"name": "Agent Network", "version": "v1", "endpoints": 6, "pricing": "₦5/call", "category": "distribution"},
		},
		"total": 5, "sandbox_available": true,
	})
}

func subscribe(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"api_key": "ik_live_" + time.Now().Format("20060102150405"),
		"tier": "standard", "rate_limit": "10000/day",
		"sandbox_key": "ik_test_sandbox_" + time.Now().Format("150405"),
	})
}

func getUsage(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"api_key": chi.URLParam(r, "apiKey"),
		"period": "current_month", "calls": 4520, "limit": 10000,
		"cost_naira": 22600, "top_endpoint": "/api/v1/policies",
	})
}
