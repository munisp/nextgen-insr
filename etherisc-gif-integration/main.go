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

// Etherisc GIF Integration — decentralized insurance protocol connector
// Business Rules:
// - Products: Parametric crop insurance, flight delay, weather index
// - Oracle: External data feeds trigger automatic payouts
// - Pool: Shared capital pool for risk diversification
// - Transparency: All policy data on-chain, verifiable by customers

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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "etherisc-gif-integration"})
	})
	r.Get("/api/v1/products", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"products": []map[string]interface{}{
				{"name": "Crop Parametric (Corn)", "trigger": "rainfall < 60mm/month", "payout": "automatic", "pool_size": 50000000},
				{"name": "Flight Delay", "trigger": "delay > 120 minutes", "payout": "automatic", "pool_size": 20000000},
			},
		})
	})
	port := os.Getenv("PORT")
	if port == "" { port = "8099" }
	log.Printf("Etherisc GIF Integration starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
