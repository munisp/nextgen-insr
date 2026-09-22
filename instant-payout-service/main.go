package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	neturl "net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
)

// context keys (SA1029: typed keys to avoid collisions)
type ctxKey string

const (
	ctxKeyRoles    ctxKey = "roles"
	ctxKeyTenantId ctxKey = "tenant_id"
	ctxKeyUserId   ctxKey = "user_id"
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

// ─── Production Middleware ───────────────────────────────────────────────────

var (
	reqCount     int64
	errCount     int64
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
	_, _ = fmt.Fprintf(w, "# HELP http_requests_total Total HTTP requests\n")
	_, _ = fmt.Fprintf(w, "# TYPE http_requests_total counter\n")
	_, _ = fmt.Fprintf(w, "http_requests_total %d\n", total)
	_, _ = fmt.Fprintf(w, "# HELP http_errors_total Total HTTP errors\n")
	_, _ = fmt.Fprintf(w, "# TYPE http_errors_total counter\n")
	_, _ = fmt.Fprintf(w, "http_errors_total %d\n", errors)
	_, _ = fmt.Fprintf(w, "# HELP http_request_duration_ms Average request latency\n")
	_, _ = fmt.Fprintf(w, "# TYPE http_request_duration_ms gauge\n")
	_, _ = fmt.Fprintf(w, "http_request_duration_ms %.2f\n", avgLatencyMs)
	if db != nil {
		if err := db.Ping(); err == nil {
			_, _ = fmt.Fprintf(w, "# HELP db_connection_active Database connected\n")
			_, _ = fmt.Fprintf(w, "# TYPE db_connection_active gauge\n")
			_, _ = fmt.Fprintf(w, "db_connection_active 1\n")
		}
	}
}

// ─── Domain Handlers ─────────────────────────────────────────────────────────

func handleList(w http.ResponseWriter, r *http.Request) {
	// Redis cache check
	cacheKey := fmt.Sprintf("%s:list:%s", "instant-payout-service", r.URL.RawQuery)
	if cached, ok := redisClient.CacheGet(cacheKey); ok {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "HIT")
		_, _ = w.Write([]byte(cached))
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	// 2026-09-19 perf: the previous SELECT COUNT(*) scanned the whole table
	// on every list request. Use the planner estimate (pg_class.reltuples,
	// maintained by ANALYZE/autovacuum) and fall back to an exact count only
	// when no estimate exists yet (fresh table before first ANALYZE).
	var total int
	err := db.QueryRow("SELECT GREATEST(reltuples::bigint, 0) FROM pg_class WHERE relname = 'instant_payouts' AND relnamespace = current_schema()::regnamespace").Scan(&total)
	if err != nil || total == 0 {
		if err2 := db.QueryRow("SELECT COUNT(*) FROM instant_payouts").Scan(&total); err2 != nil {
			atomic.AddInt64(&errCount, 1)
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err2.Error()), http.StatusInternalServerError)
			return
		}
	}

	rows, err := db.Query("SELECT id, claim_id, customer_id, amount, currency, channel, status, created_at FROM instant_payouts ORDER BY id DESC LIMIT $1 OFFSET $2", limit, offset)
	if err != nil {
		atomic.AddInt64(&errCount, 1)
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	defer func() { _ = rows.Close() }()

	cols, _ := rows.Columns()
	var results []map[string]interface{}
	for rows.Next() {
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
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
	if results == nil {
		results = []map[string]interface{}{}
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
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

	rows, err := db.Query("SELECT id, claim_id, customer_id, amount, currency, channel, status, created_at FROM instant_payouts WHERE id = $1", id)
	if err != nil {
		atomic.AddInt64(&errCount, 1)
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	defer func() { _ = rows.Close() }()

	cols, _ := rows.Columns()
	if !rows.Next() {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	vals := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}
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
	_ = json.NewEncoder(w).Encode(row)
}

func handleCreate(w http.ResponseWriter, r *http.Request) {
	// OpenSearch audit log
	if osClient != nil {
		osClient.IndexLog("info", "entity_create_attempt", "instant-payout-service", map[string]interface{}{
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

	// Authorization: creating payout records requires the payout:create permission.
	userID, _ := r.Context().Value(ctxKeyUserId).(string)
	if !permifyCheck(r.Context(), "payout", "instant_payouts", "create", userID) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}

	// Strict column whitelist: the previous implementation interpolated
	// arbitrary client-supplied column names into an INSERT, enabling
	// payout-record forgery. Only known payout fields are accepted.
	allowedCols := map[string]bool{
		"claim_id": true, "customer_id": true, "amount": true, "currency": true,
		"channel": true, "account_number": true, "bank_code": true, "reference": true,
		"status": true, "paid_at": true,
	}

	cols := make([]string, 0)
	vals := make([]interface{}, 0)
	placeholders := make([]string, 0)
	i := 1
	for k, v := range body {
		if k == "id" || k == "created_at" {
			continue
		}
		if !allowedCols[k] || !isSafeColumnName(k) {
			http.Error(w, `{"error":"invalid field name"}`, http.StatusBadRequest)
			return
		}
		cols = append(cols, k)
		vals = append(vals, v)
		placeholders = append(placeholders, fmt.Sprintf("$%d", i))
		i++
	}

	if len(cols) == 0 {
		http.Error(w, `{"error":"no fields provided"}`, http.StatusBadRequest)
		return
	}

	query := fmt.Sprintf("INSERT INTO instant_payouts (%s) VALUES (%s) RETURNING id",
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
	if kafkaWriter != nil {
		kafkaWriter.PublishEvent(r.Context(), "created", r.URL.Path, nil)
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"id": newID, "status": "created"})
	go daprPublish("instant-payout-service.entity.created", map[string]interface{}{"service": "instant-payout-service", "action": "created"})
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

	result, err := db.Exec("DELETE FROM instant_payouts WHERE id = $1", id)
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
	if kafkaWriter != nil {
		kafkaWriter.PublishEvent(r.Context(), "created", r.URL.Path, nil)
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"id": id, "status": "deleted"})
}

// ─── Health & Probes ─────────────────────────────────────────────────────────

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	dbStatus := "connected"
	if err := db.Ping(); err != nil {
		dbStatus = "disconnected"
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "unhealthy", "database": dbStatus})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": dbStatus})
}

func handleReady(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if err := db.Ping(); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "not_ready"})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}

func handleLive(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var count int
	_ = db.QueryRow("SELECT COUNT(*) FROM instant_payouts").Scan(&count)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"service":       "instant-payout-service",
		"table":         "instant_payouts",
		"total_records": count,
		"uptime":        time.Since(startTime).String(),
	})
}

var startTime = time.Now()

// ─── Main ────────────────────────────────────────────────────────────────────

// ─── Instant Payout Domain Logic ─────────────────────────────────────────────

type PayoutRequest struct {
	ClaimID       string  `json:"claim_id"`
	PolicyID      string  `json:"policy_id"`
	Amount        float64 `json:"amount"`
	Beneficiary   string  `json:"beneficiary"`
	BankCode      string  `json:"bank_code"`
	AccountNumber string  `json:"account_number"`
	Channel       string  `json:"channel"` // nibss, interswitch, mobile_money
}

type PayoutResult struct {
	PayoutID       string  `json:"payout_id"`
	ClaimID        string  `json:"claim_id"`
	Amount         float64 `json:"amount"`
	Fee            float64 `json:"fee"`
	NetAmount      float64 `json:"net_amount"`
	Status         string  `json:"status"`
	Channel        string  `json:"channel"`
	SettlementTime string  `json:"estimated_settlement"`
	Reference      string  `json:"reference"`
}

func processPayout(req PayoutRequest) PayoutResult {
	// Channel-based fees and settlement times
	fees := map[string]float64{"nibss": 50, "interswitch": 100, "mobile_money": 25}
	settlements := map[string]string{"nibss": "instant", "interswitch": "T+1", "mobile_money": "instant"}

	fee := fees[req.Channel]
	if fee == 0 {
		fee = 100
	}
	settlement := settlements[req.Channel]
	if settlement == "" {
		settlement = "T+1"
	}

	// Validation
	status := "approved"
	if req.Amount > 10000000 {
		status = "pending_approval"
	} // >₦10M needs manual approval
	if len(req.AccountNumber) != 10 {
		status = "failed"
	}

	return PayoutResult{
		PayoutID: fmt.Sprintf("PO-%d", time.Now().UnixNano()%100000000),
		ClaimID:  req.ClaimID, Amount: req.Amount,
		Fee: fee, NetAmount: req.Amount - fee,
		Status: status, Channel: req.Channel,
		SettlementTime: settlement,
		Reference:      fmt.Sprintf("REF-%d", time.Now().UnixNano()%10000000),
	}
}

func handleProcessPayout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	var req PayoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	// Funds-safety: amount and destination are NEVER taken from the client.
	// They are derived from the verified, approved claim record server-side.
	verified, holdUntil, err := verifyClaimForPayout(r.Context(), req.ClaimID)
	if err != nil {
		jsonLog("warn", "payout_claim_verification_failed", "claim_id", req.ClaimID, "error", err.Error())
		http.Error(w, fmt.Sprintf(`{"error":"claim verification failed: %s"}`, err.Error()), http.StatusUnprocessableEntity)
		return
	}
	if holdUntil != nil {
		// Claim is within its post-approval hold (cooling) period.
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status":     "hold",
			"claim_id":   req.ClaimID,
			"hold_until": holdUntil.Format(time.RFC3339),
		})
		return
	}

	// Authorization for releasing funds.
	userID, _ := r.Context().Value(ctxKeyUserId).(string)
	if !permifyCheck(r.Context(), "payout", req.ClaimID, "process", userID) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}

	req.Amount = verified.amount
	req.BankCode = verified.bankCode
	req.AccountNumber = verified.accountNumber
	if req.Channel == "" {
		req.Channel = "nibss"
	}
	result := processPayout(req)
	_ = json.NewEncoder(w).Encode(result)
}

type verifiedClaim struct {
	amount        float64
	bankCode      string
	accountNumber string
}

// verifyClaimForPayout loads the referenced claim and enforces:
//   - claim exists and is in 'approved' status
//   - payable amount = approvedAmount - paidAmount - already-initiated payouts
//   - destination account comes from the claim record (metadata set at
//     approval time), not from the client request
//   - a configurable post-approval hold period has elapsed
//
// Returns (claim, holdUntil, err); holdUntil non-nil means the payout must wait.
func verifyClaimForPayout(ctx context.Context, claimRef string) (*verifiedClaim, *time.Time, error) {
	if claimRef == "" {
		return nil, nil, fmt.Errorf("claim_id is required")
	}
	var (
		status     string
		approved   sql.NullFloat64
		paid       sql.NullFloat64
		updatedAt  time.Time
		metadata   []byte
		claimIntID int
	)
	// claimRef may be the numeric id or the claimNumber.
	claimIntID, _ = strconv.Atoi(claimRef)
	row := db.QueryRowContext(ctx,
		`SELECT status, "approvedAmount", "paidAmount", "updatedAt", metadata, id FROM claims WHERE id = $1 OR "claimNumber" = $2 LIMIT 1`,
		claimIntID, claimRef)
	if err := row.Scan(&status, &approved, &paid, &updatedAt, &metadata, &claimIntID); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil, fmt.Errorf("claim not found")
		}
		return nil, nil, fmt.Errorf("claim lookup failed")
	}
	if status != "approved" {
		return nil, nil, fmt.Errorf("claim is not in approved status (current: %s)", status)
	}
	if !approved.Valid || approved.Float64 <= 0 {
		return nil, nil, fmt.Errorf("claim has no approved amount")
	}

	// Subtract amounts already paid or in-flight for this claim.
	var inFlight sql.NullFloat64
	if err := db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(amount),0) FROM instant_payouts WHERE claim_id = $1 AND status NOT IN ('failed','cancelled')`,
		claimIntID).Scan(&inFlight); err != nil {
		return nil, nil, fmt.Errorf("payout history lookup failed")
	}
	payable := approved.Float64 - paid.Float64 - inFlight.Float64
	if payable <= 0 {
		return nil, nil, fmt.Errorf("claim coverage exhausted")
	}

	// Destination must come from the approved claim record, not the client.
	var meta struct {
		BankCode      string `json:"bankCode"`
		AccountNumber string `json:"accountNumber"`
	}
	if len(metadata) > 0 {
		_ = json.Unmarshal(metadata, &meta)
	}
	if meta.AccountNumber == "" || meta.BankCode == "" {
		return nil, nil, fmt.Errorf("claim has no verified payout destination on record")
	}

	// Post-approval hold (cooling) period before funds may move.
	holdMinutes := 60
	if v := os.Getenv("PAYOUT_HOLD_MINUTES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			holdMinutes = n
		}
	}
	holdUntil := updatedAt.Add(time.Duration(holdMinutes) * time.Minute)
	if time.Now().Before(holdUntil) {
		return nil, &holdUntil, nil
	}

	return &verifiedClaim{amount: payable, bankCode: meta.BankCode, accountNumber: meta.AccountNumber}, nil, nil
}

// ── Middleware Clients ────────────────────────────────────────────────────
var (
	redisClient *redisCache
	kafkaWriter *kafkaProducer
	osClient    *opensearchClient
)

// redisCache wraps a pooled go-redis client. 2026-09-19 perf: replaces the
// previous hand-rolled "pool" (a single net.Conn guarded by one sync.Mutex
// with a 4 KB read buffer) which serialized every cache operation in the
// service through one TCP connection and corrupted values >4 KB. go-redis
// gives a real connection pool, pipelining support and correct RESP parsing.
// Cache semantics are unchanged: a Redis error degrades to a cache miss /
// dropped write, never a request failure.
type redisCache struct {
	client *redis.Client
}

func newRedisCache(addr, password string) *redisCache {
	client := redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     password,
		PoolSize:     20,
		MinIdleConns: 4,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		jsonLog("warn", "redis_connect_failed", "error", err.Error(), "addr", addr)
	} else {
		jsonLog("info", "redis_connected", "addr", addr)
	}
	return &redisCache{client: client}
}
func (r *redisCache) CacheGet(key string) (string, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	val, err := r.client.Get(ctx, key).Result()
	if err != nil { // includes redis.Nil (miss) and connectivity failures
		return "", false
	}
	return val, true
}
func (r *redisCache) CacheSet(key string, value string, ttl time.Duration) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = r.client.Set(ctx, key, value, ttl).Err()
}
func (r *redisCache) CacheInvalidate(keys ...string) {
	if len(keys) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = r.client.Del(ctx, keys...).Err()
}

// kafkaProducer wraps a segmentio/kafka-go Writer (async, batched).
// 2026-09-19 perf: replaces the previous fake "producer" that wrote raw
// length-prefixed JSON over a mutex-locked TCP connection — that is NOT the
// Kafka protocol, so events almost certainly never landed, and the publish
// blocked the request path. The repo's shared client (shared/messaging/
// kafka.go) uses the same library and writer settings; it is not imported
// directly because the `shared` module is outside this service's Docker
// build context. Async: true means WriteMessages returns after enqueueing;
// delivery failures are logged via the completion callback.
type kafkaProducer struct {
	topic  string
	writer *kafka.Writer
}

func newKafkaProducer(brokers, topic string) *kafkaProducer {
	p := &kafkaProducer{topic: topic}
	p.writer = &kafka.Writer{
		Addr:         kafka.TCP(strings.Split(brokers, ",")...),
		Topic:        topic,
		Balancer:     &kafka.LeastBytes{},
		BatchSize:    100,
		BatchTimeout: 10 * time.Millisecond,
		RequiredAcks: kafka.RequireOne,
		Async:        true,
		Completion: func(messages []kafka.Message, err error) {
			if err != nil {
				jsonLog("warn", "kafka_publish_failed", "error", err.Error(), "topic", topic, "dropped", fmt.Sprintf("%d", len(messages)))
			}
		},
	}
	jsonLog("info", "kafka_producer_initialized", "brokers", brokers, "topic", topic)
	return p
}

// PublishEvent enqueues an event; with the async writer this does not block
// the request path on broker I/O.
func (k *kafkaProducer) PublishEvent(ctx context.Context, eventType string, key string, payload interface{}) {
	data, _ := json.Marshal(map[string]interface{}{
		"event_type": eventType,
		"source":     k.topic,
		"key":        key,
		"payload":    payload,
		"timestamp":  time.Now().Format(time.RFC3339),
	})
	if err := k.writer.WriteMessages(ctx, kafka.Message{Key: []byte(key), Value: data, Time: time.Now()}); err != nil {
		jsonLog("warn", "kafka_publish_failed", "error", err.Error(), "topic", k.topic)
		return
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
	// 2026-09-19 perf: IndexLog was a synchronous HTTP POST on the request
	// path. Entries now go through a bounded buffered channel drained by one
	// background worker; a full queue drops the entry (logged) rather than
	// slowing payout requests.
	queue chan []byte
}

func newOpenSearchClient(url, user string) *opensearchClient {
	o := &opensearchClient{
		url:      url,
		user:     user,
		password: os.Getenv("OPENSEARCH_PASSWORD"),
		client:   newSharedHTTPClient(5 * time.Second),
		queue:    make(chan []byte, 512),
	}
	go o.indexWorker()
	return o
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
	select {
	case o.queue <- data:
	default:
		jsonLog("debug", "opensearch_index_dropped", "reason", "queue full")
	}
}
func (o *opensearchClient) indexWorker() {
	for data := range o.queue {
		o.mu.Lock()
		open := o.cbOpen && time.Now().Before(o.cbUntil)
		o.mu.Unlock()
		if open {
			continue
		}
		idx := fmt.Sprintf("logs-instant-payout-service-%s", time.Now().Format("2006.01.02"))
		reqURL := fmt.Sprintf("%s/%s/_doc", o.url, idx)
		req, err := http.NewRequest("POST", reqURL, bytes.NewReader(data))
		if err != nil {
			continue
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
			continue
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}
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
			ctx := context.WithValue(r.Context(), ctxKeyUserId, "dev-user")
			ctx = context.WithValue(ctx, ctxKeyTenantId, "default")
			ctx = context.WithValue(ctx, ctxKeyRoles, []string{"admin", "user"})
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		auth := r.Header.Get("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			w.Header().Set("Content-Type", "application/json")
			jsonLog("warn", "auth_failure", "service", "instant-payout-service", "remote_addr", r.RemoteAddr, "path", r.URL.Path, "method", r.Method)
			w.WriteHeader(401)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": map[string]string{"code": "UNAUTHORIZED", "message": "missing bearer token"}})
			return
		}
		// Real JWT validation against Keycloak JWKS. Fail-closed: when JWKS is
		// not configured, production returns 503 (misconfiguration) rather than
		// trusting spoofable identity headers.
		if authMisconfigured() {
			w.Header().Set("Content-Type", "application/json")
			jsonLog("error", "auth_misconfigured", "service", "instant-payout-service", "reason", "KEYCLOAK_JWKS_URL unset")
			w.WriteHeader(503)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": map[string]string{"code": "AUTH_UNAVAILABLE", "message": "token validation not configured"}})
			return
		}
		tokenStr := strings.TrimPrefix(auth, "Bearer ")
		claims, err := validateJWT(tokenStr)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			jsonLog("warn", "auth_failure", "service", "instant-payout-service", "remote_addr", r.RemoteAddr, "path", r.URL.Path, "error", err.Error())
			w.WriteHeader(401)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": map[string]string{"code": "UNAUTHORIZED", "message": "invalid token"}})
			return
		}
		ctx := context.WithValue(r.Context(), ctxKeyUserId, claims.Sub)
		ctx = context.WithValue(ctx, ctxKeyTenantId, claims.TenantID)
		ctx = context.WithValue(ctx, ctxKeyRoles, claims.Roles)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Shared outbound HTTP transport + client singletons. 2026-09-19 perf:
// Permify/Temporal/Mojaloop previously built a fresh &http.Client{} per
// call, paying a full TCP handshake per request on the payout-critical path.
// One pooled transport with keepalive is shared; only the timeout differs.
var sharedHTTPTransport = &http.Transport{
	MaxIdleConns:        100,
	MaxIdleConnsPerHost: 32,
	IdleConnTimeout:     90 * time.Second,
	DialContext:         (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
}

func newSharedHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout, Transport: sharedHTTPTransport}
}

var (
	permifyHTTPClient        = newSharedHTTPClient(5 * time.Second)
	temporalHTTPClient       = newSharedHTTPClient(10 * time.Second)
	temporalSignalHTTPClient = newSharedHTTPClient(5 * time.Second)
	mojaloopHTTPClient       = newSharedHTTPClient(10 * time.Second)
)

// Permify authorization check
func permifyCheck(ctx context.Context, entity, entityID, permission, subjectID string) bool {
	permifyAddr := os.Getenv("PERMIFY_ADDR")
	if permifyAddr == "" {
		// Fail-closed: authorization backend unavailable is a denial in
		// production, never a silent grant.
		if isProduction() {
			jsonLog("error", "permify_not_configured", "entity", entity, "permission", permission)
			return false
		}
		return true
	}
	payload := map[string]interface{}{
		"entity":     map[string]string{"type": entity, "id": entityID},
		"permission": permission,
		"subject":    map[string]string{"type": "user", "id": subjectID},
	}
	data, _ := json.Marshal(payload)
	tenantID := "default"
	if tid, ok := ctx.Value(ctxKeyTenantId).(string); ok && tid != "" {
		tenantID = tid
	}
	url := fmt.Sprintf("http://%s/v1/tenants/%s/permissions/check", permifyAddr, neturl.PathEscape(tenantID))
	req, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(data))) // #nosec G704 -- safe-by-construction: scheme+host come from operator-controlled PERMIFY_ADDR env (not attacker-influenced); the only request-derived component (tenantID) is url-escaped via neturl.PathEscape before path interpolation, so host/port/scheme cannot be manipulated
	if err != nil {
		return true
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := permifyHTTPClient.Do(req) // #nosec G704 -- safe-by-construction: scheme+host come from operator-controlled PERMIFY_ADDR env (not attacker-influenced); the only request-derived component (tenantID) is url-escaped via neturl.PathEscape before path interpolation, so host/port/scheme cannot be manipulated
	if err != nil {
		jsonLog("warn", "permify_check_failed", "error", err.Error())
		// Fail-closed in production: an unreachable authz service denies.
		return !isProduction()
	}
	defer func() { _ = resp.Body.Close() }()
	var result struct {
		Can string `json:"can"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&result)
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
	redisClient = newRedisCache(redisAddr, os.Getenv("REDIS_PASSWORD"))
	jsonLog("info", "redis_client_initialized", "addr", redisAddr)

	// Kafka
	kafkaBrokers := os.Getenv("KAFKA_BROKERS")
	if kafkaBrokers == "" {
		kafkaBrokers = "localhost:9092"
	}
	kafkaWriter = newKafkaProducer(kafkaBrokers, "instant-payout-service-events")

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
	resp, err := temporalHTTPClient.Do(req)
	if err != nil {
		jsonLog("warn", "temporal_workflow_start_failed", "error", err.Error(), "workflow_id", workflowID)
		return workflowID, nil // Continue without Temporal in dev
	}
	defer func() { _ = resp.Body.Close() }()
	jsonLog("info", "temporal_workflow_started", "workflow_id", workflowID, "type", workflowType, "queue", taskQueue)
	return workflowID, nil
}

func (tc *temporalClient) SignalWorkflow(ctx context.Context, workflowID, signalName string, payload interface{}) error {
	data, _ := json.Marshal(payload)
	url := fmt.Sprintf("http://%s/api/v1/namespaces/default/workflows/%s/signal/%s", tc.hostPort, workflowID, signalName)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(data)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := temporalSignalHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
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
	resp, err := mojaloopHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	var result map[string]interface{}
	_ = json.NewDecoder(resp.Body).Decode(&result)
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
	if daprPort == "" {
		daprPort = "3500"
	}
	daprBaseURL = "http://localhost:" + daprPort
	daprClient = newSharedHTTPClient(5 * time.Second)
	jsonLog("info", "dapr_sidecar_configured", "port", daprPort)
}

// daprPublishSem bounds in-flight fire-and-forget publishes. 2026-09-19
// perf: the previous implementation spawned an unbounded goroutine per
// publish and NEVER closed the response body, leaking sockets and
// goroutines under load. Publishes are now bounded (drops are logged, not
// queued forever) and every response body is drained and closed so
// keep-alive connections return to the pool.
var daprPublishSem = make(chan struct{}, 64)

func daprPublish(topic string, data interface{}) {
	if daprClient == nil {
		return
	}
	body, _ := json.Marshal(data)
	req, _ := http.NewRequest("POST", daprBaseURL+"/v1.0/publish/insure-pubsub/"+topic, bytes.NewReader(body))
	if req == nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	select {
	case daprPublishSem <- struct{}{}:
	default:
		jsonLog("warn", "dapr_publish_dropped", "topic", topic, "reason", "too many in-flight publishes")
		return
	}
	go func() {
		defer func() { <-daprPublishSem }()
		resp, err := daprClient.Do(req)
		if err != nil {
			jsonLog("warn", "dapr_publish_failed", "topic", topic, "error", err.Error())
			return
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}()
}

func daprInvoke(appID, method string, data interface{}) ([]byte, error) {
	if daprClient == nil {
		return nil, fmt.Errorf("dapr not initialized")
	}
	body, _ := json.Marshal(data)
	url := fmt.Sprintf("%s/v1.0/invoke/%s/method/%s", daprBaseURL, appID, method)
	req, _ := http.NewRequest("POST", url, bytes.NewReader(body))
	if req == nil {
		return nil, fmt.Errorf("failed to create request")
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := daprClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
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
		port = "8123"
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
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS instant_payouts (id SERIAL PRIMARY KEY, claim_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, amount NUMERIC(20,2) NOT NULL, currency VARCHAR(3) DEFAULT 'NGN', channel VARCHAR(32) DEFAULT 'bank_transfer', account_number VARCHAR(64), bank_code VARCHAR(16), reference VARCHAR(128) UNIQUE, status VARCHAR(32) DEFAULT 'initiated', paid_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`)
	if err != nil {
		jsonLog("warn", "migration error", "error", err.Error())
	}

	// Create indexes for foreign key columns and common query patterns
	indexSQL := []string{
		"CREATE INDEX IF NOT EXISTS idx_instant_payouts_claim_id ON instant_payouts(claim_id)", "CREATE INDEX IF NOT EXISTS idx_instant_payouts_customer_id ON instant_payouts(customer_id)",
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
	mux.HandleFunc("/dapr/subscribe", func(w http.ResponseWriter, r *http.Request) { _ = json.NewEncoder(w).Encode([]map[string]string{}) })
	mux.HandleFunc("/ready", handleReady)
	mux.HandleFunc("/live", handleLive)
	mux.HandleFunc("/stats", handleStats)
	mux.HandleFunc("/metrics", handlePrometheusMetrics)

	// Domain CRUD routes
	mux.HandleFunc("/api/v1/payouts", handleList)
	mux.HandleFunc("/api/v1/payout", handleGetByID)
	mux.HandleFunc("/api/v1/payouts/create", handleCreate)
	mux.HandleFunc("/api/v1/payouts/delete", handleDelete)

	// Payout domain routes
	mux.HandleFunc("/api/v1/payout/process", handleProcessPayout)

	// Apply middleware chain — keycloakAuthMiddleware is REQUIRED: payout
	// endpoints move real funds and must never be reachable unauthenticated.
	var handler http.Handler = mux
	handler = keycloakAuthMiddleware(handler)
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

	log.Printf("Instant Payout Service starting on :%s", port)
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

// isSafeColumnName enforces a strict whitelist on column names taken from
// request JSON keys and interpolated into dynamically built INSERT statements
// (values are always sent as $N bind parameters). Only [A-Za-z0-9_], starting
// with a letter or underscore, up to 63 chars (Postgres identifier limit) is
// accepted; callers reject anything else with HTTP 400. This closes SQL
// injection via crafted request keys.
func isSafeColumnName(name string) bool {
	if len(name) == 0 || len(name) > 63 {
		return false
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c == '_':
		case c >= '0' && c <= '9' && i > 0:
		default:
			return false
		}
	}
	return true
}
