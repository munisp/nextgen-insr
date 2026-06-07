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

// Policy Renewal Automation — automated policy renewal with dynamic pricing
// Business Rules:
// - Auto-renew: Customer opt-in required, 30-day advance notice
// - Pricing: Base premium × claims factor × loyalty discount × inflation adjustment
// - Loyalty discount: 5% after 1 year, 10% after 3 years, 15% after 5 years
// - Claims loading: 0 claims = -5%, 1 claim = 0%, 2+ claims = +15% per claim
// - Grace period: 30 days after expiry (coverage reduced to 50%)
// - Lapse: After grace period → policy terminated, new application required
// - Communication: SMS at -30d, -14d, -7d, -3d, -1d, 0d, +7d, +14d, +30d


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
		jsonLog("info", "database connected", "service", "policy-renewal-automation", "driver", "postgresql")
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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "policy-renewal-automation"})
	})
	r.Get("/api/v1/renewals/upcoming", upcomingRenewals)
	r.Post("/api/v1/renewals/calculate", calculateRenewalPremium)
	r.Post("/api/v1/renewals/process", processRenewal)

	port := os.Getenv("PORT")
	if port == "" { port = "8105" }
	log.Printf("Policy Renewal Automation starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func upcomingRenewals(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"renewals": []map[string]interface{}{
			{"policy_id": "POL-2025-001", "customer": "Chioma Nwosu", "expiry": time.Now().AddDate(0, 0, 14).Format("2006-01-02"), "premium": 180000, "status": "notice_sent", "auto_renew": true},
			{"policy_id": "POL-2025-002", "customer": "Ibrahim Musa", "expiry": time.Now().AddDate(0, 0, 7).Format("2006-01-02"), "premium": 350000, "status": "pending_payment", "auto_renew": false},
			{"policy_id": "POL-2025-003", "customer": "Funke Adeyemi", "expiry": time.Now().AddDate(0, 0, -5).Format("2006-01-02"), "premium": 120000, "status": "grace_period", "auto_renew": true},
		},
		"total": 3, "auto_renew_count": 2, "grace_period_count": 1,
	})
}

func calculateRenewalPremium(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BasePremium  float64 `json:"base_premium"`
		YearsActive  int     `json:"years_active"`
		ClaimsCount  int     `json:"claims_count"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	loyaltyDiscount := 0.0
	if body.YearsActive >= 5 { loyaltyDiscount = 0.15 } else if body.YearsActive >= 3 { loyaltyDiscount = 0.10 } else if body.YearsActive >= 1 { loyaltyDiscount = 0.05 }
	claimsFactor := 1.0
	if body.ClaimsCount == 0 { claimsFactor = 0.95 } else if body.ClaimsCount >= 2 { claimsFactor = 1.0 + float64(body.ClaimsCount)*0.15 }
	inflationAdj := 1.05
	newPremium := body.BasePremium * claimsFactor * (1 - loyaltyDiscount) * inflationAdj
	json.NewEncoder(w).Encode(map[string]interface{}{
		"base_premium": body.BasePremium, "new_premium": int(newPremium),
		"loyalty_discount": loyaltyDiscount, "claims_factor": claimsFactor, "inflation": inflationAdj,
		"savings": int(body.BasePremium - newPremium),
	})
}

func processRenewal(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "renewed", "new_expiry": time.Now().AddDate(1, 0, 0).Format("2006-01-02"),
		"payment_method": "auto_debit", "confirmation_sent": true,
	})
}
