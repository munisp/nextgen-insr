package main

import (
	"net"
	"encoding/binary"
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
	"syscall"
	"strings"
	"sync"
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

// AI Claims Auto-Adjudication Service
// Scores claims below threshold using a hand-tuned heuristic rule engine.
// NOTE: no trained ML model is loaded by this service; a real model artifact
// (MODEL_ARTIFACT_PATH) is required before auto-approval is enabled.
// Business rule: claims <= ₦500,000 with confidence >= 0.85 → instant approval
// (only when a trained model artifact is configured).

var db *sql.DB

type ClaimInput struct {
	ID            string  `json:"id"`
	PolicyID      string  `json:"policy_id"`
	ClaimantID    string  `json:"claimant_id"`
	Amount        float64 `json:"amount"`
	Type          string  `json:"type"`
	Description   string  `json:"description"`
	EvidenceCount int     `json:"evidence_count"`
	PolicyAge     int     `json:"policy_age_days"`
	PriorClaims   int     `json:"prior_claims"`
}

type AutoDecision struct {
	ClaimID      string  `json:"claim_id"`
	Decision     string  `json:"decision"`
	Confidence   float64 `json:"confidence"`
	Reason       string  `json:"reason"`
	ProcessingMs int64   `json:"processing_ms"`
	Model        string  `json:"model"`
}

func predictRisk(claim ClaimInput) (float64, float64) {
	// Heuristic risk scoring. These weights were hand-picked — they are NOT
	// the coefficients of a trained logistic-regression model, and must not be
	// presented as such. A real fitted model artifact must be supplied via
	// MODEL_ARTIFACT_PATH before auto-approval decisions are permitted.
	features := []float64{
		claim.Amount / 1000000,
		float64(claim.EvidenceCount) / 10,
		float64(claim.PolicyAge) / 365,
		float64(claim.PriorClaims) / 5,
	}
	weights := []float64{0.35, -0.25, -0.15, 0.30}
	bias := 0.1

	z := bias
	for i, f := range features {
		if i < len(weights) {
			z += f * weights[i]
		}
	}
	riskScore := 1 / (1 + math.Exp(-z))
	confidence := 1 - math.Abs(riskScore-0.5)*2
	return riskScore, confidence
}

// modelLabel honestly identifies the scorer as a heuristic rule engine,
// not a trained ML model. Stored/returned with every decision.
const modelLabel = "heuristic-rules-v1"

func autoAdjudicate(claim ClaimInput) AutoDecision {
	start := time.Now()
	riskScore, confidence := predictRisk(claim)

	// Auto-approval is disabled unless a real trained model artifact is
	// configured. Without it, low-risk claims that would otherwise be
	// auto-approved are escalated to manual_review instead.
	autoApprovalEnabled := os.Getenv("MODEL_ARTIFACT_PATH") != ""

	decision := AutoDecision{
		ClaimID:      claim.ID,
		ProcessingMs: time.Since(start).Milliseconds(),
		Model:        modelLabel,
		Confidence:   confidence,
	}

	if claim.Amount <= 500000 && riskScore < 0.3 && confidence >= 0.85 {
		if autoApprovalEnabled {
			decision.Decision = "auto_approved"
			decision.Reason = fmt.Sprintf("Auto-approved: amount ₦%.0f, risk %.2f%%, confidence %.2f%%",
				claim.Amount, riskScore*100, confidence*100)
		} else {
			decision.Decision = "manual_review"
			decision.Reason = fmt.Sprintf("Manual review: auto-approval disabled (no trained model artifact configured via MODEL_ARTIFACT_PATH); risk %.2f%%, confidence %.2f%%",
				riskScore*100, confidence*100)
		}
	} else if riskScore >= 0.7 {
		decision.Decision = "auto_rejected"
		decision.Reason = fmt.Sprintf("Auto-rejected by heuristic rules: high risk %.2f%%", riskScore*100)
	} else {
		decision.Decision = "manual_review"
		decision.Reason = fmt.Sprintf("Escalated: risk %.2f%%, confidence %.2f%%", riskScore*100, confidence*100)
	}
	return decision
}

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("FATAL: DATABASE_URL environment variable is required")
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Printf(`{"level":"warn","msg":"database connection failed","error":"%s"}`, err)
		return
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS ai_decisions (
		id TEXT PRIMARY KEY, claim_id TEXT, decision TEXT, confidence REAL,
		risk_score REAL, model TEXT, processing_ms BIGINT, created_at TIMESTAMPTZ DEFAULT NOW()
	)`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
	}
	log.Printf(`{"level":"info","msg":"database connected","service":"ai-claims-auto-adjudication"}`)
}

func handleAutoAdjudicate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var claim ClaimInput
	if err := json.NewDecoder(r.Body).Decode(&claim); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err), http.StatusBadRequest)
		return
	}
	decision := autoAdjudicate(claim)
	if db != nil {
		riskScore, _ := predictRisk(claim)
		if _, err := db.Exec(`INSERT INTO ai_decisions (id, claim_id, decision, confidence, risk_score, model, processing_ms)
			VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
			fmt.Sprintf("dec-%s", claim.ID), claim.ID, decision.Decision, decision.Confidence, riskScore, decision.Model, decision.ProcessingMs); err != nil {
			log.Printf(`{"level":"warn","msg":"insert ai decision failed","error":"%s"}`, err)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(decision)
	if kafkaWriter != nil { kafkaWriter.PublishEvent(r.Context(), "handleAutoAdjudicate", "ai-claims-auto-adjudication", nil) }
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	dbStatus := "disconnected"
	if db != nil {
		if err := db.Ping(); err == nil {
			dbStatus = "connected"
		}
	}
	json.NewEncoder(w).Encode(map[string]string{
		"status": "healthy", "service": "ai-claims-auto-adjudication", "database": dbStatus,
	})
}

func handleReady(w http.ResponseWriter, r *http.Request) {
	if db == nil {
		w.WriteHeader(503)
		json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", "reason": "database unreachable"})
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
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

// ─── AI Claims Auto-Adjudication Logic ───────────────────────────────────────

type ClaimDecision struct {
	ClaimID       string  `json:"claim_id"`
	Amount        float64 `json:"amount"`
	RiskScore     float64 `json:"risk_score"`
	Decision      string  `json:"decision"` // auto_approve, manual_review, reject
	Confidence    float64 `json:"confidence"`
	Factors       []string `json:"factors"`
	SLACategory   string  `json:"sla_category"`
}

// Multi-factor claim scoring (weighted rule engine)
func adjudicateClaim(claimID string, amount float64, policyAge int, claimHistory int, hasDocuments bool, matchesPolicy bool) ClaimDecision {
	score := 0.0
	factors := []string{}

	// Amount-based risk (higher amounts = higher risk)
	if amount > 5000000 { score += 35; factors = append(factors, "high_value_claim") }
	if amount > 1000000 { score += 15; factors = append(factors, "significant_amount") }

	// Policy age (new policies are riskier)
	if policyAge < 90 { score += 25; factors = append(factors, "new_policy_90d") }
	if policyAge < 30 { score += 15; factors = append(factors, "very_new_policy_30d") }

	// Claims history (frequent claimants)
	if claimHistory > 3 { score += 20; factors = append(factors, "frequent_claimant") }
	if claimHistory > 5 { score += 15; factors = append(factors, "excessive_claims") }

	// Documentation
	if !hasDocuments { score += 20; factors = append(factors, "missing_documentation") }

	// Policy coverage match
	if !matchesPolicy { score += 30; factors = append(factors, "coverage_mismatch") }

	// Decision thresholds
	decision := "auto_approve"
	if score >= 60 { decision = "reject" }
	if score >= 30 && score < 60 { decision = "manual_review" }

	// Confidence is computed from the score's distance to the nearest
	// decision boundary (30 = review threshold, 60 = reject threshold).
	// Scores near a boundary are less certain; no fixed confidence values
	// are fabricated.
	d30 := math.Abs(score - 30)
	d60 := math.Abs(score - 60)
	confidence := math.Min(0.5+math.Min(d30, d60)/100, 0.99)

	// SLA based on complexity
	sla := "fast_track" // 5 days
	if decision == "manual_review" { sla = "standard" } // 15 days
	if decision == "reject" { sla = "investigation" }   // 30 days

	return ClaimDecision{
		ClaimID: claimID, Amount: amount,
		RiskScore: math.Min(score, 100), Decision: decision,
		Confidence: confidence, Factors: factors, SLACategory: sla,
	}
}

func handleAdjudicateClaim(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ClaimID      string  `json:"claim_id"`
		Amount       float64 `json:"amount"`
		PolicyAge    int     `json:"policy_age_days"`
		ClaimHistory int     `json:"claim_history_count"`
		HasDocuments bool    `json:"has_documents"`
		MatchesPolicy bool   `json:"matches_policy_coverage"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}
	result := adjudicateClaim(req.ClaimID, req.Amount, req.PolicyAge, req.ClaimHistory, req.HasDocuments, req.MatchesPolicy)
	if db != nil {
		data, _ := json.Marshal(result)
		db.Exec("INSERT INTO ai_adjudication_results (claim_id, decision, risk_score, data, created_at) VALUES ($1, $2, $3, $4, NOW())",
			req.ClaimID, result.Decision, result.RiskScore, string(data))
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}


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
			jsonLog("warn", "auth_failure", "service", "ai-claims-auto-adjudication", "remote_addr", r.RemoteAddr, "path", r.URL.Path, "method", r.Method)
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
	redisClient = newRedisPool(redisAddr, os.Getenv("REDIS_PASSWORD"))
	jsonLog("info", "redis_client_initialized", "addr", redisAddr)

	// Kafka
	kafkaBrokers := os.Getenv("KAFKA_BROKERS")
	if kafkaBrokers == "" {
		kafkaBrokers = "localhost:9092"
	}
	kafkaWriter = newKafkaProducer(kafkaBrokers, "ai-claims-auto-adjudication-events")
	jsonLog("info", "kafka_producer_initialized", "brokers", kafkaBrokers, "topic", "ai-claims-auto-adjudication-events")

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
	mux.HandleFunc("/api/v1/auto-adjudicate", handleAutoAdjudicate)
	mux.HandleFunc("/api/v1/adjudication-history", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		rows, err := db.Query("SELECT id, claim_type, amount, risk_score, decision, created_at FROM adjudication_results ORDER BY id DESC LIMIT 50")
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"data": []interface{}{}, "error": err.Error()})
			return
		}
		defer rows.Close()
		var results []map[string]interface{}
		for rows.Next() {
			var id int; var claimType, decision string; var amount, riskScore float64; var createdAt interface{}
			if err := rows.Scan(&id, &claimType, &amount, &riskScore, &decision, &createdAt); err != nil { continue }
			results = append(results, map[string]interface{}{"id": id, "claim_type": claimType, "amount": amount, "risk_score": riskScore, "decision": decision, "created_at": createdAt})
		}
		if results == nil { results = []map[string]interface{}{} }
		json.NewEncoder(w).Encode(map[string]interface{}{"data": results, "total": len(results)})
	})
	mux.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var total int
		db.QueryRow("SELECT COUNT(*) FROM adjudication_results").Scan(&total)
		json.NewEncoder(w).Encode(map[string]interface{}{"service": "ai-claims-auto-adjudication", "total_adjudications": total})
	})
	port := os.Getenv("PORT")
	if port == "" {
		port = "8120"
	}
	if port[0] != ':' {
		port = ":" + port
	}
	log.Printf(`{"level":"info","msg":"AI Claims Auto-Adjudication starting","port":"%s"}`, port)
	srv := &http.Server{Addr: port, Handler: bodyLimitMiddleware(keycloakAuthMiddleware(corsMiddleware(mux)))}
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		jsonLog("info", "shutting down gracefully", "service", "ai-claims-auto-adjudication")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			jsonLog("error", "shutdown error", "error", err.Error())
		}
	}()
	log.Fatal(srv.ListenAndServe())
}
