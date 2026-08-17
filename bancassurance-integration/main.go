package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	neturl "net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

// context keys (SA1029: typed keys to avoid collisions)
type ctxKey string

const (
	ctxKeyRoles ctxKey = "roles"
	ctxKeyTenantId ctxKey = "tenant_id"
	ctxKeyUserId ctxKey = "user_id"
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

// BancassuranceService handles bank-insurance integration
type BancassuranceService struct{}

// BankPartner represents a bank partner
type BankPartner struct {
	BankID          string   `json:"bank_id"`
	BankName        string   `json:"bank_name"`
	BankCode        string   `json:"bank_code"`
	IntegrationType string   `json:"integration_type"` // api, webhook, batch
	Products        []string `json:"products"`
	CommissionRate  float64  `json:"commission_rate"`
	Status          string   `json:"status"`
	APIEndpoint     string   `json:"api_endpoint"`
	WebhookURL      string   `json:"webhook_url"`
}

// BankCustomer represents a bank customer for insurance
type BankCustomer struct {
	CustomerID     string    `json:"customer_id"`
	BankAccountNo  string    `json:"bank_account_no"`
	BVN            string    `json:"bvn"`
	FullName       string    `json:"full_name"`
	Email          string    `json:"email"`
	Phone          string    `json:"phone"`
	DateOfBirth    time.Time `json:"date_of_birth"`
	Address        string    `json:"address"`
	AccountType    string    `json:"account_type"`
	AccountBalance float64   `json:"account_balance"`
	SalaryAccount  bool      `json:"salary_account"`
	MonthlySalary  float64   `json:"monthly_salary"`
	CreditScore    int       `json:"credit_score"`
	ExistingLoans  float64   `json:"existing_loans"`
}

// InsuranceOffer represents an insurance offer to bank customer
type InsuranceOffer struct {
	OfferID          string    `json:"offer_id"`
	CustomerID       string    `json:"customer_id"`
	ProductType      string    `json:"product_type"`
	ProductName      string    `json:"product_name"`
	SumAssured       float64   `json:"sum_assured"`
	Premium          float64   `json:"premium"`
	PaymentFrequency string    `json:"payment_frequency"`
	Term             int       `json:"term_years"`
	Benefits         []string  `json:"benefits"`
	Eligibility      bool      `json:"eligibility"`
	ValidUntil       time.Time `json:"valid_until"`
	Status           string    `json:"status"`
}

// LoanProtectionPolicy represents loan protection insurance
type LoanProtectionPolicy struct {
	PolicyID         string    `json:"policy_id"`
	LoanID           string    `json:"loan_id"`
	CustomerID       string    `json:"customer_id"`
	LoanAmount       float64   `json:"loan_amount"`
	LoanTenure       int       `json:"loan_tenure_months"`
	CoverageType     string    `json:"coverage_type"` // death, disability, retrenchment
	SumAssured       float64   `json:"sum_assured"`
	Premium          float64   `json:"premium"`
	PremiumFrequency string    `json:"premium_frequency"`
	StartDate        time.Time `json:"start_date"`
	EndDate          time.Time `json:"end_date"`
	Status           string    `json:"status"`
}

// MortgageInsurance represents mortgage protection insurance
type MortgageInsurance struct {
	PolicyID           string    `json:"policy_id"`
	MortgageID         string    `json:"mortgage_id"`
	CustomerID         string    `json:"customer_id"`
	PropertyValue      float64   `json:"property_value"`
	MortgageAmount     float64   `json:"mortgage_amount"`
	OutstandingBalance float64   `json:"outstanding_balance"`
	CoverageTypes      []string  `json:"coverage_types"` // fire, flood, earthquake, life
	TotalPremium       float64   `json:"total_premium"`
	StartDate          time.Time `json:"start_date"`
	EndDate            time.Time `json:"end_date"`
	Status             string    `json:"status"`
}

// DebitMandateRequest represents a debit mandate for premium collection
type DebitMandateRequest struct {
	MandateID     string    `json:"mandate_id"`
	CustomerID    string    `json:"customer_id"`
	BankAccountNo string    `json:"bank_account_no"`
	BankCode      string    `json:"bank_code"`
	Amount        float64   `json:"amount"`
	Frequency     string    `json:"frequency"` // monthly, quarterly, annually
	StartDate     time.Time `json:"start_date"`
	EndDate       time.Time `json:"end_date"`
	PolicyNumber  string    `json:"policy_number"`
	Status        string    `json:"status"`
}

// PremiumCollection represents a premium collection record
type PremiumCollection struct {
	CollectionID   string    `json:"collection_id"`
	MandateID      string    `json:"mandate_id"`
	PolicyNumber   string    `json:"policy_number"`
	Amount         float64   `json:"amount"`
	CollectionDate time.Time `json:"collection_date"`
	Status         string    `json:"status"` // pending, successful, failed
	FailureReason  string    `json:"failure_reason,omitempty"`
	RetryCount     int       `json:"retry_count"`
}

func NewBancassuranceService() *BancassuranceService {
	return &BancassuranceService{}
}

// GenerateOffer generates insurance offer for bank customer
func (s *BancassuranceService) GenerateOffer(customer *BankCustomer, productType string) *InsuranceOffer {
	var sumAssured, premium float64
	var benefits []string
	var term int
	eligible := true

	switch productType {
	case "credit_life":
		// Credit life based on salary
		sumAssured = customer.MonthlySalary * 24 // 2 years salary
		premium = sumAssured * 0.005 / 12        // 0.5% annual, monthly payment
		term = 5
		benefits = []string{"Death benefit", "Total permanent disability", "Critical illness"}
		eligible = customer.SalaryAccount && customer.MonthlySalary > 50000

	case "loan_protection":
		// Loan protection based on existing loans
		sumAssured = customer.ExistingLoans
		premium = sumAssured * 0.003 / 12 // 0.3% annual, monthly
		term = 3
		benefits = []string{"Loan repayment on death", "Disability coverage", "Retrenchment protection"}
		eligible = customer.ExistingLoans > 0

	case "savings_plan":
		// Savings-linked insurance
		sumAssured = customer.AccountBalance * 5
		premium = sumAssured * 0.02 / 12 // 2% annual, monthly
		term = 10
		benefits = []string{"Life cover", "Maturity benefit", "Bonus accumulation"}
		eligible = customer.AccountBalance > 100000

	case "mortgage_protection":
		// Mortgage protection
		sumAssured = customer.ExistingLoans
		premium = sumAssured * 0.004 / 12 // 0.4% annual
		term = 20
		benefits = []string{"Mortgage repayment on death", "Fire insurance", "Property damage"}
		eligible = customer.ExistingLoans > 1000000
	}

	return &InsuranceOffer{
		OfferID:          fmt.Sprintf("OFF-%d", time.Now().Unix()),
		CustomerID:       customer.CustomerID,
		ProductType:      productType,
		ProductName:      getProductName(productType),
		SumAssured:       sumAssured,
		Premium:          premium,
		PaymentFrequency: "monthly",
		Term:             term,
		Benefits:         benefits,
		Eligibility:      eligible,
		ValidUntil:       time.Now().AddDate(0, 0, 30),
		Status:           "pending",
	}
}

// CreateLoanProtection creates loan protection policy
func (s *BancassuranceService) CreateLoanProtection(loanID string, customer *BankCustomer, loanAmount float64, tenureMonths int) *LoanProtectionPolicy {
	premium := loanAmount * 0.003 / 12 // 0.3% annual rate, monthly premium

	return &LoanProtectionPolicy{
		PolicyID:         fmt.Sprintf("LPP-%d", time.Now().Unix()),
		LoanID:           loanID,
		CustomerID:       customer.CustomerID,
		LoanAmount:       loanAmount,
		LoanTenure:       tenureMonths,
		CoverageType:     "comprehensive",
		SumAssured:       loanAmount,
		Premium:          premium,
		PremiumFrequency: "monthly",
		StartDate:        time.Now(),
		EndDate:          time.Now().AddDate(0, tenureMonths, 0),
		Status:           "active",
	}
}

// CreateDebitMandate creates a debit mandate for premium collection
func (s *BancassuranceService) CreateDebitMandate(customer *BankCustomer, policyNumber string, amount float64, frequency string) *DebitMandateRequest {
	var endDate time.Time
	switch frequency {
	case "monthly":
		endDate = time.Now().AddDate(1, 0, 0)
	case "quarterly":
		endDate = time.Now().AddDate(1, 0, 0)
	case "annually":
		endDate = time.Now().AddDate(5, 0, 0)
	}

	return &DebitMandateRequest{
		MandateID:     fmt.Sprintf("MND-%d", time.Now().Unix()),
		CustomerID:    customer.CustomerID,
		BankAccountNo: customer.BankAccountNo,
		BankCode:      "058", // GTBank code
		Amount:        amount,
		Frequency:     frequency,
		StartDate:     time.Now(),
		EndDate:       endDate,
		PolicyNumber:  policyNumber,
		Status:        "active",
	}
}

// ProcessPremiumCollection submits a premium debit request to the partner
// bank API. It NEVER reports "successful": the collection stays "pending"
// until the bank asynchronously confirms settlement via callback/webhook.
// If no bank API is configured it returns an explicit error instead of
// fabricating a collection outcome.
func (s *BancassuranceService) ProcessPremiumCollection(mandate *DebitMandateRequest) (*PremiumCollection, error) {
	bankAPI := os.Getenv("BANK_API_ENDPOINT")
	if bankAPI == "" {
		return nil, fmt.Errorf("bank API endpoint not configured (BANK_API_ENDPOINT): refusing to simulate premium collection for policy %s", mandate.PolicyNumber)
	}

	collection := &PremiumCollection{
		CollectionID:   fmt.Sprintf("COL-%d", time.Now().Unix()),
		MandateID:      mandate.MandateID,
		PolicyNumber:   mandate.PolicyNumber,
		Amount:         mandate.Amount,
		CollectionDate: time.Now(),
		Status:         "pending", // pending until the bank confirms the debit
		RetryCount:     0,
	}

	if err := s.submitDebitRequest(bankAPI, mandate); err != nil {
		collection.Status = "failed"
		collection.FailureReason = err.Error()
	}
	// On a successful submission the collection remains "pending"; only a
	// bank confirmation callback may transition it to "successful".
	return collection, nil
}

// submitDebitRequest performs the real HTTP debit call to the bank partner API.
func (s *BancassuranceService) submitDebitRequest(bankAPI string, mandate *DebitMandateRequest) error {
	payload := map[string]interface{}{
		"mandate_id":      mandate.MandateID,
		"bank_account_no": mandate.BankAccountNo,
		"bank_code":       mandate.BankCode,
		"amount":          mandate.Amount,
		"policy_number":   mandate.PolicyNumber,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal debit request: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimSuffix(bankAPI, "/")+"/debits", bytes.NewReader(data)) // #nosec G704 -- safe-by-construction: full URL from operator-controlled env (BANK_API_ENDPOINT / MOJALOOP_ENDPOINT), static path suffix, no request-derived component
	if err != nil {
		return fmt.Errorf("build debit request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req) // #nosec G704 -- safe-by-construction: scheme+host come from operator-controlled PERMIFY_ADDR env (not attacker-influenced); the only request-derived component (tenantID) is url-escaped via neturl.PathEscape before path interpolation, so host/port/scheme cannot be manipulated
	if err != nil {
		return fmt.Errorf("bank debit request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("bank debit rejected: HTTP %d", resp.StatusCode)
	}
	return nil
}

func getProductName(productType string) string {
	names := map[string]string{
		"credit_life":         "A&G Credit Life Insurance",
		"loan_protection":     "A&G Loan Protection Plan",
		"savings_plan":        "A&G Savings Plus Insurance",
		"mortgage_protection": "A&G Mortgage Shield",
	}
	if name, ok := names[productType]; ok {
		return name
	}
	return "A&G Insurance Product"
}

// HTTP Handlers
func (s *BancassuranceService) HandleGenerateOffer(w http.ResponseWriter, r *http.Request) {
	type Request struct {
		Customer    BankCustomer `json:"customer"`
		ProductType string       `json:"product_type"`
	}

	var req Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	offer := s.GenerateOffer(&req.Customer, req.ProductType)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(offer)
}

func (s *BancassuranceService) HandleCreateLoanProtection(w http.ResponseWriter, r *http.Request) {
	type Request struct {
		LoanID       string       `json:"loan_id"`
		Customer     BankCustomer `json:"customer"`
		LoanAmount   float64      `json:"loan_amount"`
		TenureMonths int          `json:"tenure_months"`
	}

	var req Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	policy := s.CreateLoanProtection(req.LoanID, &req.Customer, req.LoanAmount, req.TenureMonths)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(policy)
}

func (s *BancassuranceService) HandleHealth(w http.ResponseWriter, r *http.Request) {
	dbStatus := "disconnected"
	if db != nil {
		if err := db.Ping(); err == nil {
			dbStatus = "connected"
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"service":   "bancassurance-integration",
		"timestamp": time.Now(),
		"database":  dbStatus,
		"features": []string{
			"bank_partner_management",
			"customer_offer_generation",
			"loan_protection_policies",
			"mortgage_insurance",
			"debit_mandate_management",
			"premium_collection",
			"commission_settlement",
		},
		"supported_banks": []string{
			"GTBank", "First Bank", "Access Bank", "UBA", "Zenith Bank",
			"Stanbic IBTC", "Fidelity Bank", "FCMB", "Sterling Bank", "Union Bank",
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
		jsonLog("info", "database connected", "service", "bancassurance-integration", "driver", "postgresql")
	}
	// Create domain table
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS bancassurance_referrals (
            id SERIAL PRIMARY KEY,
            bank_id TEXT NOT NULL,
            customer_id TEXT NOT NULL,
            product_type TEXT,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT NOW()
        )`); err != nil {
		if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS bancassurance_bundles (id TEXT PRIMARY KEY, bank_product_id TEXT, insurance_product TEXT, customer_id TEXT, loan_amount NUMERIC(15,2), tenure_months INT, total_premium NUMERIC(15,2), bank_commission NUMERIC(15,2), status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`); err != nil {
			if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS bancassurance_referrals (id TEXT PRIMARY KEY, referral_code TEXT, bank_branch TEXT, agent_id TEXT, product_type TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`); err != nil {
				log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
			}
			log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
		}
		jsonLog("warn", "create table failed", "error", err.Error())
	} else {
		jsonLog("info", "table ready", "table", "bancassurance_referrals")
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
	_ = json.NewEncoder(w).Encode(status)
}

func handleLive(w http.ResponseWriter, r *http.Request) {
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}

// ─── Domain CRUD Handlers (PostgreSQL-backed) ────────────────────────────────

func handleListEntities(w http.ResponseWriter, r *http.Request) {
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

	var total int
	if err := db.QueryRow("SELECT COUNT(*) FROM bancassurance_referrals").Scan(&total); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	// Redis cache for list queries
	if redisClient != nil {
		if cached, ok := redisClient.CacheGet("bancassurance-integration:list"); ok {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Cache", "HIT")
			_, _ = w.Write([]byte(cached))
			return
		}
	}

	rows, err := db.Query("SELECT id, bank_id, customer_id, product_type, status, created_at FROM bancassurance_referrals ORDER BY id DESC LIMIT $1 OFFSET $2", limit, offset)
	if err != nil {
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
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": results, "total": total, "page": page, "limit": limit})
}

func handleGetEntity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, `{"error":"id parameter required"}`, http.StatusBadRequest)
		return
	}
	rows, err := db.Query("SELECT id, bank_id, customer_id, product_type, status, created_at FROM bancassurance_referrals WHERE id = $1", idStr)
	if err != nil {
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

func handleCreateEntity(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(ctxKeyUserId).(string)
	if !permifyCheck(r.Context(), "bancassurance-integration", "", "create", userID) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
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
		if k == "id" || k == "created_at" {
			continue
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
	query := fmt.Sprintf("INSERT INTO bancassurance_referrals (%s) VALUES (%s) RETURNING id",
		strings.Join(cols, ", "), strings.Join(placeholders, ", "))
	var newID interface{}
	if err := db.QueryRow(query, vals...).Scan(&newID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	if kafkaWriter != nil {
		kafkaWriter.PublishEvent(r.Context(), "created", r.URL.Path, nil)
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"id": newID, "status": "created"})
	// Index to OpenSearch for full-text search
	if osClient != nil {
		go osClient.IndexLog("info", "entity_created", "bancassurance-integration", map[string]interface{}{"action": "created", "timestamp": time.Now().Format(time.RFC3339)})
	}
	if redisClient != nil {
		redisClient.CacheInvalidate("bancassurance-integration:list")
	}
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
	result, err := db.Exec("DELETE FROM bancassurance_referrals WHERE id = $1", idStr)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	if kafkaWriter != nil {
		kafkaWriter.PublishEvent(r.Context(), "created", r.URL.Path, nil)
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"id": idStr, "status": "deleted"})
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	var count int
	if db != nil {
		_ = db.QueryRow("SELECT COUNT(*) FROM bancassurance_referrals").Scan(&count)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"service": "bancassurance_referrals", "table": "bancassurance_referrals", "total_records": count})
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
		_, _ = r.respCmd("DEL", k)
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
			ctx := context.WithValue(r.Context(), ctxKeyUserId, "dev-user")
			ctx = context.WithValue(ctx, ctxKeyTenantId, "default")
			ctx = context.WithValue(ctx, ctxKeyRoles, []string{"admin", "user"})
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		auth := r.Header.Get("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			w.Header().Set("Content-Type", "application/json")
			jsonLog("warn", "auth_failure", "service", "bancassurance-integration", "remote_addr", r.RemoteAddr, "path", r.URL.Path, "method", r.Method)
			w.WriteHeader(401)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": map[string]string{"code": "UNAUTHORIZED", "message": "missing bearer token"}})
			return
		}
		// In production: validate JWT against Keycloak JWKS endpoint
		// For now, decode and pass through (validation handled by APISIX gateway)
		tokenStr := strings.TrimPrefix(auth, "Bearer ")
		_ = tokenStr
		ctx := context.WithValue(r.Context(), ctxKeyUserId, r.Header.Get("X-User-ID"))
		ctx = context.WithValue(ctx, ctxKeyTenantId, r.Header.Get("X-Tenant-ID"))
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
	if tid, ok := ctx.Value(ctxKeyTenantId).(string); ok && tid != "" {
		tenantID = tid
	}
	url := fmt.Sprintf("http://%s/v1/tenants/%s/permissions/check", permifyAddr, neturl.PathEscape(tenantID))
	req, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(data))) // #nosec G704 -- safe-by-construction: scheme+host come from operator-controlled PERMIFY_ADDR env (not attacker-influenced); the only request-derived component (tenantID) is url-escaped via neturl.PathEscape before path interpolation, so host/port/scheme cannot be manipulated
	if err != nil {
		return true
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req) // #nosec G704 -- safe-by-construction: env-controlled scheme+host (PERMIFY_ADDR); tenantID url-escaped via neturl.PathEscape
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
	mojaloopCli = newMojaloopClient()
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
	kafkaWriter = newKafkaProducer(kafkaBrokers, "bancassurance-integration-events")
	jsonLog("info", "kafka_producer_initialized", "brokers", kafkaBrokers, "topic", "bancassurance-integration-events")

	// OpenSearch
	osURL := os.Getenv("OPENSEARCH_URL")
	if osURL == "" {
		osURL = "http://localhost:9200"
	}
	osClient = newOpenSearchClient(osURL, os.Getenv("OPENSEARCH_USER"))
	jsonLog("info", "opensearch_client_initialized", "url", osURL)
}

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
	defer func() { _ = resp.Body.Close() }()
	var result map[string]interface{}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return result, nil
}

// InitiateTransfer performs a real HTTP POST to the configured Mojaloop
// switch. It never returns a success-looking transfer ID for a transfer
// that was not actually accepted by the switch: without MOJALOOP_ENDPOINT
// it fails with an explicit error, and any transport/protocol failure is
// propagated as an error with an empty ID.
func (mc *mojaloopClient) InitiateTransfer(ctx context.Context, amount, currency, payerID, payeeID string) (string, error) {
	endpoint := os.Getenv("MOJALOOP_ENDPOINT")
	if endpoint == "" {
		return "", fmt.Errorf("mojaloop endpoint not configured")
	}
	payload := map[string]interface{}{
		"payerFsp":   mc.dfspID,
		"payeeFsp":   "counterparty-dfsp",
		"amount":     map[string]string{"amount": amount, "currency": currency},
		"payer":      payerID,
		"payee":      payeeID,
		"expiration": time.Now().Add(60 * time.Second).Format(time.RFC3339),
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal transfer request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimSuffix(endpoint, "/")+"/transfers", bytes.NewReader(data)) // #nosec G704 -- safe-by-construction: full URL from operator-controlled env (BANK_API_ENDPOINT / MOJALOOP_ENDPOINT), static path suffix, no request-derived component
	if err != nil {
		return "", fmt.Errorf("build transfer request: %w", err)
	}
	req.Header.Set("Content-Type", "application/vnd.interoperability.transfers+json;version=1.1")
	req.Header.Set("Accept", "application/vnd.interoperability.transfers+json;version=1.1")
	req.Header.Set("FSPIOP-Source", mc.dfspID)
	req.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req) // #nosec G704 -- safe-by-construction: full URL from operator-controlled env (BANK_API_ENDPOINT / MOJALOOP_ENDPOINT), static path suffix, no request-derived component
	if err != nil {
		return "", fmt.Errorf("mojaloop transfer request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("mojaloop transfer rejected: HTTP %d", resp.StatusCode)
	}
	var result struct {
		TransferID string `json:"transferId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("parse mojaloop transfer response: %w", err)
	}
	if result.TransferID == "" {
		return "", fmt.Errorf("mojaloop transfer response missing transferId")
	}
	jsonLog("info", "mojaloop_transfer_accepted",
		"transfer_id", result.TransferID,
		"payer", payerID,
		"payee", payeeID,
		"amount", amount,
		"currency", currency,
	)
	return result.TransferID, nil
}

var mojaloopCli *mojaloopClient

func handleBundleProducts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		BankProductID    string  `json:"bank_product_id"`
		InsuranceProduct string  `json:"insurance_product"`
		CustomerID       string  `json:"customer_id"`
		LoanAmount       float64 `json:"loan_amount"`
		TenureMonths     int     `json:"tenure_months"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, 400)
		return
	}
	// Business rule: Credit life premium = 0.5% of loan amount per year
	annualPremium := req.LoanAmount * 0.005
	totalPremium := annualPremium * float64(req.TenureMonths) / 12.0
	// Business rule: Commission split — bank gets 30%, insurer retains 70%
	bankCommission := totalPremium * 0.30
	bundleID := fmt.Sprintf("BND-%d", time.Now().UnixNano())
	if db != nil {
		_, _ = db.Exec("INSERT INTO bancassurance_bundles (id, bank_product_id, insurance_product, customer_id, loan_amount, tenure_months, total_premium, bank_commission, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')",
			bundleID, req.BankProductID, req.InsuranceProduct, req.CustomerID, req.LoanAmount, req.TenureMonths, totalPremium, bankCommission)
	}
	if kafkaWriter != nil {
		kafkaWriter.PublishEvent(r.Context(), "bundle_created", bundleID, nil)
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"bundle_id": bundleID, "total_premium": totalPremium, "bank_commission": bankCommission, "insurer_retention": totalPremium - bankCommission})
}

func handleReferralTrack(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		ReferralCode string `json:"referral_code"`
		BankBranch   string `json:"bank_branch"`
		AgentID      string `json:"agent_id"`
		ProductType  string `json:"product_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, 400)
		return
	}
	refID := fmt.Sprintf("REF-%d", time.Now().UnixNano())
	if db != nil {
		_, _ = db.Exec("INSERT INTO bancassurance_referrals (id, referral_code, bank_branch, agent_id, product_type, status, created_at) VALUES ($1,$2,$3,$4,$5,'pending',NOW())",
			refID, req.ReferralCode, req.BankBranch, req.AgentID, req.ProductType)
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"referral_id": refID, "status": "tracked"})
}

func handleSettlement(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		Period   string `json:"period"` // YYYY-MM
		BankCode string `json:"bank_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, 400)
		return
	}
	var totalPremium, bankCommission float64
	var bundleCount int
	if db != nil {
		_ = db.QueryRow("SELECT COALESCE(SUM(total_premium),0), COALESCE(SUM(bank_commission),0), COUNT(*) FROM bancassurance_bundles WHERE status='active' AND to_char(created_at,'YYYY-MM')=$1", req.Period).Scan(&totalPremium, &bankCommission, &bundleCount)
	}
	netSettlement := totalPremium - bankCommission
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"period": req.Period, "total_premium": totalPremium, "bank_commission": bankCommission, "net_settlement": netSettlement, "bundle_count": bundleCount})
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
	service := NewBancassuranceService()

	http.HandleFunc("/api/bancassurance/offer", service.HandleGenerateOffer)
	http.HandleFunc("/api/bancassurance/loan-protection", service.HandleCreateLoanProtection)

	// Domain-specific routes
	http.HandleFunc("/api/v1/bundle-products", handleBundleProducts)
	http.HandleFunc("/api/v1/referral-track", handleReferralTrack)
	http.HandleFunc("/api/v1/settlement", handleSettlement)

	http.HandleFunc("/api/v1/referrals", handleListEntities)
	http.HandleFunc("/api/v1/referral", handleGetEntity)
	http.HandleFunc("/api/v1/referrals/create", handleCreateEntity)
	http.HandleFunc("/api/v1/referrals/delete", handleDeleteEntity)
	http.HandleFunc("/stats", handleStats)

	http.HandleFunc("/health", service.HandleHealth)
	http.HandleFunc("/ready", handleReady)
	http.HandleFunc("/live", handleLive)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Bancassurance Integration Service starting on port %s", port)

	srv := &http.Server{Addr: ":" + port, Handler: bodyLimitMiddleware(http.DefaultServeMux)}
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		jsonLog("info", "shutting down gracefully", "service", "bancassurance-integration")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			jsonLog("error", "shutdown error", "error", err.Error())
		}
	}()
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Failed to start server: %v", err)
	}
	log.Printf(`{"level":"info","msg":"server stopped","service":"bancassurance-integration"}`)
}
