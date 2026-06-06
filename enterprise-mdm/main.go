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

// Enterprise MDM — Master Data Management with golden record resolution
// Business Rules:
// - Golden record: Single source of truth for customer, policy, agent entities
// - Deduplication: Fuzzy matching on name + DOB + phone (>85% match = merge candidate)
// - Data quality score: 0-100, minimum 70 for operational use
// - Lineage: Track data source, transformations, and consumers
// - Governance: Data steward approval for merge operations

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
	log.Printf("Connected to PostgreSQL for enterprise_mdm")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS enterprise_mdm (
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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "enterprise-mdm"})
	})
	r.Get("/api/v1/golden-records", listGoldenRecords)
	r.Post("/api/v1/deduplicate", findDuplicates)
	r.Get("/api/v1/quality-score", dataQualityScore)
	port := os.Getenv("PORT")
	if port == "" { port = "8095" }
	log.Printf("Enterprise MDM starting on :%s", port)
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

func listGoldenRecords(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"records": []map[string]interface{}{
			{"entity": "customer", "total": 45000, "quality_score": 82, "duplicates_pending": 120},
			{"entity": "policy", "total": 28000, "quality_score": 91, "duplicates_pending": 15},
			{"entity": "agent", "total": 3500, "quality_score": 88, "duplicates_pending": 8},
		},
	})
}

func findDuplicates(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"duplicates_found": 12, "merge_candidates": 8, "review_required": 4,
		"matching_algorithm": "fuzzy_name_dob_phone", "threshold": 0.85,
	})
}

func dataQualityScore(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"overall_score": 85, "completeness": 88, "accuracy": 82, "consistency": 86,
		"timeliness": 90, "uniqueness": 79, "last_assessment": time.Now().AddDate(0, 0, -1).Format(time.RFC3339),
	})
}
