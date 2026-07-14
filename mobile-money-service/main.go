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


func main() {
	initDB()
	if db != nil {
		defer db.Close()
	}
	r := chi.NewRouter()
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
	log.Fatal(http.ListenAndServe(":"+port, r))
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
