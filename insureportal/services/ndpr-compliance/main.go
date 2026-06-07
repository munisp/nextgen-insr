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

// NDPR Compliance — Nigeria Data Protection Regulation implementation
// Business Rules:
// - Consent management: Explicit opt-in for each data processing purpose
// - Data subject rights: Access (30 days), Rectification (14 days), Erasure (30 days), Portability (30 days)
// - Breach notification: NITDA within 72 hours, affected persons "without undue delay"
// - Data Protection Impact Assessment: Required for high-risk processing
// - Annual audit: Mandatory filing with NITDA
// - Lawful basis: Consent, Contract, Legal Obligation, Vital Interest, Public Interest, Legitimate Interest


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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "ndpr-compliance"})
	})
	r.Post("/api/v1/consent", recordConsent)
	r.Post("/api/v1/dsar", submitDSAR)
	r.Get("/api/v1/dsar/{id}", getDSARStatus)
	r.Post("/api/v1/breach/report", reportBreach)
	r.Get("/api/v1/audit/annual", annualAudit)

	port := os.Getenv("PORT")
	if port == "" { port = "8126" }
	log.Printf("NDPR Compliance starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func recordConsent(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CustomerID string   `json:"customer_id"`
		Purposes   []string `json:"purposes"`
		Method     string   `json:"method"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"consent_id": "CON-" + time.Now().Format("20060102150405"),
		"customer_id": body.CustomerID, "purposes": body.Purposes,
		"lawful_basis": "consent", "recorded_at": time.Now().Format(time.RFC3339),
		"withdrawal_available": true,
	})
}

func submitDSAR(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CustomerID string `json:"customer_id"`
		Type       string `json:"type"` // access, rectification, erasure, portability
	}
	json.NewDecoder(r.Body).Decode(&body)
	sla := map[string]int{"access": 30, "rectification": 14, "erasure": 30, "portability": 30}
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"dsar_id": "DSAR-" + time.Now().Format("20060102150405"),
		"type": body.Type, "status": "received", "sla_days": sla[body.Type],
		"deadline": time.Now().AddDate(0, 0, sla[body.Type]).Format("2006-01-02"),
	})
}

func getDSARStatus(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"dsar_id": chi.URLParam(r, "id"), "type": "access", "status": "in_progress",
		"progress_pct": 60, "estimated_completion": time.Now().AddDate(0, 0, 5).Format("2006-01-02"),
	})
}

func reportBreach(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"breach_id": "BRH-" + time.Now().Format("20060102150405"),
		"nitda_notification_deadline": time.Now().Add(72 * time.Hour).Format(time.RFC3339),
		"status": "reported", "severity": "high", "affected_persons": 0,
	})
}

func annualAudit(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"audit_year": 2026, "status": "compliant",
		"consent_records": 45000, "dsar_requests": 120, "breaches": 0,
		"dpia_completed": 5, "nitda_filing": "submitted",
	})
}
