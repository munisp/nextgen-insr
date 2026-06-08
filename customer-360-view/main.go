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

// Circuit breaker for external HTTP calls
type circuitBreakerState int
const (
	cbClosed circuitBreakerState = iota
	cbOpen
	cbHalfOpen
)
type circuitBreaker struct {
	state       circuitBreakerState
	failures    int
	threshold   int
	resetAfter  time.Duration
	lastFailure time.Time
}
var cb = &circuitBreaker{threshold: 5, resetAfter: 30 * time.Second}
func (c *circuitBreaker) allow() bool {
	if c.state == cbClosed { return true }
	if c.state == cbOpen && time.Since(c.lastFailure) > c.resetAfter {
		c.state = cbHalfOpen
		return true
	}
	return c.state == cbHalfOpen
}
func (c *circuitBreaker) recordSuccess() {
	c.failures = 0
	c.state = cbClosed
}
func (c *circuitBreaker) recordFailure() {
	c.failures++
	c.lastFailure = time.Now()
	if c.failures >= c.threshold { c.state = cbOpen }
}

// Customer 360 View — unified customer profile aggregating all touchpoints
// Business Rules:
// - Data sources: KYC, transactions, claims, policies, interactions, social
// - Profile completeness score: 0-100 (minimum 60 for premium services)
// - NDPR compliance: Customer can request full data export (30-day SLA)
// - Segmentation: High-value (>₦5M), Standard, New, Dormant (90 days inactive)
// - Cross-sell scoring: Based on product gaps and life events

type CustomerProfile struct {
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	Segment          string  `json:"segment"`
	CompletenessScore int    `json:"completeness_score"`
	TotalPolicies    int     `json:"total_policies"`
	TotalPremium     float64 `json:"total_premium_naira"`
	ClaimsCount      int     `json:"claims_count"`
	LifetimeValue    float64 `json:"lifetime_value"`
	RiskScore        int     `json:"risk_score"`
	CrossSellScore   int     `json:"cross_sell_score"`
	LastInteraction  string  `json:"last_interaction"`
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

	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS customer_profiles (id TEXT PRIMARY KEY, customer_id TEXT UNIQUE NOT NULL, name TEXT, email TEXT, phone TEXT, segment TEXT, lifetime_value NUMERIC(15,2), policies_count INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table customer_profiles failed","error":"%s"}`, err)
	}
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)
	if err := db.Ping(); err != nil {
		jsonLog("warn", "database ping failed", "error", err.Error())
	} else {
		jsonLog("info", "database connected", "service", "customer-360-view", "driver", "postgresql")
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

func handleStats(w http.ResponseWriter, r *http.Request) {
	var count int
	if db != nil {
		db.QueryRow(`SELECT COUNT(*) FROM customer_profiles`).Scan(&count)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"table": "customer_profiles", "count": count})
}

func main() {
	initDB()
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "customer-360-view"})
	})
	r.Get("/ready", func(w http.ResponseWriter, r *http.Request) { handleReady(w, r) })
	r.Get("/stats", handleStats)
	r.Get("/live", func(w http.ResponseWriter, r *http.Request) { handleLive(w, r) })
	r.Get("/api/v1/customers/{id}/360", getCustomer360)
	r.Get("/api/v1/customers/{id}/cross-sell", getCrossSell)
	r.Get("/api/v1/segments", getSegments)

	port := os.Getenv("PORT")
	if port == "" { port = "8103" }
	log.Printf("Customer 360 View starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func getCustomer360(w http.ResponseWriter, r *http.Request) {
	profile := CustomerProfile{
		ID: chi.URLParam(r, "id"), Name: "Adebayo Ogundimu", Segment: "high_value",
		CompletenessScore: 85, TotalPolicies: 4, TotalPremium: 2500000,
		ClaimsCount: 1, LifetimeValue: 8500000, RiskScore: 25, CrossSellScore: 78,
		LastInteraction: time.Now().AddDate(0, 0, -3).Format(time.RFC3339),
	}
	json.NewEncoder(w).Encode(profile)
}

func getCrossSell(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"customer_id": chi.URLParam(r, "id"),
		"recommendations": []map[string]interface{}{
			{"product": "Health Insurance", "score": 92, "reason": "No health coverage, age 35-45 bracket"},
			{"product": "Life Insurance", "score": 78, "reason": "Recently married, has dependents"},
			{"product": "Investment-Linked", "score": 65, "reason": "High net worth, no investment products"},
		},
	})
}

func getSegments(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"segments": []map[string]interface{}{
			{"name": "high_value", "criteria": ">₦5M lifetime value", "count": 450},
			{"name": "standard", "criteria": "₦500K-₦5M", "count": 3200},
			{"name": "new", "criteria": "<90 days", "count": 890},
			{"name": "dormant", "criteria": ">90 days inactive", "count": 1100},
		},
	})
}
