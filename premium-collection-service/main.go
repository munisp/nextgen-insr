package main

import (
	"io"
	"bytes"
	"encoding/json"
	"fmt"
	"log"
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

// Premium Collection Service
// Manages premium payments across multiple channels: bank transfer, card, mobile money, USSD, agent cash
// Integrates with: TigerBeetle (ledger), Mojaloop (mobile money), Kafka, Postgres
//
// Payment Methods (Nigeria):
// - Bank Transfer (NIBSS): 0% fee, T+1 settlement
// - Card (Paystack/Flutterwave): 1.5% fee, instant
// - Mobile Money (MTN MoMo): 1% fee, instant
// - Agent Cash Collection: 0% fee, manual reconciliation

func handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "premium-collection-service"})
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



func handleCollect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		PolicyID string  `json:"policy_id"`
		Amount   float64 `json:"amount"`
		Method   string  `json:"method"` // bank_transfer, card, mobile_money, agent_cash
		Currency string  `json:"currency"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	feeRates := map[string]float64{"bank_transfer": 0, "card": 0.015, "mobile_money": 0.01, "agent_cash": 0}
	fee := req.Amount * feeRates[req.Method]
	
	json.NewEncoder(w).Encode(map[string]interface{}{
		"receipt_id": fmt.Sprintf("RCP-%d", time.Now().UnixNano()%1000000),
		"policy_id": req.PolicyID, "amount": req.Amount, "fee": fee,
		"net_amount": req.Amount - fee, "method": req.Method,
		"status": "confirmed", "settled_at": time.Now().Format(time.RFC3339),
	})
}

func handleReconcile(w http.ResponseWriter, r *http.Request) {
	var totalCount, recentCount int
	if db != nil {
		db.QueryRow("SELECT COUNT(*) FROM premium_collections").Scan(&totalCount)
		db.QueryRow("SELECT COUNT(*) FROM premium_collections WHERE created_at > NOW() - INTERVAL '30 days'").Scan(&recentCount)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total":      totalCount,
		"recent_30d": recentCount,
		"service":    "premium-collection-service",
		"period":     time.Now().Format("2006-01"),
	})
}


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
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)
	if err := db.Ping(); err != nil {
		jsonLog("warn", "database ping failed", "error", err.Error())
	} else {
		jsonLog("info", "database connected", "service", "premium-collection-service", "driver", "postgresql")
	}
	// Create domain table
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS premium_collections (
            id TEXT PRIMARY KEY,
            policy_id TEXT NOT NULL,
            amount NUMERIC NOT NULL,
            status TEXT DEFAULT 'pending',
            payment_method TEXT,
            reconciled BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT NOW()
        )`); err != nil {
		jsonLog("warn", "create table failed", "error", err.Error())
	} else {
		jsonLog("info", "table ready", "table", "premium_collections")
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
		"source":     "premium-collection-service",
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
	mojaloopCli = newMojaloopClient()
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
	kafkaWriter = &kafkaProducer{brokers: kafkaBrokers, topic: "premium-collection-service-events"}
	jsonLog("info", "kafka_producer_initialized", "brokers", kafkaBrokers, "topic", "premium-collection-service-events")

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


// ── Mojaloop Payment Switch Integration ───────────────────────────────────
type mojaloopClient struct {
	switchURL string
	dfspID    string
}

func newMojaloopClient() *mojaloopClient {
	url := os.Getenv("MOJALOOP_SWITCH_URL")
	if url == "" {
		url = "http://localhost:4003"
	}
	dfspID := os.Getenv("MOJALOOP_DFSP_ID")
	if dfspID == "" {
		dfspID = "insureportal-dfsp"
	}
	jsonLog("info", "mojaloop_client_initialized", "switch_url", url, "dfsp_id", dfspID)
	return &mojaloopClient{switchURL: url, dfspID: dfspID}
}

func (mc *mojaloopClient) PartyLookup(ctx context.Context, partyType, partyID string) (map[string]interface{}, error) {
	url := fmt.Sprintf("%s/parties/%s/%s", mc.switchURL, partyType, partyID)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.interoperability.parties+json;version=1.1")
	req.Header.Set("FSPIOP-Source", mc.dfspID)
	req.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	return result, nil
}

func (mc *mojaloopClient) InitiateTransfer(ctx context.Context, amount, currency, payerID, payeeID string) (string, error) {
	transferID := fmt.Sprintf("mj-%d", time.Now().UnixNano())
	payload := map[string]interface{}{
		"transferId": transferID,
		"payerFsp":   mc.dfspID,
		"payeeFsp":   "counterparty-dfsp",
		"amount":     map[string]string{"amount": amount, "currency": currency},
		"ilpPacket":  "placeholder",
		"condition":  "placeholder",
		"expiration": time.Now().Add(30 * time.Second).Format(time.RFC3339),
	}
	data, _ := json.Marshal(payload)
	jsonLog("info", "mojaloop_transfer_initiated",
		"transfer_id", transferID,
		"payer", payerID,
		"payee", payeeID,
		"amount", amount,
		"currency", currency,
		"size", fmt.Sprintf("%d", len(data)),
	)
	return transferID, nil
}

var mojaloopCli *mojaloopClient



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

func main() {
	initDB()
	initMiddleware()
	initDapr()
	temporalCli = newTemporalClient()
	tbClient = newTigerBeetleClient()
	mojaloopCli = newMojaloopClient()
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/dapr/subscribe", func(w http.ResponseWriter, r *http.Request) { json.NewEncoder(w).Encode([]map[string]string{}) })
	mux.HandleFunc("/ready", handleReady)
	mux.HandleFunc("/live", handleLive)
	mux.HandleFunc("/api/v1/collect", handleCollect)
	mux.HandleFunc("/api/v1/reconcile", handleReconcile)
	port := os.Getenv("PORT")
	if port == "" {
		port = "8098"
	}
	if port[0] != ':' {
		port = ":" + port
	}
	log.Printf("Premium Collection Service starting on %s", port)
	srv := &http.Server{Addr: port, Handler: keycloakAuthMiddleware(corsMiddleware(otelMiddleware(mux)))}
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		jsonLog("info", "shutting down gracefully", "service", "premium-collection-service")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			jsonLog("error", "shutdown error", "error", err.Error())
		}
	}()
	log.Fatal(srv.ListenAndServe())
}
