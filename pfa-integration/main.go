package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"sync"
	"time"
		"context"
	"os/signal"
	"syscall"
)

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

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func tracingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = fmt.Sprintf("req-%d", time.Now().UnixNano())
		}
		w.Header().Set("X-Request-ID", requestID)
		start := time.Now()
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		log.Printf("[TRACE] %s %s %d %s request_id=%s", r.Method, r.URL.Path, wrapped.statusCode, time.Since(start), requestID)
	})
}

type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

var (
	rateLimitMu    sync.Mutex
	rateLimitStore = make(map[string][]time.Time)
)

func rateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			ip = fwd
		}
		rateLimitMu.Lock()
		now := time.Now()
		window := now.Add(-1 * time.Minute)
		var recent []time.Time
		for _, t := range rateLimitStore[ip] {
			if t.After(window) {
				recent = append(recent, t)
			}
		}
		if len(recent) >= 100 {
			rateLimitMu.Unlock()
			w.Header().Set("Retry-After", "60")
			http.Error(w, `{"error":"rate limit exceeded","retry_after":60}`, http.StatusTooManyRequests)
			return
		}
		recent = append(recent, now)
		rateLimitStore[ip] = recent
		rateLimitMu.Unlock()
		next.ServeHTTP(w, r)
	})
}

func main() {
	service := NewPFAService()
	
	http.HandleFunc("/api/pfa/annuity-quote", service.HandleAnnuityQuote)
	http.HandleFunc("/api/pfa/validate-rsa", service.HandleValidateRSA)
	http.HandleFunc("/api/pfa/group-life-premium", service.HandleGroupLifePremium)
	http.HandleFunc("/health", service.HandleHealth)
	
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	
	log.Printf("PFA Integration Service starting on port %s", port)
	
	srv := &http.Server{Addr: ":"+port, Handler: rateLimitMiddleware(tracingMiddleware(corsMiddleware(http.DefaultServeMux))), ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	go func() { if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed { log.Fatalf("Server failed: %v", err) } }()
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down gracefully...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil { log.Fatalf("Forced shutdown: %v", err) }
	log.Println("Server stopped")
}
