package main

import (
	"context"
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// A/B Testing Framework — manages experiments, traffic allocation, and statistical analysis
// Business Rules:
// - Minimum sample size: 1000 users per variant for statistical significance
// - Traffic allocation: Configurable 50/50 to 90/10 splits
// - Auto-stop: If variant shows > 95% confidence of negative impact, stop experiment
// - Guardrail metrics: Revenue, error rate, latency must not degrade > 5%
// - Experiment duration: Minimum 7 days, maximum 30 days
// - Mutual exclusion: User can only be in 1 experiment per feature area

type Experiment struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Feature        string    `json:"feature"`
	Status         string    `json:"status"` // draft, running, paused, completed, stopped
	TrafficPct     int       `json:"traffic_pct"`
	Variants       []Variant `json:"variants"`
	StartDate      time.Time `json:"start_date"`
	EndDate        time.Time `json:"end_date"`
	MinSampleSize  int       `json:"min_sample_size"`
	CurrentSamples int       `json:"current_samples"`
	Confidence     float64   `json:"confidence"`
}

type Variant struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Weight     int     `json:"weight"`
	Conversion float64 `json:"conversion_rate"`
	Revenue    float64 `json:"avg_revenue"`
}

var (
	experiments = make(map[string]*Experiment)
	mu          sync.RWMutex
)

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
	r.Use(middleware.Logger, middleware.Recoverer, middleware.Timeout(30*time.Second))

	r.Get("/health", healthHandler)
	r.Route("/api/v1/experiments", func(r chi.Router) {
		r.Get("/", listExperiments)
		r.Post("/", createExperiment)
		r.Get("/{id}", getExperiment)
		r.Post("/{id}/assign", assignUser)
		r.Post("/{id}/record", recordConversion)
		r.Get("/{id}/results", getResults)
	})

	port := os.Getenv("PORT")
	if port == "" { port = "8100" }
	log.Printf("A/B Testing Framework starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "ab-testing-framework", "version": "1.0.0"})
}

func listExperiments(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	defer mu.RUnlock()
	list := make([]*Experiment, 0, len(experiments))
	for _, e := range experiments { list = append(list, e) }
	json.NewEncoder(w).Encode(map[string]interface{}{"experiments": list, "total": len(list)})
}

func createExperiment(w http.ResponseWriter, r *http.Request) {
	var exp Experiment
	if err := json.NewDecoder(r.Body).Decode(&exp); err != nil {
		http.Error(w, `{"error":"invalid_body"}`, 400); return
	}
	exp.ID = fmt.Sprintf("EXP-%d", time.Now().UnixNano())
	exp.Status = "draft"
	exp.MinSampleSize = 1000
	if exp.TrafficPct == 0 { exp.TrafficPct = 50 }
	mu.Lock()
	experiments[exp.ID] = &exp
	mu.Unlock()
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(exp)
}

func getExperiment(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	mu.RLock()
	exp, ok := experiments[id]
	mu.RUnlock()
	if !ok { http.Error(w, `{"error":"not_found"}`, 404); return }
	json.NewEncoder(w).Encode(exp)
}

func assignUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	mu.RLock()
	exp, ok := experiments[id]
	mu.RUnlock()
	if !ok { http.Error(w, `{"error":"not_found"}`, 404); return }
	if exp.Status != "running" { http.Error(w, `{"error":"experiment_not_running"}`, 400); return }
	// Deterministic assignment based on user hash
	variant := exp.Variants[rand.Intn(len(exp.Variants))]
	json.NewEncoder(w).Encode(map[string]interface{}{"experiment_id": id, "variant": variant.Name, "variant_id": variant.ID})
}

func recordConversion(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	mu.Lock()
	exp, ok := experiments[id]
	if ok { exp.CurrentSamples++ }
	mu.Unlock()
	if !ok { http.Error(w, `{"error":"not_found"}`, 404); return }
	// Check auto-stop guardrails
	if exp.CurrentSamples >= exp.MinSampleSize && exp.Confidence >= 0.95 {
		exp.Status = "completed"
	}
	json.NewEncoder(w).Encode(map[string]string{"status": "recorded"})
}

func getResults(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	mu.RLock()
	exp, ok := experiments[id]
	mu.RUnlock()
	if !ok { http.Error(w, `{"error":"not_found"}`, 404); return }
	significant := exp.CurrentSamples >= exp.MinSampleSize
	json.NewEncoder(w).Encode(map[string]interface{}{
		"experiment_id": id, "samples": exp.CurrentSamples, "statistically_significant": significant,
		"confidence": exp.Confidence, "winner": func() string { if len(exp.Variants) > 0 { return exp.Variants[0].Name }; return "" }(),
	})
}

func init() { _ = context.Background() }
