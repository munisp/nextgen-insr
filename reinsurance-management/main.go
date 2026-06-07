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
	"database/sql"

	_ "github.com/lib/pq"
)

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
		dsn = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
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



func jsonLog(level, msg string, kvs ...string) {
	entry := fmt.Sprintf(`{"level":"%s","msg":"%s"`, level, msg)
	for i := 0; i+1 < len(kvs); i += 2 {
		entry += fmt.Sprintf(`,"%s":"%s"`, kvs[i], kvs[i+1])
	}
	entry += `,"ts":"` + time.Now().Format(time.RFC3339) + `"}`
	log.Println(entry)
}

func main() {
	initDB()
	service := NewReinsuranceService()
	
	http.HandleFunc("/api/reinsurance/cession", service.HandleCalculateCession)
	http.HandleFunc("/api/reinsurance/recovery", service.HandleCalculateRecovery)
	http.HandleFunc("/health", service.HandleHealth)
	
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	
	log.Printf("Reinsurance Management Service starting on port %s", port)
	
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
