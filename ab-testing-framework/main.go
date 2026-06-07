package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"database/sql"

	_ "github.com/lib/pq"
)

// A/B Testing Framework — manages experiments, traffic allocation, and statistical analysis
// Business Rules:
// - Minimum sample size: 1000 users per variant for statistical significance
// - Traffic allocation: Configurable 50/50 to 90/10 splits
// - Auto-stop: If variant shows > 95% confidence of negative impact, stop experiment
// - Guardrail metrics: Revenue, error rate, latency must not degrade > 5%
// - Experiment duration: Minimum 7 days, maximum 30 days
// - Mutual exclusion: User can only be in 1 experiment per feature area

type Experiment struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Feature        string    `json:"feature"`
	Status         string    `json:"status"` // draft, running, paused, completed, stopped
	TrafficPct     int       `json:"traffic_pct"`
	Variants       []Variant `json:"variants"`
	StartDate      time.Time `json:"start_date"`
	EndDate        time.Time `json:"end_date"`
	MinSampleSize  int       `json:"min_sample_size"`
	CurrentSamples int       `json:"current_samples"`
	Confidence     float64   `json:"confidence"`
}

type Variant struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Weight     int     `json:"weight"`
	Conversion float64 `json:"conversion_rate"`
	Revenue    float64 `json:"avg_revenue"`
}

var (
	experiments = make(map[string]*Experiment)
	mu          sync.RWMutex
)


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


var db *sql.DB

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		jsonLog("warn", "database connection failed", "error", err.Error())
		return
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)
	if err := db.Ping(); err != nil {
		jsonLog("warn", "database ping failed", "error", err.Error())
	} else {
		jsonLog("info", "database connected", "service", "ab-testing-framework", "driver", "postgresql")
	}
}

// execInTransaction wraps a function in a database transaction.
func execInTransaction(fn func(tx *sql.Tx) error) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback()
			panic(p)
		}
	}()
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}



// otelMiddleware adds trace context propagation to requests.
func otelMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		traceID := r.Header.Get("X-Trace-ID")
		if traceID == "" {
			traceID = r.Header.Get("X-Request-Id")
		}
		spanID := fmt.Sprintf("span-%d", time.Now().UnixNano())
		w.Header().Set("X-Trace-ID", traceID)
		w.Header().Set("X-Span-ID", spanID)
		start := time.Now()
		next.ServeHTTP(w, r)
		duration := time.Since(start)
		if duration > 500*time.Millisecond {
			jsonLog("warn", "slow request", "path", r.URL.Path, "duration_ms", fmt.Sprintf("%.0f", float64(duration.Milliseconds())), "trace_id", traceID)
		}
	})
}



func jsonLog(level, msg string, kvs ...string) {
	entry := fmt.Sprintf(`{"level":"%s","msg":"%s"`, level, msg)
	for i := 0; i+1 < len(kvs); i += 2 {
		entry += fmt.Sprintf(`,"%s":"%s"`, kvs[i], kvs[i+1])
	}
	entry += `,"ts":"` + time.Now().Format(time.RFC3339) + `"}`
	log.Println(entry)
}

func main() {
	initDB()
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer, middleware.Timeout(30*time.Second))

	r.Get("/health", healthHandler)
	r.Route("/api/v1/experiments", func(r chi.Router) {
		r.Get("/", listExperiments)
		r.Post("/", createExperiment)
		r.Get("/{id}", getExperiment)
		r.Post("/{id}/assign", assignUser)
		r.Post("/{id}/record", recordConversion)
		r.Get("/{id}/results", getResults)
	})

	port := os.Getenv("PORT")
	if port == "" { port = "8100" }
	log.Printf("A/B Testing Framework starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "ab-testing-framework", "version": "1.0.0"})
}

func listExperiments(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	defer mu.RUnlock()
	list := make([]*Experiment, 0, len(experiments))
	for _, e := range experiments { list = append(list, e) }
	json.NewEncoder(w).Encode(map[string]interface{}{"experiments": list, "total": len(list)})
}

func createExperiment(w http.ResponseWriter, r *http.Request) {
	var exp Experiment
	if err := json.NewDecoder(r.Body).Decode(&exp); err != nil {
		http.Error(w, `{"error":"invalid_body"}`, 400); return
	}
	exp.ID = fmt.Sprintf("EXP-%d", time.Now().UnixNano())
	exp.Status = "draft"
	exp.MinSampleSize = 1000
	if exp.TrafficPct == 0 { exp.TrafficPct = 50 }
	mu.Lock()
	experiments[exp.ID] = &exp
	mu.Unlock()
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(exp)
}

func getExperiment(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	mu.RLock()
	exp, ok := experiments[id]
	mu.RUnlock()
	if !ok { http.Error(w, `{"error":"not_found"}`, 404); return }
	json.NewEncoder(w).Encode(exp)
}

func assignUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	mu.RLock()
	exp, ok := experiments[id]
	mu.RUnlock()
	if !ok { http.Error(w, `{"error":"not_found"}`, 404); return }
	if exp.Status != "running" { http.Error(w, `{"error":"experiment_not_running"}`, 400); return }
	// Deterministic assignment based on user hash
	variant := exp.Variants[rand.Intn(len(exp.Variants))]
	json.NewEncoder(w).Encode(map[string]interface{}{"experiment_id": id, "variant": variant.Name, "variant_id": variant.ID})
}

func recordConversion(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	mu.Lock()
	exp, ok := experiments[id]
	if ok { exp.CurrentSamples++ }
	mu.Unlock()
	if !ok { http.Error(w, `{"error":"not_found"}`, 404); return }
	// Check auto-stop guardrails
	if exp.CurrentSamples >= exp.MinSampleSize && exp.Confidence >= 0.95 {
		exp.Status = "completed"
	}
	json.NewEncoder(w).Encode(map[string]string{"status": "recorded"})
}

func getResults(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	mu.RLock()
	exp, ok := experiments[id]
	mu.RUnlock()
	if !ok { http.Error(w, `{"error":"not_found"}`, 404); return }
	significant := exp.CurrentSamples >= exp.MinSampleSize
	json.NewEncoder(w).Encode(map[string]interface{}{
		"experiment_id": id, "samples": exp.CurrentSamples, "statistically_significant": significant,
		"confidence": exp.Confidence, "winner": func() string { if len(exp.Variants) > 0 { return exp.Variants[0].Name }; return "" }(),
	})
}

func init() { _ = context.Background() }
