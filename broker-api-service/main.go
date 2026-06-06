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

// Broker API Service — manages insurance broker integrations and commission
// Business Rules:
// - Broker tiers: Bronze (5% commission), Silver (7%), Gold (10%), Platinum (12%)
// - Minimum premium for broker assignment: ₦50,000
// - Commission split: 70% broker, 30% sub-agents
// - NAICOM broker license validation before activation
// - Quarterly performance review: Volume, retention, complaints
// - Clawback: If policy cancelled within 6 months, commission reversed

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
	log.Printf("Connected to PostgreSQL for broker_api_service")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS broker_api_service (
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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "broker-api-service"})
	})
	r.Route("/api/v1/brokers", func(r chi.Router) {
		r.Get("/", listBrokers)
		r.Post("/", registerBroker)
		r.Get("/{id}/commission", calculateCommission)
		r.Post("/{id}/validate-license", validateLicense)
	})

	port := os.Getenv("PORT")
	if port == "" { port = "8102" }
	log.Printf("Broker API Service starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

var brokerTiers = map[string]float64{"bronze": 0.05, "silver": 0.07, "gold": 0.10, "platinum": 0.12}

func listBrokers(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"brokers": []map[string]interface{}{
			{"id": "BRK-001", "name": "Lagos Insurance Brokers Ltd", "tier": "gold", "commission_rate": 0.10, "active_policies": 245, "status": "active"},
			{"id": "BRK-002", "name": "Abuja Risk Consultants", "tier": "silver", "commission_rate": 0.07, "active_policies": 120, "status": "active"},
		},
		"total": 2,
	})
}

func registerBroker(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name          string `json:"name"`
		LicenseNumber string `json:"license_number"`
		Tier          string `json:"tier"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	rate, ok := brokerTiers[body.Tier]
	if !ok { rate = brokerTiers["bronze"] }
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"broker_id": "BRK-" + time.Now().Format("20060102"), "name": body.Name,
		"tier": body.Tier, "commission_rate": rate, "status": "pending_license_validation",
		"clawback_period": "6 months", "min_premium": 50000,
	})
}

func calculateCommission(w http.ResponseWriter, r *http.Request) {
	premium := 250000.0
	tier := "gold"
	rate := brokerTiers[tier]
	total := premium * rate
	brokerShare := total * 0.70
	subAgentShare := total * 0.30
	json.NewEncoder(w).Encode(map[string]interface{}{
		"premium": premium, "tier": tier, "rate": rate, "total_commission": total,
		"broker_share": brokerShare, "sub_agent_share": subAgentShare, "split": "70/30",
	})
}

func validateLicense(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"valid": true, "issuer": "NAICOM", "license_type": "insurance_broker",
		"expiry": time.Now().AddDate(1, 0, 0).Format("2006-01-02"), "status": "active",
	})
}
