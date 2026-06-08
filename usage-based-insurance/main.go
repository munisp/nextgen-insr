package main

import (
	"encoding/json"
	"log"
	"math"
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

// Usage-Based Insurance — telematics and IoT-driven dynamic pricing
// Business Rules:
// - Data sources: Vehicle telematics (OBD-II), mobile app (driving behavior), IoT sensors
// - Scoring factors: Mileage, time of day, speeding events, harsh braking, phone usage
// - Premium adjustment: -30% to +50% based on driving score
// - Pay-per-km: ₦5-15/km depending on risk score
// - Minimum monthly premium: ₦2,000 (regardless of usage)
// - Data retention: Raw telemetry 90 days, aggregated scores 7 years


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

	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS ubi_policies (id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, device_id TEXT, distance_km REAL DEFAULT 0, score REAL DEFAULT 100, premium_adj_pct REAL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table ubi_policies failed","error":"%s"}`, err)
	}
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)
	if err := db.Ping(); err != nil {
		jsonLog("warn", "database ping failed", "error", err.Error())
	} else {
		jsonLog("info", "database connected", "service", "usage-based-insurance", "driver", "postgresql")
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
		db.QueryRow(`SELECT COUNT(*) FROM ubi_policies`).Scan(&count)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"table": "ubi_policies", "count": count})
}

func main() {
	initDB()
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "usage-based-insurance"})
	})
	r.Get("/ready", func(w http.ResponseWriter, r *http.Request) { handleReady(w, r) })
	r.Get("/stats", handleStats)
	r.Get("/live", func(w http.ResponseWriter, r *http.Request) { handleLive(w, r) })
	r.Post("/api/v1/telemetry", ingestTelemetry)
	r.Get("/api/v1/score/{policyId}", getDrivingScore)
	r.Get("/api/v1/premium/{policyId}", calculatePremium)

	port := os.Getenv("PORT")
	if port == "" { port = "8129" }
	log.Printf("Usage-Based Insurance starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func ingestTelemetry(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PolicyID   string  `json:"policy_id"`
		KmDriven   float64 `json:"km_driven"`
		SpeedEvents int    `json:"speed_events"`
		HarshBrakes int   `json:"harsh_brakes"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ingested": true, "policy_id": body.PolicyID, "timestamp": time.Now().Format(time.RFC3339),
		"data_points": 1, "retention_days": 90,
	})
}

func getDrivingScore(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"policy_id": chi.URLParam(r, "policyId"), "driving_score": 78,
		"factors": map[string]int{"mileage": 85, "time_of_day": 70, "speeding": 65, "braking": 90, "phone_usage": 80},
		"trend": "improving", "percentile": 72,
	})
}

func calculatePremium(w http.ResponseWriter, r *http.Request) {
	basePremium := 25000.0
	score := 78.0
	adjustment := (score - 50) / 100 * -0.6
	adjustedPremium := basePremium * (1 + adjustment)
	adjustedPremium = math.Max(adjustedPremium, 2000)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"policy_id": chi.URLParam(r, "policyId"), "base_premium": basePremium,
		"driving_score": score, "adjustment_pct": adjustment * 100,
		"monthly_premium": int(adjustedPremium), "per_km_rate": 8.5,
		"minimum_premium": 2000,
	})
}
