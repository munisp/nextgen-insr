package main

import (
	"encoding/json"
	"log"
	"math"
	"net/http"
	"strconv"
	"time"
	"database/sql"
	"os"
	"fmt"

	_ "github.com/lib/pq"
)

// Agent Commission Management Service
// Calculates, tracks, and pays agent commissions based on tiered structures.
// Integrates with: TigerBeetle (payments), Kafka, Postgres, Redis
//
// Commission Tiers:
// - New Agent (0-6 months): 8% motor, 12% health, 10% life
// - Standard (6-24 months): 10% motor, 15% health, 12% life
// - Senior (24+ months): 12% motor, 18% health, 15% life
// - Override bonus: 2% on team production for team leads

type CommissionTier struct {
	Name   string
	Motor  float64
	Health float64
	Life   float64
	Home   float64
}

var tiers = map[string]CommissionTier{
	"new":      {Name: "New Agent", Motor: 0.08, Health: 0.12, Life: 0.10, Home: 0.06},
	"standard": {Name: "Standard", Motor: 0.10, Health: 0.15, Life: 0.12, Home: 0.08},
	"senior":   {Name: "Senior", Motor: 0.12, Health: 0.18, Life: 0.15, Home: 0.10},
}

func calculateCommission(premium float64, product string, tier string) float64 {
	t, ok := tiers[tier]
	if !ok { t = tiers["new"] }
	rates := map[string]float64{"motor": t.Motor, "health": t.Health, "life": t.Life, "home": t.Home}
	rate := rates[product]
	if rate == 0 { rate = 0.08 }
	return math.Round(premium*rate*100) / 100
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "agent-commission-management"})
}
func handleReady(w http.ResponseWriter, r *http.Request) {
	status := map[string]string{"status": "ready"}
	code := http.StatusOK
	if db != nil {
		if err := db.Ping(); err != nil {
			status["status"] = "not_ready"
			status["reason"] = "database unreachable"
			code = http.StatusServiceUnavailable
		}
	}
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(status)
}
func handleLive(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}



func handleCalculate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		AgentID  string  `json:"agent_id"`
		Premium  float64 `json:"premium"`
		Product  string  `json:"product"`
		Tier     string  `json:"tier"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	commission := calculateCommission(req.Premium, req.Product, req.Tier)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"agent_id": req.AgentID, "premium": req.Premium, "product": req.Product,
		"tier": req.Tier, "commission": commission, "rate": commission / req.Premium,
		"payment_date": time.Now().AddDate(0, 0, 15).Format("2006-01-02"),
	})
}

func handlePayoutSummary(w http.ResponseWriter, r *http.Request) {
	var totalCount int
	var recentCount int
	if db != nil {
		db.QueryRow("SELECT COUNT(*) FROM agent_commission_management").Scan(&totalCount)
		db.QueryRow("SELECT COUNT(*) FROM agent_commission_management WHERE created_at > NOW() - INTERVAL '30 days'").Scan(&recentCount)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total": totalCount,
		"recent_30d": recentCount,
		"service": "agent-commission-management",
		"period": time.Now().Format("2006-01"),
	})
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
		jsonLog("info", "database connected", "service", "agent-commission-management", "driver", "postgresql")
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
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/ready", handleReady)
	mux.HandleFunc("/live", handleLive)
	mux.HandleFunc("/api/v1/calculate", handleCalculate)
	mux.HandleFunc("/api/v1/payout-summary", handlePayoutSummary)
	port := ":8099"
	log.Printf("Agent Commission Management starting on %s", port)
	log.Fatal(http.ListenAndServe(port, mux))
}
