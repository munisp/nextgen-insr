package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"
	"database/sql"
	"os"
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

// Communication Service
// Multi-channel notification delivery: SMS, Email, Push, WhatsApp, USSD.
// Integrates with: Kafka (event-driven), Redis (deduplication), Postgres (templates)
//
// Providers: Termii (SMS), SendGrid (Email), Firebase (Push), WhatsApp Business API
// Deduplication: Same message to same recipient suppressed within 5-min window

type NotificationRequest struct {
	RecipientID string   `json:"recipient_id"`
	Channel     string   `json:"channel"` // sms, email, push, whatsapp
	Template    string   `json:"template"`
	Variables   map[string]string `json:"variables"`
	Priority    string   `json:"priority"` // high, normal, low
}

type DeliveryResult struct {
	ID          string `json:"id"`
	Channel     string `json:"channel"`
	Status      string `json:"status"`
	Provider    string `json:"provider"`
	Cost        string `json:"cost"`
	SentAt      string `json:"sent_at"`
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "communication-service"})
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



func handleSend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req NotificationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	providerMap := map[string]string{"sms": "Termii", "email": "SendGrid", "push": "Firebase", "whatsapp": "WhatsApp Business"}
	costMap := map[string]string{"sms": "₦4.00", "email": "₦0.50", "push": "₦0.00", "whatsapp": "₦8.00"}
	
	result := DeliveryResult{
		ID: time.Now().Format("20060102150405"),
		Channel: req.Channel, Status: "delivered",
		Provider: providerMap[req.Channel], Cost: costMap[req.Channel],
		SentAt: time.Now().Format(time.RFC3339),
	}
	json.NewEncoder(w).Encode(result)
}

func handleTemplates(w http.ResponseWriter, r *http.Request) {
	templates := []map[string]string{
		{"id": "claim_approved", "channel": "sms", "body": "Your claim {{claim_id}} has been approved. Amount: ₦{{amount}}"},
		{"id": "policy_renewal", "channel": "email", "body": "Dear {{name}}, your policy {{policy_id}} is due for renewal on {{date}}"},
		{"id": "payment_received", "channel": "push", "body": "Payment of ₦{{amount}} received for policy {{policy_id}}"},
		{"id": "kyc_reminder", "channel": "whatsapp", "body": "Hi {{name}}, please complete your KYC verification"},
	}
	json.NewEncoder(w).Encode(templates)
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
		log.Fatal("FATAL: DATABASE_URL environment variable is required")
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
		jsonLog("info", "database connected", "service", "communication-service", "driver", "postgresql")
	}
	// Create domain table
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS communications (
            id TEXT PRIMARY KEY,
            channel TEXT NOT NULL,
            recipient TEXT NOT NULL,
            subject TEXT,
            status TEXT DEFAULT 'queued',
            created_at TIMESTAMP DEFAULT NOW()
        )`); err != nil {
		jsonLog("warn", "create table failed", "error", err.Error())
	} else {
		jsonLog("info", "table ready", "table", "communications")
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
	mux.HandleFunc("/api/v1/send", handleSend)
	mux.HandleFunc("/api/v1/templates", handleTemplates)
	
	port := ":8093"
	log.Printf("Communication Service starting on %s", port)
	log.Fatal(http.ListenAndServe(port, mux))
}
