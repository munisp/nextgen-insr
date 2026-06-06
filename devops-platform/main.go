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

// DevOps Platform — CI/CD, infrastructure management, deployment orchestration
// Business Rules:
// - Deployment strategy: Blue/green with canary validation
// - Rollback: Automatic if error rate > 1% in first 5 minutes
// - Environment: dev → staging → production (manual gate for prod)
// - Infrastructure: K8s on AWS EKS, multi-AZ
// - Monitoring: Full stack observability (Prometheus, Grafana, OpenSearch)

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
	log.Printf("Connected to PostgreSQL for devops_platform")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS devops_platform (
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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "devops-platform"})
	})
	r.Get("/api/v1/deployments", listDeployments)
	r.Post("/api/v1/deploy", triggerDeploy)
	r.Get("/api/v1/infrastructure", infraStatus)

	port := os.Getenv("PORT")
	if port == "" { port = "8136" }
	log.Printf("DevOps Platform starting on :%s", port)
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

func listDeployments(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"deployments": []map[string]interface{}{
			{"id": "DEP-001", "service": "customer-portal", "version": "2.5.1", "environment": "production", "status": "healthy", "deployed_at": time.Now().AddDate(0, 0, -2).Format(time.RFC3339)},
			{"id": "DEP-002", "service": "claims-engine", "version": "1.8.0", "environment": "staging", "status": "canary_validating", "deployed_at": time.Now().Add(-30 * time.Minute).Format(time.RFC3339)},
		},
	})
}

func triggerDeploy(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"deployment_id": "DEP-" + time.Now().Format("20060102150405"),
		"strategy": "blue_green", "canary_pct": 10, "auto_rollback": true,
		"rollback_threshold": "error_rate > 1%", "status": "in_progress",
	})
}

func infraStatus(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"cluster": "eks-insureportal-prod", "nodes": 12, "pods_running": 85,
		"cpu_utilization": 45, "memory_utilization": 62,
		"availability_zones": []string{"af-south-1a", "af-south-1b", "af-south-1c"},
	})
}
