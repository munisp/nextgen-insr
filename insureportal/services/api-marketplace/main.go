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

// API Marketplace — developer portal for open insurance APIs
// Business Rules:
// - API tiers: Free (100 req/day), Standard (10K req/day), Enterprise (unlimited)
// - Monetization: Per-call billing via TigerBeetle, monthly invoicing
// - Sandbox: Full test environment with synthetic data
// - Rate limiting: Per-tier via APISIX
// - Documentation: OpenAPI 3.0 specs auto-generated
// - Partner onboarding: Self-service with API key generation


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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "api-marketplace"})
	})
	r.Get("/api/v1/catalog", apiCatalog)
	r.Post("/api/v1/subscribe", subscribe)
	r.Get("/api/v1/usage/{apiKey}", getUsage)
	port := os.Getenv("PORT")
	if port == "" { port = "8098" }
	log.Printf("API Marketplace starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func apiCatalog(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"apis": []map[string]interface{}{
			{"name": "Policy API", "version": "v2", "endpoints": 12, "pricing": "₦5/call", "category": "core"},
			{"name": "Claims API", "version": "v1", "endpoints": 8, "pricing": "₦10/call", "category": "core"},
			{"name": "KYC Verification", "version": "v1", "endpoints": 5, "pricing": "₦25/call", "category": "identity"},
			{"name": "Risk Scoring", "version": "v1", "endpoints": 3, "pricing": "₦15/call", "category": "analytics"},
			{"name": "Agent Network", "version": "v1", "endpoints": 6, "pricing": "₦5/call", "category": "distribution"},
		},
		"total": 5, "sandbox_available": true,
	})
}

func subscribe(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"api_key": "ik_live_" + time.Now().Format("20060102150405"),
		"tier": "standard", "rate_limit": "10000/day",
		"sandbox_key": "ik_test_sandbox_" + time.Now().Format("150405"),
	})
}

func getUsage(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"api_key": chi.URLParam(r, "apiKey"),
		"period": "current_month", "calls": 4520, "limit": 10000,
		"cost_naira": 22600, "top_endpoint": "/api/v1/policies",
	})
}
