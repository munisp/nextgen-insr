package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

// Agent Commission Management Service
// Calculates, tracks, and pays agent commissions based on tiered structures.
// Integrates with: TigerBeetle (payments), Kafka, Postgres, Redis
//
// Commission Tiers:
// - New Agent (0-6 months): 8% motor, 12% health, 10% life
// - Standard (6-24 months): 10% motor, 15% health, 12% life
// - Senior (24+ months): 12% motor, 18% health, 15% life
// - Override bonus: 2% on team production for team leads

type CommissionTier struct {
	Name   string
	Motor  float64
	Health float64
	Life   float64
	Home   float64
}

var tiers = map[string]CommissionTier{
	"new":      {Name: "New Agent", Motor: 0.08, Health: 0.12, Life: 0.10, Home: 0.06},
	"standard": {Name: "Standard", Motor: 0.10, Health: 0.15, Life: 0.12, Home: 0.08},
	"senior":   {Name: "Senior", Motor: 0.12, Health: 0.18, Life: 0.15, Home: 0.10},
}

func calculateCommission(premium float64, product string, tier string) float64 {
	t, ok := tiers[tier]
	if !ok {
		t = tiers["new"]
	}
	rates := map[string]float64{"motor": t.Motor, "health": t.Health, "life": t.Life, "home": t.Home}
	rate := rates[product]
	if rate == 0 {
		rate = 0.08
	}
	return math.Round(premium*rate*100) / 100
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "agent-commission-management"})
}

func handleCalculate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		AgentID string  `json:"agent_id"`
		Premium float64 `json:"premium"`
		Product string  `json:"product"`
		Tier    string  `json:"tier"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	commission := calculateCommission(req.Premium, req.Product, req.Tier)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"agent_id": req.AgentID, "premium": req.Premium, "product": req.Product,
		"tier": req.Tier, "commission": commission, "rate": commission / req.Premium,
		"payment_date": time.Now().AddDate(0, 0, 15).Format("2006-01-02"),
	})
}

// handlePayoutSummary aggregates real payout figures from the
// agent_commissions table for the current period. It never returns
// hardcoded figures: no database → 503; query failure → 503 with the error.
func handlePayoutSummary(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if db == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "payout summary unavailable: database not connected"})
		return
	}
	period := time.Now().Format("2006-01")

	var totalPayable float64
	var agentsDue, pendingApproval int
	err := db.QueryRow(`SELECT COALESCE(SUM(amount),0), COUNT(DISTINCT agent_id),
		COUNT(*) FILTER (WHERE status = 'pending')
		FROM agent_commissions WHERE period = $1`, period).Scan(&totalPayable, &agentsDue, &pendingApproval)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("payout summary query failed: %s", err.Error())})
		return
	}

	var avgPayout, topEarner float64
	if err := db.QueryRow(`SELECT COALESCE(AVG(t),0), COALESCE(MAX(t),0) FROM (
		SELECT SUM(amount) AS t FROM agent_commissions WHERE period = $1 GROUP BY agent_id
	) per_agent`, period).Scan(&avgPayout, &topEarner); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("payout summary query failed: %s", err.Error())})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"period":           period,
		"total_payable":    totalPayable,
		"agents_due":       agentsDue,
		"avg_payout":       math.Round(avgPayout),
		"top_earner":       topEarner,
		"pending_approval": pendingApproval,
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
	log.Printf("Connected to PostgreSQL for agent_commission_management")

	// Commission records table — payout summary aggregates from here.
	if _, err = db.Exec(`CREATE TABLE IF NOT EXISTS agent_commissions (
		id SERIAL PRIMARY KEY,
		agent_id TEXT NOT NULL,
		policy_id TEXT,
		amount NUMERIC(15,2) DEFAULT 0,
		status VARCHAR(32) DEFAULT 'pending',
		period VARCHAR(7),
		created_at TIMESTAMPTZ DEFAULT NOW()
	)`); err != nil {
		log.Printf("WARN: agent_commissions table creation failed: %v", err)
	}

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS agent_commission_management (
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
		atomic.AddInt64(&metricsReqCount, 1)
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

var kafkaRestURL string

func initKafka() {
	kafkaRestURL = os.Getenv("KAFKA_REST_URL")
	if kafkaRestURL == "" {
		kafkaRestURL = "http://localhost:8082"
	}
	log.Printf("Kafka REST proxy configured at %s", kafkaRestURL)
}

func publishEvent(topic string, key string, payload interface{}) {
	if kafkaRestURL == "" {
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("WARN: kafka marshal error: %v", err)
		return
	}
	msg := map[string]interface{}{
		"records": []map[string]interface{}{
			{"key": key, "value": string(data)},
		},
	}
	body, _ := json.Marshal(msg)
	resp, err := http.Post(kafkaRestURL+"/topics/"+topic, "application/vnd.kafka.json.v2+json", bytes.NewReader(body))
	if err != nil {
		log.Printf("WARN: kafka publish error: %v", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
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

// ─── Metrics & Probes ────────────────────────────────────────────────────────

var (
	metricsReqCount  int64
	metricsStartTime = time.Now()
)

func prodMetricsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	_, _ = fmt.Fprintf(w, "# HELP http_requests_total Total HTTP requests\n")
	_, _ = fmt.Fprintf(w, "# TYPE http_requests_total counter\n")
	_, _ = fmt.Fprintf(w, "http_requests_total %d\n", atomic.LoadInt64(&metricsReqCount))
	_, _ = fmt.Fprintf(w, "# HELP process_uptime_seconds Process uptime in seconds\n")
	_, _ = fmt.Fprintf(w, "# TYPE process_uptime_seconds gauge\n")
	_, _ = fmt.Fprintf(w, "process_uptime_seconds %.2f\n", time.Since(metricsStartTime).Seconds())
}

func handleReady(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if db == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", "reason": "database not initialized"})
		return
	}
	if err := db.Ping(); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", "reason": "database unreachable"})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}

func handleLive(w http.ResponseWriter, r *http.Request) {
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}

func main() {
	initDB()
	initKafka()
	if db != nil {
		defer func() { _ = db.Close() }()
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/ready", handleReady)
	mux.HandleFunc("/live", handleLive)
	mux.HandleFunc("/api/v1/calculate", handleCalculate)
	mux.HandleFunc("/api/v1/payout-summary", handlePayoutSummary)
	mux.HandleFunc("/metrics", prodMetricsHandler)
	port := ":8099"
	log.Printf("Agent Commission Management starting on %s", port)
	srv := &http.Server{
		Addr:         port,
		Handler:      rateLimitMiddleware(tracingMiddleware(corsMiddleware(mux))),
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
	log.Printf(`{"level":"info","msg":"server stopped","service":"agent-commission-management"}`)
}
