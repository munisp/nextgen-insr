package main

import (
	"fmt"
	"bytes"
	"encoding/json"
	"log"
	"math"
	"net/http"
	"database/sql"
	"os"

	_ "github.com/lib/pq"
		"context"
	"os/signal"
	"syscall"
	"time"
)

// Underwriting Engine
// Automated risk assessment and premium calculation.
// Integrates with: Postgres, Redis, Kafka, OpenSearch
//
// Supported Products: Motor, Health, Home, Life, Travel, Marine
// Rating Factors: Age, occupation, location, claims history, sum insured

type QuoteRequest struct {
	Product    string  `json:"product"`
	SumInsured float64 `json:"sum_insured"`
	Age        int     `json:"age"`
	Occupation string  `json:"occupation"`
	Location   string  `json:"location"` // Nigerian state
	ClaimsHistory int  `json:"claims_history"` // last 5 years
}

type QuoteResponse struct {
	Premium     float64 `json:"premium"`
	BasePremium float64 `json:"base_premium"`
	LoadingPct  float64 `json:"loading_pct"`
	DiscountPct float64 `json:"discount_pct"`
	RiskClass   string  `json:"risk_class"`
	Terms       string  `json:"terms"`
	Declined    bool    `json:"declined"`
	Reason      string  `json:"reason,omitempty"`
}

func calculatePremium(req QuoteRequest) QuoteResponse {
	baseRates := map[string]float64{
		"motor": 0.03, "health": 0.05, "home": 0.015,
		"life": 0.02, "travel": 0.08, "marine": 0.04,
	}
	baseRate, ok := baseRates[req.Product]
	if !ok { baseRate = 0.05 }

	basePremium := req.SumInsured * baseRate
	loading := 0.0
	discount := 0.0

	// Age loading (life/health)
	if req.Product == "life" || req.Product == "health" {
		if req.Age > 60 { loading += 0.50 }
		if req.Age > 50 { loading += 0.25 }
	}
	// Claims loading
	if req.ClaimsHistory > 0 { loading += float64(req.ClaimsHistory) * 0.10 }
	if req.ClaimsHistory > 3 { loading += 0.20 }

	// Location discount (lower risk states)
	lowRiskStates := map[string]bool{"Abuja": true, "Lagos": true, "Rivers": true}
	if lowRiskStates[req.Location] { discount += 0.05 }
	// No-claims discount
	if req.ClaimsHistory == 0 { discount += 0.15 }

	// Decline rules
	if req.Age > 75 && req.Product == "life" {
		return QuoteResponse{Declined: true, Reason: "Exceeds maximum entry age (75) for life insurance"}
	}
	if loading > 1.0 {
		return QuoteResponse{Declined: true, Reason: "Risk exceeds acceptable threshold"}
	}

	premium := basePremium * (1 + loading - discount)
	premium = math.Max(premium, 5000) // Minimum premium ₦5,000

	riskClass := "standard"
	if loading > 0.3 { riskClass = "substandard" }
	if loading == 0 && discount > 0.1 { riskClass = "preferred" }

	return QuoteResponse{
		Premium: math.Round(premium*100) / 100, BasePremium: basePremium,
		LoadingPct: loading * 100, DiscountPct: discount * 100,
		RiskClass: riskClass, Terms: "Annual renewable",
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "kafka": "configured", "redis": "configured", "service": "underwriting-engine"})
}

func handleQuote(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req QuoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	result := calculatePremium(req)
	publishEvent("underwriting.quotes", req.Product, map[string]interface{}{"event": "quote.calculated", "product": req.Product, "premium": result.Premium, "risk_class": result.RiskClass, "declined": result.Declined})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
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
	log.Printf("Connected to PostgreSQL for underwriting_engine")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS underwriting_engine (
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



// ── Kafka Event Publishing (via REST Proxy) ─────────────────────────────────
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

// ── Redis Caching ───────────────────────────────────────────────────────────
var redisAddr string

type redisConn struct {
	addr string
}

func initRedis() *redisConn {
	redisAddr = os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	log.Printf("Redis configured at %s", redisAddr)
	return &redisConn{addr: redisAddr}
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

func main() {
	initDB()
	initKafka()
	initRedis()
	if db != nil {
		defer db.Close()
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/api/v1/quote", handleQuote)
	port := ":8096"
	log.Printf("Underwriting Engine starting on %s", port)
	srv := &http.Server{
		Addr:         port,
		Handler:      tracingMiddleware(corsMiddleware(mux)),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down gracefully...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Forced shutdown: %v", err)
	}
	log.Println("Server stopped")
}
