package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"time"

	_ "github.com/lib/pq"
)

// Parametric Insurance Engine
// Auto-payouts triggered by measurable events (weather, flight delays, earthquake magnitude).
// No claims process needed — if the parameter exceeds threshold, payout is automatic.

var db *sql.DB

type ParametricPolicy struct {
	ID            string  `json:"id"`
	Type          string  `json:"type"` // weather, flight_delay, earthquake, flood
	TriggerParam  string  `json:"trigger_param"`
	ThresholdMin  float64 `json:"threshold_min"`
	ThresholdMax  float64 `json:"threshold_max"`
	PayoutAmount  float64 `json:"payout_amount"`
	PremiumAmount float64 `json:"premium_amount"`
	Region        string  `json:"region"`
	Status        string  `json:"status"`
}

type EventTrigger struct {
	PolicyID    string  `json:"policy_id"`
	EventType   string  `json:"event_type"`
	MeasuredVal float64 `json:"measured_value"`
	Source      string  `json:"source"`
	Timestamp   string  `json:"timestamp"`
}

type PayoutResult struct {
	PolicyID     string  `json:"policy_id"`
	Triggered    bool    `json:"triggered"`
	PayoutAmount float64 `json:"payout_amount"`
	MeasuredVal  float64 `json:"measured_value"`
	Threshold    float64 `json:"threshold"`
	Reason       string  `json:"reason"`
}

func evaluateTrigger(policy ParametricPolicy, event EventTrigger) PayoutResult {
	result := PayoutResult{
		PolicyID:    event.PolicyID,
		MeasuredVal: event.MeasuredVal,
		Threshold:   policy.ThresholdMin,
	}

	switch policy.Type {
	case "weather":
		if event.MeasuredVal < policy.ThresholdMin {
			result.Triggered = true
			result.PayoutAmount = policy.PayoutAmount
			result.Reason = fmt.Sprintf("Rainfall %.1fmm below threshold %.1fmm — drought payout triggered", event.MeasuredVal, policy.ThresholdMin)
		} else if event.MeasuredVal > policy.ThresholdMax {
			result.Triggered = true
			result.PayoutAmount = policy.PayoutAmount
			result.Reason = fmt.Sprintf("Rainfall %.1fmm above threshold %.1fmm — flood payout triggered", event.MeasuredVal, policy.ThresholdMax)
		} else {
			result.Reason = "Rainfall within normal range"
		}
	case "flight_delay":
		if event.MeasuredVal > policy.ThresholdMin {
			result.Triggered = true
			result.PayoutAmount = policy.PayoutAmount
			result.Reason = fmt.Sprintf("Flight delayed %.0f min (threshold: %.0f min)", event.MeasuredVal, policy.ThresholdMin)
		} else {
			result.Reason = "Flight on time or within tolerance"
		}
	case "earthquake":
		if event.MeasuredVal >= policy.ThresholdMin {
			scaleFactor := (event.MeasuredVal - policy.ThresholdMin) / 3.0
			if scaleFactor > 1 {
				scaleFactor = 1
			}
			result.Triggered = true
			result.PayoutAmount = policy.PayoutAmount * scaleFactor
			result.Reason = fmt.Sprintf("Earthquake magnitude %.1f (threshold: %.1f) — scaled payout", event.MeasuredVal, policy.ThresholdMin)
		} else {
			result.Reason = "Below earthquake threshold"
		}
	}
	return result
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
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS parametric_policies (
		id TEXT PRIMARY KEY, type TEXT, trigger_param TEXT, threshold_min REAL, threshold_max REAL,
		payout_amount REAL, premium_amount REAL, region TEXT, status TEXT DEFAULT 'active',
		created_at TIMESTAMPTZ DEFAULT NOW()
	)`)
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS parametric_payouts (
		id SERIAL PRIMARY KEY, policy_id TEXT, measured_value REAL, payout_amount REAL,
		triggered BOOLEAN, reason TEXT, source TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
	)`)
	log.Printf(`{"level":"info","msg":"database connected","service":"parametric-insurance-engine"}`)

	// Seed sample policies
	samplePolicies := []struct{ id, typ, param, region string; min, max, payout, premium float64 }{
		{"PAR-W-001", "weather", "rainfall_mm", "Lagos", 50, 300, 150000, 12000},
		{"PAR-W-002", "weather", "rainfall_mm", "Kano", 30, 250, 200000, 15000},
		{"PAR-F-001", "flight_delay", "delay_minutes", "Lagos-Abuja", 120, 9999, 50000, 3500},
		{"PAR-E-001", "earthquake", "magnitude", "Abuja", 4.5, 10, 500000, 25000},
	}
	for _, p := range samplePolicies {
		_, _ = db.Exec(`INSERT INTO parametric_policies (id, type, trigger_param, threshold_min, threshold_max, payout_amount, premium_amount, region)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, p.id, p.typ, p.param, p.min, p.max, p.payout, p.premium, p.region)
	}
}

func handleEvaluate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var event EventTrigger
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err), http.StatusBadRequest)
		return
	}
	// In production, fetch policy from DB. For now, use sample.
	policy := ParametricPolicy{Type: event.EventType, ThresholdMin: 50, ThresholdMax: 300, PayoutAmount: 150000}
	if db != nil {
		row := db.QueryRow(`SELECT type, threshold_min, threshold_max, payout_amount FROM parametric_policies WHERE id=$1`, event.PolicyID)
		_ = row.Scan(&policy.Type, &policy.ThresholdMin, &policy.ThresholdMax, &policy.PayoutAmount)
	}
	result := evaluateTrigger(policy, event)
	if db != nil && result.Triggered {
		_, _ = db.Exec(`INSERT INTO parametric_payouts (policy_id, measured_value, payout_amount, triggered, reason, source)
			VALUES ($1,$2,$3,$4,$5,$6)`, event.PolicyID, event.MeasuredVal, result.PayoutAmount, result.Triggered, result.Reason, event.Source)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleSimulate(w http.ResponseWriter, r *http.Request) {
	results := make([]PayoutResult, 0)
	types := []string{"weather", "flight_delay", "earthquake"}
	for _, t := range types {
		event := EventTrigger{PolicyID: fmt.Sprintf("SIM-%s", t), EventType: t, MeasuredVal: rand.Float64() * 500}
		policy := ParametricPolicy{Type: t, ThresholdMin: 50, ThresholdMax: 300, PayoutAmount: 150000}
		results = append(results, evaluateTrigger(policy, event))
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	dbStatus := "disconnected"
	if db != nil { if err := db.Ping(); err == nil { dbStatus = "connected" } }
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "parametric-insurance-engine", "database": dbStatus})
}
func handleReady(w http.ResponseWriter, r *http.Request) {
	if db == nil { w.WriteHeader(503); json.NewEncoder(w).Encode(map[string]string{"status": "not_ready"}); return }
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
	mux.HandleFunc("/api/v1/evaluate", handleEvaluate)
	mux.HandleFunc("/api/v1/simulate", handleSimulate)
	port := ":8121"
	log.Printf(`{"level":"info","msg":"Parametric Insurance Engine starting","port":"%s"}`, port)
	log.Fatal(http.ListenAndServe(port, mux))
}
