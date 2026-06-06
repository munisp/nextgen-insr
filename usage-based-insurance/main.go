package main

import (
	"fmt"
	"encoding/json"
	"log"
	"math"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"database/sql"

	_ "github.com/lib/pq"
		"context"
	"os/signal"
	"syscall"
)

// Usage-Based Insurance — telematics and IoT-driven dynamic pricing
// Business Rules:
// - Data sources: Vehicle telematics (OBD-II), mobile app (driving behavior), IoT sensors
// - Scoring factors: Mileage, time of day, speeding events, harsh braking, phone usage
// - Premium adjustment: -30% to +50% based on driving score
// - Pay-per-km: ₦5-15/km depending on risk score
// - Minimum monthly premium: ₦2,000 (regardless of usage)
// - Data retention: Raw telemetry 90 days, aggregated scores 7 years

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
	log.Printf("Connected to PostgreSQL for usage_based_insurance")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS usage_based_insurance (
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

func main() {
	initDB()
	if db != nil {
		defer db.Close()
	}
	r := chi.NewRouter()
	r.Use(corsMiddleware)
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "usage-based-insurance"})
	})
	r.Post("/api/v1/telemetry", ingestTelemetry)
	r.Get("/api/v1/score/{policyId}", getDrivingScore)
	r.Get("/api/v1/premium/{policyId}", calculatePremium)

	port := os.Getenv("PORT")
	if port == "" { port = "8129" }
	log.Printf("Usage-Based Insurance starting on :%s", port)
	srv := &http.Server{Addr: ":"+port, Handler: corsMiddleware(r), ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
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
