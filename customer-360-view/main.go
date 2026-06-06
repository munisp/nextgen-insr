package main

import (
	"fmt"
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"database/sql"

	_ "github.com/lib/pq"
		"context"
	"os/signal"
	"syscall"
)

// Customer 360 View — unified customer profile aggregating all touchpoints
// Business Rules:
// - Data sources: KYC, transactions, claims, policies, interactions, social
// - Profile completeness score: 0-100 (minimum 60 for premium services)
// - NDPR compliance: Customer can request full data export (30-day SLA)
// - Segmentation: High-value (>₦5M), Standard, New, Dormant (90 days inactive)
// - Cross-sell scoring: Based on product gaps and life events

type CustomerProfile struct {
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	Segment          string  `json:"segment"`
	CompletenessScore int    `json:"completeness_score"`
	TotalPolicies    int     `json:"total_policies"`
	TotalPremium     float64 `json:"total_premium_naira"`
	ClaimsCount      int     `json:"claims_count"`
	LifetimeValue    float64 `json:"lifetime_value"`
	RiskScore        int     `json:"risk_score"`
	CrossSellScore   int     `json:"cross_sell_score"`
	LastInteraction  string  `json:"last_interaction"`
}

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
	log.Printf("Connected to PostgreSQL for customer_360_view")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS customer_360_view (
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


func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func tracingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = fmt.Sprintf("req-%d", time.Now().UnixNano())
		}
		w.Header().Set("X-Request-ID", requestID)
		start := time.Now()
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		log.Printf("[TRACE] %s %s %d %s request_id=%s", r.Method, r.URL.Path, wrapped.statusCode, time.Since(start), requestID)
	})
}

type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
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

var (
	rateLimitMu    sync.Mutex
	rateLimitStore = make(map[string][]time.Time)
)

func rateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			ip = fwd
		}
		rateLimitMu.Lock()
		now := time.Now()
		window := now.Add(-1 * time.Minute)
		var recent []time.Time
		for _, t := range rateLimitStore[ip] {
			if t.After(window) {
				recent = append(recent, t)
			}
		}
		if len(recent) >= 100 {
			rateLimitMu.Unlock()
			w.Header().Set("Retry-After", "60")
			http.Error(w, `{"error":"rate limit exceeded","retry_after":60}`, http.StatusTooManyRequests)
			return
		}
		recent = append(recent, now)
		rateLimitStore[ip] = recent
		rateLimitMu.Unlock()
		next.ServeHTTP(w, r)
	})
}

func main() {
	initDB()
	initKafka()
	if db != nil {
		defer db.Close()
	}
	r := chi.NewRouter()
	r.Use(corsMiddleware)
	r.Use(tracingMiddleware)
	r.Use(rateLimitMiddleware)
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "customer-360-view"})
	})
	r.Get("/api/v1/customers/{id}/360", getCustomer360)
	r.Get("/api/v1/customers/{id}/cross-sell", getCrossSell)
	r.Get("/api/v1/segments", getSegments)

	port := os.Getenv("PORT")
	if port == "" { port = "8103" }
	log.Printf("Customer 360 View starting on :%s", port)
	srv := &http.Server{Addr: ":"+port, Handler: tracingMiddleware(corsMiddleware(r)), ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	go func() { if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed { log.Fatalf("Server failed: %v", err) } }()
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down gracefully...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil { log.Fatalf("Forced shutdown: %v", err) }
	log.Println("Server stopped")
}

func getCustomer360(w http.ResponseWriter, r *http.Request) {
	profile := CustomerProfile{
		ID: chi.URLParam(r, "id"), Name: "Adebayo Ogundimu", Segment: "high_value",
		CompletenessScore: 85, TotalPolicies: 4, TotalPremium: 2500000,
		ClaimsCount: 1, LifetimeValue: 8500000, RiskScore: 25, CrossSellScore: 78,
		LastInteraction: time.Now().AddDate(0, 0, -3).Format(time.RFC3339),
	}
	json.NewEncoder(w).Encode(profile)
}

func getCrossSell(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"customer_id": chi.URLParam(r, "id"),
		"recommendations": []map[string]interface{}{
			{"product": "Health Insurance", "score": 92, "reason": "No health coverage, age 35-45 bracket"},
			{"product": "Life Insurance", "score": 78, "reason": "Recently married, has dependents"},
			{"product": "Investment-Linked", "score": 65, "reason": "High net worth, no investment products"},
		},
	})
}

func getSegments(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"segments": []map[string]interface{}{
			{"name": "high_value", "criteria": ">₦5M lifetime value", "count": 450},
			{"name": "standard", "criteria": "₦500K-₦5M", "count": 3200},
			{"name": "new", "criteria": "<90 days", "count": 890},
			{"name": "dormant", "criteria": ">90 days inactive", "count": 1100},
		},
	})
}
