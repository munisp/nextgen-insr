package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"time"

	_ "github.com/lib/pq"
)

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
	if dsn == "" { dsn = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable" }
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
	log.Fatal(http.ListenAndServe(port, mux))
}
