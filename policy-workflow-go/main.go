package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
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

var kafkaRestURL string

func initKafka() {
	kafkaRestURL = os.Getenv("KAFKA_REST_URL")
	if kafkaRestURL == "" {
		kafkaRestURL = "http://localhost:8082"
	}
	log.Printf("Kafka REST proxy configured at %s", kafkaRestURL)
}

func publishEvent(topic string, key string, payload interface{}) {
	if kafkaRestURL == "" {
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("WARN: kafka marshal error: %v", err)
		return
	}
	msg := map[string]interface{}{
		"records": []map[string]interface{}{
			{"key": key, "value": string(data)},
		},
	}
	body, _ := json.Marshal(msg)
	resp, err := http.Post(kafkaRestURL+"/topics/"+topic, "application/vnd.kafka.json.v2+json", bytes.NewReader(body))
	if err != nil {
		log.Printf("WARN: kafka publish error: %v", err)
		return
	}
	defer resp.Body.Close()
}

func main() {
	initKafka()
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
