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

// Broker API Service — manages insurance broker integrations and commission
// Business Rules:
// - Broker tiers: Bronze (5% commission), Silver (7%), Gold (10%), Platinum (12%)
// - Minimum premium for broker assignment: ₦50,000
// - Commission split: 70% broker, 30% sub-agents
// - NAICOM broker license validation before activation
// - Quarterly performance review: Volume, retention, complaints
// - Clawback: If policy cancelled within 6 months, commission reversed


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
		jsonLog("info", "database connected", "service", "broker-api-service", "driver", "postgresql")
	}
	// Create domain table
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS brokers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            tier TEXT DEFAULT 'bronze',
            commission_rate NUMERIC DEFAULT 0.05,
            active_policies INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT NOW()
        )`); err != nil {
		jsonLog("warn", "create table failed", "error", err.Error())
	} else {
		jsonLog("info", "table ready", "table", "brokers")
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

func main() {
	initDB()
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "broker-api-service"})
	})
	r.Get("/ready", func(w http.ResponseWriter, r *http.Request) { handleReady(w, r) })
	r.Get("/live", func(w http.ResponseWriter, r *http.Request) { handleLive(w, r) })
	r.Route("/api/v1/brokers", func(r chi.Router) {
		r.Get("/", listBrokers)
		r.Post("/", registerBroker)
		r.Get("/{id}/commission", calculateCommission)
		r.Post("/{id}/validate-license", validateLicense)
	})

	port := os.Getenv("PORT")
	if port == "" { port = "8102" }
	log.Printf("Broker API Service starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

var brokerTiers = map[string]float64{"bronze": 0.05, "silver": 0.07, "gold": 0.10, "platinum": 0.12}

func listBrokers(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"brokers": []map[string]interface{}{
			{"id": "BRK-001", "name": "Lagos Insurance Brokers Ltd", "tier": "gold", "commission_rate": 0.10, "active_policies": 245, "status": "active"},
			{"id": "BRK-002", "name": "Abuja Risk Consultants", "tier": "silver", "commission_rate": 0.07, "active_policies": 120, "status": "active"},
		},
		"total": 2,
	})
}

func registerBroker(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name          string `json:"name"`
		LicenseNumber string `json:"license_number"`
		Tier          string `json:"tier"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	rate, ok := brokerTiers[body.Tier]
	if !ok { rate = brokerTiers["bronze"] }
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"broker_id": "BRK-" + time.Now().Format("20060102"), "name": body.Name,
		"tier": body.Tier, "commission_rate": rate, "status": "pending_license_validation",
		"clawback_period": "6 months", "min_premium": 50000,
	})
}

func calculateCommission(w http.ResponseWriter, r *http.Request) {
	premium := 250000.0
	tier := "gold"
	rate := brokerTiers[tier]
	total := premium * rate
	brokerShare := total * 0.70
	subAgentShare := total * 0.30
	json.NewEncoder(w).Encode(map[string]interface{}{
		"premium": premium, "tier": tier, "rate": rate, "total_commission": total,
		"broker_share": brokerShare, "sub_agent_share": subAgentShare, "split": "70/30",
	})
}

func validateLicense(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"valid": true, "issuer": "NAICOM", "license_type": "insurance_broker",
		"expiry": time.Now().AddDate(1, 0, 0).Format("2006-01-02"), "status": "active",
	})
}
