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

// NAICOM Compliance Module — automated regulatory reporting and monitoring
// Business Rules:
// - Quarterly returns: Financial statements, solvency ratio, claims statistics
// - Solvency margin: Minimum 15% (alert at 20%, critical at 17%)
// - Annual returns: Audited accounts, actuarial valuation, reinsurance arrangements
// - Incident reporting: Major incidents within 24 hours
// - Capital adequacy: Minimum ₦3B for life, ₦5B for composite

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
	log.Printf("Connected to PostgreSQL for naicom_compliance_module")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS naicom_compliance_module (
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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "naicom-compliance-module"})
	})
	r.Get("/api/v1/returns/quarterly", quarterlyReturns)
	r.Get("/api/v1/solvency", solvencyStatus)
	r.Post("/api/v1/incident/report", reportIncident)
	r.Get("/api/v1/capital", capitalAdequacy)
	port := os.Getenv("PORT")
	if port == "" { port = "8091" }
	log.Printf("NAICOM Compliance Module starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func quarterlyReturns(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"quarter": "Q1-2026", "status": "submitted", "submitted_at": time.Now().AddDate(0, 0, -5).Format(time.RFC3339),
		"components": map[string]string{
			"financial_statement": "submitted", "solvency_report": "submitted",
			"claims_statistics": "submitted", "premium_report": "submitted",
		},
		"next_deadline": time.Now().AddDate(0, 3, 0).Format("2006-01-02"),
	})
}

func solvencyStatus(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"solvency_ratio": 0.28, "minimum_required": 0.15,
		"status": "compliant", "buffer": 0.13,
		"alert_threshold": 0.20, "critical_threshold": 0.17,
	})
}

func reportIncident(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"incident_id": "INC-" + time.Now().Format("20060102150405"),
		"status": "filed", "naicom_deadline": time.Now().Add(24 * time.Hour).Format(time.RFC3339),
		"acknowledgement": "pending",
	})
}

func capitalAdequacy(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"minimum_capital": 5000000000, "current_capital": 8500000000,
		"surplus": 3500000000, "compliant": true, "license_type": "composite",
	})
}
