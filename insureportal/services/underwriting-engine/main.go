package main

import (
	"encoding/json"
	"log"
	"math"
	"net/http"
	"strconv"
	"fmt"
)

// Underwriting Engine
// Automated risk assessment and premium calculation.
// Integrates with: Postgres, Redis, Kafka, OpenSearch
//
// Supported Products: Motor, Health, Home, Life, Travel, Marine
// Rating Factors: Age, occupation, location, claims history, sum insured

type QuoteRequest struct {
	Product    string  `json:"product"`
	SumInsured float64 `json:"sum_insured"`
	Age        int     `json:"age"`
	Occupation string  `json:"occupation"`
	Location   string  `json:"location"` // Nigerian state
	ClaimsHistory int  `json:"claims_history"` // last 5 years
}

type QuoteResponse struct {
	Premium     float64 `json:"premium"`
	BasePremium float64 `json:"base_premium"`
	LoadingPct  float64 `json:"loading_pct"`
	DiscountPct float64 `json:"discount_pct"`
	RiskClass   string  `json:"risk_class"`
	Terms       string  `json:"terms"`
	Declined    bool    `json:"declined"`
	Reason      string  `json:"reason,omitempty"`
}

func calculatePremium(req QuoteRequest) QuoteResponse {
	baseRates := map[string]float64{
		"motor": 0.03, "health": 0.05, "home": 0.015,
		"life": 0.02, "travel": 0.08, "marine": 0.04,
	}
	baseRate, ok := baseRates[req.Product]
	if !ok { baseRate = 0.05 }

	basePremium := req.SumInsured * baseRate
	loading := 0.0
	discount := 0.0

	// Age loading (life/health)
	if req.Product == "life" || req.Product == "health" {
		if req.Age > 60 { loading += 0.50 }
		if req.Age > 50 { loading += 0.25 }
	}
	// Claims loading
	if req.ClaimsHistory > 0 { loading += float64(req.ClaimsHistory) * 0.10 }
	if req.ClaimsHistory > 3 { loading += 0.20 }

	// Location discount (lower risk states)
	lowRiskStates := map[string]bool{"Abuja": true, "Lagos": true, "Rivers": true}
	if lowRiskStates[req.Location] { discount += 0.05 }
	// No-claims discount
	if req.ClaimsHistory == 0 { discount += 0.15 }

	// Decline rules
	if req.Age > 75 && req.Product == "life" {
		return QuoteResponse{Declined: true, Reason: "Exceeds maximum entry age (75) for life insurance"}
	}
	if loading > 1.0 {
		return QuoteResponse{Declined: true, Reason: "Risk exceeds acceptable threshold"}
	}

	premium := basePremium * (1 + loading - discount)
	premium = math.Max(premium, 5000) // Minimum premium ₦5,000

	riskClass := "standard"
	if loading > 0.3 { riskClass = "substandard" }
	if loading == 0 && discount > 0.1 { riskClass = "preferred" }

	return QuoteResponse{
		Premium: math.Round(premium*100) / 100, BasePremium: basePremium,
		LoadingPct: loading * 100, DiscountPct: discount * 100,
		RiskClass: riskClass, Terms: "Annual renewable",
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "underwriting-engine"})
}

func handleQuote(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req QuoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	result := calculatePremium(req)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
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

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/api/v1/quote", handleQuote)
	port := ":8096"
	log.Printf("Underwriting Engine starting on %s", port)
	log.Fatal(http.ListenAndServe(port, mux))
}
