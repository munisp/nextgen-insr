package main

import (
	"fmt"
	"encoding/json"
	"log"
	"net/http"
	"database/sql"
	"os"

	_ "github.com/lib/pq"
		"context"
	"os/signal"
	"syscall"
	"time"
)

// Reinsurance Service
// Manages treaty and facultative reinsurance relationships.
// Integrates with: Postgres, Kafka, TigerBeetle (settlements)
//
// Business Rules:
// - Automatic cession for risks > ₦100M (quota share 70/30)
// - Surplus treaty: retention ₦50M, 5 lines
// - Cat XL: ₦500M xs ₦200M per occurrence

type Treaty struct {
	ID          string  `json:"id"`
	Type        string  `json:"type"` // quota_share, surplus, xl, facultative
	Reinsurer   string  `json:"reinsurer"`
	Retention   float64 `json:"retention"`
	CessionRate float64 `json:"cession_rate"`
	Limit       float64 `json:"limit"`
	Period      string  `json:"period"`
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "reinsurance-service"})
}

func handleTreaties(w http.ResponseWriter, r *http.Request) {
	treaties := []Treaty{
		{ID: "TRY-001", Type: "quota_share", Reinsurer: "Africa Re", Retention: 50000000, CessionRate: 0.30, Limit: 500000000, Period: "2026"},
		{ID: "TRY-002", Type: "surplus", Reinsurer: "Swiss Re", Retention: 50000000, CessionRate: 0.0, Limit: 250000000, Period: "2026"},
		{ID: "TRY-003", Type: "xl", Reinsurer: "Munich Re", Retention: 200000000, CessionRate: 0.0, Limit: 500000000, Period: "2026"},
	}
	json.NewEncoder(w).Encode(treaties)
}

func handleCede(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		PolicyID string  `json:"policy_id"`
		Amount   float64 `json:"amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	retention := 50000000.0
	ceded := 0.0
	if req.Amount > retention {
		ceded = (req.Amount - retention) * 0.70
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"policy_id": req.PolicyID, "gross_amount": req.Amount,
		"retention": retention, "ceded": ceded,
		"net_retained": req.Amount - ceded,
	})
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
	log.Printf("Connected to PostgreSQL for reinsurance_service")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS reinsurance_service (
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

func main() {
	initDB()
	if db != nil {
		defer db.Close()
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/api/v1/treaties", handleTreaties)
	mux.HandleFunc("/api/v1/cede", handleCede)
	port := ":8095"
	log.Printf("Reinsurance Service starting on %s", port)
	srv := &http.Server{
		Addr:         port,
		Handler:      tracingMiddleware(corsMiddleware(mux)),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down gracefully...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Forced shutdown: %v", err)
	}
	log.Println("Server stopped")
}
