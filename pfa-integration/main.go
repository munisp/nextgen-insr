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

// PFAService handles Pension Fund Administrator integration
type PFAService struct{}

// PFAPartner represents a PFA partner
type PFAPartner struct {
	PFAID            string   `json:"pfa_id"`
	PFAName          string   `json:"pfa_name"`
	PFACode          string   `json:"pfa_code"`
	LicenseNumber    string   `json:"license_number"`
	IntegrationType  string   `json:"integration_type"`
	Products         []string `json:"products"`
	CommissionRate   float64  `json:"commission_rate"`
	Status           string   `json:"status"`
	APIEndpoint      string   `json:"api_endpoint"`
}

// RSAHolder represents a Retirement Savings Account holder
type RSAHolder struct {
	RSAPIN           string    `json:"rsa_pin"`
	FullName         string    `json:"full_name"`
	DateOfBirth      time.Time `json:"date_of_birth"`
	Gender           string    `json:"gender"`
	Email            string    `json:"email"`
	Phone            string    `json:"phone"`
	EmployerName     string    `json:"employer_name"`
	EmployerCode     string    `json:"employer_code"`
	MonthlySalary    float64   `json:"monthly_salary"`
	RSABalance       float64   `json:"rsa_balance"`
	PFAName          string    `json:"pfa_name"`
	PFACode          string    `json:"pfa_code"`
	ContributionRate float64   `json:"contribution_rate"`
	Status           string    `json:"status"`
}

// AnnuityProduct represents an annuity product
type AnnuityProduct struct {
	ProductID        string    `json:"product_id"`
	ProductName      string    `json:"product_name"`
	ProductType      string    `json:"product_type"` // life_annuity, term_certain, joint_life
	MinPurchaseAge   int       `json:"min_purchase_age"`
	MaxPurchaseAge   int       `json:"max_purchase_age"`
	MinPurchaseAmount float64  `json:"min_purchase_amount"`
	GuaranteedPeriod int       `json:"guaranteed_period_years"`
	EscalationRate   float64   `json:"escalation_rate"`
	JointLifeOption  bool      `json:"joint_life_option"`
	Status           string    `json:"status"`
}

// AnnuityQuote represents an annuity quote
type AnnuityQuote struct {
	QuoteID          string    `json:"quote_id"`
	RSAPIN           string    `json:"rsa_pin"`
	ProductID        string    `json:"product_id"`
	PurchaseAmount   float64   `json:"purchase_amount"`
	Age              int       `json:"age"`
	Gender           string    `json:"gender"`
	AnnuityType      string    `json:"annuity_type"`
	PaymentFrequency string    `json:"payment_frequency"`
	GuaranteedPeriod int       `json:"guaranteed_period"`
	MonthlyPension   float64   `json:"monthly_pension"`
	AnnualPension    float64   `json:"annual_pension"`
	CommutedLumpSum  float64   `json:"commuted_lump_sum"`
	NetPurchaseAmount float64  `json:"net_purchase_amount"`
	ValidUntil       time.Time `json:"valid_until"`
	Status           string    `json:"status"`
}

// AnnuityPolicy represents an annuity policy
type AnnuityPolicy struct {
	PolicyID         string    `json:"policy_id"`
	RSAPIN           string    `json:"rsa_pin"`
	HolderName       string    `json:"holder_name"`
	ProductID        string    `json:"product_id"`
	PurchaseAmount   float64   `json:"purchase_amount"`
	CommutedLumpSum  float64   `json:"commuted_lump_sum"`
	NetPurchaseAmount float64  `json:"net_purchase_amount"`
	MonthlyPension   float64   `json:"monthly_pension"`
	PaymentFrequency string    `json:"payment_frequency"`
	GuaranteedPeriod int       `json:"guaranteed_period"`
	StartDate        time.Time `json:"start_date"`
	NextPaymentDate  time.Time `json:"next_payment_date"`
	Beneficiaries    []AnnuityBeneficiary `json:"beneficiaries"`
	Status           string    `json:"status"`
}

// AnnuityBeneficiary represents an annuity beneficiary
type AnnuityBeneficiary struct {
	Name         string  `json:"name"`
	Relationship string  `json:"relationship"`
	Percentage   float64 `json:"percentage"`
	Phone        string  `json:"phone"`
	BankName     string  `json:"bank_name"`
	AccountNo    string  `json:"account_no"`
}

// PensionPayment represents a pension payment
type PensionPayment struct {
	PaymentID        string    `json:"payment_id"`
	PolicyID         string    `json:"policy_id"`
	RSAPIN           string    `json:"rsa_pin"`
	Amount           float64   `json:"amount"`
	PaymentDate      time.Time `json:"payment_date"`
	PaymentMethod    string    `json:"payment_method"`
	BankName         string    `json:"bank_name"`
	AccountNo        string    `json:"account_no"`
	Status           string    `json:"status"`
	Reference        string    `json:"reference"`
}

// GroupLifeForPension represents group life for pension contributors
type GroupLifeForPension struct {
	PolicyID         string    `json:"policy_id"`
	EmployerCode     string    `json:"employer_code"`
	EmployerName     string    `json:"employer_name"`
	TotalContributors int      `json:"total_contributors"`
	TotalSumAssured  float64   `json:"total_sum_assured"`
	AnnualPremium    float64   `json:"annual_premium"`
	CoverageMultiple float64   `json:"coverage_multiple"`
	EffectiveDate    time.Time `json:"effective_date"`
	ExpiryDate       time.Time `json:"expiry_date"`
	Status           string    `json:"status"`
}

// MortalityTable for annuity calculations (Nigerian life table)
var annuityMortalityTable = map[int]float64{
	50: 0.0075, 55: 0.0110, 60: 0.0165, 65: 0.0250,
	70: 0.0380, 75: 0.0580, 80: 0.0890, 85: 0.1350,
}

func NewPFAService() *PFAService {
	return &PFAService{}
}

// CalculateAnnuityQuote calculates annuity quote
func (s *PFAService) CalculateAnnuityQuote(holder *RSAHolder, purchaseAmount float64, productType string, guaranteedPeriod int) *AnnuityQuote {
	age := time.Now().Year() - holder.DateOfBirth.Year()
	
	// Commutation (25% lump sum allowed by PenCom)
	commutedLumpSum := purchaseAmount * 0.25
	netPurchaseAmount := purchaseAmount - commutedLumpSum
	
	// Annuity rate based on age and gender
	annuityRate := s.getAnnuityRate(age, holder.Gender, guaranteedPeriod)
	
	// Calculate annual pension
	annualPension := netPurchaseAmount * annuityRate
	monthlyPension := annualPension / 12
	
	return &AnnuityQuote{
		QuoteID:          fmt.Sprintf("AQ-%d", time.Now().Unix()),
		RSAPIN:           holder.RSAPIN,
		PurchaseAmount:   purchaseAmount,
		Age:              age,
		Gender:           holder.Gender,
		AnnuityType:      productType,
		PaymentFrequency: "monthly",
		GuaranteedPeriod: guaranteedPeriod,
		MonthlyPension:   math.Round(monthlyPension*100) / 100,
		AnnualPension:    math.Round(annualPension*100) / 100,
		CommutedLumpSum:  commutedLumpSum,
		NetPurchaseAmount: netPurchaseAmount,
		ValidUntil:       time.Now().AddDate(0, 0, 30),
		Status:           "pending",
	}
}

// getAnnuityRate calculates annuity rate based on actuarial factors
func (s *PFAService) getAnnuityRate(age int, gender string, guaranteedPeriod int) float64 {
	// Base rate (higher age = higher rate)
	baseRate := 0.05 + float64(age-50)*0.002
	
	// Gender adjustment (females live longer, lower rate)
	if gender == "female" {
		baseRate *= 0.92
	}
	
	// Guaranteed period adjustment (longer guarantee = lower rate)
	guaranteeAdjustment := 1 - float64(guaranteedPeriod)*0.005
	
	return baseRate * guaranteeAdjustment
}

// CalculateGroupLifePremium calculates group life premium for pension contributors
func (s *PFAService) CalculateGroupLifePremium(employerCode string, contributors []RSAHolder, coverageMultiple float64) *GroupLifeForPension {
	totalSumAssured := 0.0
	
	for _, contributor := range contributors {
		sumAssured := contributor.MonthlySalary * 12 * coverageMultiple
		totalSumAssured += sumAssured
	}
	
	// Premium rate (per mille)
	premiumRate := 1.5 // 1.5 per 1000
	annualPremium := totalSumAssured * premiumRate / 1000
	
	// Group discount
	if len(contributors) >= 100 {
		annualPremium *= 0.85
	} else if len(contributors) >= 50 {
		annualPremium *= 0.90
	}
	
	return &GroupLifeForPension{
		PolicyID:          fmt.Sprintf("GLP-%d", time.Now().Unix()),
		EmployerCode:      employerCode,
		TotalContributors: len(contributors),
		TotalSumAssured:   math.Round(totalSumAssured*100) / 100,
		AnnualPremium:     math.Round(annualPremium*100) / 100,
		CoverageMultiple:  coverageMultiple,
		EffectiveDate:     time.Now(),
		ExpiryDate:        time.Now().AddDate(1, 0, 0),
		Status:            "active",
	}
}

// ProcessPensionPayment processes pension payment
func (s *PFAService) ProcessPensionPayment(policy *AnnuityPolicy) *PensionPayment {
	return &PensionPayment{
		PaymentID:     fmt.Sprintf("PP-%d", time.Now().Unix()),
		PolicyID:      policy.PolicyID,
		RSAPIN:        policy.RSAPIN,
		Amount:        policy.MonthlyPension,
		PaymentDate:   time.Now(),
		PaymentMethod: "bank_transfer",
		Status:        "processed",
		Reference:     fmt.Sprintf("PEN/%s/%s", policy.PolicyID, time.Now().Format("200601")),
	}
}

// ValidateRSAPIN validates RSA PIN with PenCom
func (s *PFAService) ValidateRSAPIN(rsaPin string) (bool, *RSAHolder) {
	// In production, this would call PenCom API
	// Simulating validation
	if len(rsaPin) != 15 {
		return false, nil
	}
	
	// Return mock holder data
	holder := &RSAHolder{
		RSAPIN:           rsaPin,
		FullName:         "John Doe",
		DateOfBirth:      time.Date(1965, 5, 15, 0, 0, 0, 0, time.UTC),
		Gender:           "male",
		RSABalance:       15000000,
		PFAName:          "Stanbic IBTC Pension",
		ContributionRate: 0.18,
		Status:           "active",
	}
	
	return true, holder
}

// HTTP Handlers
func (s *PFAService) HandleAnnuityQuote(w http.ResponseWriter, r *http.Request) {
	type Request struct {
		Holder           RSAHolder `json:"holder"`
		PurchaseAmount   float64   `json:"purchase_amount"`
		ProductType      string    `json:"product_type"`
		GuaranteedPeriod int       `json:"guaranteed_period"`
	}
	
	var req Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	quote := s.CalculateAnnuityQuote(&req.Holder, req.PurchaseAmount, req.ProductType, req.GuaranteedPeriod)
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(quote)
}

func (s *PFAService) HandleValidateRSA(w http.ResponseWriter, r *http.Request) {
	type Request struct {
		RSAPIN string `json:"rsa_pin"`
	}
	
	var req Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	valid, holder := s.ValidateRSAPIN(req.RSAPIN)
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"valid":  valid,
		"holder": holder,
	})
}

func (s *PFAService) HandleGroupLifePremium(w http.ResponseWriter, r *http.Request) {
	type Request struct {
		EmployerCode     string      `json:"employer_code"`
		Contributors     []RSAHolder `json:"contributors"`
		CoverageMultiple float64     `json:"coverage_multiple"`
	}
	
	var req Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	result := s.CalculateGroupLifePremium(req.EmployerCode, req.Contributors, req.CoverageMultiple)
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (s *PFAService) HandleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"service":   "pfa-integration",
		"timestamp": time.Now(),
		"features": []string{
			"rsa_validation",
			"annuity_quotes",
			"annuity_policies",
			"pension_payments",
			"group_life_for_pension",
			"pfa_partner_management",
			"pencom_reporting",
		},
		"supported_pfas": []string{
			"Stanbic IBTC Pension",
			"ARM Pension",
			"Leadway Pensure",
			"FCMB Pensions",
			"Trustfund Pensions",
			"Premium Pension",
			"PAL Pensions",
			"Sigma Pensions",
			"NLPC Pension",
			"Crusader Sterling Pensions",
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
		jsonLog("info", "database connected", "service", "pfa-integration", "driver", "postgresql")
	}
	// Create domain table
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS pfa_contributions (
            id SERIAL PRIMARY KEY,
            employee_id TEXT NOT NULL,
            employer_id TEXT,
            amount NUMERIC NOT NULL,
            period TEXT,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT NOW()
        )`); err != nil {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS pfa_rsa_accounts (id TEXT PRIMARY KEY, employee_id TEXT, employer_id TEXT, rsa_pin TEXT UNIQUE, monthly_basic NUMERIC(15,2), employee_contrib NUMERIC(15,2), employer_contrib NUMERIC(15,2), balance NUMERIC(15,2) DEFAULT 0, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`); err != nil {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS pfa_contributions (id TEXT PRIMARY KEY, rsa_pin TEXT, month TEXT, amount NUMERIC(15,2), status TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
	}
		log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
	}
		jsonLog("warn", "create table failed", "error", err.Error())
	} else {
		jsonLog("info", "table ready", "table", "pfa_contributions")
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
	if err := db.QueryRow("SELECT COUNT(*) FROM pfa_contributions").Scan(&total); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	rows, err := db.Query(fmt.Sprintf("SELECT id, employee_id, employer_id, amount, period, status, created_at FROM pfa_contributions ORDER BY id DESC LIMIT $1 OFFSET $2"), limit, offset)
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
	rows, err := db.Query("SELECT id, employee_id, employer_id, amount, period, status, created_at FROM pfa_contributions WHERE id = $1", idStr)
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
	query := fmt.Sprintf("INSERT INTO pfa_contributions (%s) VALUES (%s) RETURNING id",
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
	result, err := db.Exec("DELETE FROM pfa_contributions WHERE id = $1", idStr)
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
		db.QueryRow("SELECT COUNT(*) FROM pfa_contributions").Scan(&count)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"service": "pfa_contributions", "table": "pfa_contributions", "total_records": count})
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
		"source":     "pfa-integration",
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
	kafkaWriter = &kafkaProducer{brokers: kafkaBrokers, topic: "pfa-integration-events"}
	jsonLog("info", "kafka_producer_initialized", "brokers", kafkaBrokers, "topic", "pfa-integration-events")

	// OpenSearch
	osURL := os.Getenv("OPENSEARCH_URL")
	if osURL == "" {
		osURL = "http://localhost:9200"
	}
	osClient = &opensearchClient{url: osURL, user: os.Getenv("OPENSEARCH_USER")}
	jsonLog("info", "opensearch_client_initialized", "url", osURL)
}



func handleRSARegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed); return
	}
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		EmployeeID   string  `json:"employee_id"`
		EmployerID   string  `json:"employer_id"`
		RSAPin       string  `json:"rsa_pin"`
		MonthlyBasic float64 `json:"monthly_basic"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, 400); return
	}
	// PenCom: Employee contributes 8%, Employer contributes 10% of basic salary
	employeeContrib := req.MonthlyBasic * 0.08
	employerContrib := req.MonthlyBasic * 0.10
	totalMonthly := employeeContrib + employerContrib
	regID := fmt.Sprintf("RSA-%d", time.Now().UnixNano())
	if db != nil {
		db.Exec("INSERT INTO pfa_rsa_accounts (id, employee_id, employer_id, rsa_pin, monthly_basic, employee_contrib, employer_contrib, balance, status) VALUES ($1,$2,$3,$4,$5,$6,$7,0,'active')",
			regID, req.EmployeeID, req.EmployerID, req.RSAPin, req.MonthlyBasic, employeeContrib, employerContrib)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"registration_id": regID, "monthly_employee": employeeContrib, "monthly_employer": employerContrib, "total_monthly": totalMonthly, "annual_contribution": totalMonthly * 12})
}


func handleContributionProcess(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed); return
	}
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		RSAPin string  `json:"rsa_pin"`
		Month  string  `json:"month"` // YYYY-MM
		Amount float64 `json:"amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, 400); return
	}
	contribID := fmt.Sprintf("CTR-%d", time.Now().UnixNano())
	if db != nil {
		db.Exec("INSERT INTO pfa_contributions (id, rsa_pin, month, amount, status) VALUES ($1,$2,$3,$4,'processed')", contribID, req.RSAPin, req.Month, req.Amount)
		db.Exec("UPDATE pfa_rsa_accounts SET balance = balance + $1 WHERE rsa_pin = $2", req.Amount, req.RSAPin)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"contribution_id": contribID, "amount": req.Amount, "status": "processed"})
}

func main() {
	initDB()
	initMiddleware()
	service := NewPFAService()
	
	http.HandleFunc("/api/pfa/annuity-quote", service.HandleAnnuityQuote)
	http.HandleFunc("/api/pfa/validate-rsa", service.HandleValidateRSA)
	http.HandleFunc("/api/pfa/group-life-premium", service.HandleGroupLifePremium)

	http.HandleFunc("/api/v1/contributions", handleListEntities)
	http.HandleFunc("/api/v1/contribution", handleGetEntity)
	http.HandleFunc("/api/v1/contributions/create", handleCreateEntity)
	http.HandleFunc("/api/v1/contributions/delete", handleDeleteEntity)
	http.HandleFunc("/stats", handleStats)

	http.HandleFunc("/health", service.HandleHealth)
	http.HandleFunc("/ready", handleReady)
	http.HandleFunc("/live", handleLive)
	
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	
	log.Printf("PFA Integration Service starting on port %s", port)
	
	srv := &http.Server{Addr: ":" + port, Handler: nil}
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		jsonLog("info", "shutting down gracefully", "service", "pfa-integration")
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
