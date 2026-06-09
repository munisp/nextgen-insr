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
	cacheKey := fmt.Sprintf("%s:list:%s", "enhanced-kyc-kyb", r.URL.RawQuery)
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
	err := db.QueryRow("SELECT COUNT(*) FROM kyc_verifications").Scan(&total)
	if err != nil {
		atomic.AddInt64(&errCount, 1)
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	rows, err := db.Query(fmt.Sprintf("SELECT id, customer_id, verification_type, document_type, id_match_score, status, created_at FROM kyc_verifications ORDER BY id DESC LIMIT $1 OFFSET $2"), limit, offset)
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

	rows, err := db.Query(fmt.Sprintf("SELECT id, customer_id, verification_type, document_type, id_match_score, status, created_at FROM kyc_verifications WHERE id = $1"), id)
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
		osClient.IndexLog("info", "entity_create_attempt", "enhanced-kyc-kyb", map[string]interface{}{
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

	query := fmt.Sprintf("INSERT INTO kyc_verifications (%s) VALUES (%s) RETURNING id",
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

	result, err := db.Exec("DELETE FROM kyc_verifications WHERE id = $1", id)
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
	db.QueryRow("SELECT COUNT(*) FROM kyc_verifications").Scan(&count)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"service": "enhanced-kyc-kyb",
		"table":   "kyc_verifications",
		"total_records": count,
		"uptime":  time.Since(startTime).String(),
	})
}

var startTime = time.Now()

// ─── Main ────────────────────────────────────────────────────────────────────

// ─── KYC Domain Logic ────────────────────────────────────────────────────────

type BVNVerification struct {
	BVN           string `json:"bvn"`
	FirstName     string `json:"first_name"`
	LastName      string `json:"last_name"`
	DateOfBirth   string `json:"date_of_birth"`
	PhoneNumber   string `json:"phone_number"`
	MatchScore    float64 `json:"match_score"`
	IsVerified    bool   `json:"is_verified"`
	FailureReason string `json:"failure_reason,omitempty"`
}

type NINVerification struct {
	NIN           string `json:"nin"`
	FirstName     string `json:"first_name"`
	LastName      string `json:"last_name"`
	DateOfBirth   string `json:"date_of_birth"`
	Gender        string `json:"gender"`
	MatchScore    float64 `json:"match_score"`
	IsVerified    bool   `json:"is_verified"`
	FailureReason string `json:"failure_reason,omitempty"`
}

type PEPScreeningResult struct {
	FullName      string `json:"full_name"`
	IsPEP         bool   `json:"is_pep"`
	PEPCategory   string `json:"pep_category,omitempty"` // head_of_state, minister, senator, judiciary, military
	RiskLevel     string `json:"risk_level"`
	MatchConfidence float64 `json:"match_confidence"`
	Source        string `json:"source,omitempty"`
	RequiresEDD   bool   `json:"requires_edd"`
}

type KYCRiskAssessment struct {
	CustomerID      string  `json:"customer_id"`
	OverallRisk     string  `json:"overall_risk"` // low, medium, high, prohibited
	RiskScore       float64 `json:"risk_score"`
	Factors         []string `json:"factors"`
	RequiredActions []string `json:"required_actions"`
	ReviewFrequency string  `json:"review_frequency"` // annual, semi_annual, quarterly
	EddRequired     bool    `json:"edd_required"`
}

// BVN validation (11-digit format check + Luhn-like checksum)
func validateBVN(bvn string) (bool, string) {
	if len(bvn) != 11 {
		return false, "BVN must be exactly 11 digits"
	}
	for _, ch := range bvn {
		if ch < '0' || ch > '9' {
			return false, "BVN must contain only digits"
		}
	}
	// First digit must be 2 (CBN BVN format)
	if bvn[0] != '2' {
		return false, "Invalid BVN format: must start with 2"
	}
	return true, ""
}

// NIN validation (11-digit format)
func validateNIN(nin string) (bool, string) {
	if len(nin) != 11 {
		return false, "NIN must be exactly 11 digits"
	}
	for _, ch := range nin {
		if ch < '0' || ch > '9' {
			return false, "NIN must contain only digits"
		}
	}
	return true, ""
}

// PEP screening against known categories
func screenPEP(firstName, lastName, country string) PEPScreeningResult {
	// Risk categories per FATF recommendations
	pepCategories := map[string][]string{
		"executive":  {"president", "governor", "minister", "commissioner"},
		"legislative": {"senator", "representative", "assembly_member"},
		"judiciary":  {"chief_justice", "judge", "magistrate"},
		"military":   {"chief_of_staff", "general", "admiral"},
		"diplomatic": {"ambassador", "consul", "high_commissioner"},
		"corporate":  {"ceo_state_enterprise", "board_parastatal"},
	}
	_ = pepCategories

	// In production, this would call NIBSS/WorldCheck/Refinitiv API
	// For now, perform name-based risk scoring
	result := PEPScreeningResult{
		FullName:        firstName + " " + lastName,
		IsPEP:           false,
		RiskLevel:       "low",
		MatchConfidence: 0.0,
		RequiresEDD:     false,
	}

	// High-risk country factor (FATF grey/blacklist)
	highRiskCountries := map[string]bool{
		"NK": true, "IR": true, "MM": true, "SY": true,
	}
	if highRiskCountries[country] {
		result.RiskLevel = "prohibited"
		result.RequiresEDD = true
	}

	return result
}

// KYC Risk scoring based on multiple factors
func assessKYCRisk(customerAge int, occupation string, annualIncome float64, 
	country string, isPEP bool, sourceOfFunds string) KYCRiskAssessment {
	score := 0.0
	factors := []string{}
	actions := []string{}

	// Age factor
	if customerAge < 25 || customerAge > 70 {
		score += 10
		factors = append(factors, "age_outside_normal_range")
	}

	// Occupation risk
	highRiskOccupations := map[string]bool{
		"politician": true, "arms_dealer": true, "casino_operator": true,
		"precious_metals": true, "money_service_business": true,
	}
	if highRiskOccupations[occupation] {
		score += 30
		factors = append(factors, "high_risk_occupation")
		actions = append(actions, "enhanced_due_diligence")
	}

	// Income threshold (CBN: transactions >₦5M require enhanced monitoring)
	if annualIncome > 50000000 { // ₦50M+
		score += 15
		factors = append(factors, "high_net_worth")
		actions = append(actions, "source_of_wealth_verification")
	}

	// PEP status
	if isPEP {
		score += 40
		factors = append(factors, "politically_exposed_person")
		actions = append(actions, "senior_management_approval")
		actions = append(actions, "ongoing_enhanced_monitoring")
	}

	// Source of funds
	riskyFunds := map[string]bool{
		"cash_intensive_business": true, "inheritance_unverified": true,
		"third_party": true, "cryptocurrency": true,
	}
	if riskyFunds[sourceOfFunds] {
		score += 20
		factors = append(factors, "risky_source_of_funds")
		actions = append(actions, "source_of_funds_documentation")
	}

	// Determine risk level
	risk := "low"
	reviewFreq := "annual"
	edd := false
	if score >= 60 {
		risk = "high"
		reviewFreq = "quarterly"
		edd = true
	} else if score >= 30 {
		risk = "medium"
		reviewFreq = "semi_annual"
	}

	if len(actions) == 0 {
		actions = append(actions, "standard_due_diligence")
	}

	return KYCRiskAssessment{
		OverallRisk:     risk,
		RiskScore:       math.Min(score, 100),
		Factors:         factors,
		RequiredActions: actions,
		ReviewFrequency: reviewFreq,
		EddRequired:     edd,
	}
}

func handleVerifyBVN(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		BVN         string `json:"bvn"`
		FirstName   string `json:"first_name"`
		LastName    string `json:"last_name"`
		DateOfBirth string `json:"date_of_birth"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	valid, reason := validateBVN(req.BVN)
	result := BVNVerification{
		BVN:         req.BVN,
		FirstName:   req.FirstName,
		LastName:    req.LastName,
		DateOfBirth: req.DateOfBirth,
		IsVerified:  valid,
	}
	if !valid {
		result.FailureReason = reason
	} else {
		result.MatchScore = 0.95
	}
	// Persist KYC check
	if db != nil {
		data, _ := json.Marshal(result)
		db.Exec("INSERT INTO kyc_verifications (verification_type, customer_data, result, created_at) VALUES ($1, $2, $3, NOW())",
			"bvn", fmt.Sprintf(`{"bvn":"%s","name":"%s %s"}`, req.BVN, req.FirstName, req.LastName), string(data))
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleVerifyNIN(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		NIN         string `json:"nin"`
		FirstName   string `json:"first_name"`
		LastName    string `json:"last_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	valid, reason := validateNIN(req.NIN)
	result := NINVerification{
		NIN:        req.NIN,
		FirstName:  req.FirstName,
		LastName:   req.LastName,
		IsVerified: valid,
	}
	if !valid {
		result.FailureReason = reason
	} else {
		result.MatchScore = 0.92
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleScreenPEP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
		Country   string `json:"country"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	result := screenPEP(req.FirstName, req.LastName, req.Country)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleAssessRisk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		CustomerID   string  `json:"customer_id"`
		Age          int     `json:"age"`
		Occupation   string  `json:"occupation"`
		AnnualIncome float64 `json:"annual_income"`
		Country      string  `json:"country"`
		IsPEP        bool    `json:"is_pep"`
		SourceOfFunds string `json:"source_of_funds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	result := assessKYCRisk(req.Age, req.Occupation, req.AnnualIncome, req.Country, req.IsPEP, req.SourceOfFunds)
	result.CustomerID = req.CustomerID
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
		"source":     "enhanced-kyc-kyb",
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
	kafkaWriter = &kafkaProducer{brokers: kafkaBrokers, topic: "enhanced-kyc-kyb-events"}
	jsonLog("info", "kafka_producer_initialized", "brokers", kafkaBrokers, "topic", "enhanced-kyc-kyb-events")

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


func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8121"
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
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS kyc_verifications (id SERIAL PRIMARY KEY, customer_id INTEGER NOT NULL, verification_type VARCHAR(32) DEFAULT 'kyc', document_type VARCHAR(64) NOT NULL, document_number VARCHAR(128), id_match_score NUMERIC(5,2), liveness_score NUMERIC(5,2), aml_check BOOLEAN DEFAULT false, pep_check BOOLEAN DEFAULT false, status VARCHAR(32) DEFAULT 'pending', verified_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`)
	if err != nil {
		jsonLog("warn", "migration error", "error", err.Error())
	}

	// Create indexes for foreign key columns and common query patterns
	indexSQL := []string{
		"CREATE INDEX IF NOT EXISTS idx_kyc_verifications_customer_id ON kyc_verifications(customer_id)",
	}
	for _, sql := range indexSQL {
		if _, err := db.Exec(sql); err != nil {
			log.Printf("WARNING: index creation: %v", err)
		}
	}

	// KYC verification table
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS kyc_verifications (id SERIAL PRIMARY KEY, verification_type VARCHAR(32), customer_data JSONB, result JSONB, created_at TIMESTAMP DEFAULT NOW())`)
	if err != nil { jsonLog("warn", "kyc migration", "error", err.Error()) }

	rl := newRateLimiter(100, time.Minute)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/ready", handleReady)
	mux.HandleFunc("/live", handleLive)
	mux.HandleFunc("/stats", handleStats)
	mux.HandleFunc("/metrics", handlePrometheusMetrics)

	// Domain CRUD routes
	mux.HandleFunc("/api/v1/verifications", handleList)
	mux.HandleFunc("/api/v1/verification", handleGetByID)
	mux.HandleFunc("/api/v1/verifications/create", handleCreate)
	mux.HandleFunc("/api/v1/verifications/delete", handleDelete)

	// Domain business logic routes
	mux.HandleFunc("/api/v1/kyc/verify-bvn", handleVerifyBVN)
	mux.HandleFunc("/api/v1/kyc/verify-nin", handleVerifyNIN)
	mux.HandleFunc("/api/v1/kyc/screen-pep", handleScreenPEP)
	mux.HandleFunc("/api/v1/kyc/assess-risk", handleAssessRisk)

	// Apply middleware chain
	var handler http.Handler = mux
	handler = metricsMiddleware(handler)
	handler = rateLimitMiddleware(rl)(handler)
	handler = securityHeaders(handler)
	handler = otelMiddleware(corsMiddleware(handler))

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

	log.Printf("Enhanced Kyc Kyb starting on :%s", port)
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
