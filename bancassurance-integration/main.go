package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
	"context"
	"math"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
)

// BancassuranceService handles bank-insurance integration
type BancassuranceService struct{}

// BankPartner represents a bank partner
type BankPartner struct {
	BankID           string   `json:"bank_id"`
	BankName         string   `json:"bank_name"`
	BankCode         string   `json:"bank_code"`
	IntegrationType  string   `json:"integration_type"` // api, webhook, batch
	Products         []string `json:"products"`
	CommissionRate   float64  `json:"commission_rate"`
	Status           string   `json:"status"`
	APIEndpoint      string   `json:"api_endpoint"`
	WebhookURL       string   `json:"webhook_url"`
}

// BankCustomer represents a bank customer for insurance
type BankCustomer struct {
	CustomerID       string    `json:"customer_id"`
	BankAccountNo    string    `json:"bank_account_no"`
	BVN              string    `json:"bvn"`
	FullName         string    `json:"full_name"`
	Email            string    `json:"email"`
	Phone            string    `json:"phone"`
	DateOfBirth      time.Time `json:"date_of_birth"`
	Address          string    `json:"address"`
	AccountType      string    `json:"account_type"`
	AccountBalance   float64   `json:"account_balance"`
	SalaryAccount    bool      `json:"salary_account"`
	MonthlySalary    float64   `json:"monthly_salary"`
	CreditScore      int       `json:"credit_score"`
	ExistingLoans    float64   `json:"existing_loans"`
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
	PolicyID         string    `json:"policy_id"`
	MortgageID       string    `json:"mortgage_id"`
	CustomerID       string    `json:"customer_id"`
	PropertyValue    float64   `json:"property_value"`
	MortgageAmount   float64   `json:"mortgage_amount"`
	OutstandingBalance float64 `json:"outstanding_balance"`
	CoverageTypes    []string  `json:"coverage_types"` // fire, flood, earthquake, life
	TotalPremium     float64   `json:"total_premium"`
	StartDate        time.Time `json:"start_date"`
	EndDate          time.Time `json:"end_date"`
	Status           string    `json:"status"`
}

// DebitMandateRequest represents a debit mandate for premium collection
type DebitMandateRequest struct {
	MandateID        string    `json:"mandate_id"`
	CustomerID       string    `json:"customer_id"`
	BankAccountNo    string    `json:"bank_account_no"`
	BankCode         string    `json:"bank_code"`
	Amount           float64   `json:"amount"`
	Frequency        string    `json:"frequency"` // monthly, quarterly, annually
	StartDate        time.Time `json:"start_date"`
	EndDate          time.Time `json:"end_date"`
	PolicyNumber     string    `json:"policy_number"`
	Status           string    `json:"status"`
}

// PremiumCollection represents a premium collection record
type PremiumCollection struct {
	CollectionID     string    `json:"collection_id"`
	MandateID        string    `json:"mandate_id"`
	PolicyNumber     string    `json:"policy_number"`
	Amount           float64   `json:"amount"`
	CollectionDate   time.Time `json:"collection_date"`
	Status           string    `json:"status"` // pending, successful, failed
	FailureReason    string    `json:"failure_reason,omitempty"`
	RetryCount       int       `json:"retry_count"`
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

// ProcessPremiumCollection processes premium collection
func (s *BancassuranceService) ProcessPremiumCollection(mandate *DebitMandateRequest) *PremiumCollection {
	// Simulate collection process
	status := "successful"
	failureReason := ""

	// Random failure simulation (in production, this would call bank API)
	if time.Now().Unix()%10 == 0 {
		status = "failed"
		failureReason = "Insufficient funds"
	}

	return &PremiumCollection{
		CollectionID:   fmt.Sprintf("COL-%d", time.Now().Unix()),
		MandateID:      mandate.MandateID,
		PolicyNumber:   mandate.PolicyNumber,
		Amount:         mandate.Amount,
		CollectionDate: time.Now(),
		Status:         status,
		FailureReason:  failureReason,
		RetryCount:     0,
	}
}

func getProductName(productType string) string {
	names := map[string]string{
		"credit_life":        "A&G Credit Life Insurance",
		"loan_protection":    "A&G Loan Protection Plan",
		"savings_plan":       "A&G Savings Plus Insurance",
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
	json.NewEncoder(w).Encode(offer)
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
	json.NewEncoder(w).Encode(policy)
}

func (s *BancassuranceService) HandleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"service":   "bancassurance-integration",
		"timestamp": time.Now(),
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

func main() {
	initKafka()
	service := NewBancassuranceService()

	http.HandleFunc("/api/bancassurance/offer", service.HandleGenerateOffer)
	http.HandleFunc("/api/bancassurance/loan-protection", service.HandleCreateLoanProtection)
	http.HandleFunc("/health", service.HandleHealth)
	http.HandleFunc("/metrics", prodMetricsHandler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Bancassurance Integration Service starting on port %s", port)

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
