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

// Policy Workflow Engine — state machine for policy lifecycle management
// States: draft → submitted → underwriting → approved/declined → issued → active → renewal/lapsed/cancelled
// Business Rules:
// - Draft → Submitted: Requires all mandatory fields + KYC verification
// - Submitted → Underwriting: Auto-routed based on risk score (< 50 = auto, >= 50 = manual)
// - Underwriting SLA: 24h for auto, 72h for manual
// - Approved → Issued: Payment must be confirmed within 7 days
// - Active → Cancelled: Pro-rata refund if within cooling-off period (14 days)

var validTransitions = map[string][]string{
	"draft":        {"submitted"},
	"submitted":    {"underwriting", "rejected"},
	"underwriting": {"approved", "declined", "referred"},
	"approved":     {"issued", "expired"},
	"issued":       {"active"},
	"active":       {"renewal", "lapsed", "cancelled"},
	"renewal":      {"active", "lapsed"},
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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "policy-workflow-go"})
	})
	r.Post("/api/v1/workflow/transition", transitionPolicy)
	r.Get("/api/v1/workflow/valid-transitions/{state}", getValidTransitions)

	port := os.Getenv("PORT")
	if port == "" { port = "8106" }
	log.Printf("Policy Workflow Engine starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func transitionPolicy(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PolicyID     string `json:"policy_id"`
		CurrentState string `json:"current_state"`
		NewState     string `json:"new_state"`
		Actor        string `json:"actor"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	allowed, ok := validTransitions[body.CurrentState]
	if !ok { http.Error(w, `{"error":"invalid_current_state"}`, 400); return }
	valid := false
	for _, s := range allowed { if s == body.NewState { valid = true; break } }
	if !valid {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "invalid_transition", "current": body.CurrentState, "requested": body.NewState, "allowed": allowed})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true, "policy_id": body.PolicyID, "previous_state": body.CurrentState,
		"new_state": body.NewState, "transitioned_at": time.Now().Format(time.RFC3339), "actor": body.Actor,
	})
}

func getValidTransitions(w http.ResponseWriter, r *http.Request) {
	state := chi.URLParam(r, "state")
	transitions, ok := validTransitions[state]
	if !ok { http.Error(w, `{"error":"unknown_state"}`, 400); return }
	json.NewEncoder(w).Encode(map[string]interface{}{"current_state": state, "valid_transitions": transitions})
}
