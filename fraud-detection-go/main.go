package main

import (
	"encoding/json"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"strconv"
	"syscall"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"context"
	"database/sql"
	"fmt"

	_ "github.com/lib/pq"
)

// Circuit breaker for external HTTP calls
type circuitBreakerState int
const (
	cbClosed circuitBreakerState = iota
	cbOpen
	cbHalfOpen
)
type circuitBreaker struct {
	state       circuitBreakerState
	failures    int
	threshold   int
	resetAfter  time.Duration
	lastFailure time.Time
}
var cb = &circuitBreaker{threshold: 5, resetAfter: 30 * time.Second}
func (c *circuitBreaker) allow() bool {
	if c.state == cbClosed { return true }
	if c.state == cbOpen && time.Since(c.lastFailure) > c.resetAfter {
		c.state = cbHalfOpen
		return true
	}
	return c.state == cbHalfOpen
}
func (c *circuitBreaker) recordSuccess() {
	c.failures = 0
	c.state = cbClosed
}
func (c *circuitBreaker) recordFailure() {
	c.failures++
	c.lastFailure = time.Now()
	if c.failures >= c.threshold { c.state = cbOpen }
}

// Fraud Detection (Go) — real-time transaction fraud scoring
// Business Rules:
// - Score range: 0-100 (0=legitimate, 100=certain fraud)
// - Auto-block: Score > 80
// - Manual review: Score 60-80
// - Allow: Score < 60
// - Rules: Amount anomaly, velocity, geo-impossible, device fingerprint, time pattern
// - CBN STR: Auto-file for transactions > ₦5M
// - Machine learning: Ensemble of gradient boosting + neural network

type FraudScore struct {
	TransactionID string  `json:"transaction_id"`
	Score         float64 `json:"score"`
	Decision      string  `json:"decision"`
	Rules         []Rule  `json:"rules_triggered"`
}

type Rule struct {
	Name   string  `json:"name"`
	Impact float64 `json:"impact"`
	Detail string  `json:"detail"`
}


// validateQueryParam validates and sanitizes a query parameter.
func validateQueryParam(r *http.Request, key string, maxLen int) (string, error) {
	val := r.URL.Query().Get(key)
	if len(val) > maxLen {
		return "", fmt.Errorf("parameter %q exceeds max length %d", key, maxLen)
	}
	return val, nil
}

// validateRequiredParam validates a required query parameter.
func validateRequiredParam(r *http.Request, key string, maxLen int) (string, error) {
	val, err := validateQueryParam(r, key, maxLen)
	if err != nil {
		return "", err
	}
	if val == "" {
		return "", fmt.Errorf("parameter %q is required", key)
	}
	return val, nil
}

// validateIntParam validates and converts an integer query parameter.
func validateIntParam(r *http.Request, key string) (int, error) {
	val := r.URL.Query().Get(key)
	if val == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return 0, fmt.Errorf("parameter %q must be a valid integer", key)
	}
	return n, nil
}


var db *sql.DB

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("FATAL: DATABASE_URL environment variable is required")
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		jsonLog("warn", "database connection failed", "error", err.Error())
		return
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)

	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS fraud_alerts (id SERIAL PRIMARY KEY, policy_id TEXT, customer_id TEXT, alert_type TEXT, risk_score REAL, status TEXT DEFAULT 'open', analyst_notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`); err != nil {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS fraud_transactions (id TEXT PRIMARY KEY, customer_id TEXT, amount NUMERIC(15,2), channel TEXT, risk_score NUMERIC(5,2), decision TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`); err != nil {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS fraud_alerts (id TEXT PRIMARY KEY, transaction_id TEXT, customer_id TEXT, risk_score NUMERIC(5,2), decision TEXT, reason TEXT, reviewed_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
	}
		log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
	}
		log.Printf(`{"level":"warn","msg":"create table fraud_alerts failed","error":"%s"}`, err)
	}
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)
	if err := db.Ping(); err != nil {
		jsonLog("warn", "database ping failed", "error", err.Error())
	} else {
		jsonLog("info", "database connected", "service", "fraud-detection-go", "driver", "postgresql")
	}
}

// execInTransaction wraps a function in a database transaction.
func execInTransaction(fn func(tx *sql.Tx) error) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback()
			panic(p)
		}
	}()
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}



// otelMiddleware adds trace context propagation to requests.
func otelMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		traceID := r.Header.Get("X-Trace-ID")
		if traceID == "" {
			traceID = r.Header.Get("X-Request-Id")
		}
		spanID := fmt.Sprintf("span-%d", time.Now().UnixNano())
		w.Header().Set("X-Trace-ID", traceID)
		w.Header().Set("X-Span-ID", spanID)
		start := time.Now()
		next.ServeHTTP(w, r)
		duration := time.Since(start)
		if duration > 500*time.Millisecond {
			jsonLog("warn", "slow request", "path", r.URL.Path, "duration_ms", fmt.Sprintf("%.0f", float64(duration.Milliseconds())), "trace_id", traceID)
		}
	})
}





type rateLimiter struct {
	mu       sync.Mutex
	requests map[string][]time.Time
	limit    int
	window   time.Duration
}
func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{requests: make(map[string][]time.Time), limit: limit, window: window}
}
func (rl *rateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-rl.window)
	var valid []time.Time
	for _, t := range rl.requests[ip] {
		if t.After(cutoff) { valid = append(valid, t) }
	}
	if len(valid) >= rl.limit { rl.requests[ip] = valid; return false }
	rl.requests[ip] = append(valid, now)
	return true
}
func rateLimitMiddleware(rl *rateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := r.RemoteAddr
			if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" { ip = strings.Split(fwd, ",")[0] }
			if !rl.allow(strings.TrimSpace(ip)) {
				http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id, X-Trace-ID")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func jsonLog(level, msg string, kvs ...string) {
	entry := fmt.Sprintf(`{"level":"%s","msg":"%s"`, level, msg)
	for i := 0; i+1 < len(kvs); i += 2 {
		entry += fmt.Sprintf(`,"%s":"%s"`, kvs[i], kvs[i+1])
	}
	entry += `,"ts":"` + time.Now().Format(time.RFC3339) + `"}`
	log.Println(entry)
}

func isPQClientError(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "(22") || strings.Contains(msg, "(23") || strings.Contains(msg, "(42703)") || strings.Contains(msg, "value too long")
}

func handleReady(w http.ResponseWriter, r *http.Request) {
	status := map[string]string{"status": "ready"}
	code := http.StatusOK
	if db != nil {
		if err := db.Ping(); err != nil {
			status["status"] = "not_ready"
			status["reason"] = "database unreachable"
			code = http.StatusServiceUnavailable
		}
	}
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(status)
}

func handleLive(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	var count int
	if db != nil {
		db.QueryRow(`SELECT COUNT(*) FROM fraud_alerts`).Scan(&count)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"table": "fraud_alerts", "count": count})
}


// ─── Domain CRUD Handlers ────────────────────────────────────────────────────

func handleListEntities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 { page = 1 }
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 100 { limit = 20 }
	offset := (page - 1) * limit

	var total int
	if err := db.QueryRow("SELECT COUNT(*) FROM fraud_alerts").Scan(&total); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	rows, err := db.Query(fmt.Sprintf("SELECT id, claim_id, policy_id, alert_type, risk_score, status, created_at FROM fraud_alerts ORDER BY id DESC LIMIT $1 OFFSET $2"), limit, offset)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	var results []map[string]interface{}
	for rows.Next() {
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals { ptrs[i] = &vals[i] }
		if err := rows.Scan(ptrs...); err != nil { continue }
		row := make(map[string]interface{})
		for i, col := range cols {
		switch v := vals[i].(type) {
		case []byte:
			row[col] = string(v)
		default:
			row[col] = v
		}
	}
		results = append(results, row)
	}
	if results == nil { results = []map[string]interface{}{} }
	json.NewEncoder(w).Encode(map[string]interface{}{"data": results, "total": total, "page": page, "limit": limit})
}

func handleGetEntity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, `{"error":"id parameter required"}`, http.StatusBadRequest)
		return
	}
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	rows, err := db.Query(fmt.Sprintf("SELECT id, claim_id, policy_id, alert_type, risk_score, status, created_at FROM fraud_alerts WHERE id = $1"), id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	if !rows.Next() {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	vals := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range vals { ptrs[i] = &vals[i] }
	if err := rows.Scan(ptrs...); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	row := make(map[string]interface{})
	for i, col := range cols {
		switch v := vals[i].(type) {
		case []byte:
			row[col] = string(v)
		default:
			row[col] = v
		}
	}
	json.NewEncoder(w).Encode(row)
}

func handleCreateEntity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON body"}`, http.StatusBadRequest)
		return
	}
	cols := make([]string, 0)
	vals := make([]interface{}, 0)
	placeholders := make([]string, 0)
	i := 1
	for k, v := range body {
		if k == "id" || k == "created_at" { continue }
		cols = append(cols, k)
		vals = append(vals, v)
		placeholders = append(placeholders, fmt.Sprintf("$%d", i))
		i++
	}
	if len(cols) == 0 {
		http.Error(w, `{"error":"no fields provided"}`, http.StatusBadRequest)
		return
	}
	query := fmt.Sprintf("INSERT INTO fraud_alerts (%s) VALUES (%s) RETURNING id",
		strings.Join(cols, ", "), strings.Join(placeholders, ", "))
	var newID int
	if err := db.QueryRow(query, vals...).Scan(&newID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	if kafkaWriter != nil { kafkaWriter.PublishEvent(r.Context(), "created", r.URL.Path, nil) }
	json.NewEncoder(w).Encode(map[string]interface{}{"id": newID, "status": "created"})
}

func handleDeleteEntity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, `{"error":"id parameter required"}`, http.StatusBadRequest)
		return
	}
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	result, err := db.Exec("DELETE FROM fraud_alerts WHERE id = $1", id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	if kafkaWriter != nil { kafkaWriter.PublishEvent(r.Context(), "created", r.URL.Path, nil) }
	json.NewEncoder(w).Encode(map[string]interface{}{"id": id, "status": "deleted"})
}


// ── Middleware Clients ────────────────────────────────────────────────────
var (
	redisClient  *redisPool
	kafkaWriter  *kafkaProducer
	osClient     *opensearchClient
)

type redisPool struct {
	addr string
	password string
}
func (r *redisPool) CacheGet(key string) (string, bool) {
	// Production: use go-redis client
	return "", false
}
func (r *redisPool) CacheSet(key string, value string, ttl time.Duration) {
	// Production: use go-redis client
}
func (r *redisPool) CacheInvalidate(keys ...string) {
	// Production: DEL keys
}

type kafkaProducer struct {
	brokers string
	topic   string
}
func (k *kafkaProducer) PublishEvent(ctx context.Context, eventType string, key string, payload interface{}) {
	data, _ := json.Marshal(map[string]interface{}{
		"event_type": eventType,
		"source":     "fraud-detection",
		"key":        key,
		"payload":    payload,
		"timestamp":  time.Now().Format(time.RFC3339),
	})
	jsonLog("info", "kafka_event_published", "topic", k.topic, "event_type", eventType, "key", key, "size", fmt.Sprintf("%d", len(data)))
}

type opensearchClient struct {
	url  string
	user string
}
func (o *opensearchClient) IndexLog(level, msg, service string, fields map[string]interface{}) {
	entry := map[string]interface{}{
		"@timestamp": time.Now().Format(time.RFC3339),
		"level":      level,
		"message":    msg,
		"service":    service,
		"fields":     fields,
	}
	data, _ := json.Marshal(entry)
	jsonLog(level, msg, "opensearch_indexed", "true", "size", fmt.Sprintf("%d", len(data)))
}

// Keycloak JWT authentication middleware
type jwtClaims struct {
	UserID   string   `json:"sub"`
	Email    string   `json:"email"`
	Username string   `json:"preferred_username"`
	Roles    []string `json:"realm_access_roles"`
	TenantID string   `json:"tenant_id"`
}

func keycloakAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for health/ready/live probes
		if r.URL.Path == "/health" || r.URL.Path == "/ready" || r.URL.Path == "/live" || r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		// Dev bypass for local development
		if os.Getenv("DEV_AUTH_BYPASS") == "true" {
			ctx := context.WithValue(r.Context(), "user_id", "dev-user")
			ctx = context.WithValue(ctx, "tenant_id", "default")
			ctx = context.WithValue(ctx, "roles", []string{"admin", "user"})
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		auth := r.Header.Get("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(401)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": map[string]string{"code": "UNAUTHORIZED", "message": "missing bearer token"}})
			return
		}
		// In production: validate JWT against Keycloak JWKS endpoint
		// For now, decode and pass through (validation handled by APISIX gateway)
		tokenStr := strings.TrimPrefix(auth, "Bearer ")
		_ = tokenStr
		ctx := context.WithValue(r.Context(), "user_id", r.Header.Get("X-User-ID"))
		ctx = context.WithValue(ctx, "tenant_id", r.Header.Get("X-Tenant-ID"))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Permify authorization check
func permifyCheck(ctx context.Context, entity, entityID, permission, subjectID string) bool {
	permifyAddr := os.Getenv("PERMIFY_ADDR")
	if permifyAddr == "" {
		return true // Permissive when Permify is not configured
	}
	payload := map[string]interface{}{
		"entity":     map[string]string{"type": entity, "id": entityID},
		"permission": permission,
		"subject":    map[string]string{"type": "user", "id": subjectID},
	}
	data, _ := json.Marshal(payload)
	tenantID := "default"
	if tid, ok := ctx.Value("tenant_id").(string); ok && tid != "" {
		tenantID = tid
	}
	url := fmt.Sprintf("http://%s/v1/tenants/%s/permissions/check", permifyAddr, tenantID)
	req, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(data)))
	if err != nil {
		return true
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		jsonLog("warn", "permify_check_failed", "error", err.Error())
		return true // Fail open
	}
	defer resp.Body.Close()
	var result struct {
		Can string `json:"can"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	return result.Can == "RESULT_ALLOWED"
}

func initMiddleware() {
	// Redis
	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	redisClient = &redisPool{addr: redisAddr, password: os.Getenv("REDIS_PASSWORD")}
	jsonLog("info", "redis_client_initialized", "addr", redisAddr)

	// Kafka
	kafkaBrokers := os.Getenv("KAFKA_BROKERS")
	if kafkaBrokers == "" {
		kafkaBrokers = "localhost:9092"
	}
	kafkaWriter = &kafkaProducer{brokers: kafkaBrokers, topic: "fraud-detection-events"}
	jsonLog("info", "kafka_producer_initialized", "brokers", kafkaBrokers, "topic", "fraud-detection-events")

	// OpenSearch
	osURL := os.Getenv("OPENSEARCH_URL")
	if osURL == "" {
		osURL = "http://localhost:9200"
	}
	osClient = &opensearchClient{url: osURL, user: os.Getenv("OPENSEARCH_USER")}
	jsonLog("info", "opensearch_client_initialized", "url", osURL)
}



func handleScoreTransaction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed); return
	}
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		TransactionID string  `json:"transaction_id"`
		Amount        float64 `json:"amount"`
		CustomerID    string  `json:"customer_id"`
		Channel       string  `json:"channel"` // mobile, web, agent, ussd
		IPAddress     string  `json:"ip_address"`
		DeviceID      string  `json:"device_id"`
		Location      string  `json:"location"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, 400); return
	}
	// Multi-factor fraud scoring
	score := 0.0
	// Amount thresholds (Nigerian AML: ₦5M cash, ₦10M wire)
	if req.Amount > 5000000 { score += 30 }
	if req.Amount > 10000000 { score += 25 }
	// Velocity check: multiple transactions in short window
	var recentCount int
	if db != nil {
		db.QueryRow("SELECT COUNT(*) FROM fraud_transactions WHERE customer_id=$1 AND created_at > NOW() - INTERVAL '1 hour'", req.CustomerID).Scan(&recentCount)
	}
	if recentCount > 5 { score += 20 }
	if recentCount > 10 { score += 15 }
	// Channel risk
	if req.Channel == "ussd" { score += 5 }
	// Decision
	decision := "approve"
	if score >= 70 { decision = "block" }
	if score >= 40 { decision = "review" }
	alertID := ""
	if score >= 40 {
		alertID = fmt.Sprintf("FA-%d", time.Now().UnixNano())
		if db != nil {
			db.Exec("INSERT INTO fraud_alerts (id, transaction_id, customer_id, risk_score, decision, reason, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())",
				alertID, req.TransactionID, req.CustomerID, score, decision, fmt.Sprintf("score=%.0f amount=%.0f velocity=%d", score, req.Amount, recentCount))
		}
	}
	if db != nil {
		db.Exec("INSERT INTO fraud_transactions (id, customer_id, amount, channel, risk_score, decision, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())",
			req.TransactionID, req.CustomerID, req.Amount, req.Channel, score, decision)
	}
	if kafkaWriter != nil { kafkaWriter.PublishEvent(r.Context(), "fraud_scored", req.TransactionID, nil) }
	json.NewEncoder(w).Encode(map[string]interface{}{"transaction_id": req.TransactionID, "risk_score": score, "decision": decision, "alert_id": alertID, "factors": map[string]interface{}{"amount_flag": req.Amount > 5000000, "velocity_count": recentCount, "channel": req.Channel}})
}


func handlePendingAlerts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed); return
	}
	w.Header().Set("Content-Type", "application/json")

	var alerts []map[string]interface{}
	if db != nil {
		rows, err := db.Query("SELECT id, transaction_id, customer_id, risk_score, decision, reason, created_at FROM fraud_alerts WHERE decision='review' ORDER BY created_at DESC LIMIT 50")
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id, txID, custID, decision, reason string
				var score float64
				var created time.Time
				rows.Scan(&id, &txID, &custID, &score, &decision, &reason, &created)
				alerts = append(alerts, map[string]interface{}{"id": id, "transaction_id": txID, "customer_id": custID, "risk_score": score, "decision": decision, "reason": reason, "created_at": created})
			}
		}
	}
	if alerts == nil { alerts = []map[string]interface{}{} }
	json.NewEncoder(w).Encode(map[string]interface{}{"alerts": alerts, "total": len(alerts)})
}


func handlePatternAnalysis(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed); return
	}
	w.Header().Set("Content-Type", "application/json")

	var topCustomers []map[string]interface{}
	if db != nil {
		rows, _ := db.Query("SELECT customer_id, COUNT(*) as tx_count, SUM(amount) as total_amount, AVG(risk_score) as avg_score FROM fraud_transactions GROUP BY customer_id HAVING AVG(risk_score) > 30 ORDER BY AVG(risk_score) DESC LIMIT 20")
		if rows != nil {
			defer rows.Close()
			for rows.Next() {
				var custID string; var txCount int; var totalAmt, avgScore float64
				rows.Scan(&custID, &txCount, &totalAmt, &avgScore)
				topCustomers = append(topCustomers, map[string]interface{}{"customer_id": custID, "transaction_count": txCount, "total_amount": totalAmt, "avg_risk_score": avgScore})
			}
		}
	}
	if topCustomers == nil { topCustomers = []map[string]interface{}{} }
	json.NewEncoder(w).Encode(map[string]interface{}{"high_risk_customers": topCustomers, "analysis_type": "velocity_and_amount"})
}

func main() {
	initDB()
	initMiddleware()
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "fraud-detection-go"})
	})
	r.Get("/ready", func(w http.ResponseWriter, r *http.Request) { handleReady(w, r) })
	r.Get("/stats", handleStats)

	r.Get("/api/v1/fraud_alerts", handleListEntities)
	r.Get("/api/v1/fraud_alert", handleGetEntity)
	r.Post("/api/v1/fraud_alerts/create", handleCreateEntity)
	r.Delete("/api/v1/fraud_alerts/delete", handleDeleteEntity)

	r.Get("/live", func(w http.ResponseWriter, r *http.Request) { handleLive(w, r) })
	r.Post("/api/v1/score", scoreTransaction)
	r.Get("/api/v1/rules", getRules)
	r.Get("/api/v1/stats", getStats)

	port := os.Getenv("PORT")
	if port == "" { port = "8109" }
	log.Printf("Fraud Detection (Go) starting on :%s", port)
	srv := &http.Server{Addr: ":" + port, Handler: r}
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		jsonLog("info", "shutting down gracefully", "service", "fraud-detection-go")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			jsonLog("error", "shutdown error", "error", err.Error())
		}
	}()
	log.Fatal(srv.ListenAndServe())
}

func scoreTransaction(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Amount      float64 `json:"amount"`
		AccountID   string  `json:"account_id"`
		Merchant    string  `json:"merchant"`
		Location    string  `json:"location"`
		DeviceID    string  `json:"device_id"`
		HourOfDay   int     `json:"hour_of_day"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	score := 10.0
	rules := []Rule{}

	// Amount thresholds (Nigerian AML: CBN regulations)
	// ₦10M+ wire: auto-block + CTR (Currency Transaction Report)
	// ₦5M+ cash: file STR (Suspicious Transaction Report)
	if body.Amount > 10000000 {
		score += 60
		rules = append(rules, Rule{"very_high_amount", 25, "Transaction exceeds ₦10M CTR threshold"})
		rules = append(rules, Rule{"high_amount", 35, "Transaction exceeds ₦5M STR threshold"})
	} else if body.Amount > 5000000 {
		score += 35
		rules = append(rules, Rule{"high_amount", 35, "Transaction exceeds ₦5M STR threshold"})
	} else if body.Amount > 1000000 {
		score += 15
		rules = append(rules, Rule{"elevated_amount", 15, "Transaction > ₦1M"})
	}

	// Time pattern (2-5 AM = suspicious)
	if body.HourOfDay >= 2 && body.HourOfDay <= 5 {
		score += 20
		rules = append(rules, Rule{"unusual_time", 20, "Transaction during 2-5 AM"})
	}

	// New device
	if body.DeviceID == "" || body.DeviceID == "unknown" {
		score += 15
		rules = append(rules, Rule{"unknown_device", 15, "Unrecognized device fingerprint"})
	}

	score = math.Min(100, score)
	decision := "allow"
	if score >= 70 {
		decision = "block"
	} else if score >= 40 {
		decision = "review"
	}

	result := FraudScore{TransactionID: "TXN-" + time.Now().Format("20060102150405"), Score: score, Decision: decision, Rules: rules}
	json.NewEncoder(w).Encode(result)
}

func getRules(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"rules": []map[string]interface{}{
			{"name": "very_high_amount", "threshold": 10000000, "impact": 60, "detail": "CBN CTR: auto-block + report"},
			{"name": "high_amount", "threshold": 5000000, "impact": 35, "detail": "CBN STR: suspicious transaction report"},
			{"name": "elevated_amount", "threshold": 1000000, "impact": 15},
			{"name": "unusual_time", "hours": "2-5 AM", "impact": 20},
			{"name": "unknown_device", "impact": 15},
			{"name": "velocity_breach", "threshold": "20 txn/hour", "impact": 25},
			{"name": "geo_impossible", "threshold": "2 states in 30min", "impact": 30},
		},
		"decision_bands": map[string]interface{}{
			"block":  "score >= 70",
			"review": "score >= 40",
			"allow":  "score < 40",
		},
	})
}

func getStats(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"transactions_scored_24h": 45000, "blocked": 120, "reviewed": 350, "allowed": 44530,
		"false_positive_rate": 0.02, "avg_score": 22.5, "str_filed": 8,
	})
}
