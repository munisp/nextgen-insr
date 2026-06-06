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

// Document Management System — policy documents, claims evidence, KYC documents
// Business Rules:
// - Supported formats: PDF, JPEG, PNG, DOCX (max 25MB per file)
// - Retention: Policy docs (policy lifetime + 7 years), KYC (10 years post-relationship)
// - Versioning: All documents versioned, previous versions immutable
// - Access control: Role-based (underwriter, claims adjuster, compliance, customer)
// - OCR: Auto-extract data from uploaded documents (NIN, drivers license, utility bills)
// - Virus scanning: All uploads scanned before storage
// - NDPR: Documents encrypted at rest (AES-256), customer can request deletion


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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "document-management-system"})
	})
	r.Route("/api/v1/documents", func(r chi.Router) {
		r.Get("/", listDocuments)
		r.Post("/upload", uploadDocument)
		r.Get("/{id}", getDocument)
		r.Get("/{id}/versions", getVersions)
	})
	port := os.Getenv("PORT")
	if port == "" { port = "8111" }
	log.Printf("Document Management System starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func listDocuments(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"documents": []map[string]interface{}{
			{"id": "DOC-001", "type": "policy_certificate", "policy_id": "POL-2025-001", "format": "pdf", "size_bytes": 245000, "version": 2, "created_at": time.Now().AddDate(0, -3, 0).Format(time.RFC3339)},
			{"id": "DOC-002", "type": "kyc_nin", "customer_id": "CUS-001", "format": "jpeg", "size_bytes": 1200000, "version": 1, "ocr_status": "completed"},
			{"id": "DOC-003", "type": "claim_evidence", "claim_id": "CLM-001", "format": "pdf", "size_bytes": 5400000, "version": 1, "virus_scan": "clean"},
		},
		"total": 3, "retention_policy": "7 years post-expiry",
	})
}

func uploadDocument(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"document_id": "DOC-" + time.Now().Format("20060102150405"), "status": "processing",
		"virus_scan": "pending", "ocr": "queued", "encryption": "AES-256",
		"max_size": "25MB", "retention": "7 years",
	})
}

func getDocument(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id": chi.URLParam(r, "id"), "type": "policy_certificate", "version": 2,
		"encrypted": true, "access_log": []string{"underwriter@insureportal.ng viewed 2026-05-20"},
	})
}

func getVersions(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"document_id": chi.URLParam(r, "id"),
		"versions": []map[string]interface{}{
			{"version": 1, "created_at": time.Now().AddDate(0, -6, 0).Format(time.RFC3339), "created_by": "system", "immutable": true},
			{"version": 2, "created_at": time.Now().AddDate(0, -3, 0).Format(time.RFC3339), "created_by": "underwriter", "immutable": true},
		},
	})
}
