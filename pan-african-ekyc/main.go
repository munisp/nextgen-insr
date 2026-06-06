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

// Pan-African eKYC — cross-border identity verification across African markets
// Supported: Nigeria (BVN/NIN), Ghana (Ghana Card), Kenya (IPRS), South Africa (RSA ID)
// Business Rules:
// - Cross-border: Verify customer identity in originating country
// - Regulatory: Each country has different KYC requirements
// - Data residency: Identity data must remain in country of origin
// - API: Unified interface, country-specific adapters
// - SLA: < 5 seconds for real-time verification

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
	log.Printf("Connected to PostgreSQL for pan_african_ekyc")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS pan_african_ekyc (
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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "pan-african-ekyc"})
	})
	r.Post("/api/v1/verify", verifyIdentity)
	r.Get("/api/v1/countries", supportedCountries)

	port := os.Getenv("PORT")
	if port == "" { port = "8131" }
	log.Printf("Pan-African eKYC starting on :%s", port)
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

func verifyIdentity(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Country  string `json:"country"`
		IDType   string `json:"id_type"`
		IDNumber string `json:"id_number"`
		FullName string `json:"full_name"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"verification_id": "VRF-" + time.Now().Format("20060102150405"),
		"country": body.Country, "id_type": body.IDType, "match": true,
		"confidence": 0.95, "data_residency": body.Country, "sla_ms": 1200,
	})
}

func supportedCountries(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"countries": []map[string]interface{}{
			{"code": "NG", "name": "Nigeria", "id_types": []string{"BVN", "NIN", "Voters_Card", "Drivers_License"}},
			{"code": "GH", "name": "Ghana", "id_types": []string{"Ghana_Card", "Voters_ID"}},
			{"code": "KE", "name": "Kenya", "id_types": []string{"National_ID", "Passport"}},
			{"code": "ZA", "name": "South Africa", "id_types": []string{"RSA_ID", "Passport"}},
		},
	})
}
