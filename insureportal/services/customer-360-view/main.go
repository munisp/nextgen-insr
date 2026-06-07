package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"fmt"
)

// Customer 360 View — unified customer profile aggregating all touchpoints
// Business Rules:
// - Data sources: KYC, transactions, claims, policies, interactions, social
// - Profile completeness score: 0-100 (minimum 60 for premium services)
// - NDPR compliance: Customer can request full data export (30-day SLA)
// - Segmentation: High-value (>₦5M), Standard, New, Dormant (90 days inactive)
// - Cross-sell scoring: Based on product gaps and life events

type CustomerProfile struct {
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	Segment          string  `json:"segment"`
	CompletenessScore int    `json:"completeness_score"`
	TotalPolicies    int     `json:"total_policies"`
	TotalPremium     float64 `json:"total_premium_naira"`
	ClaimsCount      int     `json:"claims_count"`
	LifetimeValue    float64 `json:"lifetime_value"`
	RiskScore        int     `json:"risk_score"`
	CrossSellScore   int     `json:"cross_sell_score"`
	LastInteraction  string  `json:"last_interaction"`
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
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "customer-360-view"})
	})
	r.Get("/api/v1/customers/{id}/360", getCustomer360)
	r.Get("/api/v1/customers/{id}/cross-sell", getCrossSell)
	r.Get("/api/v1/segments", getSegments)

	port := os.Getenv("PORT")
	if port == "" { port = "8103" }
	log.Printf("Customer 360 View starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func getCustomer360(w http.ResponseWriter, r *http.Request) {
	profile := CustomerProfile{
		ID: chi.URLParam(r, "id"), Name: "Adebayo Ogundimu", Segment: "high_value",
		CompletenessScore: 85, TotalPolicies: 4, TotalPremium: 2500000,
		ClaimsCount: 1, LifetimeValue: 8500000, RiskScore: 25, CrossSellScore: 78,
		LastInteraction: time.Now().AddDate(0, 0, -3).Format(time.RFC3339),
	}
	json.NewEncoder(w).Encode(profile)
}

func getCrossSell(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"customer_id": chi.URLParam(r, "id"),
		"recommendations": []map[string]interface{}{
			{"product": "Health Insurance", "score": 92, "reason": "No health coverage, age 35-45 bracket"},
			{"product": "Life Insurance", "score": 78, "reason": "Recently married, has dependents"},
			{"product": "Investment-Linked", "score": 65, "reason": "High net worth, no investment products"},
		},
	})
}

func getSegments(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"segments": []map[string]interface{}{
			{"name": "high_value", "criteria": ">₦5M lifetime value", "count": 450},
			{"name": "standard", "criteria": "₦500K-₦5M", "count": 3200},
			{"name": "new", "criteria": "<90 days", "count": 890},
			{"name": "dormant", "criteria": ">90 days inactive", "count": 1100},
		},
	})
}
