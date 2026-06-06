package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// Gamification Service — engagement through points, badges, and leaderboards
// Business Rules:
// - Points: Policy purchase (100), claim-free year (500), referral (200), document upload (50)
// - Badges: "First Policy", "Claim-Free Champion", "Super Referrer", "Early Payer"
// - Leaderboards: Weekly/Monthly/All-time, segmented by region
// - Rewards: Points redeemable for premium discounts (1000 pts = ₦500 off)
// - Anti-gaming: Max 5 referral points/day, no self-referral, 30-day qualification


// Prometheus-compatible metrics
var (
	metricsRequestCount    int64
	metricsErrorCount      int64
	metricsStartTime       = time.Now()
)

func metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&metricsRequestCount, 1)
		wrapped := &metricsResponseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		if wrapped.statusCode >= 400 {
			atomic.AddInt64(&metricsErrorCount, 1)
		}
	})
}

type metricsResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (mrw *metricsResponseWriter) WriteHeader(code int) {
	mrw.statusCode = code
	mrw.ResponseWriter.WriteHeader(code)
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	uptime := time.Since(metricsStartTime).Seconds()
	reqCount := atomic.LoadInt64(&metricsRequestCount)
	errCount := atomic.LoadInt64(&metricsErrorCount)
	fmt.Fprintf(w, "# HELP http_requests_total Total HTTP requests\n")
	fmt.Fprintf(w, "# TYPE http_requests_total counter\n")
	fmt.Fprintf(w, "http_requests_total %d\n", reqCount)
	fmt.Fprintf(w, "# HELP http_errors_total Total HTTP errors (4xx/5xx)\n")
	fmt.Fprintf(w, "# TYPE http_errors_total counter\n")
	fmt.Fprintf(w, "http_errors_total %d\n", errCount)
	fmt.Fprintf(w, "# HELP process_uptime_seconds Process uptime\n")
	fmt.Fprintf(w, "# TYPE process_uptime_seconds gauge\n")
	fmt.Fprintf(w, "process_uptime_seconds %.2f\n", uptime)
}

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
	r.Use(metricsMiddleware)
	r.Get("/metrics", metricsHandler)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "gamification-service"})
	})
	r.Get("/api/v1/points/{userId}", getUserPoints)
	r.Post("/api/v1/points/award", awardPoints)
	r.Get("/api/v1/leaderboard", getLeaderboard)
	r.Get("/api/v1/badges/{userId}", getUserBadges)

	port := os.Getenv("PORT")
	if port == "" { port = "8125" }
	log.Printf("Gamification Service starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func getUserPoints(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user_id": chi.URLParam(r, "userId"), "total_points": 2350,
		"redeemable_value_naira": 1175, "level": "Gold",
		"next_level": "Platinum", "points_to_next": 650,
	})
}

func awardPoints(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID string `json:"user_id"`
		Action string `json:"action"`
		Amount int    `json:"amount"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user_id": body.UserID, "action": body.Action, "points_awarded": body.Amount,
		"new_total": 2350 + body.Amount, "badge_earned": nil,
	})
}

func getLeaderboard(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"period": "monthly", "entries": []map[string]interface{}{
			{"rank": 1, "user": "Adebayo O.", "points": 4500, "region": "Lagos"},
			{"rank": 2, "user": "Chioma N.", "points": 3800, "region": "Enugu"},
			{"rank": 3, "user": "Ibrahim M.", "points": 3200, "region": "Kano"},
		},
	})
}

func getUserBadges(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user_id": chi.URLParam(r, "userId"),
		"badges": []map[string]interface{}{
			{"name": "First Policy", "earned_at": time.Now().AddDate(-1, 0, 0).Format(time.RFC3339), "icon": "shield"},
			{"name": "Claim-Free Champion", "earned_at": time.Now().AddDate(0, -6, 0).Format(time.RFC3339), "icon": "star"},
			{"name": "Super Referrer", "earned_at": time.Now().AddDate(0, -1, 0).Format(time.RFC3339), "icon": "users"},
		},
	})
}
