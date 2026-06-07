package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"sync"
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
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/api/v1/batch", handleCreateBatch)
	mux.HandleFunc("/api/v1/batch/status", handleGetBatch)
	
	port := ":8092"
	log.Printf("Batch Processing Engine starting on %s", port)
	log.Fatal(http.ListenAndServe(port, mux))
}
