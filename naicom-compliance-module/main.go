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
	err := db.QueryRow("SELECT COUNT(*) FROM naicom_filings").Scan(&total)
	if err != nil {
		atomic.AddInt64(&errCount, 1)
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	rows, err := db.Query(fmt.Sprintf("SELECT id, filing_type, period, status, submitted_at, filed_by, created_at FROM naicom_filings ORDER BY id DESC LIMIT $1 OFFSET $2"), limit, offset)
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

	rows, err := db.Query(fmt.Sprintf("SELECT id, filing_type, period, status, submitted_at, filed_by, created_at FROM naicom_filings WHERE id = $1"), id)
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
		switch mv := v.(type) {
		case map[string]interface{}:
			b, _ := json.Marshal(mv)
			vals = append(vals, string(b))
		case []interface{}:
			b, _ := json.Marshal(mv)
			vals = append(vals, string(b))
		default:
			vals = append(vals, v)
		}
		placeholders = append(placeholders, fmt.Sprintf("$%d", i))
		i++
	}

	if len(cols) == 0 {
		http.Error(w, `{"error":"no fields provided"}`, http.StatusBadRequest)
		return
	}

	query := fmt.Sprintf("INSERT INTO naicom_filings (%s) VALUES (%s) RETURNING id",
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

	result, err := db.Exec("DELETE FROM naicom_filings WHERE id = $1", id)
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
	db.QueryRow("SELECT COUNT(*) FROM naicom_filings").Scan(&count)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"service": "naicom-compliance-module",
		"table":   "naicom_filings",
		"total_records": count,
		"uptime":  time.Since(startTime).String(),
	})
}

var startTime = time.Now()

// ─── Main ────────────────────────────────────────────────────────────────────

// ─── NAICOM Domain Logic ─────────────────────────────────────────────────────

// SCR (Solvency Capital Requirement) under NAICOM Risk-Based Supervision
type SCRInput struct {
	Assets          float64 `json:"assets"`
	Liabilities     float64 `json:"liabilities"`
	PremiumVolume   float64 `json:"premium_volume"`
	InvestmentAssets float64 `json:"investment_assets"`
	ReinsuranceRecoverable float64 `json:"reinsurance_recoverable"`
}

type SCRResult struct {
	MarketRisk        float64 `json:"market_risk"`
	InsuranceRisk     float64 `json:"insurance_risk"`
	CreditRisk        float64 `json:"credit_risk"`
	OperationalRisk   float64 `json:"operational_risk"`
	GrossSCR          float64 `json:"gross_scr"`
	DiversificationBenefit float64 `json:"diversification_benefit"`
	NetSCR            float64 `json:"net_scr"`
	AvailableCapital  float64 `json:"available_capital"`
	SolvencyRatio     float64 `json:"solvency_ratio"`
	MeetsMinimum      bool    `json:"meets_minimum"`
	MinimumCapital    float64 `json:"minimum_capital"`
	Status            string  `json:"status"`
}

func calculateSCR(input SCRInput) SCRResult {
	// NAICOM minimum capital requirements (2023 recapitalization)
	minimumCapital := 8000000000.0 // ₦8B for life, ₦5B for non-life, ₦10B for composite

	// Market risk: equity (35%), property (25%), interest rate (12%), currency (20%)
	equityRisk := input.InvestmentAssets * 0.35 * 0.12
	propertyRisk := input.InvestmentAssets * 0.15 * 0.25
	interestRateRisk := input.Assets * 0.12 * 0.08
	currencyRisk := input.Assets * 0.10 * 0.20
	marketRisk := equityRisk + propertyRisk + interestRateRisk + currencyRisk

	// Insurance (underwriting) risk: premium risk + reserve risk
	premiumRisk := input.PremiumVolume * 0.10
	reserveRisk := input.Liabilities * 0.08
	catastropheRisk := input.PremiumVolume * 0.03
	insuranceRisk := premiumRisk + reserveRisk + catastropheRisk

	// Credit risk: counterparty default (reinsurers, banks, policyholders)
	creditRisk := input.ReinsuranceRecoverable*0.06 + input.Assets*0.02

	// Operational risk: 3% of gross premium or 0.3% of technical provisions (whichever higher)
	opRiskPremium := input.PremiumVolume * 0.03
	opRiskProvisions := input.Liabilities * 0.003
	operationalRisk := math.Max(opRiskPremium, opRiskProvisions)

	grossSCR := marketRisk + insuranceRisk + creditRisk + operationalRisk

	// Diversification benefit (25% correlation reduction per NAICOM guidelines)
	diversification := grossSCR * 0.25
	netSCR := grossSCR - diversification

	availableCapital := input.Assets - input.Liabilities

	solvencyRatio := 0.0
	if netSCR > 0 {
		solvencyRatio = availableCapital / netSCR
	}

	status := "breach"
	if solvencyRatio >= 2.0 {
		status = "strong"
	} else if solvencyRatio >= 1.5 {
		status = "adequate"
	} else if solvencyRatio >= 1.0 {
		status = "warning"
	}

	return SCRResult{
		MarketRisk: math.Round(marketRisk*100) / 100,
		InsuranceRisk: math.Round(insuranceRisk*100) / 100,
		CreditRisk: math.Round(creditRisk*100) / 100,
		OperationalRisk: math.Round(operationalRisk*100) / 100,
		GrossSCR: math.Round(grossSCR*100) / 100,
		DiversificationBenefit: math.Round(diversification*100) / 100,
		NetSCR: math.Round(netSCR*100) / 100,
		AvailableCapital: math.Round(availableCapital*100) / 100,
		SolvencyRatio: math.Round(solvencyRatio*10000) / 10000,
		MeetsMinimum: availableCapital >= minimumCapital,
		MinimumCapital: minimumCapital,
		Status: status,
	}
}

// Statutory Return types per NAICOM Operational Guidelines
type StatutoryReturn struct {
	ReturnType    string `json:"return_type"` // annual_return, quarterly_return, monthly_premium
	Period        string `json:"period"`
	DueDate       string `json:"due_date"`
	Status        string `json:"status"`
}

func getStatutoryReturnsDue(currentDate time.Time) []StatutoryReturn {
	year := currentDate.Year()
	month := currentDate.Month()
	returns := []StatutoryReturn{}

	// Annual returns - due by March 31 (NAICOM Section 30)
	returns = append(returns, StatutoryReturn{
		ReturnType: "annual_financial_statement",
		Period:     fmt.Sprintf("%d", year-1),
		DueDate:    fmt.Sprintf("%d-03-31", year),
		Status:     "pending",
	})
	// Quarterly solvency margin report
	quarter := (int(month)-1)/3 + 1
	returns = append(returns, StatutoryReturn{
		ReturnType: "quarterly_solvency_margin",
		Period:     fmt.Sprintf("%d-Q%d", year, quarter),
		DueDate:    fmt.Sprintf("%d-%02d-30", year, quarter*3+1),
		Status:     "pending",
	})
	// Monthly premium income report (due 15th of following month)
	returns = append(returns, StatutoryReturn{
		ReturnType: "monthly_premium_income",
		Period:     fmt.Sprintf("%d-%02d", year, month),
		DueDate:    fmt.Sprintf("%d-%02d-15", year, int(month)+1),
		Status:     "pending",
	})
	// Investment returns (quarterly)
	returns = append(returns, StatutoryReturn{
		ReturnType: "quarterly_investment_return",
		Period:     fmt.Sprintf("%d-Q%d", year, quarter),
		DueDate:    fmt.Sprintf("%d-%02d-30", year, quarter*3+1),
		Status:     "pending",
	})
	return returns
}

// Commission cap enforcement (NAICOM Guidelines on Insurance Distribution)
type CommissionValidation struct {
	ProductClass    string  `json:"product_class"`
	CommissionRate  float64 `json:"commission_rate"`
	MaxAllowed      float64 `json:"max_allowed"`
	IsCompliant     bool    `json:"is_compliant"`
	Violation       string  `json:"violation,omitempty"`
}

func validateCommissionCap(productClass string, commissionRate float64) CommissionValidation {
	// NAICOM maximum commission rates
	caps := map[string]float64{
		"motor":           0.15, // 15% max
		"fire":            0.20, // 20% max
		"marine":          0.175, // 17.5% max
		"general_accident": 0.20,
		"engineering":     0.20,
		"life_individual": 0.40, // 40% first year, 7.5% renewal
		"life_group":      0.125, // 12.5% max
		"oil_gas":         0.125,
		"aviation":        0.10,
	}

	maxAllowed := caps[productClass]
	if maxAllowed == 0 {
		maxAllowed = 0.20 // default 20%
	}

	result := CommissionValidation{
		ProductClass:   productClass,
		CommissionRate: commissionRate,
		MaxAllowed:     maxAllowed,
		IsCompliant:    commissionRate <= maxAllowed,
	}
	if !result.IsCompliant {
		result.Violation = fmt.Sprintf("Commission %.1f%% exceeds NAICOM cap of %.1f%% for %s", commissionRate*100, maxAllowed*100, productClass)
	}
	return result
}

func handleCalculateSCR(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var input SCRInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	result := calculateSCR(input)
	// Persist to DB
	if db != nil {
		data, _ := json.Marshal(result)
		db.Exec("INSERT INTO naicom_filings (filing_type, period, status, data, filed_by) VALUES ($1, $2, $3, $4, $5)",
			"scr_calculation", time.Now().Format("2006-Q1"), "calculated", string(data), "system")
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleStatutoryReturns(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	returns := getStatutoryReturnsDue(time.Now())
	json.NewEncoder(w).Encode(map[string]interface{}{
		"returns_due": returns,
		"generated_at": time.Now().Format(time.RFC3339),
	})
}

func handleValidateCommission(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ProductClass   string  `json:"product_class"`
		CommissionRate float64 `json:"commission_rate"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	result := validateCommissionCap(req.ProductClass, req.CommissionRate)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8091"
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
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS naicom_filings (id SERIAL PRIMARY KEY, filing_type VARCHAR(64) NOT NULL, period VARCHAR(16) NOT NULL, status VARCHAR(32) DEFAULT 'draft', data JSONB NOT NULL, submitted_at TIMESTAMP, accepted_at TIMESTAMP, rejection_reason TEXT, filed_by VARCHAR(128), created_at TIMESTAMP DEFAULT NOW())`)
	if err != nil {
		jsonLog("warn", "migration error", "error", err.Error())
	}

	rl := newRateLimiter(100, time.Minute)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/ready", handleReady)
	mux.HandleFunc("/live", handleLive)
	mux.HandleFunc("/stats", handleStats)
	mux.HandleFunc("/metrics", handlePrometheusMetrics)

	// Domain CRUD routes
	mux.HandleFunc("/api/v1/filings", handleList)
	mux.HandleFunc("/api/v1/filing", handleGetByID)
	mux.HandleFunc("/api/v1/filings/create", handleCreate)
	mux.HandleFunc("/api/v1/filings/delete", handleDelete)

	// Domain business logic routes
	mux.HandleFunc("/api/v1/scr/calculate", handleCalculateSCR)
	mux.HandleFunc("/api/v1/statutory-returns", handleStatutoryReturns)
	mux.HandleFunc("/api/v1/commission/validate", handleValidateCommission)

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

	log.Printf("Naicom Compliance Module starting on :%s", port)
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
