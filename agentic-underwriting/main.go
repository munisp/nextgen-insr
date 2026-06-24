package main

import (
	"net"
	"encoding/binary"
	"io"
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
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
	cacheKey := fmt.Sprintf("%s:list:%s", "agentic-underwriting", r.URL.RawQuery)
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
	err := db.QueryRow("SELECT COUNT(*) FROM underwriting_decisions").Scan(&total)
	if err != nil {
		atomic.AddInt64(&errCount, 1)
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	rows, err := db.Query(fmt.Sprintf("SELECT id, application_id, decision, premium_quoted, risk_score, risk_class, created_at FROM underwriting_decisions ORDER BY id DESC LIMIT $1 OFFSET $2"), limit, offset)
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

	rows, err := db.Query(fmt.Sprintf("SELECT id, application_id, decision, premium_quoted, risk_score, risk_class, created_at FROM underwriting_decisions WHERE id = $1"), id)
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
		osClient.IndexLog("info", "entity_create_attempt", "agentic-underwriting", map[string]interface{}{
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

	query := fmt.Sprintf("INSERT INTO underwriting_decisions (%s) VALUES (%s) RETURNING id",
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
	go daprPublish("agentic-underwriting.entity.created", map[string]interface{}{"service": "agentic-underwriting", "action": "created"})
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

	result, err := db.Exec("DELETE FROM underwriting_decisions WHERE id = $1", id)
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
	db.QueryRow("SELECT COUNT(*) FROM underwriting_decisions").Scan(&count)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"service": "agentic-underwriting",
		"table":   "underwriting_decisions",
		"total_records": count,
		"uptime":  time.Since(startTime).String(),
	})
}

var startTime = time.Now()

// ─── Main ────────────────────────────────────────────────────────────────────


// ── Middleware Clients ────────────────────────────────────────────────────
var (
	redisClient  *redisPool
	kafkaWriter  *kafkaProducer
	osClient     *opensearchClient
)

type redisPool struct {
	addr     string
	password string
	conn     net.Conn
	mu       sync.Mutex
	cbOpen   bool
	cbUntil  time.Time
}
func newRedisPool(addr, password string) *redisPool {
	r := &redisPool{addr: addr, password: password}
	go r.connect()
	return r
}
func (r *redisPool) connect() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.conn != nil { return }
	conn, err := net.DialTimeout("tcp", r.addr, 5*time.Second)
	if err != nil {
		jsonLog("warn", "redis_connect_failed", "error", err.Error(), "addr", r.addr)
		r.cbOpen = true
		r.cbUntil = time.Now().Add(30 * time.Second)
		return
	}
	if r.password != "" {
		fmt.Fprintf(conn, "*2\r\n$4\r\nAUTH\r\n$%d\r\n%s\r\n", len(r.password), r.password)
		buf := make([]byte, 128)
		conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		conn.Read(buf)
	}
	r.conn = conn
	r.cbOpen = false
	jsonLog("info", "redis_connected", "addr", r.addr)
}
func (r *redisPool) respCmd(args ...string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cbOpen && time.Now().Before(r.cbUntil) { return "", fmt.Errorf("circuit open") }
	if r.conn == nil {
		r.mu.Unlock()
		r.connect()
		r.mu.Lock()
		if r.conn == nil { return "", fmt.Errorf("not connected") }
	}
	cmd := fmt.Sprintf("*%d\r\n", len(args))
	for _, a := range args { cmd += fmt.Sprintf("$%d\r\n%s\r\n", len(a), a) }
	r.conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
	_, err := fmt.Fprint(r.conn, cmd)
	if err != nil {
		r.conn.Close(); r.conn = nil; r.cbOpen = true; r.cbUntil = time.Now().Add(30 * time.Second)
		return "", err
	}
	r.conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	buf := make([]byte, 4096)
	n, err := r.conn.Read(buf)
	if err != nil {
		r.conn.Close(); r.conn = nil; r.cbOpen = true; r.cbUntil = time.Now().Add(30 * time.Second)
		return "", err
	}
	return string(buf[:n]), nil
}
func (r *redisPool) CacheGet(key string) (string, bool) {
	resp, err := r.respCmd("GET", key)
	if err != nil || strings.HasPrefix(resp, "$-1") { return "", false }
	parts := strings.SplitN(resp, "\r\n", 3)
	if len(parts) >= 2 { return parts[1], true }
	return "", false
}
func (r *redisPool) CacheSet(key string, value string, ttl time.Duration) {
	if ttl > 0 {
		r.respCmd("SETEX", key, fmt.Sprintf("%d", int(ttl.Seconds())), value)
	} else {
		r.respCmd("SET", key, value)
	}
}
func (r *redisPool) CacheInvalidate(keys ...string) {
	for _, k := range keys { r.respCmd("DEL", k) }
}

type kafkaProducer struct {
	brokers string
	topic   string
	conn    net.Conn
	mu      sync.Mutex
	cbOpen  bool
	cbUntil time.Time
}
func newKafkaProducer(brokers, topic string) *kafkaProducer {
	p := &kafkaProducer{brokers: brokers, topic: topic}
	go p.connect()
	return p
}
func (k *kafkaProducer) connect() {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.conn != nil { return }
	addr := k.brokers
	if idx := strings.Index(addr, ","); idx > 0 { addr = addr[:idx] }
	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		jsonLog("warn", "kafka_connect_failed", "error", err.Error(), "brokers", k.brokers)
		k.cbOpen = true
		k.cbUntil = time.Now().Add(30 * time.Second)
		return
	}
	k.conn = conn
	k.cbOpen = false
	jsonLog("info", "kafka_connected", "brokers", k.brokers, "topic", k.topic)
}
func (k *kafkaProducer) PublishEvent(ctx context.Context, eventType string, key string, payload interface{}) {
	data, _ := json.Marshal(map[string]interface{}{
		"event_type": eventType,
		"source":     k.topic,
		"key":        key,
		"payload":    payload,
		"timestamp":  time.Now().Format(time.RFC3339),
	})
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.cbOpen && time.Now().Before(k.cbUntil) {
		jsonLog("debug", "kafka_circuit_open", "topic", k.topic, "event_type", eventType)
		return
	}
	if k.conn == nil {
		k.mu.Unlock()
		k.connect()
		k.mu.Lock()
	}
	if k.conn != nil {
		msg := append([]byte{0, 0, 0, 0}, data...)
		binary.BigEndian.PutUint32(msg[:4], uint32(len(data)))
		k.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		_, err := k.conn.Write(msg)
		if err != nil {
			jsonLog("warn", "kafka_publish_failed", "error", err.Error(), "topic", k.topic)
			k.conn.Close()
			k.conn = nil
			k.cbOpen = true
			k.cbUntil = time.Now().Add(30 * time.Second)
			return
		}
	}
	jsonLog("info", "kafka_event_published", "topic", k.topic, "event_type", eventType, "key", key, "size", fmt.Sprintf("%d", len(data)))
}

type opensearchClient struct {
	url      string
	user     string
	password string
	client   *http.Client
	cbOpen   bool
	cbUntil  time.Time
	mu       sync.Mutex
}
func newOpenSearchClient(url, user string) *opensearchClient {
	return &opensearchClient{
		url:      url,
		user:     user,
		password: os.Getenv("OPENSEARCH_PASSWORD"),
		client:   &http.Client{Timeout: 5 * time.Second},
	}
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
	o.mu.Lock()
	if o.cbOpen && time.Now().Before(o.cbUntil) {
		o.mu.Unlock()
		return
	}
	o.mu.Unlock()
	idx := fmt.Sprintf("logs-%s-%s", service, time.Now().Format("2006.01.02"))
	reqURL := fmt.Sprintf("%s/%s/_doc", o.url, idx)
	req, err := http.NewRequest("POST", reqURL, bytes.NewReader(data))
	if err != nil { return }
	req.Header.Set("Content-Type", "application/json")
	if o.user != "" { req.SetBasicAuth(o.user, o.password) }
	resp, err := o.client.Do(req)
	if err != nil {
		o.mu.Lock()
		o.cbOpen = true
		o.cbUntil = time.Now().Add(60 * time.Second)
		o.mu.Unlock()
		jsonLog("debug", "opensearch_index_failed", "error", err.Error())
		return
	}
	resp.Body.Close()
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
			jsonLog("warn", "auth_failure", "service", "agentic-underwriting", "remote_addr", r.RemoteAddr, "path", r.URL.Path, "method", r.Method)
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
	temporalCli = newTemporalClient()
	// Redis
	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	redisClient = newRedisPool(redisAddr, os.Getenv("REDIS_PASSWORD"))
	jsonLog("info", "redis_client_initialized", "addr", redisAddr)

	// Kafka
	kafkaBrokers := os.Getenv("KAFKA_BROKERS")
	if kafkaBrokers == "" {
		kafkaBrokers = "localhost:9092"
	}
	kafkaWriter = newKafkaProducer(kafkaBrokers, "agentic-underwriting-events")
	jsonLog("info", "kafka_producer_initialized", "brokers", kafkaBrokers, "topic", "agentic-underwriting-events")

	// OpenSearch
	osURL := os.Getenv("OPENSEARCH_URL")
	if osURL == "" {
		osURL = "http://localhost:9200"
	}
	osClient = newOpenSearchClient(osURL, os.Getenv("OPENSEARCH_USER"))
	jsonLog("info", "opensearch_client_initialized", "url", osURL)
}



// ── Temporal Workflow Integration ──────────────────────────────────────────
type temporalClient struct {
	hostPort string
}

func newTemporalClient() *temporalClient {
	host := os.Getenv("TEMPORAL_HOST")
	if host == "" {
		host = "localhost:7233"
	}
	jsonLog("info", "temporal_client_initialized", "host", host)
	return &temporalClient{hostPort: host}
}

func (tc *temporalClient) StartWorkflow(ctx context.Context, workflowID, workflowType, taskQueue string, input interface{}) (string, error) {
	payload := map[string]interface{}{
		"workflow_id":   workflowID,
		"workflow_type": map[string]string{"name": workflowType},
		"task_queue":    map[string]string{"name": taskQueue},
		"input":         []interface{}{input},
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal workflow input: %w", err)
	}
	url := fmt.Sprintf("http://%s/api/v1/namespaces/default/workflows/%s", tc.hostPort, workflowID)
	req, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(data)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		jsonLog("warn", "temporal_workflow_start_failed", "error", err.Error(), "workflow_id", workflowID)
		return workflowID, nil // Continue without Temporal in dev
	}
	defer resp.Body.Close()
	jsonLog("info", "temporal_workflow_started", "workflow_id", workflowID, "type", workflowType, "queue", taskQueue)
	return workflowID, nil
}

func (tc *temporalClient) SignalWorkflow(ctx context.Context, workflowID, signalName string, payload interface{}) error {
	data, _ := json.Marshal(payload)
	url := fmt.Sprintf("http://%s/api/v1/namespaces/default/workflows/%s/signal/%s", tc.hostPort, workflowID, signalName)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(data)))
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

var temporalCli *temporalClient



func handleQuoteRisk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed); return
	}
	var req struct {
		ApplicantAge   int     `json:"applicant_age"`
		SumAssured     float64 `json:"sum_assured"`
		OccupationCode string  `json:"occupation_code"`
		BMI            float64 `json:"bmi"`
		Smoker         bool    `json:"smoker"`
		MedicalHistory []string `json:"medical_history"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.SumAssured <= 0 || req.ApplicantAge <= 0 {
		http.Error(w, `{"error":"sum_assured and applicant_age required"}`, http.StatusBadRequest); return
	}
	// Risk scoring engine
	riskScore := 100.0
	if req.ApplicantAge > 60 { riskScore += 30 } else if req.ApplicantAge > 45 { riskScore += 15 }
	if req.Smoker { riskScore += 40 }
	if req.BMI > 35 { riskScore += 25 } else if req.BMI > 30 { riskScore += 10 }
	for _, cond := range req.MedicalHistory {
		switch cond {
		case "diabetes": riskScore += 30
		case "hypertension": riskScore += 20
		case "cancer": riskScore += 50
		case "heart_disease": riskScore += 45
		}
	}
	// Decision
	premiumModifier := riskScore / 100.0
	decision := "approved"
	if riskScore > 250 { decision = "declined" } else if riskScore > 180 { decision = "refer_to_medical" } else if riskScore > 140 { decision = "substandard" }
	premium := req.SumAssured * 0.003 * premiumModifier
	if db != nil {
		db.Exec("INSERT INTO underwriting_decisions (applicant_age, sum_assured, risk_score, decision, premium_quoted, created_at) VALUES ($1,$2,$3,$4,$5,NOW())",
			req.ApplicantAge, req.SumAssured, riskScore, decision, premium)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"risk_score": riskScore, "decision": decision, "premium_quoted": premium, "premium_modifier": premiumModifier})
}

func handleAssessPortfolio(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var totalExposure, avgRisk float64
	var count int
	if db != nil {
		db.QueryRow("SELECT COALESCE(SUM(sum_assured),0), COALESCE(AVG(risk_score),0), COUNT(*) FROM underwriting_decisions WHERE decision != 'declined'").Scan(&totalExposure, &avgRisk, &count)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"total_exposure": totalExposure, "avg_risk_score": avgRisk, "active_policies": count, "max_single_risk": totalExposure * 0.1})
}


// Dapr sidecar integration
var daprClient *http.Client
var daprBaseURL string

func initDapr() {
	daprPort := os.Getenv("DAPR_HTTP_PORT")
	if daprPort == "" { daprPort = "3500" }
	daprBaseURL = "http://localhost:" + daprPort
	daprClient = &http.Client{Timeout: 5 * time.Second}
	jsonLog("info", "dapr_sidecar_configured", "port", daprPort)
}

func daprPublish(topic string, data interface{}) {
	if daprClient == nil { return }
	body, _ := json.Marshal(data)
	req, _ := http.NewRequest("POST", daprBaseURL+"/v1.0/publish/insure-pubsub/"+topic, bytes.NewReader(body))
	if req != nil {
		req.Header.Set("Content-Type", "application/json")
		go func() { daprClient.Do(req) }()
	}
}

func daprInvoke(appID, method string, data interface{}) ([]byte, error) {
	if daprClient == nil { return nil, fmt.Errorf("dapr not initialized") }
	body, _ := json.Marshal(data)
	url := fmt.Sprintf("%s/v1.0/invoke/%s/method/%s", daprBaseURL, appID, method)
	req, _ := http.NewRequest("POST", url, bytes.NewReader(body))
	if req == nil { return nil, fmt.Errorf("failed to create request") }
	req.Header.Set("Content-Type", "application/json")
	resp, err := daprClient.Do(req)
	if err != nil { return nil, err }
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
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
		port = "8115"
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
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS underwriting_decisions (id SERIAL PRIMARY KEY, application_id TEXT NOT NULL, decision TEXT NOT NULL, premium_quoted NUMERIC, risk_score NUMERIC, risk_class TEXT, created_at TIMESTAMP DEFAULT NOW())`)
	if err != nil {
		jsonLog("warn", "migration error", "error", err.Error())
	}

	// Create indexes for foreign key columns and common query patterns
	indexSQL := []string{
		"CREATE INDEX IF NOT EXISTS idx_underwriting_decisions_application_id ON underwriting_decisions(application_id)",
	}
	for _, sql := range indexSQL {
		if _, err := db.Exec(sql); err != nil {
			log.Printf("WARNING: index creation: %v", err)
		}
	}

	initMiddleware()
	initDapr()

	rl := newRateLimiter(100, time.Minute)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/dapr/subscribe", func(w http.ResponseWriter, r *http.Request) { json.NewEncoder(w).Encode([]map[string]string{}) })
	mux.HandleFunc("/ready", handleReady)
	mux.HandleFunc("/live", handleLive)
	mux.HandleFunc("/stats", handleStats)
	mux.HandleFunc("/api/v1/assess-portfolio", handleAssessPortfolio)
	mux.HandleFunc("/api/v1/quote-risk", handleQuoteRisk)
	mux.HandleFunc("/metrics", handlePrometheusMetrics)

	// Domain CRUD routes
	mux.HandleFunc("/api/v1/decisions", handleList)
	mux.HandleFunc("/api/v1/decision", handleGetByID)
	mux.HandleFunc("/api/v1/decisions/create", handleCreate)
	mux.HandleFunc("/api/v1/decisions/delete", handleDelete)

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

	log.Printf("Agentic Underwriting starting on :%s", port)
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
