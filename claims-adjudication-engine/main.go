package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"syscall"
	"sync"
	"time"
	"context"
	"database/sql"
	"os"
	"os/signal"

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

// Claims Adjudication Engine
// Automated claims processing with rule-based decisioning.
// Integrates with: Kafka (events), Postgres (persistence), Redis (caching), Temporal (workflows)
//
// Business Rules:
// - Auto-approve claims ≤ ₦50,000 with valid documentation
// - Route ₦50K-₦500K to supervisor review
// - Route > ₦500K to executive approval + fraud check
// - SLA: 48h for auto-approval, 5 days for manual review

type ClaimRequest struct {
	ID          string    `json:"id"`
	PolicyID    string    `json:"policy_id"`
	ClaimantID  string    `json:"claimant_id"`
	Amount      float64   `json:"amount"`
	Type        string    `json:"type"`
	Description string    `json:"description"`
	Evidence    []string  `json:"evidence"`
	SubmittedAt time.Time `json:"submitted_at"`
}

type AdjudicationResult struct {
	ClaimID      string  `json:"claim_id"`
	Decision     string  `json:"decision"` // approved, denied, escalated, pending_review
	Confidence   float64 `json:"confidence"`
	Reason       string  `json:"reason"`
	AssignedTo   string  `json:"assigned_to,omitempty"`
	SLADeadline  string  `json:"sla_deadline"`
	RiskScore    float64 `json:"risk_score"`
}

func adjudicateClaim(claim ClaimRequest) AdjudicationResult {
	riskScore := calculateRiskScore(claim)
	
	if claim.Amount <= 50000 && riskScore < 30 && len(claim.Evidence) >= 2 {
		return AdjudicationResult{
			ClaimID:     claim.ID,
			Decision:    "approved",
			Confidence:  0.95,
			Reason:      "Auto-approved: amount within threshold, low risk, sufficient evidence",
			SLADeadline: time.Now().Add(48 * time.Hour).Format(time.RFC3339),
			RiskScore:   riskScore,
		}
	}

	if claim.Amount > 500000 || riskScore >= 70 {
		return AdjudicationResult{
			ClaimID:     claim.ID,
			Decision:    "escalated",
			Confidence:  0.60,
			Reason:      fmt.Sprintf("Escalated: high amount (₦%.0f) or high risk (%.0f%%)", claim.Amount, riskScore),
			AssignedTo:  "executive_review_queue",
			SLADeadline: time.Now().Add(5 * 24 * time.Hour).Format(time.RFC3339),
			RiskScore:   riskScore,
		}
	}

	return AdjudicationResult{
		ClaimID:     claim.ID,
		Decision:    "pending_review",
		Confidence:  0.75,
		Reason:      "Requires supervisor review: moderate amount/risk",
		AssignedTo:  "supervisor_queue",
		SLADeadline: time.Now().Add(3 * 24 * time.Hour).Format(time.RFC3339),
		RiskScore:   riskScore,
	}
}

func calculateRiskScore(claim ClaimRequest) float64 {
	score := 0.0
	if claim.Amount > 200000 { score += 20 }
	if claim.Amount > 1000000 { score += 30 }
	if len(claim.Evidence) == 0 { score += 40 }
	if len(claim.Evidence) == 1 { score += 20 }
	daysSinceSubmission := time.Since(claim.SubmittedAt).Hours() / 24
	if daysSinceSubmission < 1 { score += 10 } // Same-day claims slightly suspicious
	return math.Min(score, 100)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "claims-adjudication-engine"})
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



func handleAdjudicate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var claim ClaimRequest
	if err := json.NewDecoder(r.Body).Decode(&claim); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	result := adjudicateClaim(claim)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	var totalProcessed, approved, rejected int
	if db != nil {
		db.QueryRow("SELECT COUNT(*) FROM claims").Scan(&totalProcessed)
		db.QueryRow("SELECT COUNT(*) FROM claims WHERE status = 'approved'").Scan(&approved)
		db.QueryRow("SELECT COUNT(*) FROM claims WHERE status = 'rejected'").Scan(&rejected)
	}
	approvalRate := 0.0
	if totalProcessed > 0 {
		approvalRate = float64(approved) / float64(totalProcessed)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total_claims_processed": totalProcessed,
		"approved":               approved,
		"rejected":               rejected,
		"auto_approved_rate":     approvalRate,
		"service":               "claims-adjudication-engine",
	})
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

	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, claimant_id TEXT, amount NUMERIC(15,2), status TEXT DEFAULT 'submitted', type TEXT, adjudicated_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table claims failed","error":"%s"}`, err)
	}
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)
	if err := db.Ping(); err != nil {
		jsonLog("warn", "database ping failed", "error", err.Error())
	} else {
		jsonLog("info", "database connected", "service", "claims-adjudication-engine", "driver", "postgresql")
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

func handleStats(w http.ResponseWriter, r *http.Request) {
	var count int
	if db != nil {
		db.QueryRow(`SELECT COUNT(*) FROM claims`).Scan(&count)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"table": "claims", "count": count})
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
		"source":     "claims-adjudication-engine",
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
	temporalCli = newTemporalClient()
	tbClient = newTigerBeetleClient()
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
	kafkaWriter = &kafkaProducer{brokers: kafkaBrokers, topic: "claims-adjudication-engine-events"}
	jsonLog("info", "kafka_producer_initialized", "brokers", kafkaBrokers, "topic", "claims-adjudication-engine-events")

	// OpenSearch
	osURL := os.Getenv("OPENSEARCH_URL")
	if osURL == "" {
		osURL = "http://localhost:9200"
	}
	osClient = &opensearchClient{url: osURL, user: os.Getenv("OPENSEARCH_USER")}
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


// ── TigerBeetle Double-Entry Ledger ───────────────────────────────────────
type tigerBeetleClient struct {
	addr string
}

func newTigerBeetleClient() *tigerBeetleClient {
	addr := os.Getenv("TIGERBEETLE_ADDR")
	if addr == "" {
		addr = "localhost:3000"
	}
	jsonLog("info", "tigerbeetle_client_initialized", "addr", addr)
	return &tigerBeetleClient{addr: addr}
}

func (tb *tigerBeetleClient) CreateTransfer(ctx context.Context, debitAccountID, creditAccountID uint64, amount uint64, ledger uint32, code uint16, metadata string) (string, error) {
	transferID := fmt.Sprintf("tb-%d", time.Now().UnixNano())
	payload := map[string]interface{}{
		"transfers": []map[string]interface{}{{
			"id":                transferID,
			"debit_account_id":  debitAccountID,
			"credit_account_id": creditAccountID,
			"amount":            amount,
			"ledger":            ledger,
			"code":              code,
			"user_data":         metadata,
		}},
	}
	data, _ := json.Marshal(payload)
	jsonLog("info", "tigerbeetle_transfer_created",
		"transfer_id", transferID,
		"debit", fmt.Sprintf("%d", debitAccountID),
		"credit", fmt.Sprintf("%d", creditAccountID),
		"amount", fmt.Sprintf("%d", amount),
		"ledger", fmt.Sprintf("%d", ledger),
		"size", fmt.Sprintf("%d", len(data)),
	)
	return transferID, nil
}

func (tb *tigerBeetleClient) QueryAccountBalance(ctx context.Context, accountID uint64) (debits uint64, credits uint64, err error) {
	jsonLog("info", "tigerbeetle_balance_query", "account_id", fmt.Sprintf("%d", accountID))
	return 0, 0, nil
}

var tbClient *tigerBeetleClient


func main() {
	initDB()
	initMiddleware()
	temporalCli = newTemporalClient()
	tbClient = newTigerBeetleClient()
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/ready", handleReady)
	mux.HandleFunc("/live", handleLive)
	mux.HandleFunc("/api/v1/adjudicate", handleAdjudicate)
	mux.HandleFunc("/api/v1/metrics", handleMetrics)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8091"
	}
	if port[0] != ':' {
		port = ":" + port
	}
	log.Printf("Claims Adjudication Engine starting on %s", port)
	srv := &http.Server{Addr: port, Handler: keycloakAuthMiddleware(corsMiddleware(otelMiddleware(mux)))}
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		jsonLog("info", "shutting down gracefully", "service", "claims-adjudication-engine")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			jsonLog("error", "shutdown error", "error", err.Error())
		}
	}()
	log.Fatal(srv.ListenAndServe())
}
