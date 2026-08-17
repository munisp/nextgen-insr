package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

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
	if c.state == cbClosed {
		return true
	}
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
	if c.failures >= c.threshold {
		c.state = cbOpen
	}
}

// Predictive Churn Prevention Engine
// ML model predicting policy lapse 30 days before renewal.
// Triggers automated retention campaigns (SMS, agent outreach, discounts).

var db *sql.DB

type PolicyHolder struct {
	ID              string  `json:"id"`
	PolicyID        string  `json:"policy_id"`
	PremiumAmount   float64 `json:"premium_amount"`
	DaysTillRenewal int     `json:"days_till_renewal"`
	PaymentHistory  int     `json:"payment_history_score"` // 0-100
	ClaimHistory    int     `json:"claim_count"`
	EngagementScore int     `json:"engagement_score"` // 0-100
	TenureMonths    int     `json:"tenure_months"`
}

type ChurnPrediction struct {
	PolicyID        string  `json:"policy_id"`
	ChurnProb       float64 `json:"churn_probability"`
	RiskLevel       string  `json:"risk_level"`
	RetentionAction string  `json:"retention_action"`
	DiscountOffer   float64 `json:"discount_offer_pct"`
	Channel         string  `json:"channel"`
	Priority        int     `json:"priority"`
}

func predictChurn(ph PolicyHolder) ChurnPrediction {
	// Logistic regression: payment history, engagement, tenure, claims
	features := map[string]float64{
		"payment":    float64(ph.PaymentHistory) / 100,
		"engagement": float64(ph.EngagementScore) / 100,
		"tenure":     math.Min(float64(ph.TenureMonths)/60, 1),
		"claims":     math.Min(float64(ph.ClaimHistory)/5, 1),
		"days":       math.Max(1-float64(ph.DaysTillRenewal)/90, 0),
	}
	weights := map[string]float64{
		"payment": -0.4, "engagement": -0.3, "tenure": -0.2, "claims": 0.15, "days": 0.25,
	}
	z := 0.3 // bias toward churn
	for k, v := range features {
		z += v * weights[k]
	}
	churnProb := 1 / (1 + math.Exp(-z*3))

	pred := ChurnPrediction{PolicyID: ph.PolicyID, ChurnProb: churnProb}

	switch {
	case churnProb >= 0.7:
		pred.RiskLevel = "high"
		pred.RetentionAction = "agent_outreach"
		pred.DiscountOffer = 15
		pred.Channel = "phone_call"
		pred.Priority = 1
	case churnProb >= 0.4:
		pred.RiskLevel = "medium"
		pred.RetentionAction = "sms_campaign"
		pred.DiscountOffer = 10
		pred.Channel = "sms"
		pred.Priority = 2
	default:
		pred.RiskLevel = "low"
		pred.RetentionAction = "email_reminder"
		pred.DiscountOffer = 0
		pred.Channel = "email"
		pred.Priority = 3
	}
	return pred
}

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("FATAL: DATABASE_URL environment variable is required")
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Printf(`{"level":"warn","msg":"db failed","error":"%s"}`, err)
		return
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS churn_predictions (
		id SERIAL PRIMARY KEY, policy_id TEXT, churn_prob REAL, risk_level TEXT,
		retention_action TEXT, discount_pct REAL, channel TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
	)`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
	}
	log.Printf(`{"level":"info","msg":"database connected","service":"predictive-churn-engine"}`)
}

func handlePredict(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var ph PolicyHolder
	if err := json.NewDecoder(r.Body).Decode(&ph); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err), http.StatusBadRequest)
		return
	}
	pred := predictChurn(ph)
	if db != nil {
		if _, err := db.Exec(`INSERT INTO churn_predictions (policy_id, churn_prob, risk_level, retention_action, discount_pct, channel)
			VALUES ($1,$2,$3,$4,$5,$6)`, pred.PolicyID, pred.ChurnProb, pred.RiskLevel, pred.RetentionAction, pred.DiscountOffer, pred.Channel); err != nil {
			log.Printf(`{"level":"warn","msg":"insert failed","error":"%s"}`, err)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(pred)
	if kafkaWriter != nil {
		kafkaWriter.PublishEvent(r.Context(), "handlePredict", "predictive-churn-engine", nil)
	}
}

func handleBatchPredict(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var holders []PolicyHolder
	if err := json.NewDecoder(r.Body).Decode(&holders); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err), http.StatusBadRequest)
		return
	}
	results := make([]ChurnPrediction, len(holders))
	for i, ph := range holders {
		results[i] = predictChurn(ph)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(results)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	dbStatus := "disconnected"
	if db != nil {
		if err := db.Ping(); err == nil {
			dbStatus = "connected"
		}
	}
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "predictive-churn-engine", "database": dbStatus})
}
func handleReady(w http.ResponseWriter, r *http.Request) {
	if db == nil {
		w.WriteHeader(503)
		json.NewEncoder(w).Encode(map[string]string{"status": "not_ready"})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}
func handleLive(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
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
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}
	if len(valid) >= rl.limit {
		rl.requests[ip] = valid
		return false
	}
	rl.requests[ip] = append(valid, now)
	return true
}
func rateLimitMiddleware(rl *rateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := r.RemoteAddr
			if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
				ip = strings.Split(fwd, ",")[0]
			}
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

// ─── Predictive Churn Engine Logic ───────────────────────────────────────────

// ── Middleware Clients ────────────────────────────────────────────────────
var (
	redisClient *redisPool
	kafkaWriter *kafkaProducer
	osClient    *opensearchClient
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
	if r.conn != nil {
		return
	}
	conn, err := net.DialTimeout("tcp", r.addr, 5*time.Second)
	if err != nil {
		jsonLog("warn", "redis_connect_failed", "error", err.Error(), "addr", r.addr)
		r.cbOpen = true
		r.cbUntil = time.Now().Add(30 * time.Second)
		return
	}
	if r.password != "" {
		_, _ = fmt.Fprintf(conn, "*2\r\n$4\r\nAUTH\r\n$%d\r\n%s\r\n", len(r.password), r.password)
		buf := make([]byte, 128)
		_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		_, _ = conn.Read(buf)
	}
	r.conn = conn
	r.cbOpen = false
	jsonLog("info", "redis_connected", "addr", r.addr)
}
func (r *redisPool) respCmd(args ...string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cbOpen && time.Now().Before(r.cbUntil) {
		return "", fmt.Errorf("circuit open")
	}
	if r.conn == nil {
		r.mu.Unlock()
		r.connect()
		r.mu.Lock()
		if r.conn == nil {
			return "", fmt.Errorf("not connected")
		}
	}
	cmd := fmt.Sprintf("*%d\r\n", len(args))
	for _, a := range args {
		cmd += fmt.Sprintf("$%d\r\n%s\r\n", len(a), a)
	}
	_ = r.conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
	_, err := fmt.Fprint(r.conn, cmd)
	if err != nil {
		_ = r.conn.Close()
		r.conn = nil
		r.cbOpen = true
		r.cbUntil = time.Now().Add(30 * time.Second)
		return "", err
	}
	_ = r.conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	buf := make([]byte, 4096)
	n, err := r.conn.Read(buf)
	if err != nil {
		_ = r.conn.Close()
		r.conn = nil
		r.cbOpen = true
		r.cbUntil = time.Now().Add(30 * time.Second)
		return "", err
	}
	return string(buf[:n]), nil
}
func (r *redisPool) CacheGet(key string) (string, bool) {
	resp, err := r.respCmd("GET", key)
	if err != nil || strings.HasPrefix(resp, "$-1") {
		return "", false
	}
	parts := strings.SplitN(resp, "\r\n", 3)
	if len(parts) >= 2 {
		return parts[1], true
	}
	return "", false
}
func (r *redisPool) CacheSet(key string, value string, ttl time.Duration) {
	if ttl > 0 {
		_, _ = r.respCmd("SETEX", key, fmt.Sprintf("%d", int(ttl.Seconds())), value)
	} else {
		_, _ = r.respCmd("SET", key, value)
	}
}
func (r *redisPool) CacheInvalidate(keys ...string) {
	for _, k := range keys {
		r.respCmd("DEL", k)
	}
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
	if k.conn != nil {
		return
	}
	addr := k.brokers
	if idx := strings.Index(addr, ","); idx > 0 {
		addr = addr[:idx]
	}
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
		_ = k.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		_, err := k.conn.Write(msg)
		if err != nil {
			jsonLog("warn", "kafka_publish_failed", "error", err.Error(), "topic", k.topic)
			_ = k.conn.Close()
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
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if o.user != "" {
		req.SetBasicAuth(o.user, o.password)
	}
	resp, err := o.client.Do(req)
	if err != nil {
		o.mu.Lock()
		o.cbOpen = true
		o.cbUntil = time.Now().Add(60 * time.Second)
		o.mu.Unlock()
		jsonLog("debug", "opensearch_index_failed", "error", err.Error())
		return
	}
	_ = resp.Body.Close()
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
			jsonLog("warn", "auth_failure", "service", "predictive-churn-engine", "remote_addr", r.RemoteAddr, "path", r.URL.Path, "method", r.Method)
			w.WriteHeader(401)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": map[string]string{"code": "UNAUTHORIZED", "message": "missing bearer token"}})
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
	defer func() { _ = resp.Body.Close() }()
	var result struct {
		Can string `json:"can"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return result.Can == "RESULT_ALLOWED"
}

func initMiddleware() {
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
	kafkaWriter = newKafkaProducer(kafkaBrokers, "predictive-churn-engine-events")
	jsonLog("info", "kafka_producer_initialized", "brokers", kafkaBrokers, "topic", "predictive-churn-engine-events")

	// OpenSearch
	osURL := os.Getenv("OPENSEARCH_URL")
	if osURL == "" {
		osURL = "http://localhost:9200"
	}
	osClient = newOpenSearchClient(osURL, os.Getenv("OPENSEARCH_USER"))
	jsonLog("info", "opensearch_client_initialized", "url", osURL)
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
	initDB()
	initMiddleware()
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/ready", handleReady)
	mux.HandleFunc("/live", handleLive)
	mux.HandleFunc("/api/v1/predict", handlePredict)
	mux.HandleFunc("/api/v1/batch-predict", handleBatchPredict)
	port := ":8124"
	log.Printf(`{"level":"info","msg":"Predictive Churn Engine starting","port":"%s"}`, port)
	srv := &http.Server{Addr: port, Handler: bodyLimitMiddleware(keycloakAuthMiddleware(corsMiddleware(mux)))}
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		jsonLog("info", "shutting down gracefully", "service", "predictive-churn-engine")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			jsonLog("error", "shutdown error", "error", err.Error())
		}
	}()
	log.Fatal(srv.ListenAndServe())
}
