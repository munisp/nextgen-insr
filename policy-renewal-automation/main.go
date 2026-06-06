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

// Policy Renewal Automation — automated policy renewal with dynamic pricing
// Business Rules:
// - Auto-renew: Customer opt-in required, 30-day advance notice
// - Pricing: Base premium × claims factor × loyalty discount × inflation adjustment
// - Loyalty discount: 5% after 1 year, 10% after 3 years, 15% after 5 years
// - Claims loading: 0 claims = -5%, 1 claim = 0%, 2+ claims = +15% per claim
// - Grace period: 30 days after expiry (coverage reduced to 50%)
// - Lapse: After grace period → policy terminated, new application required
// - Communication: SMS at -30d, -14d, -7d, -3d, -1d, 0d, +7d, +14d, +30d

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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "policy-renewal-automation"})
	})
	r.Get("/api/v1/renewals/upcoming", upcomingRenewals)
	r.Post("/api/v1/renewals/calculate", calculateRenewalPremium)
	r.Post("/api/v1/renewals/process", processRenewal)

	port := os.Getenv("PORT")
	if port == "" { port = "8105" }
	log.Printf("Policy Renewal Automation starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func upcomingRenewals(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"renewals": []map[string]interface{}{
			{"policy_id": "POL-2025-001", "customer": "Chioma Nwosu", "expiry": time.Now().AddDate(0, 0, 14).Format("2006-01-02"), "premium": 180000, "status": "notice_sent", "auto_renew": true},
			{"policy_id": "POL-2025-002", "customer": "Ibrahim Musa", "expiry": time.Now().AddDate(0, 0, 7).Format("2006-01-02"), "premium": 350000, "status": "pending_payment", "auto_renew": false},
			{"policy_id": "POL-2025-003", "customer": "Funke Adeyemi", "expiry": time.Now().AddDate(0, 0, -5).Format("2006-01-02"), "premium": 120000, "status": "grace_period", "auto_renew": true},
		},
		"total": 3, "auto_renew_count": 2, "grace_period_count": 1,
	})
}

func calculateRenewalPremium(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BasePremium  float64 `json:"base_premium"`
		YearsActive  int     `json:"years_active"`
		ClaimsCount  int     `json:"claims_count"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	loyaltyDiscount := 0.0
	if body.YearsActive >= 5 { loyaltyDiscount = 0.15 } else if body.YearsActive >= 3 { loyaltyDiscount = 0.10 } else if body.YearsActive >= 1 { loyaltyDiscount = 0.05 }
	claimsFactor := 1.0
	if body.ClaimsCount == 0 { claimsFactor = 0.95 } else if body.ClaimsCount >= 2 { claimsFactor = 1.0 + float64(body.ClaimsCount)*0.15 }
	inflationAdj := 1.05
	newPremium := body.BasePremium * claimsFactor * (1 - loyaltyDiscount) * inflationAdj
	json.NewEncoder(w).Encode(map[string]interface{}{
		"base_premium": body.BasePremium, "new_premium": int(newPremium),
		"loyalty_discount": loyaltyDiscount, "claims_factor": claimsFactor, "inflation": inflationAdj,
		"savings": int(body.BasePremium - newPremium),
	})
}

func processRenewal(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "renewed", "new_expiry": time.Now().AddDate(1, 0, 0).Format("2006-01-02"),
		"payment_method": "auto_debit", "confirmation_sent": true,
	})
}
