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

// Insurance Mobile App Backend — API for mobile clients (iOS/Android/Flutter)
// Business Rules:
// - JWT auth with biometric fallback (fingerprint/face)
// - Push notifications via FCM/APNS
// - Offline-first: Queue transactions, sync when online
// - Rate limiting: 60 req/min per device
// - Minimum app version enforcement (force update below v2.0)

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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "insurance-mobile-app"})
	})
	r.Get("/api/v1/app/config", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"min_version": "2.0.0", "force_update_below": "1.5.0",
			"features": []string{"biometric_login", "push_notifications", "offline_mode", "document_upload"},
			"maintenance_mode": false,
		})
	})
	r.Post("/api/v1/sync", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{"synced": true, "timestamp": time.Now().Format(time.RFC3339), "pending_transactions": 0})
	})
	port := os.Getenv("PORT")
	if port == "" { port = "8113" }
	log.Printf("Insurance Mobile App Backend starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
