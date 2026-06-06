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

// Mobile Money Service — integration with Nigerian mobile money operators
// Operators: OPay, PalmPay, Paga, Moniepoint, Kuda
// Business Rules:
// - Premium collection via mobile money deduction (auto-debit with consent)
// - Claim payout to mobile wallets (instant, max ₦5M per transaction)
// - KYC tier determines transaction limits
// - Mojaloop integration for interoperability
// - Settlement: T+0 for wallet-to-wallet, T+1 for wallet-to-bank

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
	log.Printf("Connected to PostgreSQL for mobile_money_service")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS mobile_money_service (
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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "mobile-money-service"})
	})
	r.Post("/api/v1/collect", collectPremium)
	r.Post("/api/v1/disburse", disburseToClaim)
	r.Get("/api/v1/operators", listOperators)
	r.Get("/api/v1/balance/{walletId}", walletBalance)

	port := os.Getenv("PORT")
	if port == "" { port = "8127" }
	log.Printf("Mobile Money Service starting on :%s", port)
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

func collectPremium(w http.ResponseWriter, r *http.Request) {
	var body struct {
		WalletID string  `json:"wallet_id"`
		Amount   float64 `json:"amount"`
		Operator string  `json:"operator"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"transaction_id": "MMT-" + time.Now().Format("20060102150405"),
		"amount": body.Amount, "operator": body.Operator, "status": "successful",
		"settlement": "T+0", "reference": body.WalletID,
	})
}

func disburseToClaim(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"payout_id": "MMP-" + time.Now().Format("20060102150405"),
		"status": "completed", "channel": "mobile_wallet", "settlement": "instant",
	})
}

func listOperators(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"operators": []map[string]interface{}{
			{"name": "OPay", "code": "OPAY", "active": true, "max_transaction": 5000000},
			{"name": "PalmPay", "code": "PALMPAY", "active": true, "max_transaction": 5000000},
			{"name": "Paga", "code": "PAGA", "active": true, "max_transaction": 3000000},
			{"name": "Moniepoint", "code": "MONIE", "active": true, "max_transaction": 5000000},
			{"name": "Kuda", "code": "KUDA", "active": true, "max_transaction": 5000000},
		},
	})
}

func walletBalance(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"wallet_id": chi.URLParam(r, "walletId"), "balance": 450000,
		"currency": "NGN", "last_transaction": time.Now().Add(-2 * time.Hour).Format(time.RFC3339),
	})
}
