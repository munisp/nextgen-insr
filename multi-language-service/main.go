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

// Multi-Language Service — i18n for Nigerian languages + Pan-African markets
// Supported: English, Yoruba, Igbo, Hausa, Pidgin, French (West Africa)
// Business Rules:
// - Default: English, auto-detect from browser/device locale
// - Insurance terms: Professionally translated, NAICOM-approved terminology
// - SMS/USSD: Must support local language for rural agents
// - Fallback: English if translation unavailable

var translations = map[string]map[string]string{
	"en": {"welcome": "Welcome to InsurePortal", "policy": "Insurance Policy", "claim": "File a Claim", "premium": "Premium Payment"},
	"yo": {"welcome": "E kaabo si InsurePortal", "policy": "Iwe Adehun Insora", "claim": "Fi Ejo Sile", "premium": "Owo Isanwo"},
	"ig": {"welcome": "Nnoo na InsurePortal", "policy": "Akwukwo Insora", "claim": "Tinye Ariro", "premium": "Ugwo Insora"},
	"ha": {"welcome": "Barka da zuwa InsurePortal", "policy": "Takaddama Insora", "claim": "Shigar da Kara", "premium": "Biyan Insora"},
	"pcm": {"welcome": "You don reach InsurePortal", "policy": "Insurance Paper", "claim": "Make Claim", "premium": "Pay Premium"},
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

	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS translations (id TEXT PRIMARY KEY, locale TEXT NOT NULL, key TEXT NOT NULL, value TEXT, namespace TEXT DEFAULT 'common', created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(locale, key, namespace))`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table translations failed","error":"%s"}`, err)
	}
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)
	if err := db.Ping(); err != nil {
		jsonLog("warn", "database ping failed", "error", err.Error())
	} else {
		jsonLog("info", "database connected", "service", "multi-language-service", "driver", "postgresql")
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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "multi-language-service"})
	})
	r.Get("/ready", func(w http.ResponseWriter, r *http.Request) { handleReady(w, r) })
	r.Get("/live", func(w http.ResponseWriter, r *http.Request) { handleLive(w, r) })
	r.Get("/api/v1/languages", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"languages": []map[string]string{
				{"code": "en", "name": "English", "status": "complete"},
				{"code": "yo", "name": "Yoruba", "status": "complete"},
				{"code": "ig", "name": "Igbo", "status": "complete"},
				{"code": "ha", "name": "Hausa", "status": "complete"},
				{"code": "pcm", "name": "Pidgin", "status": "partial"},
				{"code": "fr", "name": "French", "status": "partial"},
			},
		})
	})
	r.Get("/api/v1/translate/{lang}", func(w http.ResponseWriter, r *http.Request) {
		lang := chi.URLParam(r, "lang")
		t, ok := translations[lang]
		if !ok { t = translations["en"] }
		json.NewEncoder(w).Encode(map[string]interface{}{"language": lang, "translations": t})
	})
	port := os.Getenv("PORT")
	if port == "" { port = "8137" }
	log.Printf("Multi-Language Service starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
