package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
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

// Predictive Churn Prevention Engine
// ML model predicting policy lapse 30 days before renewal.
// Triggers automated retention campaigns (SMS, agent outreach, discounts).

var db *sql.DB

type PolicyHolder struct {
	ID              string  `json:"id"`
	PolicyID        string  `json:"policy_id"`
	PremiumAmount   float64 `json:"premium_amount"`
	DaysTillRenewal int     `json:"days_till_renewal"`
	PaymentHistory  int     `json:"payment_history_score"` // 0-100
	ClaimHistory    int     `json:"claim_count"`
	EngagementScore int     `json:"engagement_score"` // 0-100
	TenureMonths    int     `json:"tenure_months"`
}

type ChurnPrediction struct {
	PolicyID        string  `json:"policy_id"`
	ChurnProb       float64 `json:"churn_probability"`
	RiskLevel       string  `json:"risk_level"`
	RetentionAction string  `json:"retention_action"`
	DiscountOffer   float64 `json:"discount_offer_pct"`
	Channel         string  `json:"channel"`
	Priority        int     `json:"priority"`
}

func predictChurn(ph PolicyHolder) ChurnPrediction {
	// Logistic regression: payment history, engagement, tenure, claims
	features := map[string]float64{
		"payment":    float64(ph.PaymentHistory) / 100,
		"engagement": float64(ph.EngagementScore) / 100,
		"tenure":     math.Min(float64(ph.TenureMonths)/60, 1),
		"claims":     math.Min(float64(ph.ClaimHistory)/5, 1),
		"days":       math.Max(1-float64(ph.DaysTillRenewal)/90, 0),
	}
	weights := map[string]float64{
		"payment": -0.4, "engagement": -0.3, "tenure": -0.2, "claims": 0.15, "days": 0.25,
	}
	z := 0.3 // bias toward churn
	for k, v := range features {
		z += v * weights[k]
	}
	churnProb := 1 / (1 + math.Exp(-z*3))

	pred := ChurnPrediction{PolicyID: ph.PolicyID, ChurnProb: churnProb}

	switch {
	case churnProb >= 0.7:
		pred.RiskLevel = "high"
		pred.RetentionAction = "agent_outreach"
		pred.DiscountOffer = 15
		pred.Channel = "phone_call"
		pred.Priority = 1
	case churnProb >= 0.4:
		pred.RiskLevel = "medium"
		pred.RetentionAction = "sms_campaign"
		pred.DiscountOffer = 10
		pred.Channel = "sms"
		pred.Priority = 2
	default:
		pred.RiskLevel = "low"
		pred.RetentionAction = "email_reminder"
		pred.DiscountOffer = 0
		pred.Channel = "email"
		pred.Priority = 3
	}
	return pred
}

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" { log.Fatal("FATAL: DATABASE_URL environment variable is required") }
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil { log.Printf(`{"level":"warn","msg":"db failed","error":"%s"}`, err); return }
	db.SetMaxOpenConns(25); db.SetMaxIdleConns(5); db.SetConnMaxLifetime(5 * time.Minute)
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS churn_predictions (
		id SERIAL PRIMARY KEY, policy_id TEXT, churn_prob REAL, risk_level TEXT,
		retention_action TEXT, discount_pct REAL, channel TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
	)`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
	}
	log.Printf(`{"level":"info","msg":"database connected","service":"predictive-churn-engine"}`)
}

func handlePredict(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed); return
	}
	var ph PolicyHolder
	if err := json.NewDecoder(r.Body).Decode(&ph); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err), http.StatusBadRequest); return
	}
	pred := predictChurn(ph)
	if db != nil {
		if _, err := db.Exec(`INSERT INTO churn_predictions (policy_id, churn_prob, risk_level, retention_action, discount_pct, channel)
			VALUES ($1,$2,$3,$4,$5,$6)`, pred.PolicyID, pred.ChurnProb, pred.RiskLevel, pred.RetentionAction, pred.DiscountOffer, pred.Channel); err != nil {
			log.Printf(`{"level":"warn","msg":"insert failed","error":"%s"}`, err)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(pred)
}

func handleBatchPredict(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed); return
	}
	var holders []PolicyHolder
	if err := json.NewDecoder(r.Body).Decode(&holders); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err), http.StatusBadRequest); return
	}
	results := make([]ChurnPrediction, len(holders))
	for i, ph := range holders {
		results[i] = predictChurn(ph)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	dbStatus := "disconnected"
	if db != nil { if err := db.Ping(); err == nil { dbStatus = "connected" } }
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "predictive-churn-engine", "database": dbStatus})
}
func handleReady(w http.ResponseWriter, r *http.Request) {
	if db == nil { w.WriteHeader(503); json.NewEncoder(w).Encode(map[string]string{"status": "not_ready"}); return }
	json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}
func handleLive(w http.ResponseWriter, r *http.Request) { json.NewEncoder(w).Encode(map[string]string{"status": "alive"}) }


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

// ─── Predictive Churn Engine Logic ───────────────────────────────────────────



func main() {
	initDB()
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/ready", handleReady)
	mux.HandleFunc("/live", handleLive)
	mux.HandleFunc("/api/v1/predict", handlePredict)
	mux.HandleFunc("/api/v1/batch-predict", handleBatchPredict)
	port := ":8124"
	log.Printf(`{"level":"info","msg":"Predictive Churn Engine starting","port":"%s"}`, port)
	srv := &http.Server{Addr: port, Handler: mux}
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		jsonLog("info", "shutting down gracefully", "service", "predictive-churn-engine")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			jsonLog("error", "shutdown error", "error", err.Error())
		}
	}()
	log.Fatal(srv.ListenAndServe())
}
