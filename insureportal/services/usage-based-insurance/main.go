package main

import (
	"encoding/json"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"fmt"
)

// Usage-Based Insurance — telematics and IoT-driven dynamic pricing
// Business Rules:
// - Data sources: Vehicle telematics (OBD-II), mobile app (driving behavior), IoT sensors
// - Scoring factors: Mileage, time of day, speeding events, harsh braking, phone usage
// - Premium adjustment: -30% to +50% based on driving score
// - Pay-per-km: ₦5-15/km depending on risk score
// - Minimum monthly premium: ₦2,000 (regardless of usage)
// - Data retention: Raw telemetry 90 days, aggregated scores 7 years


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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "usage-based-insurance"})
	})
	r.Post("/api/v1/telemetry", ingestTelemetry)
	r.Get("/api/v1/score/{policyId}", getDrivingScore)
	r.Get("/api/v1/premium/{policyId}", calculatePremium)

	port := os.Getenv("PORT")
	if port == "" { port = "8129" }
	log.Printf("Usage-Based Insurance starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func ingestTelemetry(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PolicyID   string  `json:"policy_id"`
		KmDriven   float64 `json:"km_driven"`
		SpeedEvents int    `json:"speed_events"`
		HarshBrakes int   `json:"harsh_brakes"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ingested": true, "policy_id": body.PolicyID, "timestamp": time.Now().Format(time.RFC3339),
		"data_points": 1, "retention_days": 90,
	})
}

func getDrivingScore(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"policy_id": chi.URLParam(r, "policyId"), "driving_score": 78,
		"factors": map[string]int{"mileage": 85, "time_of_day": 70, "speeding": 65, "braking": 90, "phone_usage": 80},
		"trend": "improving", "percentile": 72,
	})
}

func calculatePremium(w http.ResponseWriter, r *http.Request) {
	basePremium := 25000.0
	score := 78.0
	adjustment := (score - 50) / 100 * -0.6
	adjustedPremium := basePremium * (1 + adjustment)
	adjustedPremium = math.Max(adjustedPremium, 2000)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"policy_id": chi.URLParam(r, "policyId"), "base_premium": basePremium,
		"driving_score": score, "adjustment_pct": adjustment * 100,
		"monthly_premium": int(adjustedPremium), "per_km_rate": 8.5,
		"minimum_premium": 2000,
	})
}
