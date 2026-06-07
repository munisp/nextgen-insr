package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"fmt"
)

// Customer Feedback Loop — NPS, CSAT, and CES collection and analysis
// Business Rules:
// - NPS survey: After claim settlement, policy issuance, service interaction
// - CSAT: 1-5 stars, collected within 24h of interaction
// - CES: 1-7 scale for effort required
// - Response rate target: > 30%
// - Alert: NPS < 6 from high-value customer → immediate escalation
// - Trend analysis: Weekly rolling average, alert on > 10% decline


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
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "customer-feedback-loop"})
	})
	r.Post("/api/v1/feedback", submitFeedback)
	r.Get("/api/v1/feedback/summary", feedbackSummary)
	r.Get("/api/v1/nps", npsScore)

	port := os.Getenv("PORT")
	if port == "" { port = "8112" }
	log.Printf("Customer Feedback Loop starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func submitFeedback(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CustomerID string `json:"customer_id"`
		Type       string `json:"type"` // nps, csat, ces
		Score      int    `json:"score"`
		Comment    string `json:"comment"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"feedback_id": "FB-" + time.Now().Format("20060102150405"),
		"customer_id": body.CustomerID, "type": body.Type, "score": body.Score,
		"escalated": body.Type == "nps" && body.Score < 6, "timestamp": time.Now().Format(time.RFC3339),
	})
}

func feedbackSummary(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"nps": map[string]interface{}{"score": 42, "promoters": 55, "passives": 25, "detractors": 20},
		"csat": map[string]interface{}{"average": 4.1, "responses": 1250},
		"ces": map[string]interface{}{"average": 5.2, "responses": 800},
		"response_rate": 34.5, "period": "last_30_days",
	})
}

func npsScore(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"current_nps": 42, "previous_nps": 38, "trend": "improving",
		"benchmark": 35, "above_benchmark": true,
	})
}
