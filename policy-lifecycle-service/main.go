package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"
)

// Policy Lifecycle Service
// Manages the full insurance policy lifecycle: quote → bind → issue → endorse → renew → cancel → lapse
// Integrates with: Postgres, Kafka, TigerBeetle, Temporal
//
// State Machine: draft → quoted → bound → active → endorsed → renewed | cancelled | lapsed | expired

type PolicyState string
const (
	StateDraft     PolicyState = "draft"
	StateQuoted    PolicyState = "quoted"
	StateBound     PolicyState = "bound"
	StateActive    PolicyState = "active"
	StateEndorsed  PolicyState = "endorsed"
	StateRenewed   PolicyState = "renewed"
	StateCancelled PolicyState = "cancelled"
	StateLapsed    PolicyState = "lapsed"
	StateExpired   PolicyState = "expired"
)

var validTransitions = map[PolicyState][]PolicyState{
	StateDraft:     {StateQuoted},
	StateQuoted:    {StateBound, StateDraft},
	StateBound:     {StateActive},
	StateActive:    {StateEndorsed, StateRenewed, StateCancelled, StateLapsed, StateExpired},
	StateEndorsed:  {StateActive, StateCancelled},
}

func isValidTransition(from, to PolicyState) bool {
	allowed, ok := validTransitions[from]
	if !ok { return false }
	for _, s := range allowed {
		if s == to { return true }
	}
	return false
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "policy-lifecycle-service"})
}

func handleTransition(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		PolicyID string `json:"policy_id"`
		FromState string `json:"from_state"`
		ToState   string `json:"to_state"`
		Reason    string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if !isValidTransition(PolicyState(req.FromState), PolicyState(req.ToState)) {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{
			"error": "Invalid state transition",
			"allowed": "See /api/v1/transitions for valid transitions",
		})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"policy_id": req.PolicyID, "previous_state": req.FromState,
		"current_state": req.ToState, "transitioned_at": time.Now().Format(time.RFC3339),
	})
}

func handleTransitions(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(validTransitions)
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
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/api/v1/transition", handleTransition)
	mux.HandleFunc("/api/v1/transitions", handleTransitions)
	port := ":8097"
	log.Printf("Policy Lifecycle Service starting on %s", port)
	log.Fatal(http.ListenAndServe(port, mux))
}
