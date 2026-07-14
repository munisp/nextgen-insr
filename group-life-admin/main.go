package main

import (
	"net"
	"encoding/binary"
	"bytes"
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

// GroupLifeService handles group life insurance administration
type GroupLifeService struct{}

// GroupScheme represents a group life insurance scheme
type GroupScheme struct {
	SchemeID         string    `json:"scheme_id"`
	SchemeName       string    `json:"scheme_name"`
	EmployerName     string    `json:"employer_name"`
	EmployerID       string    `json:"employer_id"`
	Industry         string    `json:"industry"`
	SchemeType       string    `json:"scheme_type"` // contributory, non-contributory
	CoverageType     string    `json:"coverage_type"` // death, disability, critical_illness
	MultipleOfSalary float64   `json:"multiple_of_salary"`
	FlatBenefit      float64   `json:"flat_benefit"`
	MaxBenefit       float64   `json:"max_benefit"`
	MinBenefit       float64   `json:"min_benefit"`
	TotalMembers     int       `json:"total_members"`
	TotalSumAssured  float64   `json:"total_sum_assured"`
	AnnualPremium    float64   `json:"annual_premium"`
	EffectiveDate    time.Time `json:"effective_date"`
	RenewalDate      time.Time `json:"renewal_date"`
	Status           string    `json:"status"`
}

// GroupMember represents a member in a group scheme
type GroupMember struct {
	MemberID         string    `json:"member_id"`
	SchemeID         string    `json:"scheme_id"`
	EmployeeID       string    `json:"employee_id"`
	FullName         string    `json:"full_name"`
	DateOfBirth      time.Time `json:"date_of_birth"`
	Gender           string    `json:"gender"`
	JobTitle         string    `json:"job_title"`
	Department       string    `json:"department"`
	DateOfJoining    time.Time `json:"date_of_joining"`
	AnnualSalary     float64   `json:"annual_salary"`
	SumAssured       float64   `json:"sum_assured"`
	Premium          float64   `json:"premium"`
	Beneficiaries    []Beneficiary `json:"beneficiaries"`
	Status           string    `json:"status"` // active, suspended, terminated
	EnrollmentDate   time.Time `json:"enrollment_date"`
}

// Beneficiary represents a beneficiary
type Beneficiary struct {
	Name         string  `json:"name"`
	Relationship string  `json:"relationship"`
	Percentage   float64 `json:"percentage"`
	Phone        string  `json:"phone"`
	Email        string  `json:"email"`
}

// GroupClaim represents a group life claim
type GroupClaim struct {
	ClaimID          string    `json:"claim_id"`
	SchemeID         string    `json:"scheme_id"`
	MemberID         string    `json:"member_id"`
	MemberName       string    `json:"member_name"`
	ClaimType        string    `json:"claim_type"` // death, disability, critical_illness
	ClaimAmount      float64   `json:"claim_amount"`
	DateOfEvent      time.Time `json:"date_of_event"`
	DateOfClaim      time.Time `json:"date_of_claim"`
	Documents        []string  `json:"documents"`
	Beneficiaries    []BeneficiaryPayout `json:"beneficiaries"`
	Status           string    `json:"status"`
	ApprovalDate     time.Time `json:"approval_date,omitempty"`
	PaymentDate      time.Time `json:"payment_date,omitempty"`
}

// BeneficiaryPayout represents payout to a beneficiary
type BeneficiaryPayout struct {
	Name       string  `json:"name"`
	Amount     float64 `json:"amount"`
	BankName   string  `json:"bank_name"`
	AccountNo  string  `json:"account_no"`
	Status     string  `json:"status"`
}

// MemberMovement represents member additions/deletions
type MemberMovement struct {
	MovementID   string    `json:"movement_id"`
	SchemeID     string    `json:"scheme_id"`
	MovementType string    `json:"movement_type"` // addition, deletion, salary_revision
	EffectiveDate time.Time `json:"effective_date"`
	Members      []MemberChange `json:"members"`
	PremiumImpact float64  `json:"premium_impact"`
	Status       string    `json:"status"`
}

// MemberChange represents a change to a member
type MemberChange struct {
	MemberID     string  `json:"member_id"`
	EmployeeID   string  `json:"employee_id"`
	FullName     string  `json:"full_name"`
	OldSalary    float64 `json:"old_salary,omitempty"`
	NewSalary    float64 `json:"new_salary,omitempty"`
	OldSumAssured float64 `json:"old_sum_assured,omitempty"`
	NewSumAssured float64 `json:"new_sum_assured,omitempty"`
	ChangeType   string  `json:"change_type"`
}

// PremiumCalculation represents premium calculation for a group
type PremiumCalculation struct {
	SchemeID         string  `json:"scheme_id"`
	TotalMembers     int     `json:"total_members"`
	TotalSumAssured  float64 `json:"total_sum_assured"`
	AverageAge       float64 `json:"average_age"`
	BaseRate         float64 `json:"base_rate"`
	AgeLoadingFactor float64 `json:"age_loading_factor"`
	IndustryFactor   float64 `json:"industry_factor"`
	GroupDiscount    float64 `json:"group_discount"`
	GrossPremium     float64 `json:"gross_premium"`
	NetPremium       float64 `json:"net_premium"`
}

// RenewalQuote represents a renewal quote
type RenewalQuote struct {
	QuoteID          string    `json:"quote_id"`
	SchemeID         string    `json:"scheme_id"`
	CurrentPremium   float64   `json:"current_premium"`
	ProposedPremium  float64   `json:"proposed_premium"`
	PremiumChange    float64   `json:"premium_change_percent"`
	ClaimsExperience float64   `json:"claims_experience"`
	MemberChanges    int       `json:"member_changes"`
	ValidUntil       time.Time `json:"valid_until"`
	Status           string    `json:"status"`
}

func NewGroupLifeService() *GroupLifeService {
	return &GroupLifeService{}
}

// CalculatePremium calculates group life premium
func (s *GroupLifeService) CalculatePremium(scheme *GroupScheme, members []GroupMember) *PremiumCalculation {
	totalSumAssured := 0.0
	totalAge := 0.0
	
	for _, member := range members {
		totalSumAssured += member.SumAssured
		age := time.Now().Year() - member.DateOfBirth.Year()
		totalAge += float64(age)
	}
	
	averageAge := totalAge / float64(len(members))
	
	// Base rate (per 1000 sum assured)
	baseRate := 1.5 // 1.5 per mille
	
	// Age loading factor
	ageLoadingFactor := 1.0
	if averageAge > 40 {
		ageLoadingFactor = 1 + (averageAge-40)*0.02
	}
	
	// Industry factor
	industryFactors := map[string]float64{
		"banking":       1.0,
		"manufacturing": 1.3,
		"oil_gas":       1.5,
		"construction":  1.4,
		"technology":    0.9,
		"healthcare":    1.1,
		"retail":        1.0,
	}
	industryFactor := industryFactors[scheme.Industry]
	if industryFactor == 0 {
		industryFactor = 1.0
	}
	
	// Group discount based on size
	groupDiscount := 0.0
	if len(members) >= 100 {
		groupDiscount = 0.15
	} else if len(members) >= 50 {
		groupDiscount = 0.10
	} else if len(members) >= 20 {
		groupDiscount = 0.05
	}
	
	// Calculate premium
	grossPremium := totalSumAssured * baseRate / 1000 * ageLoadingFactor * industryFactor
	netPremium := grossPremium * (1 - groupDiscount)
	
	return &PremiumCalculation{
		SchemeID:         scheme.SchemeID,
		TotalMembers:     len(members),
		TotalSumAssured:  totalSumAssured,
		AverageAge:       math.Round(averageAge*100) / 100,
		BaseRate:         baseRate,
		AgeLoadingFactor: math.Round(ageLoadingFactor*1000) / 1000,
		IndustryFactor:   industryFactor,
		GroupDiscount:    groupDiscount,
		GrossPremium:     math.Round(grossPremium*100) / 100,
		NetPremium:       math.Round(netPremium*100) / 100,
	}
}

// CalculateMemberBenefit calculates individual member benefit
func (s *GroupLifeService) CalculateMemberBenefit(scheme *GroupScheme, member *GroupMember) float64 {
	var benefit float64
	
	if scheme.MultipleOfSalary > 0 {
		benefit = member.AnnualSalary * scheme.MultipleOfSalary
	} else {
		benefit = scheme.FlatBenefit
	}
	
	// Apply min/max limits
	if benefit < scheme.MinBenefit {
		benefit = scheme.MinBenefit
	}
	if benefit > scheme.MaxBenefit {
		benefit = scheme.MaxBenefit
	}
	
	return benefit
}

// ProcessMemberMovement processes member additions/deletions
func (s *GroupLifeService) ProcessMemberMovement(movement *MemberMovement, scheme *GroupScheme) float64 {
	premiumImpact := 0.0
	
	for _, change := range movement.Members {
		switch change.ChangeType {
		case "addition":
			// Calculate premium for new member
			memberPremium := change.NewSumAssured * 1.5 / 1000 // Base rate
			premiumImpact += memberPremium
			
		case "deletion":
			// Refund premium for deleted member
			memberPremium := change.OldSumAssured * 1.5 / 1000
			premiumImpact -= memberPremium
			
		case "salary_revision":
			// Calculate premium difference
			oldPremium := change.OldSumAssured * 1.5 / 1000
			newPremium := change.NewSumAssured * 1.5 / 1000
			premiumImpact += newPremium - oldPremium
		}
	}
	
	// Pro-rate based on remaining policy period
	daysRemaining := scheme.RenewalDate.Sub(time.Now()).Hours() / 24
	proRataFactor := daysRemaining / 365
	
	return math.Round(premiumImpact*proRataFactor*100) / 100
}

// GenerateRenewalQuote generates renewal quote
func (s *GroupLifeService) GenerateRenewalQuote(scheme *GroupScheme, claimsAmount float64) *RenewalQuote {
	// Claims experience ratio
	claimsExperience := claimsAmount / scheme.AnnualPremium * 100
	
	// Calculate proposed premium
	proposedPremium := scheme.AnnualPremium
	
	if claimsExperience > 80 {
		// High claims - increase premium
		proposedPremium *= 1.15
	} else if claimsExperience > 60 {
		proposedPremium *= 1.05
	} else if claimsExperience < 30 {
		// Low claims - discount
		proposedPremium *= 0.95
	}
	
	premiumChange := (proposedPremium - scheme.AnnualPremium) / scheme.AnnualPremium * 100
	
	return &RenewalQuote{
		QuoteID:          fmt.Sprintf("RQ-%d", time.Now().Unix()),
		SchemeID:         scheme.SchemeID,
		CurrentPremium:   scheme.AnnualPremium,
		ProposedPremium:  math.Round(proposedPremium*100) / 100,
		PremiumChange:    math.Round(premiumChange*100) / 100,
		ClaimsExperience: math.Round(claimsExperience*100) / 100,
		ValidUntil:       time.Now().AddDate(0, 0, 30),
		Status:           "pending",
	}
}

// HTTP Handlers
func (s *GroupLifeService) HandleCalculatePremium(w http.ResponseWriter, r *http.Request) {
	type Request struct {
		Scheme  GroupScheme   `json:"scheme"`
		Members []GroupMember `json:"members"`
	}
	
	var req Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	result := s.CalculatePremium(&req.Scheme, req.Members)
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (s *GroupLifeService) HandleRenewalQuote(w http.ResponseWriter, r *http.Request) {
	type Request struct {
		Scheme       GroupScheme `json:"scheme"`
		ClaimsAmount float64     `json:"claims_amount"`
	}
	
	var req Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	result := s.GenerateRenewalQuote(&req.Scheme, req.ClaimsAmount)
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (s *GroupLifeService) HandleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"service":   "group-life-admin",
		"timestamp": time.Now(),
		"features": []string{
			"scheme_management",
			"member_enrollment",
			"premium_calculation",
			"claims_processing",
			"member_movements",
			"renewal_quotes",
			"beneficiary_management",
			"bulk_upload",
			"reporting",
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
		jsonLog("info", "database connected", "service", "group-life-admin", "driver", "postgresql")
	}
	// Create domain table
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS group_life_schemes (
            id SERIAL PRIMARY KEY,
            company_name TEXT NOT NULL,
            member_count INTEGER DEFAULT 0,
            total_premium NUMERIC DEFAULT 0,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT NOW()
        )`); err != nil {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS group_members (id TEXT PRIMARY KEY, group_id TEXT, member_id TEXT, member_name TEXT, date_of_birth TEXT, sum_assured NUMERIC(15,2), category TEXT, annual_premium NUMERIC(15,2), claim_amount NUMERIC(15,2) DEFAULT 0, premium_paid NUMERIC(15,2) DEFAULT 0, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
	}
		jsonLog("warn", "create table failed", "error", err.Error())
	} else {
		jsonLog("info", "table ready", "table", "group_life_schemes")
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
	if err := db.QueryRow("SELECT COUNT(*) FROM group_life_schemes").Scan(&total); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	// Redis cache for list queries
	if redisClient != nil {
		if cached, ok := redisClient.CacheGet("group-life-admin:list"); ok {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Cache", "HIT")
			w.Write([]byte(cached))
			return
		}
	}

	rows, err := db.Query(fmt.Sprintf("SELECT id, company_name, member_count, total_premium, status, created_at FROM group_life_schemes ORDER BY id DESC LIMIT $1 OFFSET $2"), limit, offset)
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
	rows, err := db.Query("SELECT id, company_name, member_count, total_premium, status, created_at FROM group_life_schemes WHERE id = $1", idStr)
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
	userID, _ := r.Context().Value("user_id").(string)
	if !permifyCheck(r.Context(), "group-life-admin", "", "create", userID) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden); return
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
	query := fmt.Sprintf("INSERT INTO group_life_schemes (%s) VALUES (%s) RETURNING id",
		strings.Join(cols, ", "), strings.Join(placeholders, ", "))
	var newID interface{}
	if err := db.QueryRow(query, vals...).Scan(&newID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	if kafkaWriter != nil { kafkaWriter.PublishEvent(r.Context(), "created", r.URL.Path, nil) }
	json.NewEncoder(w).Encode(map[string]interface{}{"id": newID, "status": "created"})
	// Index to OpenSearch for full-text search
	if osClient != nil {
		go osClient.IndexLog("info", "entity_created", "group-life-admin", map[string]interface{}{"action": "created", "timestamp": time.Now().Format(time.RFC3339)})
	}
	if redisClient != nil { redisClient.CacheInvalidate("group-life-admin:list") }
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
	result, err := db.Exec("DELETE FROM group_life_schemes WHERE id = $1", idStr)
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
		db.QueryRow("SELECT COUNT(*) FROM group_life_schemes").Scan(&count)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"service": "group_life_schemes", "table": "group_life_schemes", "total_records": count})
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
			jsonLog("warn", "auth_failure", "service", "group-life-admin", "remote_addr", r.RemoteAddr, "path", r.URL.Path, "method", r.Method)
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
	kafkaWriter = newKafkaProducer(kafkaBrokers, "group-life-admin-events")
	jsonLog("info", "kafka_producer_initialized", "brokers", kafkaBrokers, "topic", "group-life-admin-events")

	// OpenSearch
	osURL := os.Getenv("OPENSEARCH_URL")
	if osURL == "" {
		osURL = "http://localhost:9200"
	}
	osClient = newOpenSearchClient(osURL, os.Getenv("OPENSEARCH_USER"))
	jsonLog("info", "opensearch_client_initialized", "url", osURL)
}



func handleGroupEnroll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed); return
	}
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		GroupID    string `json:"group_id"`
		MemberID   string `json:"member_id"`
		MemberName string `json:"member_name"`
		DateOfBirth string `json:"date_of_birth"`
		SumAssured float64 `json:"sum_assured"`
		Category   string `json:"category"` // employee, spouse, child
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, 400); return
	}
	// Business rule: max sum assured = ₦50M for employees, ₦25M for spouse, ₦10M for child
	maxSA := map[string]float64{"employee": 50000000, "spouse": 25000000, "child": 10000000}
	if max, ok := maxSA[req.Category]; ok && req.SumAssured > max {
		http.Error(w, fmt.Sprintf(`{"error":"sum_assured exceeds max %.0f for %s"}`, max, req.Category), 400); return
	}
	// Premium calculation: per-mille rate based on group experience
	rate := 2.5 // base rate per ₦1000 sum assured per annum
	var claimsRatio float64
	if db != nil {
		db.QueryRow("SELECT COALESCE(SUM(claim_amount)/NULLIF(SUM(premium_paid),0), 0) FROM group_members WHERE group_id=$1", req.GroupID).Scan(&claimsRatio)
	}
	// Experience rating adjustment
	if claimsRatio < 0.4 { rate *= 0.85 } // Good experience discount
	if claimsRatio > 0.8 { rate *= 1.25 } // Bad experience loading
	annualPremium := (req.SumAssured / 1000) * rate
	enrollID := fmt.Sprintf("GE-%d", time.Now().UnixNano())
	if db != nil {
		db.Exec("INSERT INTO group_members (id, group_id, member_id, member_name, date_of_birth, sum_assured, category, annual_premium, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')",
			enrollID, req.GroupID, req.MemberID, req.MemberName, req.DateOfBirth, req.SumAssured, req.Category, annualPremium)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"enrollment_id": enrollID, "annual_premium": annualPremium, "rate_per_mille": rate, "experience_adjustment": claimsRatio})
}


func handleExperienceRating(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed); return
	}
	w.Header().Set("Content-Type", "application/json")

	groupID := r.URL.Query().Get("group_id")
	if groupID == "" { http.Error(w, `{"error":"group_id required"}`, 400); return }
	var memberCount int; var totalSA, totalPremium, totalClaims float64
	if db != nil {
		db.QueryRow("SELECT COUNT(*), COALESCE(SUM(sum_assured),0), COALESCE(SUM(annual_premium),0), COALESCE(SUM(claim_amount),0) FROM group_members WHERE group_id=$1 AND status='active'", groupID).Scan(&memberCount, &totalSA, &totalPremium, &totalClaims)
	}
	claimsRatio := 0.0
	if totalPremium > 0 { claimsRatio = totalClaims / totalPremium }
	rating := "standard"
	if claimsRatio < 0.4 { rating = "preferred" }
	if claimsRatio > 0.8 { rating = "substandard" }
	json.NewEncoder(w).Encode(map[string]interface{}{"group_id": groupID, "member_count": memberCount, "total_sum_assured": totalSA, "total_premium": totalPremium, "total_claims": totalClaims, "claims_ratio": claimsRatio, "experience_rating": rating})
}


func handlePremiumSchedule(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed); return
	}
	w.Header().Set("Content-Type", "application/json")

	groupID := r.URL.Query().Get("group_id")
	var schedule []map[string]interface{}
	if db != nil {
		rows, _ := db.Query("SELECT category, COUNT(*) as members, SUM(sum_assured) as total_sa, SUM(annual_premium) as total_premium FROM group_members WHERE group_id=$1 AND status='active' GROUP BY category", groupID)
		if rows != nil {
			defer rows.Close()
			for rows.Next() {
				var cat string; var cnt int; var sa, prem float64
				rows.Scan(&cat, &cnt, &sa, &prem)
				schedule = append(schedule, map[string]interface{}{"category": cat, "member_count": cnt, "total_sum_assured": sa, "annual_premium": prem, "monthly_premium": prem / 12})
			}
		}
	}
	if schedule == nil { schedule = []map[string]interface{}{} }
	json.NewEncoder(w).Encode(map[string]interface{}{"group_id": groupID, "schedule": schedule})
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
	service := NewGroupLifeService()
	
	http.HandleFunc("/api/group-life/premium", service.HandleCalculatePremium)
	http.HandleFunc("/api/group-life/renewal-quote", service.HandleRenewalQuote)

	http.HandleFunc("/api/v1/schemes", handleListEntities)
	http.HandleFunc("/api/v1/scheme", handleGetEntity)
	http.HandleFunc("/api/v1/schemes/create", handleCreateEntity)
	http.HandleFunc("/api/v1/schemes/delete", handleDeleteEntity)
	http.HandleFunc("/stats", handleStats)

	http.HandleFunc("/health", service.HandleHealth)
	http.HandleFunc("/ready", handleReady)
	http.HandleFunc("/live", handleLive)
	
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	
	log.Printf("Group Life Administration Service starting on port %s", port)
	
	srv := &http.Server{Addr: ":" + port, Handler: bodyLimitMiddleware(http.DefaultServeMux)}
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		jsonLog("info", "shutting down gracefully", "service", "group-life-admin")
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
