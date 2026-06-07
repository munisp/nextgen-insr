package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"
	"fmt"
)

// CorePlatformService - Central orchestration for insurance operations
type PolicySummary struct {
	ID           string  `json:"id"`
	PolicyNumber string  `json:"policyNumber"`
	ProductName  string  `json:"productName"`
	Status       string  `json:"status"`
	Premium      float64 `json:"premium"`
	SumInsured   float64 `json:"sumInsured"`
	InceptionDate string `json:"inceptionDate"`
	ExpiryDate    string `json:"expiryDate"`
}

type DashboardMetrics struct {
	TotalPolicies     int     `json:"totalPolicies"`
	ActivePolicies    int     `json:"activePolicies"`
	TotalPremium      float64 `json:"totalPremium"`
	ClaimsPending     int     `json:"claimsPending"`
	ClaimsApproved    int     `json:"claimsApproved"`
	LossRatio         float64 `json:"lossRatio"`
	RenewalsDue30Days int     `json:"renewalsDue30Days"`
	AgentsActive      int     `json:"agentsActive"`
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "healthy",
		"service": "insurance-platform",
		"version": "1.0.0",
		"uptime":  time.Now().Format(time.RFC3339),
	})
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	metrics := DashboardMetrics{
		TotalPolicies:     12450,
		ActivePolicies:    9823,
		TotalPremium:      4560000000,
		ClaimsPending:     234,
		ClaimsApproved:    1567,
		LossRatio:         0.42,
		RenewalsDue30Days: 445,
		AgentsActive:      1230,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metrics)
}

func productsHandler(w http.ResponseWriter, r *http.Request) {
	products := []map[string]interface{}{
		{"id": "PROD-MOT-001", "name": "Motor Comprehensive", "category": "motor", "minPremium": 25000},
		{"id": "PROD-MOT-002", "name": "Motor Third Party", "category": "motor", "minPremium": 5000},
		{"id": "PROD-LIF-001", "name": "Term Life", "category": "life", "minPremium": 50000},
		{"id": "PROD-HLT-001", "name": "Health Individual", "category": "health", "minPremium": 75000},
		{"id": "PROD-HLT-002", "name": "Health Family", "category": "health", "minPremium": 150000},
		{"id": "PROD-FIR-001", "name": "Fire & Burglary", "category": "fire", "minPremium": 30000},
		{"id": "PROD-MAR-001", "name": "Marine Cargo", "category": "marine", "minPremium": 100000},
		{"id": "PROD-MIC-001", "name": "Micro Insurance", "category": "micro", "minPremium": 1000},
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"products": products})
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
	port := os.Getenv("PORT")
	if port == "" {
		port = "8094"
	}

	http.HandleFunc("/health", healthHandler)
	http.HandleFunc("/api/v1/platform/metrics", metricsHandler)
	http.HandleFunc("/api/v1/platform/products", productsHandler)

	log.Printf("Insurance Platform Core Service running on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
