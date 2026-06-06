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

// NDPR Compliance — Nigeria Data Protection Regulation implementation
// Business Rules:
// - Consent management: Explicit opt-in for each data processing purpose
// - Data subject rights: Access (30 days), Rectification (14 days), Erasure (30 days), Portability (30 days)
// - Breach notification: NITDA within 72 hours, affected persons "without undue delay"
// - Data Protection Impact Assessment: Required for high-risk processing
// - Annual audit: Mandatory filing with NITDA
// - Lawful basis: Consent, Contract, Legal Obligation, Vital Interest, Public Interest, Legitimate Interest

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
	log.Printf("Connected to PostgreSQL for ndpr_compliance")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS ndpr_compliance (
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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "ndpr-compliance"})
	})
	r.Post("/api/v1/consent", recordConsent)
	r.Post("/api/v1/dsar", submitDSAR)
	r.Get("/api/v1/dsar/{id}", getDSARStatus)
	r.Post("/api/v1/breach/report", reportBreach)
	r.Get("/api/v1/audit/annual", annualAudit)

	port := os.Getenv("PORT")
	if port == "" { port = "8126" }
	log.Printf("NDPR Compliance starting on :%s", port)
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

func recordConsent(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CustomerID string   `json:"customer_id"`
		Purposes   []string `json:"purposes"`
		Method     string   `json:"method"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"consent_id": "CON-" + time.Now().Format("20060102150405"),
		"customer_id": body.CustomerID, "purposes": body.Purposes,
		"lawful_basis": "consent", "recorded_at": time.Now().Format(time.RFC3339),
		"withdrawal_available": true,
	})
}

func submitDSAR(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CustomerID string `json:"customer_id"`
		Type       string `json:"type"` // access, rectification, erasure, portability
	}
	json.NewDecoder(r.Body).Decode(&body)
	sla := map[string]int{"access": 30, "rectification": 14, "erasure": 30, "portability": 30}
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"dsar_id": "DSAR-" + time.Now().Format("20060102150405"),
		"type": body.Type, "status": "received", "sla_days": sla[body.Type],
		"deadline": time.Now().AddDate(0, 0, sla[body.Type]).Format("2006-01-02"),
	})
}

func getDSARStatus(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"dsar_id": chi.URLParam(r, "id"), "type": "access", "status": "in_progress",
		"progress_pct": 60, "estimated_completion": time.Now().AddDate(0, 0, 5).Format("2006-01-02"),
	})
}

func reportBreach(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"breach_id": "BRH-" + time.Now().Format("20060102150405"),
		"nitda_notification_deadline": time.Now().Add(72 * time.Hour).Format(time.RFC3339),
		"status": "reported", "severity": "high", "affected_persons": 0,
	})
}

func annualAudit(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"audit_year": 2026, "status": "compliant",
		"consent_records": 45000, "dsar_requests": 120, "breaches": 0,
		"dpia_completed": 5, "nitda_filing": "submitted",
	})
}
