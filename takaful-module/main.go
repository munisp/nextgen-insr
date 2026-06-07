package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"database/sql"
	"fmt"

	_ "github.com/lib/pq"
)

// Takaful Module — Shariah-compliant insurance operations
// Business Rules:
// - Tabarru (donation) pool model — participants contribute to shared pool
// - Surplus distribution: 70% participants, 30% operator (Wakala fee)
// - Investment: Only Shariah-compliant instruments (no riba/interest)
// - Shariah Advisory Board: Required for product approval
// - Retakaful: Reinsurance through Shariah-compliant retakaful operators
// - NAICOM Takaful guidelines compliance


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
		jsonLog("info", "database connected", "service", "takaful-module", "driver", "postgresql")
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
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "takaful-module"})
	})
	r.Get("/api/v1/products", takafulProducts)
	r.Get("/api/v1/pool/status", poolStatus)
	r.Post("/api/v1/contribution", makeContribution)
	r.Get("/api/v1/surplus", surplusDistribution)

	port := os.Getenv("PORT")
	if port == "" { port = "8128" }
	log.Printf("Takaful Module starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func takafulProducts(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"products": []map[string]interface{}{
			{"id": "TAK-FAM", "name": "Family Takaful", "type": "life", "contribution_min": 5000, "shariah_certified": true},
			{"id": "TAK-GEN", "name": "General Takaful", "type": "general", "contribution_min": 10000, "shariah_certified": true},
			{"id": "TAK-HLT", "name": "Health Takaful", "type": "health", "contribution_min": 3000, "shariah_certified": true},
		},
		"wakala_fee_pct": 30, "shariah_board": "approved",
	})
}

func poolStatus(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total_pool": 85000000, "tabarru_pool": 59500000, "investment_pool": 25500000,
		"participants": 3200, "claims_paid_ytd": 12000000,
		"investment_return": 0.08, "shariah_compliant": true,
	})
}

func makeContribution(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ParticipantID string  `json:"participant_id"`
		Amount        float64 `json:"amount"`
		ProductID     string  `json:"product_id"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	tabarru := body.Amount * 0.70
	wakala := body.Amount * 0.30
	json.NewEncoder(w).Encode(map[string]interface{}{
		"contribution_id": "CON-" + time.Now().Format("20060102150405"),
		"amount": body.Amount, "tabarru_portion": tabarru, "wakala_fee": wakala,
		"status": "accepted", "shariah_compliant": true,
	})
}

func surplusDistribution(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"period": "2025", "total_surplus": 15000000,
		"participant_share": 10500000, "operator_share": 4500000,
		"distribution_ratio": "70/30", "status": "distributed",
	})
}
