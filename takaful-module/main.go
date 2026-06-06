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

// Takaful Module — Shariah-compliant insurance operations
// Business Rules:
// - Tabarru (donation) pool model — participants contribute to shared pool
// - Surplus distribution: 70% participants, 30% operator (Wakala fee)
// - Investment: Only Shariah-compliant instruments (no riba/interest)
// - Shariah Advisory Board: Required for product approval
// - Retakaful: Reinsurance through Shariah-compliant retakaful operators
// - NAICOM Takaful guidelines compliance

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
	log.Printf("Connected to PostgreSQL for takaful_module")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS takaful_module (
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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "takaful-module"})
	})
	r.Get("/api/v1/products", takafulProducts)
	r.Get("/api/v1/pool/status", poolStatus)
	r.Post("/api/v1/contribution", makeContribution)
	r.Get("/api/v1/surplus", surplusDistribution)

	port := os.Getenv("PORT")
	if port == "" { port = "8128" }
	log.Printf("Takaful Module starting on :%s", port)
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

func takafulProducts(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"products": []map[string]interface{}{
			{"id": "TAK-FAM", "name": "Family Takaful", "type": "life", "contribution_min": 5000, "shariah_certified": true},
			{"id": "TAK-GEN", "name": "General Takaful", "type": "general", "contribution_min": 10000, "shariah_certified": true},
			{"id": "TAK-HLT", "name": "Health Takaful", "type": "health", "contribution_min": 3000, "shariah_certified": true},
		},
		"wakala_fee_pct": 30, "shariah_board": "approved",
	})
}

func poolStatus(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total_pool": 85000000, "tabarru_pool": 59500000, "investment_pool": 25500000,
		"participants": 3200, "claims_paid_ytd": 12000000,
		"investment_return": 0.08, "shariah_compliant": true,
	})
}

func makeContribution(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ParticipantID string  `json:"participant_id"`
		Amount        float64 `json:"amount"`
		ProductID     string  `json:"product_id"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	tabarru := body.Amount * 0.70
	wakala := body.Amount * 0.30
	json.NewEncoder(w).Encode(map[string]interface{}{
		"contribution_id": "CON-" + time.Now().Format("20060102150405"),
		"amount": body.Amount, "tabarru_portion": tabarru, "wakala_fee": wakala,
		"status": "accepted", "shariah_compliant": true,
	})
}

func surplusDistribution(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"period": "2025", "total_surplus": 15000000,
		"participant_share": 10500000, "operator_share": 4500000,
		"distribution_ratio": "70/30", "status": "distributed",
	})
}
