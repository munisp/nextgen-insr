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

// NAICOM Compliance Module — automated regulatory reporting and monitoring
// Business Rules:
// - Quarterly returns: Financial statements, solvency ratio, claims statistics
// - Solvency margin: Minimum 15% (alert at 20%, critical at 17%)
// - Annual returns: Audited accounts, actuarial valuation, reinsurance arrangements
// - Incident reporting: Major incidents within 24 hours
// - Capital adequacy: Minimum ₦3B for life, ₦5B for composite


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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "naicom-compliance-module"})
	})
	r.Get("/api/v1/returns/quarterly", quarterlyReturns)
	r.Get("/api/v1/solvency", solvencyStatus)
	r.Post("/api/v1/incident/report", reportIncident)
	r.Get("/api/v1/capital", capitalAdequacy)
	port := os.Getenv("PORT")
	if port == "" { port = "8091" }
	log.Printf("NAICOM Compliance Module starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func quarterlyReturns(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"quarter": "Q1-2026", "status": "submitted", "submitted_at": time.Now().AddDate(0, 0, -5).Format(time.RFC3339),
		"components": map[string]string{
			"financial_statement": "submitted", "solvency_report": "submitted",
			"claims_statistics": "submitted", "premium_report": "submitted",
		},
		"next_deadline": time.Now().AddDate(0, 3, 0).Format("2006-01-02"),
	})
}

func solvencyStatus(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"solvency_ratio": 0.28, "minimum_required": 0.15,
		"status": "compliant", "buffer": 0.13,
		"alert_threshold": 0.20, "critical_threshold": 0.17,
	})
}

func reportIncident(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"incident_id": "INC-" + time.Now().Format("20060102150405"),
		"status": "filed", "naicom_deadline": time.Now().Add(24 * time.Hour).Format(time.RFC3339),
		"acknowledgement": "pending",
	})
}

func capitalAdequacy(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"minimum_capital": 5000000000, "current_capital": 8500000000,
		"surplus": 3500000000, "compliant": true, "license_type": "composite",
	})
}
