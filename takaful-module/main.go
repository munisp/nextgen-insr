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

// Takaful Module — Shariah-compliant insurance operations
// Business Rules:
// - Tabarru (donation) pool model — participants contribute to shared pool
// - Surplus distribution: 70% participants, 30% operator (Wakala fee)
// - Investment: Only Shariah-compliant instruments (no riba/interest)
// - Shariah Advisory Board: Required for product approval
// - Retakaful: Reinsurance through Shariah-compliant retakaful operators
// - NAICOM Takaful guidelines compliance

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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "takaful-module"})
	})
	r.Get("/api/v1/products", takafulProducts)
	r.Get("/api/v1/pool/status", poolStatus)
	r.Post("/api/v1/contribution", makeContribution)
	r.Get("/api/v1/surplus", surplusDistribution)

	port := os.Getenv("PORT")
	if port == "" { port = "8128" }
	log.Printf("Takaful Module starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func takafulProducts(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"products": []map[string]interface{}{
			{"id": "TAK-FAM", "name": "Family Takaful", "type": "life", "contribution_min": 5000, "shariah_certified": true},
			{"id": "TAK-GEN", "name": "General Takaful", "type": "general", "contribution_min": 10000, "shariah_certified": true},
			{"id": "TAK-HLT", "name": "Health Takaful", "type": "health", "contribution_min": 3000, "shariah_certified": true},
		},
		"wakala_fee_pct": 30, "shariah_board": "approved",
	})
}

func poolStatus(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total_pool": 85000000, "tabarru_pool": 59500000, "investment_pool": 25500000,
		"participants": 3200, "claims_paid_ytd": 12000000,
		"investment_return": 0.08, "shariah_compliant": true,
	})
}

func makeContribution(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ParticipantID string  `json:"participant_id"`
		Amount        float64 `json:"amount"`
		ProductID     string  `json:"product_id"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	tabarru := body.Amount * 0.70
	wakala := body.Amount * 0.30
	json.NewEncoder(w).Encode(map[string]interface{}{
		"contribution_id": "CON-" + time.Now().Format("20060102150405"),
		"amount": body.Amount, "tabarru_portion": tabarru, "wakala_fee": wakala,
		"status": "accepted", "shariah_compliant": true,
	})
}

func surplusDistribution(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"period": "2025", "total_surplus": 15000000,
		"participant_share": 10500000, "operator_share": 4500000,
		"distribution_ratio": "70/30", "status": "distributed",
	})
}
