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

// NAICOM Compliance Module — automated regulatory reporting and monitoring
// Business Rules:
// - Quarterly returns: Financial statements, solvency ratio, claims statistics
// - Solvency margin: Minimum 15% (alert at 20%, critical at 17%)
// - Annual returns: Audited accounts, actuarial valuation, reinsurance arrangements
// - Incident reporting: Major incidents within 24 hours
// - Capital adequacy: Minimum ₦3B for life, ₦5B for composite


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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "naicom-compliance-module"})
	})
	r.Get("/api/v1/returns/quarterly", quarterlyReturns)
	r.Get("/api/v1/solvency", solvencyStatus)
	r.Post("/api/v1/incident/report", reportIncident)
	r.Get("/api/v1/capital", capitalAdequacy)
	port := os.Getenv("PORT")
	if port == "" { port = "8091" }
	log.Printf("NAICOM Compliance Module starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func quarterlyReturns(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"quarter": "Q1-2026", "status": "submitted", "submitted_at": time.Now().AddDate(0, 0, -5).Format(time.RFC3339),
		"components": map[string]string{
			"financial_statement": "submitted", "solvency_report": "submitted",
			"claims_statistics": "submitted", "premium_report": "submitted",
		},
		"next_deadline": time.Now().AddDate(0, 3, 0).Format("2006-01-02"),
	})
}

func solvencyStatus(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"solvency_ratio": 0.28, "minimum_required": 0.15,
		"status": "compliant", "buffer": 0.13,
		"alert_threshold": 0.20, "critical_threshold": 0.17,
	})
}

func reportIncident(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"incident_id": "INC-" + time.Now().Format("20060102150405"),
		"status": "filed", "naicom_deadline": time.Now().Add(24 * time.Hour).Format(time.RFC3339),
		"acknowledgement": "pending",
	})
}

func capitalAdequacy(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"minimum_capital": 5000000000, "current_capital": 8500000000,
		"surplus": 3500000000, "compliant": true, "license_type": "composite",
	})
}
