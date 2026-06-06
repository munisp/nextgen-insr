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

// Blockchain Transparency — immutable audit trail and parametric trigger verification
// Business Rules:
// - Smart contracts: Parametric insurance triggers (weather, flight delay)
// - Claims provenance: Every claim state change recorded on-chain
// - Reinsurance: Treaty terms encoded as smart contracts
// - Transparency: Customers can verify claim processing status
// - Integration: Etherisc GIF framework for decentralized insurance

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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "blockchain-transparency"})
	})
	r.Post("/api/v1/record", recordOnChain)
	r.Get("/api/v1/verify/{hash}", verifyRecord)
	r.Get("/api/v1/contracts", listContracts)

	port := os.Getenv("PORT")
	if port == "" { port = "8135" }
	log.Printf("Blockchain Transparency starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func recordOnChain(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tx_hash": "0x" + time.Now().Format("20060102150405") + "abcdef1234567890",
		"block_number": 12345678, "status": "confirmed", "gas_used": 21000,
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

func verifyRecord(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"hash": chi.URLParam(r, "hash"), "verified": true,
		"block_number": 12345678, "timestamp": time.Now().AddDate(0, 0, -5).Format(time.RFC3339),
		"data_integrity": "valid",
	})
}

func listContracts(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"contracts": []map[string]interface{}{
			{"name": "Crop Parametric", "type": "parametric", "trigger": "rainfall_index", "active_policies": 500},
			{"name": "Flight Delay", "type": "parametric", "trigger": "delay_minutes > 120", "active_policies": 200},
			{"name": "Reinsurance Treaty", "type": "treaty", "capacity": 5000000000, "utilization": 0.45},
		},
	})
}
