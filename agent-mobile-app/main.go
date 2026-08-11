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

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	_ "github.com/lib/pq"
)

// Agent Mobile App Backend — API for insurance agent field operations
// Business Rules:
// - Agent onboarding: Background check + NAICOM registration required
// - Offline mode: Queue policies/claims, sync when connected
// - Geofencing: Agent can only operate within assigned LGA — enforced by real
//   haversine distance against the agent's configured territory. Without a
//   configured territory the geofence can never default to "inside".
// - Commission: Real-time calculation and wallet credit
// - KPI tracking: Policies sold, renewals, claims filed, customer satisfaction

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
	log.Printf("Connected to PostgreSQL for agent_mobile_app")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS agent_mobile_app (
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

	// Domain tables backing the agent dashboard, geofence check-in and
	// commission endpoints. All dashboard figures are aggregated from these.
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS agent_policies (
			id SERIAL PRIMARY KEY,
			agent_id TEXT NOT NULL,
			policy_id TEXT,
			premium NUMERIC(15,2) DEFAULT 0,
			commission NUMERIC(15,2) DEFAULT 0,
			status VARCHAR(32) DEFAULT 'active',
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS agent_claims (
			id SERIAL PRIMARY KEY,
			agent_id TEXT NOT NULL,
			claim_id TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS agent_commissions (
			id SERIAL PRIMARY KEY,
			agent_id TEXT NOT NULL,
			policy_id TEXT,
			amount NUMERIC(15,2) DEFAULT 0,
			type VARCHAR(32) DEFAULT 'new_business',
			status VARCHAR(32) DEFAULT 'pending',
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS agent_wallets (
			agent_id TEXT PRIMARY KEY,
			balance NUMERIC(15,2) DEFAULT 0,
			rating NUMERIC(3,2)
		)`,
		`CREATE TABLE IF NOT EXISTS agent_territories (
			agent_id TEXT PRIMARY KEY,
			territory_name TEXT NOT NULL,
			center_lat DOUBLE PRECISION NOT NULL,
			center_lng DOUBLE PRECISION NOT NULL,
			radius_km DOUBLE PRECISION NOT NULL
		)`,
	}
	for _, m := range migrations {
		if _, err := db.Exec(m); err != nil {
			log.Printf("WARN: domain table creation failed: %v", err)
		}
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
	defer resp.Body.Close()
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
	fmt.Fprintf(w, "# HELP http_requests_total Total HTTP requests\n")
	fmt.Fprintf(w, "# TYPE http_requests_total counter\n")
	fmt.Fprintf(w, "http_requests_total %d\n", atomic.LoadInt64(&metricsReqCount))
	fmt.Fprintf(w, "# HELP process_uptime_seconds Process uptime in seconds\n")
	fmt.Fprintf(w, "# TYPE process_uptime_seconds gauge\n")
	fmt.Fprintf(w, "process_uptime_seconds %.2f\n", time.Since(metricsStartTime).Seconds())
}

func handleReady(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if db == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", "reason": "database not initialized"})
		return
	}
	if err := db.Ping(); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", "reason": "database unreachable"})
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}

func handleLive(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}

func main() {
	initDB()
	initKafka()
	if db != nil {
		defer db.Close()
	}
	r := chi.NewRouter()
	r.Use(corsMiddleware)
	r.Use(tracingMiddleware)
	r.Use(rateLimitMiddleware)
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/metrics", prodMetricsHandler)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "agent-mobile-app"})
	})
	r.Get("/ready", handleReady)
	r.Get("/live", handleLive)
	r.Get("/api/v1/agent/{id}/dashboard", agentDashboard)
	r.Post("/api/v1/agent/{id}/checkin", agentCheckin)
	r.Get("/api/v1/agent/{id}/commission", agentCommission)

	port := os.Getenv("PORT")
	if port == "" { port = "8134" }
	log.Printf("Agent Mobile App starting on :%s", port)
	srv := &http.Server{Addr: ":"+port, Handler: tracingMiddleware(corsMiddleware(r)), ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	go func() { if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed { log.Fatalf("Server failed: %v", err) } }()
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Printf(`{"level":"info","msg":"shutting down gracefully","service":"agent-mobile-app"}`)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil { log.Fatalf("Forced shutdown: %v", err) }
	log.Println("Server stopped")
}

// dbUnavailable answers 503 honestly when there is no database to aggregate from.
func dbUnavailable(w http.ResponseWriter, agentID, resource string) {
	w.WriteHeader(http.StatusServiceUnavailable)
	json.NewEncoder(w).Encode(map[string]string{
		"error":    fmt.Sprintf("%s unavailable: database not connected", resource),
		"agent_id": agentID,
	})
}

// agentDashboard aggregates today's KPIs from the database. It never returns
// hardcoded figures: no database → 503; query failure → 503 with the error.
func agentDashboard(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	w.Header().Set("Content-Type", "application/json")
	if db == nil {
		dbUnavailable(w, agentID, "agent dashboard")
		return
	}

	var policiesSold, renewals, claimsFiled int
	var premiumCollected, commissionEarned float64

	if err := db.QueryRow(`SELECT COUNT(*) FROM agent_policies WHERE agent_id = $1 AND created_at::date = CURRENT_DATE`, agentID).Scan(&policiesSold); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("dashboard query failed: %s", err.Error()), "agent_id": agentID})
		return
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM agent_policies WHERE agent_id = $1 AND status = 'renewed' AND created_at::date = CURRENT_DATE`, agentID).Scan(&renewals); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("dashboard query failed: %s", err.Error()), "agent_id": agentID})
		return
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM agent_claims WHERE agent_id = $1 AND created_at::date = CURRENT_DATE`, agentID).Scan(&claimsFiled); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("dashboard query failed: %s", err.Error()), "agent_id": agentID})
		return
	}
	if err := db.QueryRow(`SELECT COALESCE(SUM(premium),0) FROM agent_policies WHERE agent_id = $1 AND created_at::date = CURRENT_DATE`, agentID).Scan(&premiumCollected); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("dashboard query failed: %s", err.Error()), "agent_id": agentID})
		return
	}
	if err := db.QueryRow(`SELECT COALESCE(SUM(amount),0) FROM agent_commissions WHERE agent_id = $1 AND created_at::date = CURRENT_DATE`, agentID).Scan(&commissionEarned); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("dashboard query failed: %s", err.Error()), "agent_id": agentID})
		return
	}

	var walletBalance float64
	var rating sql.NullFloat64
	err := db.QueryRow(`SELECT balance, rating FROM agent_wallets WHERE agent_id = $1`, agentID).Scan(&walletBalance, &rating)
	if err == sql.ErrNoRows {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "agent wallet not found (agent not onboarded)", "agent_id": agentID})
		return
	} else if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("dashboard query failed: %s", err.Error()), "agent_id": agentID})
		return
	}

	var monthlyPolicies int
	if err := db.QueryRow(`SELECT COUNT(*) FROM agent_policies WHERE agent_id = $1 AND to_char(created_at,'YYYY-MM') = to_char(CURRENT_DATE,'YYYY-MM')`, agentID).Scan(&monthlyPolicies); err != nil {
		monthlyPolicies = 0
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"agent_id": agentID,
		"today": map[string]interface{}{
			"policies_sold":     policiesSold,
			"renewals":          renewals,
			"claims_filed":      claimsFiled,
			"premium_collected": premiumCollected,
			"commission_earned": commissionEarned,
		},
		"monthly_policies": monthlyPolicies,
		"wallet_balance":   walletBalance,
		"rating":           rating.Float64,
	})
}

// haversineKm computes the great-circle distance between two coordinates.
func haversineKm(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusKm = 6371.0
	toRad := func(deg float64) float64 { return deg * math.Pi / 180 }
	dLat := toRad(lat2 - lat1)
	dLon := toRad(lon2 - lon1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * earthRadiusKm * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

// agentCheckin verifies the reported coordinates against the agent's assigned
// territory using a real haversine distance. within_geofence is NEVER
// defaulted to true: without a configured territory the check-in is rejected.
func agentCheckin(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		Lat float64 `json:"lat"`
		Lng float64 `json:"lng"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request: lat and lng required"}`, http.StatusBadRequest)
		return
	}
	if req.Lat < -90 || req.Lat > 90 || req.Lng < -180 || req.Lng > 180 {
		http.Error(w, `{"error":"invalid coordinates"}`, http.StatusBadRequest)
		return
	}
	if db == nil {
		dbUnavailable(w, agentID, "agent check-in")
		return
	}

	var territoryName string
	var centerLat, centerLng, radiusKm float64
	err := db.QueryRow(`SELECT territory_name, center_lat, center_lng, radius_km FROM agent_territories WHERE agent_id = $1`, agentID).
		Scan(&territoryName, &centerLat, &centerLng, &radiusKm)
	if err == sql.ErrNoRows {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]string{
			"error":    "no assigned territory configured for agent; geofence cannot be verified",
			"agent_id": agentID,
		})
		return
	} else if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("territory lookup failed: %s", err.Error()), "agent_id": agentID})
		return
	}

	distanceKm := haversineKm(req.Lat, req.Lng, centerLat, centerLng)
	within := distanceKm <= radiusKm

	json.NewEncoder(w).Encode(map[string]interface{}{
		"agent_id":             agentID,
		"checked_in":           true,
		"location":             territoryName,
		"within_geofence":      within,
		"distance_km":          math.Round(distanceKm*100) / 100,
		"territory_radius_km":  radiusKm,
		"timestamp":            time.Now().Format(time.RFC3339),
	})
}

// agentCommission lists real commission records from the database.
func agentCommission(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	w.Header().Set("Content-Type", "application/json")
	if db == nil {
		dbUnavailable(w, agentID, "agent commissions")
		return
	}
	rows, err := db.Query(`SELECT policy_id, amount, type, status FROM agent_commissions WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 100`, agentID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("commission query failed: %s", err.Error()), "agent_id": agentID})
		return
	}
	defer rows.Close()

	commissions := []map[string]interface{}{}
	var totalPending, totalCredited float64
	for rows.Next() {
		var policyID sql.NullString
		var amount float64
		var ctype, status string
		if err := rows.Scan(&policyID, &amount, &ctype, &status); err != nil {
			continue
		}
		commissions = append(commissions, map[string]interface{}{
			"policy_id": policyID.String,
			"amount":    amount,
			"type":      ctype,
			"status":    status,
		})
		if status == "pending" {
			totalPending += amount
		} else if status == "credited" {
			totalCredited += amount
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"agent_id":       agentID,
		"commissions":    commissions,
		"total_pending":  totalPending,
		"total_credited": totalCredited,
	})
}
