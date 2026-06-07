package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"fmt"
)

// Reinsurance Service
// Manages treaty and facultative reinsurance relationships.
// Integrates with: Postgres, Kafka, TigerBeetle (settlements)
//
// Business Rules:
// - Automatic cession for risks > ₦100M (quota share 70/30)
// - Surplus treaty: retention ₦50M, 5 lines
// - Cat XL: ₦500M xs ₦200M per occurrence

type Treaty struct {
	ID          string  `json:"id"`
	Type        string  `json:"type"` // quota_share, surplus, xl, facultative
	Reinsurer   string  `json:"reinsurer"`
	Retention   float64 `json:"retention"`
	CessionRate float64 `json:"cession_rate"`
	Limit       float64 `json:"limit"`
	Period      string  `json:"period"`
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "reinsurance-service"})
}

func handleTreaties(w http.ResponseWriter, r *http.Request) {
	treaties := []Treaty{
		{ID: "TRY-001", Type: "quota_share", Reinsurer: "Africa Re", Retention: 50000000, CessionRate: 0.30, Limit: 500000000, Period: "2026"},
		{ID: "TRY-002", Type: "surplus", Reinsurer: "Swiss Re", Retention: 50000000, CessionRate: 0.0, Limit: 250000000, Period: "2026"},
		{ID: "TRY-003", Type: "xl", Reinsurer: "Munich Re", Retention: 200000000, CessionRate: 0.0, Limit: 500000000, Period: "2026"},
	}
	json.NewEncoder(w).Encode(treaties)
}

func handleCede(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		PolicyID string  `json:"policy_id"`
		Amount   float64 `json:"amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	retention := 50000000.0
	ceded := 0.0
	if req.Amount > retention {
		ceded = (req.Amount - retention) * 0.70
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"policy_id": req.PolicyID, "gross_amount": req.Amount,
		"retention": retention, "ceded": ceded,
		"net_retained": req.Amount - ceded,
	})
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
	mux.HandleFunc("/api/v1/treaties", handleTreaties)
	mux.HandleFunc("/api/v1/cede", handleCede)
	port := ":8095"
	log.Printf("Reinsurance Service starting on %s", port)
	log.Fatal(http.ListenAndServe(port, mux))
}
