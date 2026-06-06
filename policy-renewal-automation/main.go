package main

import (
	"fmt"
	"encoding/json"
	"log"
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

// Policy Renewal Automation — automated policy renewal with dynamic pricing
// Business Rules:
// - Auto-renew: Customer opt-in required, 30-day advance notice
// - Pricing: Base premium × claims factor × loyalty discount × inflation adjustment
// - Loyalty discount: 5% after 1 year, 10% after 3 years, 15% after 5 years
// - Claims loading: 0 claims = -5%, 1 claim = 0%, 2+ claims = +15% per claim
// - Grace period: 30 days after expiry (coverage reduced to 50%)
// - Lapse: After grace period → policy terminated, new application required
// - Communication: SMS at -30d, -14d, -7d, -3d, -1d, 0d, +7d, +14d, +30d

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
	log.Printf("Connected to PostgreSQL for policy_renewal_automation")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS policy_renewal_automation (
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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "policy-renewal-automation"})
	})
	r.Get("/api/v1/renewals/upcoming", upcomingRenewals)
	r.Post("/api/v1/renewals/calculate", calculateRenewalPremium)
	r.Post("/api/v1/renewals/process", processRenewal)

	port := os.Getenv("PORT")
	if port == "" { port = "8105" }
	log.Printf("Policy Renewal Automation starting on :%s", port)
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
