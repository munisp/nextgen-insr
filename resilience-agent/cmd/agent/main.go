// resilience-agent — 54Link Nigeria Connectivity Resilience Service
//
// Exposes a lightweight HTTP API on :8031 that the Node.js POS server
// consults for real-time connectivity intelligence:
//
//   GET  /probe          — measure latency to the configured probe URL
//   GET  /carrier/:phone — identify Nigerian carrier from phone prefix
//   POST /retry          — submit a transaction with exponential-backoff retry
//   GET  /health         — liveness check
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/54link/resilience-agent/internal/carrier"
	"github.com/54link/resilience-agent/internal/probe"
	"github.com/54link/resilience-agent/internal/retry"
	"database/sql"

	_ "github.com/lib/pq"
)

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
	log.Printf("Connected to PostgreSQL for resilience_agent")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS resilience_agent (
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
	port := os.Getenv("RESILIENCE_PORT")
	if port == "" {
		port = "8031"
	}
	probeURL := os.Getenv("PROBE_URL")
	if probeURL == "" {
		probeURL = "http://localhost:3000/api/trpc/agent.me?batch=1&input=%7B%7D"
	}
	posBackend := os.Getenv("POS_BACKEND_URL")
	if posBackend == "" {
		posBackend = "http://localhost:3000/api/trpc/transactions.create"
	}

	mux := http.NewServeMux()

	// ── GET /probe ─────────────────────────────────────────────────────────────
	mux.HandleFunc("/probe", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		result := probe.Probe(probeURL)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	})

	// ── GET /carrier/{phone} ───────────────────────────────────────────────────
	mux.HandleFunc("/carrier/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		phone := strings.TrimPrefix(r.URL.Path, "/carrier/")
		c := carrier.Detect(phone)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(c)
	})

	// ── POST /retry ────────────────────────────────────────────────────────────
	mux.HandleFunc("/retry", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var payload retry.TxPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		result := retry.Submit(ctx, posBackend, payload)
		w.Header().Set("Content-Type", "application/json")
		if result.Success {
			w.WriteHeader(http.StatusOK)
		} else {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		json.NewEncoder(w).Encode(result)
	})

	// ── GET /health ────────────────────────────────────────────────────────────
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":    "ok",
			"service":   "resilience-agent",
			"probeURL":  probeURL,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	})

	log.Printf("[resilience-agent] Listening on :%s (probe=%s)", port, probeURL)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("[resilience-agent] Fatal: %v", err)
	}
}
