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

// Policy Workflow Engine — state machine for policy lifecycle management
// States: draft → submitted → underwriting → approved/declined → issued → active → renewal/lapsed/cancelled
// Business Rules:
// - Draft → Submitted: Requires all mandatory fields + KYC verification
// - Submitted → Underwriting: Auto-routed based on risk score (< 50 = auto, >= 50 = manual)
// - Underwriting SLA: 24h for auto, 72h for manual
// - Approved → Issued: Payment must be confirmed within 7 days
// - Active → Cancelled: Pro-rata refund if within cooling-off period (14 days)

var validTransitions = map[string][]string{
	"draft":        {"submitted"},
	"submitted":    {"underwriting", "rejected"},
	"underwriting": {"approved", "declined", "referred"},
	"approved":     {"issued", "expired"},
	"issued":       {"active"},
	"active":       {"renewal", "lapsed", "cancelled"},
	"renewal":      {"active", "lapsed"},
}

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
	log.Printf("Connected to PostgreSQL for policy_workflow_go")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS policy_workflow_go (
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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "policy-workflow-go"})
	})
	r.Post("/api/v1/workflow/transition", transitionPolicy)
	r.Get("/api/v1/workflow/valid-transitions/{state}", getValidTransitions)

	port := os.Getenv("PORT")
	if port == "" { port = "8106" }
	log.Printf("Policy Workflow Engine starting on :%s", port)
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

func transitionPolicy(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PolicyID     string `json:"policy_id"`
		CurrentState string `json:"current_state"`
		NewState     string `json:"new_state"`
		Actor        string `json:"actor"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	allowed, ok := validTransitions[body.CurrentState]
	if !ok { http.Error(w, `{"error":"invalid_current_state"}`, 400); return }
	valid := false
	for _, s := range allowed { if s == body.NewState { valid = true; break } }
	if !valid {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "invalid_transition", "current": body.CurrentState, "requested": body.NewState, "allowed": allowed})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true, "policy_id": body.PolicyID, "previous_state": body.CurrentState,
		"new_state": body.NewState, "transitioned_at": time.Now().Format(time.RFC3339), "actor": body.Actor,
	})
}

func getValidTransitions(w http.ResponseWriter, r *http.Request) {
	state := chi.URLParam(r, "state")
	transitions, ok := validTransitions[state]
	if !ok { http.Error(w, `{"error":"unknown_state"}`, 400); return }
	json.NewEncoder(w).Encode(map[string]interface{}{"current_state": state, "valid_transitions": transitions})
}
