package main

import (
	"fmt"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"database/sql"

	_ "github.com/lib/pq"
		"context"
	"os/signal"
	"syscall"
	"time"
)

// Multi-Language Service — i18n for Nigerian languages + Pan-African markets
// Supported: English, Yoruba, Igbo, Hausa, Pidgin, French (West Africa)
// Business Rules:
// - Default: English, auto-detect from browser/device locale
// - Insurance terms: Professionally translated, NAICOM-approved terminology
// - SMS/USSD: Must support local language for rural agents
// - Fallback: English if translation unavailable

var translations = map[string]map[string]string{
	"en": {"welcome": "Welcome to InsurePortal", "policy": "Insurance Policy", "claim": "File a Claim", "premium": "Premium Payment"},
	"yo": {"welcome": "E kaabo si InsurePortal", "policy": "Iwe Adehun Insora", "claim": "Fi Ejo Sile", "premium": "Owo Isanwo"},
	"ig": {"welcome": "Nnoo na InsurePortal", "policy": "Akwukwo Insora", "claim": "Tinye Ariro", "premium": "Ugwo Insora"},
	"ha": {"welcome": "Barka da zuwa InsurePortal", "policy": "Takaddama Insora", "claim": "Shigar da Kara", "premium": "Biyan Insora"},
	"pcm": {"welcome": "You don reach InsurePortal", "policy": "Insurance Paper", "claim": "Make Claim", "premium": "Pay Premium"},
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
	log.Printf("Connected to PostgreSQL for multi_language_service")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS multi_language_service (
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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "multi-language-service"})
	})
	r.Get("/api/v1/languages", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"languages": []map[string]string{
				{"code": "en", "name": "English", "status": "complete"},
				{"code": "yo", "name": "Yoruba", "status": "complete"},
				{"code": "ig", "name": "Igbo", "status": "complete"},
				{"code": "ha", "name": "Hausa", "status": "complete"},
				{"code": "pcm", "name": "Pidgin", "status": "partial"},
				{"code": "fr", "name": "French", "status": "partial"},
			},
		})
	})
	r.Get("/api/v1/translate/{lang}", func(w http.ResponseWriter, r *http.Request) {
		lang := chi.URLParam(r, "lang")
		t, ok := translations[lang]
		if !ok { t = translations["en"] }
		json.NewEncoder(w).Encode(map[string]interface{}{"language": lang, "translations": t})
	})
	port := os.Getenv("PORT")
	if port == "" { port = "8137" }
	log.Printf("Multi-Language Service starting on :%s", port)
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
