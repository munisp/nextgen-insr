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

// agent-network-platform — production microservice for InsurePortal platform
// Integrates with: Kafka, Redis, Postgres

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
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "healthy", "service": "agent-network-platform", "version": "1.0.0",
			"uptime": time.Since(startTime).String(),
		})
	})
	r.Get("/api/v1/info", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"service": "agent-network-platform", "started_at": startTime.Format(time.RFC3339),
			"uptime_seconds": int(time.Since(startTime).Seconds()),
			"ready": true, "dependencies": []string{"postgres", "redis", "kafka"},
		})
	})
	r.Get("/api/v1/status", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"operational": true, "last_heartbeat": time.Now().Format(time.RFC3339),
		})
	})
	port := os.Getenv("PORT")
	if port == "" { port = "8120" }
	log.Printf("agent-network-platform starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

var startTime = time.Now()
