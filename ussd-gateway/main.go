package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"database/sql"
	"fmt"

	_ "github.com/lib/pq"
)

// USSD Gateway — session-based USSD menu system for insurance services
// Business Rules:
// - Short code: *384*xxx# (NAICOM approved)
// - Session timeout: 180 seconds
// - Menu depth: Max 5 levels (UX constraint)
// - Languages: English, Hausa, Yoruba, Igbo
// - Operations: Check policy, file claim, pay premium, agent locator
// - Available 24/7, supports all 36 states + FCT


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
		jsonLog("info", "database connected", "service", "ussd-gateway", "driver", "postgresql")
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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "ussd-gateway"})
	})
	r.Post("/api/v1/session", handleUSSD)
	r.Get("/api/v1/menu", getMenu)
	r.Get("/api/v1/stats", ussdStats)
	port := os.Getenv("PORT")
	if port == "" { port = "8092" }
	log.Printf("USSD Gateway starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func handleUSSD(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SessionID string `json:"session_id"`
		MSISDN    string `json:"msisdn"`
		Input     string `json:"input"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	response := "Welcome to InsurePortal\n1. Check Policy\n2. File Claim\n3. Pay Premium\n4. Find Agent\n5. Change Language"
	if body.Input == "1" { response = "Enter Policy Number:" }
	if body.Input == "2" { response = "Enter Claim Type:\n1. Motor\n2. Health\n3. Property\n4. Life" }
	json.NewEncoder(w).Encode(map[string]interface{}{
		"session_id": body.SessionID, "response": response, "end_session": false,
		"timeout_seconds": 180,
	})
}

func getMenu(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"short_code": "*384*100#", "languages": []string{"en", "ha", "yo", "ig"},
		"menu_tree": map[string]interface{}{
			"1": "Check Policy", "2": "File Claim", "3": "Pay Premium",
			"4": "Find Agent", "5": "Change Language", "0": "Exit",
		},
		"max_depth": 5, "session_timeout": 180,
	})
}

func ussdStats(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"sessions_today": 12500, "completed_transactions": 3200,
		"avg_session_duration": "45 seconds", "drop_off_rate": 0.22,
		"top_service": "check_policy", "states_covered": 37,
	})
}
