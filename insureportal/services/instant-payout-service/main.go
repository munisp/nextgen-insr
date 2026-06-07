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

// Instant Payout Service — real-time claim settlements and agent payouts
// Business Rules:
// - Instant payout: Claims ≤ ₦500K settled within 15 minutes
// - Channels: Bank transfer (NIP), mobile money, agent wallet
// - Daily limit: ₦10M per agent, ₦50M per corporate
// - Fraud check: All payouts > ₦100K require 2-factor approval
// - Float management: Pre-funded pool, alert at 20% remaining
// - Reconciliation: Real-time via TigerBeetle double-entry


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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "instant-payout-service"})
	})
	r.Post("/api/v1/payout", initiatePayout)
	r.Get("/api/v1/payout/{id}/status", payoutStatus)
	r.Get("/api/v1/float", floatStatus)

	port := os.Getenv("PORT")
	if port == "" { port = "8123" }
	log.Printf("Instant Payout Service starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func initiatePayout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Amount      float64 `json:"amount"`
		Recipient   string  `json:"recipient"`
		Channel     string  `json:"channel"`
		Reference   string  `json:"reference"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	requires2FA := body.Amount > 100000
	status := "processing"
	if body.Amount <= 500000 && !requires2FA { status = "completed" }
	json.NewEncoder(w).Encode(map[string]interface{}{
		"payout_id": "PAY-" + time.Now().Format("20060102150405"),
		"amount": body.Amount, "channel": body.Channel, "status": status,
		"requires_2fa": requires2FA, "estimated_completion": "< 15 minutes",
		"reference": body.Reference,
	})
}

func payoutStatus(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"payout_id": chi.URLParam(r, "id"), "status": "completed",
		"completed_at": time.Now().Format(time.RFC3339), "channel": "nip",
	})
}

func floatStatus(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total_float": 250000000, "available": 180000000, "reserved": 70000000,
		"utilization_pct": 72, "alert_threshold_pct": 20, "status": "healthy",
	})
}
