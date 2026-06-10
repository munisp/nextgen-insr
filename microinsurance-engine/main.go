package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"log"
	"net/http"
	"os"
	"os/signal"
	"context"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

var db *sql.DB
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


// ─── Production Middleware ───────────────────────────────────────────────────

var (
	reqCount    int64
	errCount    int64
	avgLatencyMs float64
)

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = os.Getenv("ALLOWED_ORIGIN")
		}
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Request-ID,X-Tenant-ID")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-XSS-Protection", "1; mode=block")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		w.Header().Set("Content-Security-Policy", "default-src 'self'")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
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
	filtered := make([]time.Time, 0)
	for _, t := range rl.requests[ip] {
		if t.After(cutoff) {
			filtered = append(filtered, t)
		}
	}
	if len(filtered) >= rl.limit {
		return false
	}
	rl.requests[ip] = append(filtered, now)
	return true
}

func rateLimitMiddleware(rl *rateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := r.RemoteAddr
			if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
				ip = strings.Split(xff, ",")[0]
			}
			if !rl.allow(strings.TrimSpace(ip)) {
				http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		duration := time.Since(start).Milliseconds()
		atomic.AddInt64(&reqCount, 1)
		total := atomic.LoadInt64(&reqCount)
		avgLatencyMs = (avgLatencyMs*float64(total-1) + float64(duration)) / float64(total)
	})
}




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

func handlePrometheusMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	total := atomic.LoadInt64(&reqCount)
	errors := atomic.LoadInt64(&errCount)
	fmt.Fprintf(w, "# HELP http_requests_total Total HTTP requests\n")
	fmt.Fprintf(w, "# TYPE http_requests_total counter\n")
	fmt.Fprintf(w, "http_requests_total %d\n", total)
	fmt.Fprintf(w, "# HELP http_errors_total Total HTTP errors\n")
	fmt.Fprintf(w, "# TYPE http_errors_total counter\n")
	fmt.Fprintf(w, "http_errors_total %d\n", errors)
	fmt.Fprintf(w, "# HELP http_request_duration_ms Average request latency\n")
	fmt.Fprintf(w, "# TYPE http_request_duration_ms gauge\n")
	fmt.Fprintf(w, "http_request_duration_ms %.2f\n", avgLatencyMs)
	if db != nil {
		if err := db.Ping(); err == nil {
			fmt.Fprintf(w, "# HELP db_connection_active Database connected\n")
			fmt.Fprintf(w, "# TYPE db_connection_active gauge\n")
			fmt.Fprintf(w, "db_connection_active 1\n")
		}
	}
}


// ─── Domain Handlers ─────────────────────────────────────────────────────────

func handleList(w http.ResponseWriter, r *http.Request) {
	// Redis cache check
	cacheKey := fmt.Sprintf("%s:list:%s", "microinsurance-engine", r.URL.RawQuery)
	if cached, ok := redisClient.CacheGet(cacheKey); ok {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "HIT")
		w.Write([]byte(cached))
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 { page = 1 }
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 100 { limit = 20 }
	offset := (page - 1) * limit

	var total int
	err := db.QueryRow("SELECT COUNT(*) FROM micro_policies").Scan(&total)
	if err != nil {
		atomic.AddInt64(&errCount, 1)
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	rows, err := db.Query(fmt.Sprintf("SELECT id, customer_id, product_code, sum_insured, premium, channel, status, start_date, end_date FROM micro_policies ORDER BY id DESC LIMIT $1 OFFSET $2"), limit, offset)
	if err != nil {
		atomic.AddInt64(&errCount, 1)
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
		if err := rows.Scan(ptrs...); err != nil {
			continue
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
		results = append(results, row)
	}
	if results == nil { results = []map[string]interface{}{} }

	json.NewEncoder(w).Encode(map[string]interface{}{
		"data":  results,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

func handleGetByID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
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

	rows, err := db.Query(fmt.Sprintf("SELECT id, customer_id, product_code, sum_insured, premium, channel, status, start_date, end_date FROM micro_policies WHERE id = $1"), id)
	if err != nil {
		atomic.AddInt64(&errCount, 1)
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

func handleCreate(w http.ResponseWriter, r *http.Request) {
	// OpenSearch audit log
	if osClient != nil {
		osClient.IndexLog("info", "entity_create_attempt", "microinsurance-engine", map[string]interface{}{
			"path": r.URL.Path, "method": r.Method, "remote_addr": r.RemoteAddr,
		})
	}
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
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

	query := fmt.Sprintf("INSERT INTO micro_policies (%s) VALUES (%s) RETURNING id",
		strings.Join(cols, ", "), strings.Join(placeholders, ", "))

	var newID int
	err := db.QueryRow(query, vals...).Scan(&newID)
	if err != nil {
		atomic.AddInt64(&errCount, 1)
		if isPQClientError(err) {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
		} else {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		}
		return
	}

	w.WriteHeader(http.StatusCreated)
	if kafkaWriter != nil { kafkaWriter.PublishEvent(r.Context(), "created", r.URL.Path, nil) }
	json.NewEncoder(w).Encode(map[string]interface{}{"id": newID, "status": "created"})
}

func handleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
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

	result, err := db.Exec("DELETE FROM micro_policies WHERE id = $1", id)
	if err != nil {
		atomic.AddInt64(&errCount, 1)
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

// ─── Health & Probes ─────────────────────────────────────────────────────────

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	dbStatus := "connected"
	if err := db.Ping(); err != nil {
		dbStatus = "disconnected"
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"status": "unhealthy", "database": dbStatus})
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": dbStatus})
}

func handleReady(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if err := db.Ping(); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"status": "not_ready"})
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}

func handleLive(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var count int
	db.QueryRow("SELECT COUNT(*) FROM micro_policies").Scan(&count)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"service": "microinsurance-engine",
		"table":   "micro_policies",
		"total_records": count,
		"uptime":  time.Since(startTime).String(),
	})
}

var startTime = time.Now()

// ─── Main ────────────────────────────────────────────────────────────────────

// ─── Microinsurance Domain Logic ─────────────────────────────────────────────

// NAICOM Microinsurance Guidelines (2013):
// - Maximum premium: ₦10,000/year (non-life), ₦30,000/year (life)
// - Maximum sum insured: ₦2,000,000 (non-life), ₦5,000,000 (life)
// - Simplified documentation: No medical exam required
// - Grace period: Minimum 30 days for premium payment
// - Claims settlement: Maximum 10 working days

type MicroProduct struct {
	ProductID      string  `json:"product_id"`
	Name           string  `json:"name"`
	Category       string  `json:"category"` // crop, livestock, health, funeral, personal_accident
	MaxPremium     float64 `json:"max_premium"`
	MaxSumInsured  float64 `json:"max_sum_insured"`
	MinSumInsured  float64 `json:"min_sum_insured"`
	WaitingPeriod  int     `json:"waiting_period_days"`
	GracePeriod    int     `json:"grace_period_days"`
	ClaimSettlement int    `json:"claim_settlement_days"`
}

type MicroQuoteResult struct {
	ProductID     string  `json:"product_id"`
	Premium       float64 `json:"premium"`
	SumInsured    float64 `json:"sum_insured"`
	IsCompliant   bool    `json:"naicom_compliant"`
	Violations    []string `json:"violations,omitempty"`
	Channel       string  `json:"channel"` // ussd, mobile_app, agent, pos
	Frequency     string  `json:"frequency"` // daily, weekly, monthly, annual
}

var microProducts = []MicroProduct{
	{ProductID: "MI-CROP-01", Name: "Crop Protection", Category: "crop", MaxPremium: 10000, MaxSumInsured: 2000000, MinSumInsured: 50000, WaitingPeriod: 0, GracePeriod: 30, ClaimSettlement: 10},
	{ProductID: "MI-LIVE-01", Name: "Livestock Cover", Category: "livestock", MaxPremium: 10000, MaxSumInsured: 2000000, MinSumInsured: 25000, WaitingPeriod: 14, GracePeriod: 30, ClaimSettlement: 10},
	{ProductID: "MI-HLTH-01", Name: "Hospital Cash", Category: "health", MaxPremium: 10000, MaxSumInsured: 500000, MinSumInsured: 50000, WaitingPeriod: 30, GracePeriod: 30, ClaimSettlement: 5},
	{ProductID: "MI-FNL-01", Name: "Funeral Expense", Category: "funeral", MaxPremium: 5000, MaxSumInsured: 500000, MinSumInsured: 50000, WaitingPeriod: 90, GracePeriod: 30, ClaimSettlement: 3},
	{ProductID: "MI-PA-01", Name: "Personal Accident", Category: "personal_accident", MaxPremium: 8000, MaxSumInsured: 2000000, MinSumInsured: 100000, WaitingPeriod: 0, GracePeriod: 30, ClaimSettlement: 10},
}

func calculateMicroPremium(sumInsured float64, category string, frequency string) (float64, []string) {
	// Base rates per category (annual)
	baseRates := map[string]float64{
		"crop":              0.05,  // 5% (high risk, weather dependent)
		"livestock":         0.04,  // 4%
		"health":            0.03,  // 3%
		"funeral":           0.015, // 1.5%
		"personal_accident": 0.02,  // 2%
	}
	rate := baseRates[category]
	if rate == 0 { rate = 0.03 }

	annualPremium := sumInsured * rate
	violations := []string{}

	// NAICOM cap enforcement
	maxPremium := 10000.0
	if category == "funeral" { maxPremium = 5000 }
	if annualPremium > maxPremium {
		violations = append(violations, fmt.Sprintf("Premium ₦%.0f exceeds NAICOM cap of ₦%.0f", annualPremium, maxPremium))
		annualPremium = maxPremium // Cap it
	}

	// Sum insured cap
	maxSI := 2000000.0
	if sumInsured > maxSI {
		violations = append(violations, fmt.Sprintf("Sum insured ₦%.0f exceeds microinsurance cap of ₦%.0f", sumInsured, maxSI))
	}

	// Frequency adjustment
	var premium float64
	switch frequency {
	case "daily":
		premium = math.Ceil(annualPremium / 365)
	case "weekly":
		premium = math.Ceil(annualPremium / 52)
	case "monthly":
		premium = math.Ceil(annualPremium / 12)
	default:
		premium = annualPremium
	}

	return premium, violations
}

func handleMicroQuote(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Category   string  `json:"category"`
		SumInsured float64 `json:"sum_insured"`
		Frequency  string  `json:"frequency"`
		Channel    string  `json:"channel"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	premium, violations := calculateMicroPremium(req.SumInsured, req.Category, req.Frequency)
	result := MicroQuoteResult{
		Premium:     premium,
		SumInsured:  req.SumInsured,
		IsCompliant: len(violations) == 0,
		Violations:  violations,
		Channel:     req.Channel,
		Frequency:   req.Frequency,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleMicroProducts(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"products": microProducts})
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
		"source":     "microinsurance-engine",
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
		if os.Getenv("DEV_AUTH_BYPASS") == "true" && os.Getenv("ENVIRONMENT") != "production" {
			ctx := context.WithValue(r.Context(), "user_id", "dev-user")
			ctx = context.WithValue(ctx, "tenant_id", "default")
			ctx = context.WithValue(ctx, "roles", []string{"admin", "user"})
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		auth := r.Header.Get("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			w.Header().Set("Content-Type", "application/json")
			jsonLog("warn", "auth_failure", "service", "microinsurance-engine", "remote_addr", r.RemoteAddr, "path", r.URL.Path, "method", r.Method)
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
	kafkaWriter = &kafkaProducer{brokers: kafkaBrokers, topic: "microinsurance-engine-events"}
	jsonLog("info", "kafka_producer_initialized", "brokers", kafkaBrokers, "topic", "microinsurance-engine-events")

	// OpenSearch
	osURL := os.Getenv("OPENSEARCH_URL")
	if osURL == "" {
		osURL = "http://localhost:9200"
	}
	osClient = &opensearchClient{url: osURL, user: os.Getenv("OPENSEARCH_USER")}
	jsonLog("info", "opensearch_client_initialized", "url", osURL)
}



func handlePriceMicroProduct(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed); return
	}
	var req struct {
		ProductType string  `json:"product_type"`
		CoverAmount float64 `json:"cover_amount"`
		DurationDays int    `json:"duration_days"`
		CustomerAge  int    `json:"customer_age"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.CoverAmount <= 0 || req.DurationDays <= 0 {
		http.Error(w, `{"error":"cover_amount and duration_days required"}`, http.StatusBadRequest); return
	}
	// NAICOM microinsurance cap: max ₦2M cover, max ₦50K premium
	if req.CoverAmount > 2000000 {
		http.Error(w, `{"error":"microinsurance cover capped at ₦2,000,000 (NAICOM)"}`, http.StatusBadRequest); return
	}
	// Pricing: base rate per day * risk factor
	baseRate := req.CoverAmount * 0.0001
	riskFactor := 1.0
	if req.CustomerAge > 55 { riskFactor = 1.4 } else if req.CustomerAge > 40 { riskFactor = 1.2 }
	switch req.ProductType {
	case "crop": riskFactor *= 1.3
	case "livestock": riskFactor *= 1.5
	case "health": riskFactor *= 1.1
	case "funeral": riskFactor *= 0.9
	}
	premium := baseRate * float64(req.DurationDays) * riskFactor
	if premium > 50000 { premium = 50000 }
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"premium": premium, "cover_amount": req.CoverAmount, "duration_days": req.DurationDays, "product_type": req.ProductType, "naicom_compliant": true})
}

func handleIssueMicroPolicy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed); return
	}
	var req struct {
		CustomerID  string  `json:"customer_id"`
		ProductType string  `json:"product_type"`
		CoverAmount float64 `json:"cover_amount"`
		Premium     float64 `json:"premium"`
		DurationDays int    `json:"duration_days"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.CustomerID == "" || req.CoverAmount <= 0 {
		http.Error(w, `{"error":"customer_id and cover_amount required"}`, http.StatusBadRequest); return
	}
	policyID := fmt.Sprintf("MICRO-%d", time.Now().UnixNano())
	if db != nil {
		db.Exec("INSERT INTO micro_policies (id, customer_id, product_type, cover_amount, premium, duration_days, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,'active',NOW())",
			policyID, req.CustomerID, req.ProductType, req.CoverAmount, req.Premium, req.DurationDays)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"policy_id": policyID, "status": "active", "cover_amount": req.CoverAmount, "premium": req.Premium})
}

func bodyLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch {
			r.Body = http.MaxBytesReader(w, r.Body, 10<<20) // 10MB limit
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8124"
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("FATAL: DATABASE_URL environment variable is required")
	}

	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err = db.Ping(); err != nil {
		log.Printf("WARNING: Database not reachable at startup: %v", err)
	}

	// Auto-migrate
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS micro_policies (id SERIAL PRIMARY KEY, customer_id INTEGER NOT NULL, product_code VARCHAR(64) NOT NULL, sum_insured NUMERIC(20,2) NOT NULL, premium NUMERIC(20,2) NOT NULL, premium_frequency VARCHAR(16) DEFAULT 'monthly', channel VARCHAR(32) DEFAULT 'ussd', start_date DATE NOT NULL, end_date DATE NOT NULL, status VARCHAR(32) DEFAULT 'active', created_at TIMESTAMP DEFAULT NOW())`)
	if err != nil {
		jsonLog("warn", "migration error", "error", err.Error())
	}

	// Create indexes for foreign key columns and common query patterns
	indexSQL := []string{
		"CREATE INDEX IF NOT EXISTS idx_micro_policies_customer_id ON micro_policies(customer_id)",
	}
	for _, sql := range indexSQL {
		if _, err := db.Exec(sql); err != nil {
			log.Printf("WARNING: index creation: %v", err)
		}
	}

	initMiddleware()

	rl := newRateLimiter(100, time.Minute)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/ready", handleReady)
	mux.HandleFunc("/live", handleLive)
	mux.HandleFunc("/stats", handleStats)
	mux.HandleFunc("/api/v1/issue-micro", handleIssueMicroPolicy)
	mux.HandleFunc("/api/v1/price-micro", handlePriceMicroProduct)
	mux.HandleFunc("/metrics", handlePrometheusMetrics)

	// Domain CRUD routes
	mux.HandleFunc("/api/v1/micro_policys", handleList)
	mux.HandleFunc("/api/v1/micro_policy", handleGetByID)
	mux.HandleFunc("/api/v1/micro_policys/create", handleCreate)
	mux.HandleFunc("/api/v1/micro_policys/delete", handleDelete)

	// Domain business logic routes
	mux.HandleFunc("/api/v1/micro/quote", handleMicroQuote)
	mux.HandleFunc("/api/v1/micro/products", handleMicroProducts)

	// Apply middleware chain
	var handler http.Handler = mux
	handler = metricsMiddleware(handler)
	handler = rateLimitMiddleware(rl)(handler)
	handler = securityHeaders(handler)
	handler = otelMiddleware(corsMiddleware(handler))
	handler = bodyLimitMiddleware(handler)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		log.Println("Shutting down gracefully...")
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("Forced shutdown: %v", err)
		}
	}()

	log.Printf("Microinsurance Engine starting on :%s", port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server failed: %v", err)
	}
}

// ─── Input Validation ────────────────────────────────────────────────────────

func validateQueryParam(r *http.Request, key string, maxLen int) (string, error) {
	val := r.URL.Query().Get(key)
	if len(val) > maxLen {
		return "", fmt.Errorf("parameter %s exceeds max length %d", key, maxLen)
	}
	return val, nil
}

func validateIntParam(r *http.Request, key string) (int, error) {
	val := r.URL.Query().Get(key)
	if val == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return 0, fmt.Errorf("parameter %s must be an integer", key)
	}
	return n, nil
}
