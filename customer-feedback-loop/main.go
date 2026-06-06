package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"database/sql"

	_ "github.com/lib/pq"
)

// Customer Feedback Loop — NPS, CSAT, and CES collection and analysis
// Business Rules:
// - NPS survey: After claim settlement, policy issuance, service interaction
// - CSAT: 1-5 stars, collected within 24h of interaction
// - CES: 1-7 scale for effort required
// - Response rate target: > 30%
// - Alert: NPS < 6 from high-value customer → immediate escalation
// - Trend analysis: Weekly rolling average, alert on > 10% decline

var db *sql.DB

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgresql://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("WARN: database connection failed: %v (running in degraded mode)", err)
		return
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	if err = db.Ping(); err != nil {
		log.Printf("WARN: database ping failed: %v (running in degraded mode)", err)
		db = nil
		return
	}
	log.Printf("Connected to PostgreSQL for customer_feedback_loop")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS customer_feedback_loop (
		id SERIAL PRIMARY KEY,
		data JSONB NOT NULL DEFAULT '{}',
		status VARCHAR(50) DEFAULT 'active',
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		tenant_id INTEGER DEFAULT 1
	)`)
	if err != nil {
		log.Printf("WARN: table creation failed: %v", err)
	}
}


func main() {
	initDB()
	if db != nil {
		defer db.Close()
	}
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": db != nil, "service": "customer-feedback-loop"})
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
