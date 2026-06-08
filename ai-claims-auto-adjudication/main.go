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

// AI Claims Auto-Adjudication Service
// Auto-approves claims below threshold using ML-based risk scoring.
// Business rule: claims <= ₦500,000 with ML confidence >= 0.85 → instant approval.

var db *sql.DB

type ClaimInput struct {
	ID            string  `json:"id"`
	PolicyID      string  `json:"policy_id"`
	ClaimantID    string  `json:"claimant_id"`
	Amount        float64 `json:"amount"`
	Type          string  `json:"type"`
	Description   string  `json:"description"`
	EvidenceCount int     `json:"evidence_count"`
	PolicyAge     int     `json:"policy_age_days"`
	PriorClaims   int     `json:"prior_claims"`
}

type AutoDecision struct {
	ClaimID      string  `json:"claim_id"`
	Decision     string  `json:"decision"`
	Confidence   float64 `json:"confidence"`
	Reason       string  `json:"reason"`
	ProcessingMs int64   `json:"processing_ms"`
	Model        string  `json:"model"`
}

func predictRisk(claim ClaimInput) (float64, float64) {
	// ML-based risk scoring with logistic regression features
	features := []float64{
		claim.Amount / 1000000,
		float64(claim.EvidenceCount) / 10,
		float64(claim.PolicyAge) / 365,
		float64(claim.PriorClaims) / 5,
	}
	weights := []float64{0.35, -0.25, -0.15, 0.30}
	bias := 0.1

	z := bias
	for i, f := range features {
		if i < len(weights) {
			z += f * weights[i]
		}
	}
	riskScore := 1 / (1 + math.Exp(-z))
	confidence := 1 - math.Abs(riskScore-0.5)*2
	return riskScore, confidence
}

func autoAdjudicate(claim ClaimInput) AutoDecision {
	start := time.Now()
	riskScore, confidence := predictRisk(claim)

	decision := AutoDecision{
		ClaimID:      claim.ID,
		ProcessingMs: time.Since(start).Milliseconds(),
		Model:        "logistic-regression-v2",
		Confidence:   confidence,
	}

	if claim.Amount <= 500000 && riskScore < 0.3 && confidence >= 0.85 {
		decision.Decision = "auto_approved"
		decision.Reason = fmt.Sprintf("ML auto-approved: amount ₦%.0f, risk %.2f%%, confidence %.2f%%",
			claim.Amount, riskScore*100, confidence*100)
	} else if riskScore >= 0.7 {
		decision.Decision = "auto_rejected"
		decision.Reason = fmt.Sprintf("ML auto-rejected: high risk %.2f%%", riskScore*100)
	} else {
		decision.Decision = "manual_review"
		decision.Reason = fmt.Sprintf("Escalated: risk %.2f%%, confidence %.2f%%", riskScore*100, confidence*100)
	}
	return decision
}

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("FATAL: DATABASE_URL environment variable is required")
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Printf(`{"level":"warn","msg":"database connection failed","error":"%s"}`, err)
		return
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS ai_decisions (
		id TEXT PRIMARY KEY, claim_id TEXT, decision TEXT, confidence REAL,
		risk_score REAL, model TEXT, processing_ms BIGINT, created_at TIMESTAMPTZ DEFAULT NOW()
	)`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
	}
	log.Printf(`{"level":"info","msg":"database connected","service":"ai-claims-auto-adjudication"}`)
}

func handleAutoAdjudicate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var claim ClaimInput
	if err := json.NewDecoder(r.Body).Decode(&claim); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err), http.StatusBadRequest)
		return
	}
	decision := autoAdjudicate(claim)
	if db != nil {
		riskScore, _ := predictRisk(claim)
		if _, err := db.Exec(`INSERT INTO ai_decisions (id, claim_id, decision, confidence, risk_score, model, processing_ms)
			VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
			fmt.Sprintf("dec-%s", claim.ID), claim.ID, decision.Decision, decision.Confidence, riskScore, decision.Model, decision.ProcessingMs); err != nil {
			log.Printf(`{"level":"warn","msg":"insert ai decision failed","error":"%s"}`, err)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(decision)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	dbStatus := "disconnected"
	if db != nil {
		if err := db.Ping(); err == nil {
			dbStatus = "connected"
		}
	}
	json.NewEncoder(w).Encode(map[string]string{
		"status": "healthy", "service": "ai-claims-auto-adjudication", "database": dbStatus,
	})
}

func handleReady(w http.ResponseWriter, r *http.Request) {
	if db == nil {
		w.WriteHeader(503)
		json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", "reason": "database unreachable"})
		return
	}
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

// ─── AI Claims Auto-Adjudication Logic ───────────────────────────────────────

type ClaimDecision struct {
	ClaimID       string  `json:"claim_id"`
	Amount        float64 `json:"amount"`
	RiskScore     float64 `json:"risk_score"`
	Decision      string  `json:"decision"` // auto_approve, manual_review, reject
	Confidence    float64 `json:"confidence"`
	Factors       []string `json:"factors"`
	SLACategory   string  `json:"sla_category"`
}

// Multi-factor AI claim scoring (weighted rule engine)
func adjudicateClaim(claimID string, amount float64, policyAge int, claimHistory int, hasDocuments bool, matchesPolicy bool) ClaimDecision {
	score := 0.0
	factors := []string{}

	// Amount-based risk (higher amounts = higher risk)
	if amount > 5000000 { score += 35; factors = append(factors, "high_value_claim") }
	if amount > 1000000 { score += 15; factors = append(factors, "significant_amount") }

	// Policy age (new policies are riskier)
	if policyAge < 90 { score += 25; factors = append(factors, "new_policy_90d") }
	if policyAge < 30 { score += 15; factors = append(factors, "very_new_policy_30d") }

	// Claims history (frequent claimants)
	if claimHistory > 3 { score += 20; factors = append(factors, "frequent_claimant") }
	if claimHistory > 5 { score += 15; factors = append(factors, "excessive_claims") }

	// Documentation
	if !hasDocuments { score += 20; factors = append(factors, "missing_documentation") }

	// Policy coverage match
	if !matchesPolicy { score += 30; factors = append(factors, "coverage_mismatch") }

	// Decision thresholds
	decision := "auto_approve"
	confidence := 0.95
	if score >= 60 { decision = "reject"; confidence = 0.80 }
	if score >= 30 && score < 60 { decision = "manual_review"; confidence = 0.70 }

	// SLA based on complexity
	sla := "fast_track" // 5 days
	if decision == "manual_review" { sla = "standard" } // 15 days
	if decision == "reject" { sla = "investigation" }   // 30 days

	return ClaimDecision{
		ClaimID: claimID, Amount: amount,
		RiskScore: math.Min(score, 100), Decision: decision,
		Confidence: confidence, Factors: factors, SLACategory: sla,
	}
}

func handleAdjudicateClaim(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ClaimID      string  `json:"claim_id"`
		Amount       float64 `json:"amount"`
		PolicyAge    int     `json:"policy_age_days"`
		ClaimHistory int     `json:"claim_history_count"`
		HasDocuments bool    `json:"has_documents"`
		MatchesPolicy bool   `json:"matches_policy_coverage"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}
	result := adjudicateClaim(req.ClaimID, req.Amount, req.PolicyAge, req.ClaimHistory, req.HasDocuments, req.MatchesPolicy)
	if db != nil {
		data, _ := json.Marshal(result)
		db.Exec("INSERT INTO ai_adjudication_results (claim_id, decision, risk_score, data, created_at) VALUES ($1, $2, $3, $4, NOW())",
			req.ClaimID, result.Decision, result.RiskScore, string(data))
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func main() {
	initDB()
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/ready", handleReady)
	mux.HandleFunc("/live", handleLive)
	mux.HandleFunc("/api/v1/auto-adjudicate", handleAutoAdjudicate)
	mux.HandleFunc("/api/v1/adjudication-history", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		rows, err := db.Query("SELECT id, claim_type, amount, risk_score, decision, created_at FROM adjudication_results ORDER BY id DESC LIMIT 50")
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"data": []interface{}{}, "error": err.Error()})
			return
		}
		defer rows.Close()
		var results []map[string]interface{}
		for rows.Next() {
			var id int; var claimType, decision string; var amount, riskScore float64; var createdAt interface{}
			if err := rows.Scan(&id, &claimType, &amount, &riskScore, &decision, &createdAt); err != nil { continue }
			results = append(results, map[string]interface{}{"id": id, "claim_type": claimType, "amount": amount, "risk_score": riskScore, "decision": decision, "created_at": createdAt})
		}
		if results == nil { results = []map[string]interface{}{} }
		json.NewEncoder(w).Encode(map[string]interface{}{"data": results, "total": len(results)})
	})
	mux.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var total int
		db.QueryRow("SELECT COUNT(*) FROM adjudication_results").Scan(&total)
		json.NewEncoder(w).Encode(map[string]interface{}{"service": "ai-claims-auto-adjudication", "total_adjudications": total})
	})
	port := os.Getenv("PORT")
	if port == "" {
		port = ":8120"
	}
	log.Printf(`{"level":"info","msg":"AI Claims Auto-Adjudication starting","port":"%s"}`, port)
	srv := &http.Server{Addr: port, Handler: mux}
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		jsonLog("info", "shutting down gracefully", "service", "ai-claims-auto-adjudication")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			jsonLog("error", "shutdown error", "error", err.Error())
		}
	}()
	log.Fatal(srv.ListenAndServe())
}
