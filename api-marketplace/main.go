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

// API Marketplace — developer portal for open insurance APIs
// Business Rules:
// - API tiers: Free (100 req/day), Standard (10K req/day), Enterprise (unlimited)
// - Monetization: Per-call billing via TigerBeetle, monthly invoicing
// - Sandbox: Full test environment with synthetic data
// - Rate limiting: Per-tier via APISIX
// - Documentation: OpenAPI 3.0 specs auto-generated
// - Partner onboarding: Self-service with API key generation

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
	log.Printf("Connected to PostgreSQL for api_marketplace")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS api_marketplace (
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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "api-marketplace"})
	})
	r.Get("/api/v1/catalog", apiCatalog)
	r.Post("/api/v1/subscribe", subscribe)
	r.Get("/api/v1/usage/{apiKey}", getUsage)
	port := os.Getenv("PORT")
	if port == "" { port = "8098" }
	log.Printf("API Marketplace starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func apiCatalog(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"apis": []map[string]interface{}{
			{"name": "Policy API", "version": "v2", "endpoints": 12, "pricing": "₦5/call", "category": "core"},
			{"name": "Claims API", "version": "v1", "endpoints": 8, "pricing": "₦10/call", "category": "core"},
			{"name": "KYC Verification", "version": "v1", "endpoints": 5, "pricing": "₦25/call", "category": "identity"},
			{"name": "Risk Scoring", "version": "v1", "endpoints": 3, "pricing": "₦15/call", "category": "analytics"},
			{"name": "Agent Network", "version": "v1", "endpoints": 6, "pricing": "₦5/call", "category": "distribution"},
		},
		"total": 5, "sandbox_available": true,
	})
}

func subscribe(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"api_key": "ik_live_" + time.Now().Format("20060102150405"),
		"tier": "standard", "rate_limit": "10000/day",
		"sandbox_key": "ik_test_sandbox_" + time.Now().Format("150405"),
	})
}

func getUsage(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"api_key": chi.URLParam(r, "apiKey"),
		"period": "current_month", "calls": 4520, "limit": 10000,
		"cost_naira": 22600, "top_endpoint": "/api/v1/policies",
	})
}
