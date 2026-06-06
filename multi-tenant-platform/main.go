package main

import (
	"fmt"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"database/sql"

	_ "github.com/lib/pq"
		"context"
	"os/signal"
	"syscall"
)

// Multi-Tenant Platform — white-label insurance platform for multiple insurers
// Business Rules:
// - Tenant isolation: Separate schemas per tenant, shared infrastructure
// - Branding: Custom logo, colors, domain per tenant
// - Feature flags: Per-tenant feature enablement
// - Data residency: Tenant data never crosses boundaries
// - Billing: Per-policy or monthly subscription model
// - Onboarding: Self-service tenant provisioning in < 24 hours

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
	log.Printf("Connected to PostgreSQL for multi_tenant_platform")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS multi_tenant_platform (
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

func tracingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = fmt.Sprintf("req-%d", time.Now().UnixNano())
		}
		w.Header().Set("X-Request-ID", requestID)
		start := time.Now()
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		log.Printf("[TRACE] %s %s %d %s request_id=%s", r.Method, r.URL.Path, wrapped.statusCode, time.Since(start), requestID)
	})
}

type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

var (
	rateLimitMu    sync.Mutex
	rateLimitStore = make(map[string][]time.Time)
)

func rateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			ip = fwd
		}
		rateLimitMu.Lock()
		now := time.Now()
		window := now.Add(-1 * time.Minute)
		var recent []time.Time
		for _, t := range rateLimitStore[ip] {
			if t.After(window) {
				recent = append(recent, t)
			}
		}
		if len(recent) >= 100 {
			rateLimitMu.Unlock()
			w.Header().Set("Retry-After", "60")
			http.Error(w, `{"error":"rate limit exceeded","retry_after":60}`, http.StatusTooManyRequests)
			return
		}
		recent = append(recent, now)
		rateLimitStore[ip] = recent
		rateLimitMu.Unlock()
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
	r.Use(tracingMiddleware)
	r.Use(rateLimitMiddleware)
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "multi-tenant-platform"})
	})
	r.Get("/api/v1/tenants", listTenants)
	r.Post("/api/v1/tenants", createTenant)
	r.Get("/api/v1/tenants/{id}/config", getTenantConfig)

	port := os.Getenv("PORT")
	if port == "" { port = "8133" }
	log.Printf("Multi-Tenant Platform starting on :%s", port)
	srv := &http.Server{Addr: ":"+port, Handler: tracingMiddleware(corsMiddleware(r)), ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
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

func listTenants(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tenants": []map[string]interface{}{
			{"id": "TEN-001", "name": "A&G Insurance", "domain": "ag.insureportal.ng", "status": "active", "policies": 12000},
			{"id": "TEN-002", "name": "Leadway Assurance", "domain": "leadway.insureportal.ng", "status": "active", "policies": 8500},
		},
	})
}

func createTenant(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tenant_id": "TEN-" + time.Now().Format("20060102"), "status": "provisioning",
		"estimated_ready": time.Now().Add(24 * time.Hour).Format(time.RFC3339),
		"isolation": "schema_per_tenant",
	})
}

func getTenantConfig(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tenant_id": chi.URLParam(r, "id"),
		"branding": map[string]string{"primary_color": "#1a365d", "logo_url": "/assets/logo.png"},
		"features": []string{"claims", "policies", "agents", "reports", "microinsurance"},
		"billing_model": "per_policy", "data_residency": "NG",
	})
}
