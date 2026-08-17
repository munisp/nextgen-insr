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
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

// Circuit breaker for external HTTP calls

// GroupLifeService handles group life insurance administration
type GroupLifeService struct{}

// GroupScheme represents a group life insurance scheme
type GroupScheme struct {
	SchemeID         string    `json:"scheme_id"`
	SchemeName       string    `json:"scheme_name"`
	EmployerName     string    `json:"employer_name"`
	EmployerID       string    `json:"employer_id"`
	Industry         string    `json:"industry"`
	SchemeType       string    `json:"scheme_type"`   // contributory, non-contributory
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
	MemberID       string        `json:"member_id"`
	SchemeID       string        `json:"scheme_id"`
	EmployeeID     string        `json:"employee_id"`
	FullName       string        `json:"full_name"`
	DateOfBirth    time.Time     `json:"date_of_birth"`
	Gender         string        `json:"gender"`
	JobTitle       string        `json:"job_title"`
	Department     string        `json:"department"`
	DateOfJoining  time.Time     `json:"date_of_joining"`
	AnnualSalary   float64       `json:"annual_salary"`
	SumAssured     float64       `json:"sum_assured"`
	Premium        float64       `json:"premium"`
	Beneficiaries  []Beneficiary `json:"beneficiaries"`
	Status         string        `json:"status"` // active, suspended, terminated
	EnrollmentDate time.Time     `json:"enrollment_date"`
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
	ClaimID       string              `json:"claim_id"`
	SchemeID      string              `json:"scheme_id"`
	MemberID      string              `json:"member_id"`
	MemberName    string              `json:"member_name"`
	ClaimType     string              `json:"claim_type"` // death, disability, critical_illness
	ClaimAmount   float64             `json:"claim_amount"`
	DateOfEvent   time.Time           `json:"date_of_event"`
	DateOfClaim   time.Time           `json:"date_of_claim"`
	Documents     []string            `json:"documents"`
	Beneficiaries []BeneficiaryPayout `json:"beneficiaries"`
	Status        string              `json:"status"`
	ApprovalDate  time.Time           `json:"approval_date,omitempty"`
	PaymentDate   time.Time           `json:"payment_date,omitempty"`
}

// BeneficiaryPayout represents payout to a beneficiary
type BeneficiaryPayout struct {
	Name      string  `json:"name"`
	Amount    float64 `json:"amount"`
	BankName  string  `json:"bank_name"`
	AccountNo string  `json:"account_no"`
	Status    string  `json:"status"`
}

// MemberMovement represents member additions/deletions
type MemberMovement struct {
	MovementID    string         `json:"movement_id"`
	SchemeID      string         `json:"scheme_id"`
	MovementType  string         `json:"movement_type"` // addition, deletion, salary_revision
	EffectiveDate time.Time      `json:"effective_date"`
	Members       []MemberChange `json:"members"`
	PremiumImpact float64        `json:"premium_impact"`
	Status        string         `json:"status"`
}

// MemberChange represents a change to a member
type MemberChange struct {
	MemberID      string  `json:"member_id"`
	EmployeeID    string  `json:"employee_id"`
	FullName      string  `json:"full_name"`
	OldSalary     float64 `json:"old_salary,omitempty"`
	NewSalary     float64 `json:"new_salary,omitempty"`
	OldSumAssured float64 `json:"old_sum_assured,omitempty"`
	NewSumAssured float64 `json:"new_sum_assured,omitempty"`
	ChangeType    string  `json:"change_type"`
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
	daysRemaining := time.Until(scheme.RenewalDate).Hours() / 24
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
	_ = json.NewEncoder(w).Encode(result)
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
	_ = json.NewEncoder(w).Encode(result)
}

func (s *GroupLifeService) HandleHealth(w http.ResponseWriter, r *http.Request) {
	dbStatus := "disconnected"
	if db != nil {
		if err := db.Ping(); err == nil {
			dbStatus = "connected"
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"service":   "group-life-admin",
		"timestamp": time.Now(),
		"database":  dbStatus,
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

// otelMiddleware adds trace context propagation to requests.

func jsonLog(level, msg string, kvs ...string) {
	entry := fmt.Sprintf(`{"level":"%s","msg":"%s"`, level, msg)
	for i := 0; i+1 < len(kvs); i += 2 {
		entry += fmt.Sprintf(`,"%s":"%s"`, kvs[i], kvs[i+1])
	}
	entry += `,"ts":"` + time.Now().Format(time.RFC3339) + `"}`
	log.Println(entry)
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
	if err := db.QueryRow("SELECT COUNT(*) FROM group_life_schemes").Scan(&total); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	// Redis cache for list queries
	if redisClient != nil {
		if cached, ok := redisClient.CacheGet("group-life-admin:list"); ok {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Cache", "HIT")
			_, _ = w.Write([]byte(cached))
			return
		}
	}

	rows, err := db.Query("SELECT id, company_name, member_count, total_premium, status, created_at FROM group_life_schemes ORDER BY id DESC LIMIT $1 OFFSET $2", limit, offset)
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
	rows, err := db.Query("SELECT id, company_name, member_count, total_premium, status, created_at FROM group_life_schemes WHERE id = $1", idStr)
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
	userID, _ := r.Context().Value("user_id").(string)
	if !permifyCheck(r.Context(), "group-life-admin", "", "create", userID) {
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
	query := fmt.Sprintf("INSERT INTO group_life_schemes (%s) VALUES (%s) RETURNING id",
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
		go osClient.IndexLog("info", "entity_created", "group-life-admin", map[string]interface{}{"action": "created", "timestamp": time.Now().Format(time.RFC3339)})
	}
	if redisClient != nil {
		redisClient.CacheInvalidate("group-life-admin:list")
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
	if kafkaWriter != nil {
		kafkaWriter.PublishEvent(r.Context(), "created", r.URL.Path, nil)
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"id": idStr, "status": "deleted"})
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	var count int
	if db != nil {
		_ = db.QueryRow("SELECT COUNT(*) FROM group_life_schemes").Scan(&count)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"service": "group_life_schemes", "table": "group_life_schemes", "total_records": count})
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

// Skip auth for health/ready/live probes

// Dev bypass for local development

// In production: validate JWT against Keycloak JWKS endpoint
// For now, decode and pass through (validation handled by APISIX gateway)

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

// employee, spouse, child

// Business rule: max sum assured = ₦50M for employees, ₦25M for spouse, ₦10M for child

// Premium calculation: per-mille rate based on group experience
// base rate per ₦1000 sum assured per annum

// Experience rating adjustment

// Good experience discount

// Bad experience loading

func bodyLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch {
			r.Body = http.MaxBytesReader(w, r.Body, 10<<20) // 10MB limit
		}
		next.ServeHTTP(w, r)
	})
}

// Panic recovery middleware - catches panics and returns 500

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
	log.Printf(`{"level":"info","msg":"server stopped","service":"group-life-admin"}`)
}
