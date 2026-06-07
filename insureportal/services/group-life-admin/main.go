package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"time"
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

func main() {
	service := NewGroupLifeService()
	
	http.HandleFunc("/api/group-life/premium", service.HandleCalculatePremium)
	http.HandleFunc("/api/group-life/renewal-quote", service.HandleRenewalQuote)
	http.HandleFunc("/health", service.HandleHealth)
	
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	
	log.Printf("Group Life Administration Service starting on port %s", port)
	
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
