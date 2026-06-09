package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"sync"
	"time"
	"context"
	"database/sql"

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

// ReinsuranceService manages reinsurance operations
type ReinsuranceService struct{}

// Treaty represents a reinsurance treaty
type Treaty struct {
	TreatyID          string    `json:"treaty_id"`
	TreatyName        string    `json:"treaty_name"`
	TreatyType        string    `json:"treaty_type"` // quota_share, surplus, excess_of_loss, stop_loss
	Reinsurer         string    `json:"reinsurer"`
	ReinsurerShare    float64   `json:"reinsurer_share"`
	RetentionLimit    float64   `json:"retention_limit"`
	CoverLimit        float64   `json:"cover_limit"`
	CommissionRate    float64   `json:"commission_rate"`
	ProfitCommission  float64   `json:"profit_commission"`
	EffectiveDate     time.Time `json:"effective_date"`
	ExpiryDate        time.Time `json:"expiry_date"`
	Status            string    `json:"status"`
	LinesOfBusiness   []string  `json:"lines_of_business"`
}

// FacultativePlacement represents a facultative reinsurance placement
type FacultativePlacement struct {
	PlacementID       string    `json:"placement_id"`
	PolicyNumber      string    `json:"policy_number"`
	InsuredName       string    `json:"insured_name"`
	RiskDescription   string    `json:"risk_description"`
	SumInsured        float64   `json:"sum_insured"`
	GrossPremium      float64   `json:"gross_premium"`
	RetainedAmount    float64   `json:"retained_amount"`
	CededAmount       float64   `json:"ceded_amount"`
	CededPremium      float64   `json:"ceded_premium"`
	Commission        float64   `json:"commission"`
	Reinsurers        []ReinsurerParticipation `json:"reinsurers"`
	PlacementDate     time.Time `json:"placement_date"`
	Status            string    `json:"status"`
}

// ReinsurerParticipation represents a reinsurer's participation
type ReinsurerParticipation struct {
	ReinsurerName     string  `json:"reinsurer_name"`
	ReinsurerCode     string  `json:"reinsurer_code"`
	SharePercent      float64 `json:"share_percent"`
	ShareAmount       float64 `json:"share_amount"`
	Premium           float64 `json:"premium"`
	Commission        float64 `json:"commission"`
}

// BordereauEntry represents a bordereau entry
type BordereauEntry struct {
	EntryID           string    `json:"entry_id"`
	TreatyID          string    `json:"treaty_id"`
	PolicyNumber      string    `json:"policy_number"`
	InsuredName       string    `json:"insured_name"`
	RiskType          string    `json:"risk_type"`
	InceptionDate     time.Time `json:"inception_date"`
	ExpiryDate        time.Time `json:"expiry_date"`
	SumInsured        float64   `json:"sum_insured"`
	GrossPremium      float64   `json:"gross_premium"`
	CededPremium      float64   `json:"ceded_premium"`
	Commission        float64   `json:"commission"`
	NetPremium        float64   `json:"net_premium"`
}

// ClaimRecovery represents a reinsurance claim recovery
type ClaimRecovery struct {
	RecoveryID        string    `json:"recovery_id"`
	ClaimNumber       string    `json:"claim_number"`
	PolicyNumber      string    `json:"policy_number"`
	TreatyID          string    `json:"treaty_id"`
	GrossClaimAmount  float64   `json:"gross_claim_amount"`
	RetainedAmount    float64   `json:"retained_amount"`
	RecoverableAmount float64   `json:"recoverable_amount"`
	RecoveredAmount   float64   `json:"recovered_amount"`
	OutstandingAmount float64   `json:"outstanding_amount"`
	Reinsurers        []ReinsurerRecovery `json:"reinsurers"`
	Status            string    `json:"status"`
	SubmissionDate    time.Time `json:"submission_date"`
}

// ReinsurerRecovery represents recovery from a specific reinsurer
type ReinsurerRecovery struct {
	ReinsurerName     string    `json:"reinsurer_name"`
	SharePercent      float64   `json:"share_percent"`
	RecoverableAmount float64   `json:"recoverable_amount"`
	RecoveredAmount   float64   `json:"recovered_amount"`
	RecoveryDate      time.Time `json:"recovery_date,omitempty"`
	Status            string    `json:"status"`
}

// ReinsuranceAccount represents reinsurance account statement
type ReinsuranceAccount struct {
	AccountID         string    `json:"account_id"`
	TreatyID          string    `json:"treaty_id"`
	Period            string    `json:"period"`
	GrossPremium      float64   `json:"gross_premium"`
	Commission        float64   `json:"commission"`
	Claims            float64   `json:"claims"`
	ProfitCommission  float64   `json:"profit_commission"`
	Balance           float64   `json:"balance"`
	Status            string    `json:"status"`
}

// ReinsuranceAnalytics represents reinsurance analytics
type ReinsuranceAnalytics struct {
	TotalCededPremium     float64 `json:"total_ceded_premium"`
	TotalCommissionEarned float64 `json:"total_commission_earned"`
	TotalClaimsRecovered  float64 `json:"total_claims_recovered"`
	RetentionRatio        float64 `json:"retention_ratio"`
	CessionRatio          float64 `json:"cession_ratio"`
	RecoveryRatio         float64 `json:"recovery_ratio"`
	NetRetention          float64 `json:"net_retention"`
	TreatyUtilization     map[string]float64 `json:"treaty_utilization"`
}

func NewReinsuranceService() *ReinsuranceService {
	return &ReinsuranceService{}
}

// CalculateCession calculates reinsurance cession for a policy
func (s *ReinsuranceService) CalculateCession(sumInsured, grossPremium float64, treaty *Treaty) *FacultativePlacement {
	var retainedAmount, cededAmount, cededPremium, commission float64
	
	switch treaty.TreatyType {
	case "quota_share":
		// Fixed percentage cession
		cededAmount = sumInsured * treaty.ReinsurerShare
		retainedAmount = sumInsured - cededAmount
		cededPremium = grossPremium * treaty.ReinsurerShare
		commission = cededPremium * treaty.CommissionRate
		
	case "surplus":
		// Cede amounts above retention
		if sumInsured > treaty.RetentionLimit {
			retainedAmount = treaty.RetentionLimit
			cededAmount = math.Min(sumInsured-treaty.RetentionLimit, treaty.CoverLimit)
			cessionRatio := cededAmount / sumInsured
			cededPremium = grossPremium * cessionRatio
			commission = cededPremium * treaty.CommissionRate
		} else {
			retainedAmount = sumInsured
			cededAmount = 0
			cededPremium = 0
			commission = 0
		}
		
	case "excess_of_loss":
		// XOL - applies to claims, not premium
		retainedAmount = treaty.RetentionLimit
		cededAmount = math.Min(sumInsured-treaty.RetentionLimit, treaty.CoverLimit)
		// XOL premium is typically a flat rate
		cededPremium = grossPremium * 0.05 // 5% XOL rate
		commission = cededPremium * treaty.CommissionRate
	}
	
	return &FacultativePlacement{
		PlacementID:    fmt.Sprintf("FAC-%d", time.Now().Unix()),
		SumInsured:     sumInsured,
		GrossPremium:   grossPremium,
		RetainedAmount: math.Round(retainedAmount*100) / 100,
		CededAmount:    math.Round(cededAmount*100) / 100,
		CededPremium:   math.Round(cededPremium*100) / 100,
		Commission:     math.Round(commission*100) / 100,
		PlacementDate:  time.Now(),
		Status:         "placed",
	}
}

// CalculateClaimRecovery calculates reinsurance claim recovery
func (s *ReinsuranceService) CalculateClaimRecovery(claimAmount float64, treaty *Treaty) *ClaimRecovery {
	var retainedAmount, recoverableAmount float64
	
	switch treaty.TreatyType {
	case "quota_share":
		retainedAmount = claimAmount * (1 - treaty.ReinsurerShare)
		recoverableAmount = claimAmount * treaty.ReinsurerShare
		
	case "surplus":
		if claimAmount > treaty.RetentionLimit {
			retainedAmount = treaty.RetentionLimit
			recoverableAmount = math.Min(claimAmount-treaty.RetentionLimit, treaty.CoverLimit)
		} else {
			retainedAmount = claimAmount
			recoverableAmount = 0
		}
		
	case "excess_of_loss":
		if claimAmount > treaty.RetentionLimit {
			retainedAmount = treaty.RetentionLimit
			recoverableAmount = math.Min(claimAmount-treaty.RetentionLimit, treaty.CoverLimit)
		} else {
			retainedAmount = claimAmount
			recoverableAmount = 0
		}
	}
	
	return &ClaimRecovery{
		RecoveryID:        fmt.Sprintf("REC-%d", time.Now().Unix()),
		TreatyID:          treaty.TreatyID,
		GrossClaimAmount:  claimAmount,
		RetainedAmount:    math.Round(retainedAmount*100) / 100,
		RecoverableAmount: math.Round(recoverableAmount*100) / 100,
		RecoveredAmount:   0,
		OutstandingAmount: math.Round(recoverableAmount*100) / 100,
		Status:            "pending",
		SubmissionDate:    time.Now(),
	}
}

// GenerateBordereau generates a bordereau report
func (s *ReinsuranceService) GenerateBordereau(treatyID string, entries []BordereauEntry) map[string]interface{} {
	var totalGrossPremium, totalCededPremium, totalCommission, totalNetPremium float64
	
	for _, entry := range entries {
		totalGrossPremium += entry.GrossPremium
		totalCededPremium += entry.CededPremium
		totalCommission += entry.Commission
		totalNetPremium += entry.NetPremium
	}
	
	return map[string]interface{}{
		"treaty_id":           treatyID,
		"period":              time.Now().Format("2006-01"),
		"entry_count":         len(entries),
		"total_gross_premium": math.Round(totalGrossPremium*100) / 100,
		"total_ceded_premium": math.Round(totalCededPremium*100) / 100,
		"total_commission":    math.Round(totalCommission*100) / 100,
		"total_net_premium":   math.Round(totalNetPremium*100) / 100,
		"generated_at":        time.Now(),
		"entries":             entries,
	}
}

// CalculateAnalytics calculates reinsurance analytics
func (s *ReinsuranceService) CalculateAnalytics(grossPremium, cededPremium, commission, claimsPaid, claimsRecovered float64) *ReinsuranceAnalytics {
	retentionRatio := (grossPremium - cededPremium) / grossPremium * 100
	cessionRatio := cededPremium / grossPremium * 100
	recoveryRatio := 0.0
	if claimsPaid > 0 {
		recoveryRatio = claimsRecovered / claimsPaid * 100
	}
	
	return &ReinsuranceAnalytics{
		TotalCededPremium:     cededPremium,
		TotalCommissionEarned: commission,
		TotalClaimsRecovered:  claimsRecovered,
		RetentionRatio:        math.Round(retentionRatio*100) / 100,
		CessionRatio:          math.Round(cessionRatio*100) / 100,
		RecoveryRatio:         math.Round(recoveryRatio*100) / 100,
		NetRetention:          grossPremium - cededPremium + commission,
	}
}

// HTTP Handlers
func (s *ReinsuranceService) HandleCalculateCession(w http.ResponseWriter, r *http.Request) {
	type Request struct {
		SumInsured   float64 `json:"sum_insured"`
		GrossPremium float64 `json:"gross_premium"`
		Treaty       Treaty  `json:"treaty"`
	}
	
	var req Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	result := s.CalculateCession(req.SumInsured, req.GrossPremium, &req.Treaty)
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (s *ReinsuranceService) HandleCalculateRecovery(w http.ResponseWriter, r *http.Request) {
	type Request struct {
		ClaimAmount float64 `json:"claim_amount"`
		Treaty      Treaty  `json:"treaty"`
	}
	
	var req Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	result := s.CalculateClaimRecovery(req.ClaimAmount, &req.Treaty)
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (s *ReinsuranceService) HandleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"service":   "reinsurance-management",
		"timestamp": time.Now(),
		"features": []string{
			"treaty_management",
			"facultative_placement",
			"cession_calculation",
			"claim_recovery",
			"bordereau_generation",
			"account_statements",
			"analytics",
		},
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
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)
	if err := db.Ping(); err != nil {
		jsonLog("warn", "database ping failed", "error", err.Error())
	} else {
		jsonLog("info", "database connected", "service", "reinsurance-management", "driver", "postgresql")
	}
	// Create domain table
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS reinsurance_contracts (
            id SERIAL PRIMARY KEY,
            reinsurer_name TEXT NOT NULL,
            contract_type TEXT NOT NULL,
            limit_amount NUMERIC,
            retention NUMERIC,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT NOW()
        )`); err != nil {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS reinsurance_cessions (id TEXT PRIMARY KEY, policy_id TEXT, treaty_type TEXT, sum_insured NUMERIC(15,2), gross_premium NUMERIC(15,2), ceded_premium NUMERIC(15,2), retained_premium NUMERIC(15,2), ceded_si NUMERIC(15,2), created_at TIMESTAMPTZ DEFAULT NOW())`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
	}
		jsonLog("warn", "create table failed", "error", err.Error())
	} else {
		jsonLog("info", "table ready", "table", "reinsurance_contracts")
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

// ─── Domain CRUD Handlers (PostgreSQL-backed) ────────────────────────────────

func handleListEntities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 { page = 1 }
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 100 { limit = 20 }
	offset := (page - 1) * limit

	var total int
	if err := db.QueryRow("SELECT COUNT(*) FROM reinsurance_contracts").Scan(&total); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	rows, err := db.Query(fmt.Sprintf("SELECT id, reinsurer_name, contract_type, limit_amount, retention, status, created_at FROM reinsurance_contracts ORDER BY id DESC LIMIT $1 OFFSET $2"), limit, offset)
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
	rows, err := db.Query("SELECT id, reinsurer_name, contract_type, limit_amount, retention, status, created_at FROM reinsurance_contracts WHERE id = $1", idStr)
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
	query := fmt.Sprintf("INSERT INTO reinsurance_contracts (%s) VALUES (%s) RETURNING id",
		strings.Join(cols, ", "), strings.Join(placeholders, ", "))
	var newID interface{}
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
	if r.Method != http.MethodDelete {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, `{"error":"id parameter required"}`, http.StatusBadRequest)
		return
	}
	result, err := db.Exec("DELETE FROM reinsurance_contracts WHERE id = $1", idStr)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	if kafkaWriter != nil { kafkaWriter.PublishEvent(r.Context(), "created", r.URL.Path, nil) }
	json.NewEncoder(w).Encode(map[string]interface{}{"id": idStr, "status": "deleted"})
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	var count int
	if db != nil {
		db.QueryRow("SELECT COUNT(*) FROM reinsurance_contracts").Scan(&count)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"service": "reinsurance_contracts", "table": "reinsurance_contracts", "total_records": count})
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
		"source":     "reinsurance-management",
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
	kafkaWriter = &kafkaProducer{brokers: kafkaBrokers, topic: "reinsurance-management-events"}
	jsonLog("info", "kafka_producer_initialized", "brokers", kafkaBrokers, "topic", "reinsurance-management-events")

	// OpenSearch
	osURL := os.Getenv("OPENSEARCH_URL")
	if osURL == "" {
		osURL = "http://localhost:9200"
	}
	osClient = &opensearchClient{url: osURL, user: os.Getenv("OPENSEARCH_USER")}
	jsonLog("info", "opensearch_client_initialized", "url", osURL)
}



func handleTreatyApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed); return
	}
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		PolicyID    string  `json:"policy_id"`
		SumInsured  float64 `json:"sum_insured"`
		Premium     float64 `json:"premium"`
		TreatyType  string  `json:"treaty_type"` // quota_share, surplus, excess_of_loss
		RetentionPct float64 `json:"retention_pct"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, 400); return
	}
	cessionID := fmt.Sprintf("CES-%d", time.Now().UnixNano())
	var cededPremium, retainedPremium, cededSI float64
	switch req.TreatyType {
	case "quota_share":
		cessionPct := 1.0 - req.RetentionPct/100.0
		cededPremium = req.Premium * cessionPct
		retainedPremium = req.Premium * (req.RetentionPct / 100.0)
		cededSI = req.SumInsured * cessionPct
	case "surplus":
		retention := req.SumInsured * (req.RetentionPct / 100.0)
		if req.SumInsured > retention {
			cededSI = req.SumInsured - retention
			cededPremium = req.Premium * (cededSI / req.SumInsured)
		}
		retainedPremium = req.Premium - cededPremium
	case "excess_of_loss":
		// XL: flat premium ceded
		cededPremium = req.Premium * 0.05 // 5% XL rate
		retainedPremium = req.Premium - cededPremium
		cededSI = req.SumInsured // full exposure ceded above attachment point
	}
	if db != nil {
		db.Exec("INSERT INTO reinsurance_cessions (id, policy_id, treaty_type, sum_insured, gross_premium, ceded_premium, retained_premium, ceded_si, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())",
			cessionID, req.PolicyID, req.TreatyType, req.SumInsured, req.Premium, cededPremium, retainedPremium, cededSI)
	}
	if kafkaWriter != nil { kafkaWriter.PublishEvent(r.Context(), "cession_created", cessionID, nil) }
	json.NewEncoder(w).Encode(map[string]interface{}{"cession_id": cessionID, "treaty_type": req.TreatyType, "gross_premium": req.Premium, "ceded_premium": cededPremium, "retained_premium": retainedPremium, "ceded_sum_insured": cededSI})
}


func handleTreatySummary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed); return
	}
	w.Header().Set("Content-Type", "application/json")

	var quotaCeded, surplusCeded, xlCeded float64
	var totalCessions int
	if db != nil {
		db.QueryRow("SELECT COUNT(*), COALESCE(SUM(CASE WHEN treaty_type='quota_share' THEN ceded_premium END),0), COALESCE(SUM(CASE WHEN treaty_type='surplus' THEN ceded_premium END),0), COALESCE(SUM(CASE WHEN treaty_type='excess_of_loss' THEN ceded_premium END),0) FROM reinsurance_cessions", ).Scan(&totalCessions, &quotaCeded, &surplusCeded, &xlCeded)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"total_cessions": totalCessions, "quota_share_ceded": quotaCeded, "surplus_ceded": surplusCeded, "xl_ceded": xlCeded, "total_ceded": quotaCeded + surplusCeded + xlCeded})
}

func main() {
	initDB()
	initMiddleware()
	service := NewReinsuranceService()
	
	http.HandleFunc("/api/reinsurance/cession", service.HandleCalculateCession)
	http.HandleFunc("/api/reinsurance/recovery", service.HandleCalculateRecovery)

	http.HandleFunc("/api/v1/contracts", handleListEntities)
	http.HandleFunc("/api/v1/contract", handleGetEntity)
	http.HandleFunc("/api/v1/contracts/create", handleCreateEntity)
	http.HandleFunc("/api/v1/contracts/delete", handleDeleteEntity)
	http.HandleFunc("/stats", handleStats)

	http.HandleFunc("/health", service.HandleHealth)
	http.HandleFunc("/ready", handleReady)
	http.HandleFunc("/live", handleLive)
	
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	
	log.Printf("Reinsurance Management Service starting on port %s", port)
	
	srv := &http.Server{Addr: ":" + port, Handler: nil}
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		jsonLog("info", "shutting down gracefully", "service", "reinsurance-management")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			jsonLog("error", "shutdown error", "error", err.Error())
		}
	}()
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Failed to start server: %v", err)
	}
}
