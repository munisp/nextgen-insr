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
	"math/rand"
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

// Digital Twin Risk Modeler
// Monte Carlo simulation engine for portfolio risk modeling.
// Models scenarios: pandemic, natural disaster, economic downturn.

var db *sql.DB

type SimulationRequest struct {
	Scenario       string  `json:"scenario"` // pandemic, flood, recession, earthquake
	PortfolioValue float64 `json:"portfolio_value"`
	PolicyCount    int     `json:"policy_count"`
	Iterations     int     `json:"iterations"`
	TimeHorizon    int     `json:"time_horizon_months"`
}

type SimulationResult struct {
	Scenario        string  `json:"scenario"`
	Iterations      int     `json:"iterations"`
	MeanLoss        float64 `json:"mean_loss"`
	MedianLoss      float64 `json:"median_loss"`
	P95Loss         float64 `json:"p95_loss"`
	P99Loss         float64 `json:"p99_loss"`
	MaxLoss         float64 `json:"max_loss"`
	LossRatio       float64 `json:"loss_ratio"`
	CapitalRequired float64 `json:"capital_required"`
	RuinProbability float64 `json:"ruin_probability"`
	ExecutionMs     int64   `json:"execution_ms"`
}

func runMonteCarlo(req SimulationRequest) SimulationResult {
	start := time.Now()
	if req.Iterations == 0 {
		req.Iterations = 10000
	}
	if req.TimeHorizon == 0 {
		req.TimeHorizon = 12
	}

	// Scenario-specific parameters
	var baseLossRate, volatility, catastropheFactor float64
	switch req.Scenario {
	case "pandemic":
		baseLossRate = 0.08
		volatility = 0.15
		catastropheFactor = 2.5
	case "flood":
		baseLossRate = 0.12
		volatility = 0.25
		catastropheFactor = 3.0
	case "recession":
		baseLossRate = 0.06
		volatility = 0.10
		catastropheFactor = 1.5
	case "earthquake":
		baseLossRate = 0.15
		volatility = 0.35
		catastropheFactor = 4.0
	default:
		baseLossRate = 0.05
		volatility = 0.08
		catastropheFactor = 1.0
	}

	losses := make([]float64, req.Iterations)
	ruinCount := 0
	reserves := req.PortfolioValue * 0.15

	for i := 0; i < req.Iterations; i++ {
		totalLoss := 0.0
		for m := 0; m < req.TimeHorizon; m++ {
			monthlyRate := baseLossRate + volatility*rand.NormFloat64()
			if rand.Float64() < 0.02 {
				monthlyRate *= catastropheFactor
			}
			if monthlyRate < 0 {
				monthlyRate = 0
			}
			monthLoss := req.PortfolioValue * monthlyRate / 12
			totalLoss += monthLoss
		}
		losses[i] = totalLoss
		if totalLoss > reserves {
			ruinCount++
		}
	}

	// Sort for percentiles
	sortFloat64s(losses)

	p95Idx := int(float64(req.Iterations) * 0.95)
	p99Idx := int(float64(req.Iterations) * 0.99)

	mean := 0.0
	for _, l := range losses {
		mean += l
	}
	mean /= float64(req.Iterations)

	return SimulationResult{
		Scenario: req.Scenario, Iterations: req.Iterations,
		MeanLoss:        math.Round(mean*100) / 100,
		MedianLoss:      math.Round(losses[req.Iterations/2]*100) / 100,
		P95Loss:         math.Round(losses[p95Idx]*100) / 100,
		P99Loss:         math.Round(losses[p99Idx]*100) / 100,
		MaxLoss:         math.Round(losses[req.Iterations-1]*100) / 100,
		LossRatio:       math.Round(mean/req.PortfolioValue*10000) / 10000,
		CapitalRequired: math.Round(losses[p99Idx]*1.1*100) / 100,
		RuinProbability: float64(ruinCount) / float64(req.Iterations),
		ExecutionMs:     time.Since(start).Milliseconds(),
	}
}

func sortFloat64s(a []float64) {
	for i := 1; i < len(a); i++ {
		key := a[i]
		j := i - 1
		for j >= 0 && a[j] > key {
			a[j+1] = a[j]
			j--
		}
		a[j+1] = key
	}
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
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS risk_simulations (
		id SERIAL PRIMARY KEY, scenario TEXT, iterations INT, mean_loss REAL, p95_loss REAL,
		p99_loss REAL, capital_required REAL, ruin_prob REAL, execution_ms BIGINT, created_at TIMESTAMPTZ DEFAULT NOW()
	)`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
	}
	log.Printf(`{"level":"info","msg":"database connected","service":"digital-twin-risk-modeler"}`)
}

func handleSimulate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var req SimulationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err), http.StatusBadRequest)
		return
	}
	result := runMonteCarlo(req)
	if db != nil {
		if _, err := db.Exec(`INSERT INTO risk_simulations (scenario, iterations, mean_loss, p95_loss, p99_loss, capital_required, ruin_prob, execution_ms)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, result.Scenario, result.Iterations, result.MeanLoss, result.P95Loss, result.P99Loss, result.CapitalRequired, result.RuinProbability, result.ExecutionMs); err != nil {
			log.Printf(`{"level":"warn","msg":"insert failed","error":"%s"}`, err)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
	if kafkaWriter != nil {
		kafkaWriter.PublishEvent(r.Context(), "handleSimulate", "digital-twin-risk-modeler", nil)
	}
}

func handleStressTest(w http.ResponseWriter, r *http.Request) {
	scenarios := []string{"pandemic", "flood", "recession", "earthquake"}
	results := make([]SimulationResult, len(scenarios))
	for i, s := range scenarios {
		results[i] = runMonteCarlo(SimulationRequest{
			Scenario: s, PortfolioValue: 10000000000, PolicyCount: 50000, Iterations: 5000, TimeHorizon: 12,
		})
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
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "digital-twin-risk-modeler", "database": dbStatus})
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

// ─── Digital Twin Risk Modeling Logic ────────────────────────────────────────

type AssetRiskModel struct {
	AssetID         string   `json:"asset_id"`
	AssetType       string   `json:"asset_type"`
	CurrentValue    float64  `json:"current_value"`
	RiskScore       float64  `json:"risk_score"`
	FailureProb     float64  `json:"failure_probability"`
	ExpectedLoss    float64  `json:"expected_loss"`
	OptimalCover    float64  `json:"optimal_coverage"`
	Recommendations []string `json:"recommendations"`
}

func modelAssetRisk(assetType string, age int, value float64, maintenanceScore float64, environmentRisk float64) AssetRiskModel {
	// Failure probability based on bathtub curve (reliability engineering)
	failureProb := 0.01 // base 1%
	if age < 2 {
		failureProb = 0.03
	} // infant mortality
	if age > 10 {
		failureProb += float64(age-10) * 0.005
	} // wear-out

	// Adjust for maintenance quality (0-100)
	if maintenanceScore < 50 {
		failureProb *= 2.0
	}
	if maintenanceScore < 25 {
		failureProb *= 1.5
	}

	// Environment risk multiplier
	failureProb *= (1 + environmentRisk/100)
	failureProb = math.Min(failureProb, 0.95)

	// Expected loss = value * failure probability * severity factor
	severityFactor := map[string]float64{
		"building": 0.40, "vehicle": 0.60, "machinery": 0.70,
		"electronics": 0.80, "inventory": 0.50,
	}
	severity := severityFactor[assetType]
	if severity == 0 {
		severity = 0.50
	}
	expectedLoss := value * failureProb * severity

	// Optimal coverage (expected loss * safety margin)
	optimalCover := expectedLoss * 3.0 // 3x expected loss

	riskScore := failureProb * 100
	recs := []string{}
	if riskScore > 50 {
		recs = append(recs, "Immediate maintenance required")
	}
	if riskScore > 30 {
		recs = append(recs, "Increase coverage")
	}
	if age > 15 {
		recs = append(recs, "Consider asset replacement")
	}

	return AssetRiskModel{
		AssetType: assetType, CurrentValue: value,
		RiskScore:       math.Round(riskScore*100) / 100,
		FailureProb:     math.Round(failureProb*10000) / 10000,
		ExpectedLoss:    math.Round(expectedLoss*100) / 100,
		OptimalCover:    math.Round(optimalCover*100) / 100,
		Recommendations: recs,
	}
}

func handleModelRisk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		AssetID          string  `json:"asset_id"`
		AssetType        string  `json:"asset_type"`
		Age              int     `json:"age_years"`
		Value            float64 `json:"value"`
		MaintenanceScore float64 `json:"maintenance_score"`
		EnvironmentRisk  float64 `json:"environment_risk"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}
	result := modelAssetRisk(req.AssetType, req.Age, req.Value, req.MaintenanceScore, req.EnvironmentRisk)
	result.AssetID = req.AssetID
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

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
			jsonLog("warn", "auth_failure", "service", "digital-twin-risk-modeler", "remote_addr", r.RemoteAddr, "path", r.URL.Path, "method", r.Method)
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
	kafkaWriter = newKafkaProducer(kafkaBrokers, "digital-twin-risk-modeler-events")
	jsonLog("info", "kafka_producer_initialized", "brokers", kafkaBrokers, "topic", "digital-twin-risk-modeler-events")

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
	mux.HandleFunc("/api/v1/simulate", handleSimulate)
	mux.HandleFunc("/api/v1/stress-test", handleStressTest)
	port := ":8125"
	log.Printf(`{"level":"info","msg":"Digital Twin Risk Modeler starting","port":"%s"}`, port)
	srv := &http.Server{Addr: port, Handler: bodyLimitMiddleware(keycloakAuthMiddleware(corsMiddleware(mux)))}
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		jsonLog("info", "shutting down gracefully", "service", "digital-twin-risk-modeler")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			jsonLog("error", "shutdown error", "error", err.Error())
		}
	}()
	log.Fatal(srv.ListenAndServe())
}
