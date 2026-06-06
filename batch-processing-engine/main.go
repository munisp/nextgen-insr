package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

// Batch Processing Engine
// Handles large-scale async operations: bulk payments, mass notifications,
// batch KYC reviews, commission payouts, policy renewals.
// Integrates with: Kafka, Temporal, Postgres, Redis

type BatchJob struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	Status      string    `json:"status"`
	TotalItems  int       `json:"total_items"`
	Processed   int       `json:"processed"`
	Succeeded   int       `json:"succeeded"`
	Failed      int       `json:"failed"`
	StartedAt   time.Time `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

var (
	jobs   = make(map[string]*BatchJob)
	jobsMu sync.RWMutex
)

func handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "batch-processing-engine"})
}

func handleCreateBatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Type  string `json:"type"`
		Items int    `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.Items > 10000 {
		http.Error(w, "Max 10,000 items per batch", http.StatusBadRequest)
		return
	}
	job := &BatchJob{
		ID: fmt.Sprintf("BATCH-%d", time.Now().UnixNano()),
		Type: req.Type, Status: "processing",
		TotalItems: req.Items, StartedAt: time.Now(),
	}
	jobsMu.Lock()
	jobs[job.ID] = job
	jobsMu.Unlock()
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

func handleGetBatch(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	jobsMu.RLock()
	job, ok := jobs[id]
	jobsMu.RUnlock()
	if !ok {
		http.Error(w, "Batch not found", http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(job)
}


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
	mux := http.NewServeMux()
	mux.HandleFunc("/metrics", metricsHandler)
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/api/v1/batch", handleCreateBatch)
	mux.HandleFunc("/api/v1/batch/status", handleGetBatch)
	
	port := ":8092"
	log.Printf("Batch Processing Engine starting on %s", port)
	log.Fatal(http.ListenAndServe(port, mux))
}
