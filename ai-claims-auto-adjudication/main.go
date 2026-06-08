package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"time"

	_ "github.com/lib/pq"
)

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
		dsn = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
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

func main() {
	initDB()
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/ready", handleReady)
	mux.HandleFunc("/live", handleLive)
	mux.HandleFunc("/api/v1/auto-adjudicate", handleAutoAdjudicate)
	port := ":8120"
	log.Printf(`{"level":"info","msg":"AI Claims Auto-Adjudication starting","port":"%s"}`, port)
	log.Fatal(http.ListenAndServe(port, mux))
}
