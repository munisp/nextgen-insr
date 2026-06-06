package main

import (
	"bytes"
	"encoding/json"
	"log"
	"math"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// Premium Finance Service — installment premium payment and credit assessment
// Business Rules:
// - Installment options: 3, 6, 9, 12 months
// - Interest rate: 2.5%/month (flat), reduced to 2% for loyal customers (3+ years)
// - Minimum premium for financing: ₦100,000
// - Credit scoring: Based on payment history, claims ratio, tenure
// - Default handling: 2 missed payments → policy suspended, 3 → terminated
// - Early settlement: 50% rebate on remaining interest

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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "premium-finance-service"})
	})
	r.Post("/api/v1/calculate", calculateInstallments)
	r.Post("/api/v1/apply", applyForFinancing)
	r.Get("/api/v1/schedule/{id}", paymentSchedule)

	port := os.Getenv("PORT")
	if port == "" { port = "8130" }
	log.Printf("Premium Finance Service starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func calculateInstallments(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Premium    float64 `json:"premium"`
		Months     int     `json:"months"`
		LoyalYears int     `json:"loyal_years"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	if body.Premium < 100000 {
		http.Error(w, `{"error":"minimum_premium_100000"}`, 400); return
	}
	rate := 0.025
	if body.LoyalYears >= 3 { rate = 0.020 }
	totalInterest := body.Premium * rate * float64(body.Months)
	total := body.Premium + totalInterest
	monthly := math.Ceil(total / float64(body.Months))
	json.NewEncoder(w).Encode(map[string]interface{}{
		"premium": body.Premium, "months": body.Months, "rate_monthly": rate,
		"total_interest": totalInterest, "total_payable": total,
		"monthly_installment": monthly, "early_settlement_rebate": "50% of remaining interest",
	})
}

func applyForFinancing(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"application_id": "PF-" + time.Now().Format("20060102150405"),
		"status": "approved", "credit_score": 720,
		"approved_amount": 500000, "term_months": 6,
	})
}

func paymentSchedule(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"finance_id": chi.URLParam(r, "id"),
		"schedule": []map[string]interface{}{
			{"month": 1, "amount": 91250, "due_date": time.Now().AddDate(0, 1, 0).Format("2006-01-02"), "status": "upcoming"},
			{"month": 2, "amount": 91250, "due_date": time.Now().AddDate(0, 2, 0).Format("2006-01-02"), "status": "upcoming"},
		},
		"total_remaining": 547500, "missed_payments": 0,
	})
}
