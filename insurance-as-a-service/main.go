package main

import (
	"crypto/rand"
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"strings"
	"sync"
	"time"

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

// Insurance-as-a-Service (IaaS) API
// Enables partners (ride-hailing, fintech, e-commerce) to embed insurance
// in 3 API calls: Quote → Bind → Claim.

var db *sql.DB

type QuoteRequest struct {
	PartnerID  string  `json:"partner_id"`
	ProductID  string  `json:"product_id"`
	CustomerID string  `json:"customer_id"`
	SumInsured float64 `json:"sum_insured"`
	Duration   int     `json:"duration_days"`
	Metadata   map[string]interface{} `json:"metadata"`
}

type QuoteResponse struct {
	QuoteID      string  `json:"quote_id"`
	Premium      float64 `json:"premium"`
	SumInsured   float64 `json:"sum_insured"`
	Product      string  `json:"product"`
	ValidUntil   string  `json:"valid_until"`
	PartnerShare float64 `json:"partner_share"`
}

type BindRequest struct {
	QuoteID    string `json:"quote_id"`
	CustomerID string `json:"customer_id"`
	PaymentRef string `json:"payment_ref"`
}

type PolicyResponse struct {
	PolicyID    string  `json:"policy_id"`
	QuoteID     string  `json:"quote_id"`
	Status      string  `json:"status"`
	StartDate   string  `json:"start_date"`
	EndDate     string  `json:"end_date"`
	Premium     float64 `json:"premium"`
	Certificate string  `json:"certificate_url"`
}

func generateID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

func calculatePremium(sumInsured float64, durationDays int) float64 {
	baseRate := 0.002
	dailyRate := baseRate / 365
	premium := sumInsured * dailyRate * float64(durationDays)
	if premium < 100 {
		premium = 100
	}
	return premium
}

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" { log.Fatal("FATAL: DATABASE_URL environment variable is required") }
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Printf(`{"level":"warn","msg":"database connection failed","error":"%s"}`, err)
		return
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS iaas_quotes (
		id TEXT PRIMARY KEY, partner_id TEXT, product_id TEXT, customer_id TEXT,
		sum_insured REAL, premium REAL, duration_days INT, valid_until TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
	)`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS iaas_policies (
		id TEXT PRIMARY KEY, quote_id TEXT, customer_id TEXT, payment_ref TEXT,
		status TEXT DEFAULT 'active', start_date TIMESTAMPTZ, end_date TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
	)`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS iaas_claims (
		id TEXT PRIMARY KEY, policy_id TEXT, amount REAL, description TEXT,
		status TEXT DEFAULT 'submitted', created_at TIMESTAMPTZ DEFAULT NOW()
	)`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS iaas_partners (
		id TEXT PRIMARY KEY, name TEXT, api_key TEXT, commission_rate REAL DEFAULT 0.15, created_at TIMESTAMPTZ DEFAULT NOW()
	)`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
	}
	log.Printf(`{"level":"info","msg":"database connected","service":"insurance-as-a-service"}`)
}

func handleQuote(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var req QuoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err), http.StatusBadRequest)
		return
	}
	premium := calculatePremium(req.SumInsured, req.Duration)
	quoteID := generateID("QT-")
	validUntil := time.Now().Add(24 * time.Hour)
	if db != nil {
		if _, err := db.Exec(`INSERT INTO iaas_quotes (id, partner_id, product_id, customer_id, sum_insured, premium, duration_days, valid_until)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, quoteID, req.PartnerID, req.ProductID, req.CustomerID, req.SumInsured, premium, req.Duration, validUntil); err != nil {
			log.Printf(`{"level":"warn","msg":"insert failed","error":"%s"}`, err)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(QuoteResponse{
		QuoteID: quoteID, Premium: premium, SumInsured: req.SumInsured,
		Product: req.ProductID, ValidUntil: validUntil.Format(time.RFC3339), PartnerShare: premium * 0.15,
	})
}

func handleBind(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var req BindRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err), http.StatusBadRequest)
		return
	}
	policyID := generateID("POL-")
	start := time.Now()
	end := start.Add(365 * 24 * time.Hour)
	if db != nil {
		if _, err := db.Exec(`INSERT INTO iaas_policies (id, quote_id, customer_id, payment_ref, start_date, end_date)
			VALUES ($1,$2,$3,$4,$5,$6)`, policyID, req.QuoteID, req.CustomerID, req.PaymentRef, start, end); err != nil {
			log.Printf(`{"level":"warn","msg":"insert failed","error":"%s"}`, err)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(PolicyResponse{
		PolicyID: policyID, QuoteID: req.QuoteID, Status: "active",
		StartDate: start.Format(time.RFC3339), EndDate: end.Format(time.RFC3339),
		Certificate: fmt.Sprintf("https://api.insureportal.com/certificates/%s.pdf", policyID),
	})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	dbStatus := "disconnected"
	if db != nil { if err := db.Ping(); err == nil { dbStatus = "connected" } }
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "insurance-as-a-service", "database": dbStatus})
}
func handleReady(w http.ResponseWriter, r *http.Request) {
	if db == nil { w.WriteHeader(503); json.NewEncoder(w).Encode(map[string]string{"status": "not_ready"}); return }
	json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}
func handleLive(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}


type rateLimiter struct {
	mu       sync.Mutex
	requests map[string][]time.Time
	limit    int
	window   time.Duration
}
func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{requests: make(map[string][]time.Time), limit: limit, window: window}
}
func (rl *rateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-rl.window)
	var valid []time.Time
	for _, t := range rl.requests[ip] {
		if t.After(cutoff) { valid = append(valid, t) }
	}
	if len(valid) >= rl.limit { rl.requests[ip] = valid; return false }
	rl.requests[ip] = append(valid, now)
	return true
}
func rateLimitMiddleware(rl *rateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := r.RemoteAddr
			if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" { ip = strings.Split(fwd, ",")[0] }
			if !rl.allow(strings.TrimSpace(ip)) {
				http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id, X-Trace-ID")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
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
	mux.HandleFunc("/api/v1/quote", handleQuote)
	mux.HandleFunc("/api/v1/bind", handleBind)
	port := ":8122"
	log.Printf(`{"level":"info","msg":"Insurance-as-a-Service API starting","port":"%s"}`, port)
	srv := &http.Server{Addr: port, Handler: mux}
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		jsonLog("info", "shutting down gracefully", "service", "insurance-as-a-service")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			jsonLog("error", "shutdown error", "error", err.Error())
		}
	}()
	log.Fatal(srv.ListenAndServe())
}
