package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
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

// Digital Twin Risk Modeler
// Monte Carlo simulation engine for portfolio risk modeling.
// Models scenarios: pandemic, natural disaster, economic downturn.

var db *sql.DB

type SimulationRequest struct {
	Scenario       string  `json:"scenario"` // pandemic, flood, recession, earthquake
	PortfolioValue float64 `json:"portfolio_value"`
	PolicyCount    int     `json:"policy_count"`
	Iterations     int     `json:"iterations"`
	TimeHorizon    int     `json:"time_horizon_months"`
}

type SimulationResult struct {
	Scenario         string   `json:"scenario"`
	Iterations       int      `json:"iterations"`
	MeanLoss         float64  `json:"mean_loss"`
	MedianLoss       float64  `json:"median_loss"`
	P95Loss          float64  `json:"p95_loss"`
	P99Loss          float64  `json:"p99_loss"`
	MaxLoss          float64  `json:"max_loss"`
	LossRatio        float64  `json:"loss_ratio"`
	CapitalRequired  float64  `json:"capital_required"`
	RuinProbability  float64  `json:"ruin_probability"`
	ExecutionMs      int64    `json:"execution_ms"`
}

func runMonteCarlo(req SimulationRequest) SimulationResult {
	start := time.Now()
	if req.Iterations == 0 { req.Iterations = 10000 }
	if req.TimeHorizon == 0 { req.TimeHorizon = 12 }

	// Scenario-specific parameters
	var baseLossRate, volatility, catastropheFactor float64
	switch req.Scenario {
	case "pandemic":
		baseLossRate = 0.08; volatility = 0.15; catastropheFactor = 2.5
	case "flood":
		baseLossRate = 0.12; volatility = 0.25; catastropheFactor = 3.0
	case "recession":
		baseLossRate = 0.06; volatility = 0.10; catastropheFactor = 1.5
	case "earthquake":
		baseLossRate = 0.15; volatility = 0.35; catastropheFactor = 4.0
	default:
		baseLossRate = 0.05; volatility = 0.08; catastropheFactor = 1.0
	}

	losses := make([]float64, req.Iterations)
	ruinCount := 0
	reserves := req.PortfolioValue * 0.15

	for i := 0; i < req.Iterations; i++ {
		totalLoss := 0.0
		for m := 0; m < req.TimeHorizon; m++ {
			monthlyRate := baseLossRate + volatility*rand.NormFloat64()
			if rand.Float64() < 0.02 { monthlyRate *= catastropheFactor }
			if monthlyRate < 0 { monthlyRate = 0 }
			monthLoss := req.PortfolioValue * monthlyRate / 12
			totalLoss += monthLoss
		}
		losses[i] = totalLoss
		if totalLoss > reserves { ruinCount++ }
	}

	// Sort for percentiles
	sortFloat64s(losses)

	p95Idx := int(float64(req.Iterations) * 0.95)
	p99Idx := int(float64(req.Iterations) * 0.99)

	mean := 0.0
	for _, l := range losses { mean += l }
	mean /= float64(req.Iterations)

	return SimulationResult{
		Scenario: req.Scenario, Iterations: req.Iterations,
		MeanLoss: math.Round(mean*100)/100,
		MedianLoss: math.Round(losses[req.Iterations/2]*100)/100,
		P95Loss: math.Round(losses[p95Idx]*100)/100,
		P99Loss: math.Round(losses[p99Idx]*100)/100,
		MaxLoss: math.Round(losses[req.Iterations-1]*100)/100,
		LossRatio: math.Round(mean/req.PortfolioValue*10000)/10000,
		CapitalRequired: math.Round(losses[p99Idx]*1.1*100)/100,
		RuinProbability: float64(ruinCount) / float64(req.Iterations),
		ExecutionMs: time.Since(start).Milliseconds(),
	}
}

func sortFloat64s(a []float64) {
	for i := 1; i < len(a); i++ {
		key := a[i]; j := i - 1
		for j >= 0 && a[j] > key { a[j+1] = a[j]; j-- }
		a[j+1] = key
	}
}

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" { log.Fatal("FATAL: DATABASE_URL environment variable is required") }
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil { log.Printf(`{"level":"warn","msg":"db failed","error":"%s"}`, err); return }
	db.SetMaxOpenConns(25); db.SetMaxIdleConns(5); db.SetConnMaxLifetime(5 * time.Minute)
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS risk_simulations (
		id SERIAL PRIMARY KEY, scenario TEXT, iterations INT, mean_loss REAL, p95_loss REAL,
		p99_loss REAL, capital_required REAL, ruin_prob REAL, execution_ms BIGINT, created_at TIMESTAMPTZ DEFAULT NOW()
	)`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
	}
	log.Printf(`{"level":"info","msg":"database connected","service":"digital-twin-risk-modeler"}`)
}

func handleSimulate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed); return
	}
	var req SimulationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err), http.StatusBadRequest); return
	}
	result := runMonteCarlo(req)
	if db != nil {
		if _, err := db.Exec(`INSERT INTO risk_simulations (scenario, iterations, mean_loss, p95_loss, p99_loss, capital_required, ruin_prob, execution_ms)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, result.Scenario, result.Iterations, result.MeanLoss, result.P95Loss, result.P99Loss, result.CapitalRequired, result.RuinProbability, result.ExecutionMs); err != nil {
			log.Printf(`{"level":"warn","msg":"insert failed","error":"%s"}`, err)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleStressTest(w http.ResponseWriter, r *http.Request) {
	scenarios := []string{"pandemic", "flood", "recession", "earthquake"}
	results := make([]SimulationResult, len(scenarios))
	for i, s := range scenarios {
		results[i] = runMonteCarlo(SimulationRequest{
			Scenario: s, PortfolioValue: 10000000000, PolicyCount: 50000, Iterations: 5000, TimeHorizon: 12,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	dbStatus := "disconnected"
	if db != nil { if err := db.Ping(); err == nil { dbStatus = "connected" } }
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "digital-twin-risk-modeler", "database": dbStatus})
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

// ─── Digital Twin Risk Modeling Logic ────────────────────────────────────────

type AssetRiskModel struct {
	AssetID       string  `json:"asset_id"`
	AssetType     string  `json:"asset_type"`
	CurrentValue  float64 `json:"current_value"`
	RiskScore     float64 `json:"risk_score"`
	FailureProb   float64 `json:"failure_probability"`
	ExpectedLoss  float64 `json:"expected_loss"`
	OptimalCover  float64 `json:"optimal_coverage"`
	Recommendations []string `json:"recommendations"`
}

func modelAssetRisk(assetType string, age int, value float64, maintenanceScore float64, environmentRisk float64) AssetRiskModel {
	// Failure probability based on bathtub curve (reliability engineering)
	failureProb := 0.01 // base 1%
	if age < 2 { failureProb = 0.03 } // infant mortality
	if age > 10 { failureProb += float64(age-10) * 0.005 } // wear-out

	// Adjust for maintenance quality (0-100)
	if maintenanceScore < 50 { failureProb *= 2.0 }
	if maintenanceScore < 25 { failureProb *= 1.5 }

	// Environment risk multiplier
	failureProb *= (1 + environmentRisk/100)
	failureProb = math.Min(failureProb, 0.95)

	// Expected loss = value * failure probability * severity factor
	severityFactor := map[string]float64{
		"building": 0.40, "vehicle": 0.60, "machinery": 0.70,
		"electronics": 0.80, "inventory": 0.50,
	}
	severity := severityFactor[assetType]
	if severity == 0 { severity = 0.50 }
	expectedLoss := value * failureProb * severity

	// Optimal coverage (expected loss * safety margin)
	optimalCover := expectedLoss * 3.0 // 3x expected loss

	riskScore := failureProb * 100
	recs := []string{}
	if riskScore > 50 { recs = append(recs, "Immediate maintenance required") }
	if riskScore > 30 { recs = append(recs, "Increase coverage") }
	if age > 15 { recs = append(recs, "Consider asset replacement") }

	return AssetRiskModel{
		AssetType: assetType, CurrentValue: value,
		RiskScore: math.Round(riskScore*100) / 100,
		FailureProb: math.Round(failureProb*10000) / 10000,
		ExpectedLoss: math.Round(expectedLoss*100) / 100,
		OptimalCover: math.Round(optimalCover*100) / 100,
		Recommendations: recs,
	}
}

func handleModelRisk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		AssetID        string  `json:"asset_id"`
		AssetType      string  `json:"asset_type"`
		Age            int     `json:"age_years"`
		Value          float64 `json:"value"`
		MaintenanceScore float64 `json:"maintenance_score"`
		EnvironmentRisk float64 `json:"environment_risk"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}
	result := modelAssetRisk(req.AssetType, req.Age, req.Value, req.MaintenanceScore, req.EnvironmentRisk)
	result.AssetID = req.AssetID
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func main() {
	initDB()
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/ready", handleReady)
	mux.HandleFunc("/live", handleLive)
	mux.HandleFunc("/api/v1/simulate", handleSimulate)
	mux.HandleFunc("/api/v1/stress-test", handleStressTest)
	port := ":8125"
	log.Printf(`{"level":"info","msg":"Digital Twin Risk Modeler starting","port":"%s"}`, port)
	srv := &http.Server{Addr: port, Handler: mux}
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		jsonLog("info", "shutting down gracefully", "service", "digital-twin-risk-modeler")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			jsonLog("error", "shutdown error", "error", err.Error())
		}
	}()
	log.Fatal(srv.ListenAndServe())
}
