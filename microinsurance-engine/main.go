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

// Microinsurance Engine — affordable insurance products for low-income Nigerians
// Business Rules:
// - Premium range: ₦100 - ₦5,000/month
// - Products: Crop (₦500/season), Health (₦200/month), Life (₦100/month), Device (₦300/month)
// - Distribution: USSD, agent network, mobile money deduction
// - Claims: Simplified process, max 3 documents, settlement within 48h
// - Auto-enrollment: Via mobile money operators (opt-out)
// - Parametric triggers: Weather index for crop, hospitalization for health

type MicroProduct struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Premium     float64 `json:"premium_naira"`
	Coverage    float64 `json:"coverage_naira"`
	Duration    string  `json:"duration"`
	ClaimSLA    string  `json:"claim_sla"`
}

var microProducts = []MicroProduct{
	{ID: "MIC-CROP", Name: "Crop Protection", Premium: 500, Coverage: 50000, Duration: "per_season", ClaimSLA: "48h"},
	{ID: "MIC-HEALTH", Name: "Basic Health", Premium: 200, Coverage: 100000, Duration: "monthly", ClaimSLA: "24h"},
	{ID: "MIC-LIFE", Name: "Term Life", Premium: 100, Coverage: 200000, Duration: "monthly", ClaimSLA: "72h"},
	{ID: "MIC-DEVICE", Name: "Device Protection", Premium: 300, Coverage: 75000, Duration: "monthly", ClaimSLA: "48h"},
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
		jsonLog("info", "database connected", "service", "microinsurance-engine", "driver", "postgresql")
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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "microinsurance-engine"})
	})
	r.Get("/api/v1/products", listProducts)
	r.Post("/api/v1/enroll", enroll)
	r.Post("/api/v1/claim", fileClaim)
	r.Get("/api/v1/stats", getStats)

	port := os.Getenv("PORT")
	if port == "" { port = "8124" }
	log.Printf("Microinsurance Engine starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func listProducts(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{"products": microProducts, "total": len(microProducts)})
}

func enroll(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CustomerID string `json:"customer_id"`
		ProductID  string `json:"product_id"`
		Channel    string `json:"channel"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"enrollment_id": "ENR-" + time.Now().Format("20060102150405"),
		"product_id": body.ProductID, "status": "active", "channel": body.Channel,
		"next_premium_due": time.Now().AddDate(0, 1, 0).Format("2006-01-02"),
	})
}

func fileClaim(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"claim_id": "MCL-" + time.Now().Format("20060102150405"),
		"status": "approved", "settlement_amount": 50000,
		"expected_payment": time.Now().Add(48 * time.Hour).Format(time.RFC3339),
		"documents_required": 3, "simplified_process": true,
	})
}

func getStats(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total_enrolled": 125000, "active_policies": 98000, "claims_this_month": 450,
		"avg_premium": 275, "loss_ratio": 0.45, "penetration_rate_pct": 8.5,
	})
}

func init() { _ = math.Pi }
