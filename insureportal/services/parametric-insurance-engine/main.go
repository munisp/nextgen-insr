package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"
)

// ParametricTrigger defines conditions for automatic payout
type ParametricTrigger struct {
	ID          string  `json:"id"`
	PolicyID    string  `json:"policyId"`
	TriggerType string  `json:"triggerType"` // rainfall, temperature, earthquake, flood
	Threshold   float64 `json:"threshold"`
	Operator    string  `json:"operator"` // gt, lt, gte, lte, eq
	PayoutAmount float64 `json:"payoutAmount"`
	Region      string  `json:"region"`
}

// WeatherEvent from external data oracle
type WeatherEvent struct {
	EventType string  `json:"eventType"`
	Value     float64 `json:"value"`
	Region    string  `json:"region"`
	Timestamp string  `json:"timestamp"`
}

// PayoutDecision result of trigger evaluation
type PayoutDecision struct {
	TriggerID    string  `json:"triggerId"`
	PolicyID     string  `json:"policyId"`
	Triggered    bool    `json:"triggered"`
	PayoutAmount float64 `json:"payoutAmount"`
	EventValue   float64 `json:"eventValue"`
	Threshold    float64 `json:"threshold"`
	Reason       string  `json:"reason"`
	Timestamp    string  `json:"timestamp"`
}

func evaluateTrigger(trigger ParametricTrigger, event WeatherEvent) PayoutDecision {
	triggered := false
	switch trigger.Operator {
	case "gt":
		triggered = event.Value > trigger.Threshold
	case "lt":
		triggered = event.Value < trigger.Threshold
	case "gte":
		triggered = event.Value >= trigger.Threshold
	case "lte":
		triggered = event.Value <= trigger.Threshold
	case "eq":
		triggered = event.Value == trigger.Threshold
	}

	reason := "Conditions not met"
	if triggered {
		reason = fmt.Sprintf("%s %s %.2f (actual: %.2f) in %s",
			trigger.TriggerType, trigger.Operator, trigger.Threshold, event.Value, event.Region)
	}

	return PayoutDecision{
		TriggerID:    trigger.ID,
		PolicyID:     trigger.PolicyID,
		Triggered:    triggered,
		PayoutAmount: func() float64 { if triggered { return trigger.PayoutAmount }; return 0 }(),
		EventValue:   event.Value,
		Threshold:    trigger.Threshold,
		Reason:       reason,
		Timestamp:    time.Now().UTC().Format(time.RFC3339),
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "parametric-insurance-engine"})
}

func evaluateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Trigger ParametricTrigger `json:"trigger"`
		Event   WeatherEvent     `json:"event"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	decision := evaluateTrigger(req.Trigger, req.Event)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(decision)
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
		port = "8093"
	}

	http.HandleFunc("/health", healthHandler)
	http.HandleFunc("/api/v1/parametric/evaluate", evaluateHandler)

	log.Printf("Parametric Insurance Engine running on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
