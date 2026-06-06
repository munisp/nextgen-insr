package main

import (
	"database/sql"
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"time"
	"context"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"

	_ "github.com/lib/pq"
)

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
	dbStatus := "disconnected"
	if db != nil {
		if err := db.Ping(); err == nil {
			dbStatus = "connected"
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
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

var kafkaRestURL string

func initKafka() {
	kafkaRestURL = os.Getenv("KAFKA_REST_URL")
	if kafkaRestURL == "" {
		kafkaRestURL = "http://localhost:8082"
	}
	log.Printf("Kafka REST proxy configured at %s", kafkaRestURL)
}

func publishEvent(topic string, key string, payload interface{}) {
	if kafkaRestURL == "" {
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("WARN: kafka marshal error: %v", err)
		return
	}
	msg := map[string]interface{}{
		"records": []map[string]interface{}{
			{"key": key, "value": string(data)},
		},
	}
	body, _ := json.Marshal(msg)
	resp, err := http.Post(kafkaRestURL+"/topics/"+topic, "application/vnd.kafka.json.v2+json", bytes.NewReader(body))
	if err != nil {
		log.Printf("WARN: kafka publish error: %v", err)
		return
	}
	defer resp.Body.Close()
}

// --- Production Middleware ---

type statusResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (w *statusResponseWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

// Tracing middleware - adds X-Request-ID to all requests
func prodTracingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqID := r.Header.Get("X-Request-Id")
		if reqID == "" {
			reqID = fmt.Sprintf("req-%d", time.Now().UnixNano())
		}
		w.Header().Set("X-Request-Id", reqID)
		start := time.Now()
		wrapped := &statusResponseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		log.Printf("[TRACE] %s %s %d %s request_id=%s", r.Method, r.URL.Path, wrapped.statusCode, time.Since(start), reqID)
	})
}

// CORS middleware - handles preflight and sets headers
func prodCorsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Rate limiting - token bucket per IP, 100 req/min
var (
	prodRateLimitMu      sync.Mutex
	prodRateLimitBuckets = make(map[string]*prodTokenBucket)
)

type prodTokenBucket struct {
	tokens     float64
	lastRefill time.Time
}

func prodRateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			ip = fwd
		}
		prodRateLimitMu.Lock()
		bucket, ok := prodRateLimitBuckets[ip]
		if !ok {
			bucket = &prodTokenBucket{tokens: 100, lastRefill: time.Now()}
			prodRateLimitBuckets[ip] = bucket
		}
		elapsed := time.Since(bucket.lastRefill).Seconds()
		bucket.tokens = math.Min(100, bucket.tokens+elapsed*(100.0/60.0))
		bucket.lastRefill = time.Now()
		if bucket.tokens < 1 {
			prodRateLimitMu.Unlock()
			w.Header().Set("Retry-After", "60")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "rate limit exceeded", "retry_after": 60})
			return
		}
		bucket.tokens--
		prodRateLimitMu.Unlock()
		next.ServeHTTP(w, r)
	})
}

// Prometheus-compatible metrics
var (
	prodMetricsReqCount   int64
	prodMetricsErrCount   int64
	prodMetricsStartTime  = time.Now()
)

func prodMetricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&prodMetricsReqCount, 1)
		wrapped := &statusResponseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		if wrapped.statusCode >= 400 {
			atomic.AddInt64(&prodMetricsErrCount, 1)
		}
	})
}

func prodMetricsHandler(w http.ResponseWriter, r *http.Request) {
	uptime := time.Since(prodMetricsStartTime).Seconds()
	reqCount := atomic.LoadInt64(&prodMetricsReqCount)
	errCount := atomic.LoadInt64(&prodMetricsErrCount)
	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprintf(w, "# HELP http_requests_total Total HTTP requests\n")
	fmt.Fprintf(w, "# TYPE http_requests_total counter\n")
	fmt.Fprintf(w, "http_requests_total %d\n", reqCount)
	fmt.Fprintf(w, "# HELP http_errors_total Total HTTP errors (4xx/5xx)\n")
	fmt.Fprintf(w, "# TYPE http_errors_total counter\n")
	fmt.Fprintf(w, "http_errors_total %d\n", errCount)
	fmt.Fprintf(w, "# HELP process_uptime_seconds Process uptime in seconds\n")
	fmt.Fprintf(w, "# TYPE process_uptime_seconds gauge\n")
	fmt.Fprintf(w, "process_uptime_seconds %.2f\n", uptime)
}

var db *sql.DB

func initDB() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		log.Printf("WARN: database connection failed: %v", err)
		return
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err = db.Ping(); err != nil {
		log.Printf("WARN: database ping failed: %v", err)
		return
	}
	log.Println("PostgreSQL connected")
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS group_policies (id TEXT PRIMARY KEY, group_name TEXT NOT NULL, employer_id TEXT, member_count INT DEFAULT 0, total_premium NUMERIC(15,2), coverage_type TEXT, status TEXT DEFAULT 'active', effective_date DATE, created_at TIMESTAMPTZ DEFAULT NOW())`)
	if err != nil {
		log.Printf("WARN: table creation failed: %v", err)
	}
}

func main() {
	initKafka()
	initDB()
	service := NewGroupLifeService()
	
	http.HandleFunc("/api/group-life/premium", service.HandleCalculatePremium)
	http.HandleFunc("/api/group-life/renewal-quote", service.HandleRenewalQuote)
	http.HandleFunc("/health", service.HandleHealth)
	http.HandleFunc("/metrics", prodMetricsHandler)
	
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	
	log.Printf("Group Life Administration Service starting on port %s", port)
	
	handler := prodMetricsMiddleware(prodTracingMiddleware(prodCorsMiddleware(prodRateLimitMiddleware(http.DefaultServeMux))))
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down gracefully...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}
	log.Println("Server stopped")
}
