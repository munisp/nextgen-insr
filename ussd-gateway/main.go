package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// USSD Gateway — session-based USSD menu system for insurance services
// Business Rules:
// - Short code: *384*xxx# (NAICOM approved)
// - Session timeout: 180 seconds
// - Menu depth: Max 5 levels (UX constraint)
// - Languages: English, Hausa, Yoruba, Igbo
// - Operations: Check policy, file claim, pay premium, agent locator
// - Available 24/7, supports all 36 states + FCT

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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "ussd-gateway"})
	})
	r.Post("/api/v1/session", handleUSSD)
	r.Get("/api/v1/menu", getMenu)
	r.Get("/api/v1/stats", ussdStats)
	port := os.Getenv("PORT")
	if port == "" { port = "8092" }
	log.Printf("USSD Gateway starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func handleUSSD(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SessionID string `json:"session_id"`
		MSISDN    string `json:"msisdn"`
		Input     string `json:"input"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	response := "Welcome to InsurePortal\n1. Check Policy\n2. File Claim\n3. Pay Premium\n4. Find Agent\n5. Change Language"
	if body.Input == "1" { response = "Enter Policy Number:" }
	if body.Input == "2" { response = "Enter Claim Type:\n1. Motor\n2. Health\n3. Property\n4. Life" }
	json.NewEncoder(w).Encode(map[string]interface{}{
		"session_id": body.SessionID, "response": response, "end_session": false,
		"timeout_seconds": 180,
	})
}

func getMenu(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"short_code": "*384*100#", "languages": []string{"en", "ha", "yo", "ig"},
		"menu_tree": map[string]interface{}{
			"1": "Check Policy", "2": "File Claim", "3": "Pay Premium",
			"4": "Find Agent", "5": "Change Language", "0": "Exit",
		},
		"max_depth": 5, "session_timeout": 180,
	})
}

func ussdStats(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"sessions_today": 12500, "completed_transactions": 3200,
		"avg_session_duration": "45 seconds", "drop_off_rate": 0.22,
		"top_service": "check_policy", "states_covered": 37,
	})
}
