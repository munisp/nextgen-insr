package service

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/unified-insurance/pfa-integration/internal/models"
	"github.com/unified-insurance/pfa-integration/internal/repository"

	"github.com/google/uuid"
)

// Nigerian annuity mortality rates (PMA92 adjusted for Nigerian population)
var annuityMortalityRates = map[int]float64{
	55: 0.0085, 56: 0.0095, 57: 0.0106, 58: 0.0118, 59: 0.0132,
	60: 0.0148, 61: 0.0166, 62: 0.0186, 63: 0.0210, 64: 0.0237,
	65: 0.0268, 66: 0.0304, 67: 0.0345, 68: 0.0393, 69: 0.0448,
	70: 0.0513, 71: 0.0588, 72: 0.0676, 73: 0.0779, 74: 0.0900,
	75: 0.1041, 76: 0.1207, 77: 0.1403, 78: 0.1634, 79: 0.1908,
	80: 0.2231, 85: 0.3500, 90: 0.5000, 95: 0.7000, 100: 1.0000,
}

type PFAService struct {
	repo *repository.PFARepository
}

func NewPFAService(repo *repository.PFARepository) *PFAService {
	return &PFAService{repo: repo}
}

func (s *PFAService) RegisterPFAPartner(ctx context.Context, req RegisterPFARequest) (*models.PFAPartner, error) {
	partner := &models.PFAPartner{
		PFACode: req.PFACode, PFAName: req.PFAName, PenComLicense: req.PenComLicense,
		ContactEmail: req.ContactEmail, ContactPhone: req.ContactPhone,
		APIEndpoint: req.APIEndpoint, CommissionRate: req.CommissionRate, IsActive: true,
	}
	if err := s.repo.CreatePFAPartner(ctx, partner); err != nil {
		return nil, fmt.Errorf("failed to register PFA partner: %w", err)
	}
	return partner, nil
}

func (s *PFAService) ValidateRSAPIN(ctx context.Context, rsaPIN string) (*models.RSAHolder, error) {
	if len(rsaPIN) < 10 || len(rsaPIN) > 15 {
		return nil, fmt.Errorf("invalid RSA PIN format: must be 10-15 characters")
	}
	holder, err := s.repo.GetRSAHolder(ctx, rsaPIN)
	if err != nil {
		return nil, fmt.Errorf("RSA PIN not found: %s", rsaPIN)
	}
	if !holder.KYCVerified {
		return nil, fmt.Errorf("RSA holder KYC not verified")
	}
	return holder, nil
}

func (s *PFAService) RegisterRSAHolder(ctx context.Context, req RegisterRSAHolderRequest) (*models.RSAHolder, error) {
	holder := &models.RSAHolder{
		RSAPIN: req.RSAPIN, PFAPartnerID: req.PFAPartnerID,
		FirstName: req.FirstName, LastName: req.LastName,
		DateOfBirth: req.DateOfBirth, Gender: req.Gender,
		Email: req.Email, Phone: req.Phone,
		EmployerName: req.EmployerName, EmployerRCNo: req.EmployerRCNo,
		RSABalance: req.RSABalance, KYCVerified: true,
	}
	if err := s.repo.CreateRSAHolder(ctx, holder); err != nil {
		return nil, fmt.Errorf("failed to register RSA holder: %w", err)
	}
	return holder, nil
}

func (s *PFAService) CalculateAnnuityQuote(ctx context.Context, req AnnuityQuoteRequest) (*models.AnnuityQuote, error) {
	holder, err := s.repo.GetRSAHolderByID(ctx, req.RSAHolderID)
	if err != nil {
		return nil, fmt.Errorf("RSA holder not found: %w", err)
	}

	age := s.calculateAge(holder.DateOfBirth)
	if age < 50 || age > 70 {
		return nil, fmt.Errorf("annuity entry age must be between 50 and 70, got %d", age)
	}

	if req.PurchaseAmount < 2000000 { // NGN 2 million minimum
		return nil, fmt.Errorf("minimum annuity purchase amount is NGN 2,000,000")
	}

	// PenCom requirement: minimum of 25% RSA balance for programmed withdrawal
	if req.PurchaseAmount > holder.RSABalance*0.75 {
		return nil, fmt.Errorf("purchase amount cannot exceed 75%% of RSA balance (NGN %.2f)", holder.RSABalance*0.75)
	}

	interestRate := 0.12 // 12% annuity pricing rate
	guaranteedPeriod := req.GuaranteedPeriod
	if guaranteedPeriod == 0 {
		guaranteedPeriod = 10
	}

	annuityFactor := s.calculateAnnuityFactor(age, interestRate, guaranteedPeriod, req.ProductType)
	annualPension := req.PurchaseAmount / annuityFactor
	monthlyPension := annualPension / 12.0

	quote := &models.AnnuityQuote{
		RSAHolderID:      req.RSAHolderID,
		ProductID:        req.ProductID,
		PurchaseAmount:   req.PurchaseAmount,
		MonthlyPension:   math.Round(monthlyPension*100) / 100,
		AnnualPension:    math.Round(annualPension*100) / 100,
		GuaranteedPeriod: guaranteedPeriod,
		CommencementDate: req.CommencementDate,
		AnnuityFactor:    math.Round(annuityFactor*10000) / 10000,
		InterestRate:     interestRate,
		MortalityAdjust:  1.0,
		Status:           "quoted",
		ValidUntil:       time.Now().AddDate(0, 0, 30),
	}

	if err := s.repo.CreateAnnuityQuote(ctx, quote); err != nil {
		return nil, fmt.Errorf("failed to create quote: %w", err)
	}
	return quote, nil
}

func (s *PFAService) AcceptAnnuityQuote(ctx context.Context, quoteID uuid.UUID) (*models.AnnuityPolicy, error) {
	quote, err := s.repo.GetAnnuityQuote(ctx, quoteID)
	if err != nil {
		return nil, fmt.Errorf("quote not found: %w", err)
	}
	if quote.Status != "quoted" {
		return nil, fmt.Errorf("quote cannot be accepted in status: %s", quote.Status)
	}
	if time.Now().After(quote.ValidUntil) {
		return nil, fmt.Errorf("quote has expired")
	}

	if err := s.repo.UpdateQuoteStatus(ctx, quoteID, "accepted"); err != nil {
		return nil, fmt.Errorf("failed to update quote: %w", err)
	}

	policyNumber := fmt.Sprintf("ANN-%s-%d", time.Now().Format("2006"), time.Now().UnixNano()%1000000)
	nextPayment := quote.CommencementDate.AddDate(0, 1, 0)

	policy := &models.AnnuityPolicy{
		PolicyNumber:      policyNumber,
		QuoteID:           quoteID,
		RSAHolderID:       quote.RSAHolderID,
		ProductID:         quote.ProductID,
		PurchaseAmount:    quote.PurchaseAmount,
		MonthlyPension:    quote.MonthlyPension,
		CommencementDate:  quote.CommencementDate,
		GuaranteedEndDate: quote.CommencementDate.AddDate(quote.GuaranteedPeriod, 0, 0),
		Status:            "active",
		NextPaymentDate:   &nextPayment,
	}

	if err := s.repo.CreateAnnuityPolicy(ctx, policy); err != nil {
		return nil, fmt.Errorf("failed to create policy: %w", err)
	}
	return policy, nil
}

func (s *PFAService) ProcessPensionPayment(ctx context.Context, policyID uuid.UUID) (*models.PensionPayment, error) {
	policy, err := s.repo.GetAnnuityPolicy(ctx, policyID)
	if err != nil {
		return nil, fmt.Errorf("policy not found: %w", err)
	}
	if policy.Status != "active" {
		return nil, fmt.Errorf("policy is not active")
	}

	holder, err := s.repo.GetRSAHolderByID(ctx, policy.RSAHolderID)
	if err != nil {
		return nil, fmt.Errorf("RSA holder not found: %w", err)
	}

	// Calculate withholding tax (pension income is taxed at graduated rates)
	grossAmount := policy.MonthlyPension
	wht := s.calculatePensionTax(grossAmount)
	netAmount := grossAmount - wht

	transRef := fmt.Sprintf("PEN-%s-%d", time.Now().Format("20060102"), time.Now().UnixNano()%1000000)

	payment := &models.PensionPayment{
		PolicyID:       policyID,
		RSAHolderID:    policy.RSAHolderID,
		Amount:         grossAmount,
		PaymentDate:    time.Now(),
		PaymentMethod:  "bank_transfer",
		BankAccountNo:  holder.Phone, // placeholder
		TransactionRef: transRef,
		Status:         "processed",
		WithholdingTax: math.Round(wht*100) / 100,
		NetAmount:      math.Round(netAmount*100) / 100,
	}

	if err := s.repo.CreatePensionPayment(ctx, payment); err != nil {
		return nil, fmt.Errorf("failed to create payment: %w", err)
	}
	return payment, nil
}

func (s *PFAService) CalculateGroupLifePremium(ctx context.Context, req GroupLifeRequest) (*models.GroupLifeForPension, error) {
	if req.MemberCount <= 0 {
		return nil, fmt.Errorf("member count must be positive")
	}

	// PenCom mandates minimum 3x annual emolument group life cover
	coverMultiple := 3.0
	if req.CoverMultiple > coverMultiple {
		coverMultiple = req.CoverMultiple
	}
	totalSumAssured := req.TotalAnnualEmolument * coverMultiple

	// Premium rate depends on industry and group size
	baseRate := 0.005 // 0.5% of sum assured
	industryFactor := s.getIndustryFactor(req.Industry)
	sizeDiscount := s.getGroupSizeDiscount(req.MemberCount)

	annualPremium := totalSumAssured * baseRate * industryFactor * sizeDiscount

	gl := &models.GroupLifeForPension{
		PFAPartnerID:    req.PFAPartnerID,
		EmployerRCNo:    req.EmployerRCNo,
		EmployerName:    req.EmployerName,
		MemberCount:     req.MemberCount,
		TotalSumAssured: math.Round(totalSumAssured*100) / 100,
		AnnualPremium:   math.Round(annualPremium*100) / 100,
		CoverMultiple:   coverMultiple,
		InceptionDate:   req.InceptionDate,
		ExpiryDate:      req.InceptionDate.AddDate(1, 0, 0),
		Status:          "active",
	}

	if err := s.repo.CreateGroupLife(ctx, gl); err != nil {
		return nil, fmt.Errorf("failed to create group life: %w", err)
	}
	return gl, nil
}

func (s *PFAService) InitiateFundTransfer(ctx context.Context, req FundTransferRequest) (*models.FundTransfer, error) {
	holder, err := s.repo.GetRSAHolderByID(ctx, req.RSAHolderID)
	if err != nil {
		return nil, fmt.Errorf("RSA holder not found: %w", err)
	}
	if req.Amount > holder.RSABalance {
		return nil, fmt.Errorf("transfer amount exceeds RSA balance")
	}

	transRef := fmt.Sprintf("FT-%s-%d", time.Now().Format("20060102"), time.Now().UnixNano()%1000000)

	ft := &models.FundTransfer{
		RSAHolderID:    req.RSAHolderID,
		SourcePFAID:    holder.PFAPartnerID,
		Amount:         req.Amount,
		TransferType:   req.TransferType,
		TransactionRef: transRef,
		Status:         "initiated",
	}

	if err := s.repo.CreateFundTransfer(ctx, ft); err != nil {
		return nil, fmt.Errorf("failed to create fund transfer: %w", err)
	}
	return ft, nil
}

func (s *PFAService) ApproveFundTransfer(ctx context.Context, transferID uuid.UUID) error {
	return s.repo.UpdateFundTransferStatus(ctx, transferID, "approved")
}

func (s *PFAService) GeneratePenComReport(ctx context.Context, reportType, period string) (*models.PenComReport, error) {
	reportData := map[string]interface{}{
		"report_type":  reportType,
		"period":       period,
		"generated_at": time.Now(),
		"generator":    "pfa-integration-service",
	}

	report := &models.PenComReport{
		ReportType: reportType, Period: period, ReportData: reportData, Status: "draft",
	}
	if err := s.repo.CreatePenComReport(ctx, report); err != nil {
		return nil, fmt.Errorf("failed to create report: %w", err)
	}
	return report, nil
}

func (s *PFAService) GetPFAPartners(ctx context.Context) ([]models.PFAPartner, error) {
	return s.repo.ListPFAPartners(ctx)
}

func (s *PFAService) GetAnnuityProducts(ctx context.Context) ([]models.AnnuityProduct, error) {
	return s.repo.ListAnnuityProducts(ctx)
}

func (s *PFAService) GetPoliciesByHolder(ctx context.Context, holderID uuid.UUID) ([]models.AnnuityPolicy, error) {
	return s.repo.GetPoliciesByHolder(ctx, holderID)
}

func (s *PFAService) GetPaymentsByPolicy(ctx context.Context, policyID uuid.UUID) ([]models.PensionPayment, error) {
	return s.repo.GetPaymentsByPolicy(ctx, policyID)
}

// Helper functions
func (s *PFAService) calculateAge(dob time.Time) int {
	now := time.Now()
	age := now.Year() - dob.Year()
	if now.YearDay() < dob.YearDay() {
		age--
	}
	return age
}

func (s *PFAService) calculateAnnuityFactor(age int, rate float64, guaranteedPeriod int, productType string) float64 {
	v := 1.0 / (1.0 + rate)
	factor := 0.0

	switch productType {
	case "life_annuity":
		tpx := 1.0
		for t := 0; t < 100-age; t++ {
			qx := s.getMortalityRate(age + t)
			factor += math.Pow(v, float64(t)) * tpx
			tpx *= (1 - qx)
		}
	case "term_certain":
		for t := 0; t < guaranteedPeriod; t++ {
			factor += math.Pow(v, float64(t))
		}
	case "joint_life":
		factor = s.calculateAnnuityFactor(age, rate, guaranteedPeriod, "life_annuity") * 0.85
	default:
		// Guaranteed period + life contingent
		for t := 0; t < guaranteedPeriod; t++ {
			factor += math.Pow(v, float64(t))
		}
		tpx := 1.0
		for t := 0; t < guaranteedPeriod; t++ {
			qx := s.getMortalityRate(age + t)
			tpx *= (1 - qx)
		}
		for t := guaranteedPeriod; t < 100-age; t++ {
			qx := s.getMortalityRate(age + t)
			factor += math.Pow(v, float64(t)) * tpx
			tpx *= (1 - qx)
		}
	}
	return factor
}

func (s *PFAService) getMortalityRate(age int) float64 {
	if rate, ok := annuityMortalityRates[age]; ok {
		return rate
	}
	lower, upper := 55, 100
	for a := range annuityMortalityRates {
		if a <= age && a > lower {
			lower = a
		}
		if a >= age && a < upper {
			upper = a
		}
	}
	if lower == upper {
		return annuityMortalityRates[lower]
	}
	lRate := annuityMortalityRates[lower]
	uRate := annuityMortalityRates[upper]
	t := float64(age-lower) / float64(upper-lower)
	return lRate + t*(uRate-lRate)
}

func (s *PFAService) calculatePensionTax(monthlyAmount float64) float64 {
	annualAmount := monthlyAmount * 12
	// Nigerian PAYE tax bands (simplified for pension income)
	if annualAmount <= 300000 {
		return 0
	}
	if annualAmount <= 600000 {
		return (annualAmount - 300000) * 0.07 / 12
	}
	if annualAmount <= 1100000 {
		return (300000*0.07 + (annualAmount-600000)*0.11) / 12
	}
	if annualAmount <= 1600000 {
		return (300000*0.07 + 500000*0.11 + (annualAmount-1100000)*0.15) / 12
	}
	return (300000*0.07 + 500000*0.11 + 500000*0.15 + (annualAmount-1600000)*0.19) / 12
}

func (s *PFAService) getIndustryFactor(industry string) float64 {
	factors := map[string]float64{
		"banking": 1.0, "oil_gas": 1.5, "manufacturing": 1.3, "construction": 1.6,
		"technology": 0.9, "education": 0.8, "healthcare": 1.1, "mining": 1.8,
		"agriculture": 1.2, "telecoms": 1.0, "government": 0.9,
	}
	if f, ok := factors[industry]; ok {
		return f
	}
	return 1.0
}

func (s *PFAService) getGroupSizeDiscount(count int) float64 {
	switch {
	case count >= 1000:
		return 0.70
	case count >= 500:
		return 0.75
	case count >= 200:
		return 0.80
	case count >= 100:
		return 0.85
	case count >= 50:
		return 0.90
	default:
		return 1.0
	}
}
