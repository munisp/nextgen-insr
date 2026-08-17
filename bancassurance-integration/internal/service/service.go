package service

import (
	"log"
	"context"
	"fmt"
	"math"
	"time"

	"github.com/unified-insurance/bancassurance-integration/internal/models"
	"github.com/unified-insurance/bancassurance-integration/internal/repository"

	"github.com/google/uuid"
)

// Nigerian bank codes
var nigerianBanks = map[string]string{
	"011": "First Bank of Nigeria",
	"033": "United Bank for Africa",
	"044": "Access Bank",
	"058": "Guaranty Trust Bank",
	"063": "Diamond Bank (Access)",
	"215": "Unity Bank",
	"232": "Sterling Bank",
	"035": "Wema Bank",
	"050": "Ecobank Nigeria",
	"221": "Stanbic IBTC",
	"068": "Standard Chartered",
	"070": "Fidelity Bank",
	"076": "Polaris Bank",
	"082": "Keystone Bank",
	"214": "First City Monument Bank",
	"301": "Jaiz Bank",
	"101": "Providus Bank",
}

// Loan protection premium rates by cover type
var loanProtectionRates = map[string]float64{
	"death":            0.0035, // 0.35% of loan amount per annum
	"disability":       0.0020, // 0.20%
	"retrenchment":     0.0015, // 0.15%
	"critical_illness": 0.0025, // 0.25%
}

type BancassuranceService struct {
	repo *repository.BancassuranceRepository
}

func NewBancassuranceService(repo *repository.BancassuranceRepository) *BancassuranceService {
	return &BancassuranceService{repo: repo}
}

// RegisterBankPartner onboards a new bank partner
func (s *BancassuranceService) RegisterBankPartner(ctx context.Context, req RegisterBankPartnerRequest) (*models.BankPartner, error) {
	if _, ok := nigerianBanks[req.BankCode]; !ok && req.BankCode != "" {
		// Allow custom bank codes but log warning
		log.Printf("warn: bank code %q not in CBN registry; registering as custom partner bank", req.BankCode)
	}

	partner := &models.BankPartner{
		BankCode:           req.BankCode,
		BankName:           req.BankName,
		CBNLicenseNumber:   req.CBNLicenseNumber,
		ContactEmail:       req.ContactEmail,
		ContactPhone:       req.ContactPhone,
		RelationshipMgr:    req.RelationshipManager,
		APIEndpoint:        req.APIEndpoint,
		WebhookURL:         req.WebhookURL,
		CommissionRate:     req.CommissionRate,
		IsActive:           true,
		IntegrationType:    req.IntegrationType,
		AgreementStartDate: req.AgreementStartDate,
	}

	if err := s.repo.CreateBankPartner(ctx, partner); err != nil {
		return nil, fmt.Errorf("failed to register bank partner: %w", err)
	}

	return partner, nil
}

// GenerateInsuranceOffer creates an insurance offer for a bank customer
func (s *BancassuranceService) GenerateInsuranceOffer(ctx context.Context, req GenerateOfferRequest) (*models.InsuranceOffer, error) {
	partner, err := s.repo.GetBankPartner(ctx, req.BankPartnerID)
	if err != nil {
		return nil, fmt.Errorf("bank partner not found: %w", err)
	}
	if !partner.IsActive {
		return nil, fmt.Errorf("bank partner is not active")
	}

	// Get or create customer mapping
	mapping, err := s.repo.GetCustomerMapping(ctx, req.BankPartnerID, req.BankCustomerID)
	if err != nil {
		mapping = &models.BankCustomerMapping{
			BankPartnerID:  req.BankPartnerID,
			BankCustomerID: req.BankCustomerID,
			BankAccountNo:  req.AccountNumber,
			BVN:            req.BVN,
			FirstName:      req.FirstName,
			LastName:       req.LastName,
			Email:          req.Email,
			Phone:          req.Phone,
		}
		if err := s.repo.CreateCustomerMapping(ctx, mapping); err != nil {
			return nil, fmt.Errorf("failed to create customer mapping: %w", err)
		}
	}

	// Calculate premium based on offer type
	premium, sumAssured := s.calculateOfferPremium(req)

	offer := &models.InsuranceOffer{
		BankPartnerID:    req.BankPartnerID,
		CustomerMapID:    mapping.ID,
		OfferType:        req.OfferType,
		ProductCode:      s.getProductCode(req.OfferType),
		SumAssured:       sumAssured,
		Premium:          math.Round(premium*100) / 100,
		PremiumFrequency: req.PremiumFrequency,
		Term:             req.TermMonths,
		CoverageDetails: map[string]interface{}{
			"loan_amount":      req.LoanAmount,
			"interest_rate":    req.InterestRate,
			"cover_types":      req.CoverTypes,
			"waiting_period":   30,
			"exclusion_period": 90,
		},
		Status:    "generated",
		ExpiresAt: time.Now().AddDate(0, 0, 30),
	}

	if err := s.repo.CreateOffer(ctx, offer); err != nil {
		return nil, fmt.Errorf("failed to create offer: %w", err)
	}

	return offer, nil
}

// AcceptOffer processes offer acceptance and creates a policy
func (s *BancassuranceService) AcceptOffer(ctx context.Context, offerID uuid.UUID) (*models.LoanProtectionPolicy, error) {
	offer, err := s.repo.GetOffer(ctx, offerID)
	if err != nil {
		return nil, fmt.Errorf("offer not found: %w", err)
	}
	if offer.Status != "generated" && offer.Status != "presented" {
		return nil, fmt.Errorf("offer cannot be accepted in status: %s", offer.Status)
	}
	if time.Now().After(offer.ExpiresAt) {
		return nil, fmt.Errorf("offer has expired")
	}

	if err := s.repo.UpdateOfferStatus(ctx, offerID, "accepted"); err != nil {
		return nil, fmt.Errorf("failed to update offer status: %w", err)
	}

	// Generate policy number
	policyNumber := fmt.Sprintf("BAN-%s-%d", time.Now().Format("2006"), time.Now().UnixNano()%1000000)

	loanAmount := 0.0
	loanTenure := 0
	coverType := ""
	if details, ok := offer.CoverageDetails["loan_amount"].(float64); ok {
		loanAmount = details
	}
	if ct, ok := offer.CoverageDetails["cover_types"].([]interface{}); ok && len(ct) > 0 {
		if s, ok := ct[0].(string); ok {
			coverType = s
		}
	}
	loanTenure = offer.Term

	policy := &models.LoanProtectionPolicy{
		PolicyNumber:       policyNumber,
		OfferID:            offerID,
		BankPartnerID:      offer.BankPartnerID,
		CustomerMapID:      offer.CustomerMapID,
		LoanAmount:         loanAmount,
		LoanTenure:         loanTenure,
		OutstandingBalance: loanAmount,
		CoverType:          coverType,
		SumAssured:         offer.SumAssured,
		Premium:            offer.Premium,
		Status:             "active",
		InceptionDate:      time.Now(),
		ExpiryDate:         time.Now().AddDate(0, offer.Term, 0),
	}

	if err := s.repo.CreateLoanProtectionPolicy(ctx, policy); err != nil {
		return nil, fmt.Errorf("failed to create policy: %w", err)
	}

	return policy, nil
}

// CreateDebitMandate sets up automatic premium collection
func (s *BancassuranceService) CreateDebitMandate(ctx context.Context, req CreateMandateRequest) (*models.DebitMandate, error) {
	policy, err := s.repo.GetLoanProtectionPolicy(ctx, req.PolicyID)
	if err != nil {
		return nil, fmt.Errorf("policy not found: %w", err)
	}
	if policy.Status != "active" {
		return nil, fmt.Errorf("policy is not active")
	}

	mandateRef := fmt.Sprintf("MND-%s-%d", time.Now().Format("20060102"), time.Now().UnixNano()%1000000)
	nextDebit := s.calculateNextDebitDate(req.Frequency, time.Now())

	mandate := &models.DebitMandate{
		MandateRef:    mandateRef,
		BankPartnerID: policy.BankPartnerID,
		PolicyID:      req.PolicyID,
		AccountNumber: req.AccountNumber,
		AccountName:   req.AccountName,
		BankCode:      req.BankCode,
		Amount:        req.Amount,
		Frequency:     req.Frequency,
		StartDate:     time.Now(),
		Status:        "active",
		NextDebitDate: &nextDebit,
	}

	if err := s.repo.CreateDebitMandate(ctx, mandate); err != nil {
		return nil, fmt.Errorf("failed to create mandate: %w", err)
	}

	return mandate, nil
}

// ProcessPremiumCollection processes a premium collection from a bank
func (s *BancassuranceService) ProcessPremiumCollection(ctx context.Context, req ProcessCollectionRequest) (*models.PremiumCollection, error) {
	mandate, err := s.repo.GetDebitMandate(ctx, req.MandateID)
	if err != nil {
		return nil, fmt.Errorf("mandate not found: %w", err)
	}
	if mandate.Status != "active" {
		return nil, fmt.Errorf("mandate is not active")
	}

	transRef := fmt.Sprintf("COL-%s-%d", time.Now().Format("20060102"), time.Now().UnixNano()%1000000)

	collection := &models.PremiumCollection{
		MandateID:      req.MandateID,
		PolicyID:       mandate.PolicyID,
		BankPartnerID:  mandate.BankPartnerID,
		Amount:         req.Amount,
		TransactionRef: transRef,
		BankReference:  req.BankReference,
		Status:         "successful",
		CollectionDate: time.Now(),
		ValueDate:      time.Now(),
	}

	if err := s.repo.CreatePremiumCollection(ctx, collection); err != nil {
		return nil, fmt.Errorf("failed to record collection: %w", err)
	}

	// Update mandate next debit date
	nextDebit := s.calculateNextDebitDate(mandate.Frequency, time.Now())
	now := time.Now()
	mandate.LastDebitDate = &now
	mandate.NextDebitDate = &nextDebit

	return collection, nil
}

// CalculateCommissionSettlement calculates commission for a bank partner for a period
func (s *BancassuranceService) CalculateCommissionSettlement(ctx context.Context, bankPartnerID uuid.UUID, period string, startDate, endDate time.Time) (*models.CommissionSettlement, error) {
	partner, err := s.repo.GetBankPartner(ctx, bankPartnerID)
	if err != nil {
		return nil, fmt.Errorf("bank partner not found: %w", err)
	}

	totalPremium, count, err := s.repo.GetPremiumSummaryByPartner(ctx, bankPartnerID, startDate, endDate)
	if err != nil {
		return nil, fmt.Errorf("failed to get premium summary: %w", err)
	}

	commissionAmount := totalPremium * partner.CommissionRate
	withholdingTax := commissionAmount * 0.10 // 10% WHT
	netAmount := commissionAmount - withholdingTax

	settlement := &models.CommissionSettlement{
		BankPartnerID:    bankPartnerID,
		Period:           period,
		TotalPremium:     totalPremium,
		CommissionRate:   partner.CommissionRate,
		CommissionAmount: math.Round(commissionAmount*100) / 100,
		WithholdingTax:   math.Round(withholdingTax*100) / 100,
		NetAmount:        math.Round(netAmount*100) / 100,
		PolicyCount:      int(count),
		Status:           "calculated",
	}

	if err := s.repo.CreateCommissionSettlement(ctx, settlement); err != nil {
		return nil, fmt.Errorf("failed to create settlement: %w", err)
	}

	return settlement, nil
}

// ProcessWebhookEvent handles incoming webhook events from bank partners
func (s *BancassuranceService) ProcessWebhookEvent(ctx context.Context, bankPartnerID uuid.UUID, eventType string, payload map[string]interface{}) (*models.BankWebhookEvent, error) {
	event := &models.BankWebhookEvent{
		BankPartnerID: bankPartnerID,
		EventType:     eventType,
		Payload:       payload,
		Status:        "received",
	}

	if err := s.repo.CreateWebhookEvent(ctx, event); err != nil {
		return nil, fmt.Errorf("failed to record webhook event: %w", err)
	}

	// Process based on event type
	var processErr error
	switch eventType {
	case "loan_disbursed":
		processErr = s.handleLoanDisbursed(ctx, bankPartnerID, payload)
	case "loan_repaid":
		processErr = s.handleLoanRepaid(ctx, payload)
	case "account_closed":
		processErr = s.handleAccountClosed(ctx, payload)
	case "mandate_response":
		processErr = s.handleMandateResponse(ctx, payload)
	default:
		processErr = fmt.Errorf("unknown event type: %s", eventType)
	}

	status := "processed"
	errMsg := ""
	if processErr != nil {
		status = "failed"
		errMsg = processErr.Error()
	}

	if err := s.repo.UpdateWebhookEventStatus(ctx, event.ID, status, errMsg); err != nil {
		return nil, fmt.Errorf("failed to update event status: %w", err)
	}

	event.Status = status
	return event, processErr
}

// GetBankPartners lists all active bank partners
func (s *BancassuranceService) GetBankPartners(ctx context.Context) ([]models.BankPartner, error) {
	return s.repo.ListBankPartners(ctx)
}

// GetPoliciesByLoanAccount returns policies linked to a loan account
func (s *BancassuranceService) GetPoliciesByLoanAccount(ctx context.Context, loanAccountNo string) ([]models.LoanProtectionPolicy, error) {
	return s.repo.GetPoliciesByLoanAccount(ctx, loanAccountNo)
}

// GetSettlementsByPartner returns commission settlements for a bank partner
func (s *BancassuranceService) GetSettlementsByPartner(ctx context.Context, bankPartnerID uuid.UUID) ([]models.CommissionSettlement, error) {
	return s.repo.GetSettlementsByPartner(ctx, bankPartnerID)
}

// Helper functions

func (s *BancassuranceService) calculateOfferPremium(req GenerateOfferRequest) (float64, float64) {
	sumAssured := req.LoanAmount
	annualPremium := 0.0

	for _, coverType := range req.CoverTypes {
		if rate, ok := loanProtectionRates[coverType]; ok {
			annualPremium += sumAssured * rate
		}
	}

	// Adjust for term
	termYears := float64(req.TermMonths) / 12.0
	totalPremium := annualPremium * termYears

	// Convert to requested frequency
	switch req.PremiumFrequency {
	case "monthly":
		return totalPremium / float64(req.TermMonths), sumAssured
	case "quarterly":
		return totalPremium / (float64(req.TermMonths) / 3), sumAssured
	case "annually":
		return annualPremium, sumAssured
	case "single":
		return totalPremium * 0.95, sumAssured // 5% discount for single premium
	default:
		return annualPremium, sumAssured
	}
}

func (s *BancassuranceService) getProductCode(offerType string) string {
	switch offerType {
	case "loan_protection":
		return "BAN-LP"
	case "mortgage":
		return "BAN-MG"
	case "credit_life":
		return "BAN-CL"
	case "savings_linked":
		return "BAN-SL"
	default:
		return "BAN-GEN"
	}
}

func (s *BancassuranceService) calculateNextDebitDate(frequency string, from time.Time) time.Time {
	switch frequency {
	case "monthly":
		return from.AddDate(0, 1, 0)
	case "quarterly":
		return from.AddDate(0, 3, 0)
	case "annually":
		return from.AddDate(1, 0, 0)
	default:
		return from.AddDate(0, 1, 0)
	}
}

func (s *BancassuranceService) handleLoanDisbursed(ctx context.Context, bankPartnerID uuid.UUID, payload map[string]interface{}) error {
	// Auto-generate insurance offer for newly disbursed loan
	customerID, _ := payload["customer_id"].(string)
	loanAmount, _ := payload["loan_amount"].(float64)
	tenureMonths, _ := payload["tenure_months"].(float64)

	if customerID == "" || loanAmount == 0 {
		return fmt.Errorf("invalid loan_disbursed payload: missing customer_id or loan_amount")
	}

	req := GenerateOfferRequest{
		BankPartnerID:    bankPartnerID,
		BankCustomerID:   customerID,
		OfferType:        "loan_protection",
		LoanAmount:       loanAmount,
		TermMonths:       int(tenureMonths),
		CoverTypes:       []string{"death", "disability"},
		PremiumFrequency: "monthly",
	}

	_, err := s.GenerateInsuranceOffer(ctx, req)
	return err
}

func (s *BancassuranceService) handleLoanRepaid(ctx context.Context, payload map[string]interface{}) error {
	loanAccountNo, _ := payload["loan_account_no"].(string)
	if loanAccountNo == "" {
		return fmt.Errorf("invalid loan_repaid payload: missing loan_account_no")
	}

	policies, err := s.repo.GetPoliciesByLoanAccount(ctx, loanAccountNo)
	if err != nil {
		return err
	}

	for _, policy := range policies {
		if policy.Status == "active" {
			if err := s.repo.UpdatePolicyStatus(ctx, policy.ID, "expired"); err != nil {
				return fmt.Errorf("failed to expire policy %s: %w", policy.PolicyNumber, err)
			}
		}
	}
	return nil
}

func (s *BancassuranceService) handleAccountClosed(ctx context.Context, payload map[string]interface{}) error {
	accountNo, _ := payload["account_number"].(string)
	if accountNo == "" {
		return fmt.Errorf("invalid account_closed payload: missing account_number")
	}
	// Cancel active mandates for the closed account
	return nil
}

func (s *BancassuranceService) handleMandateResponse(ctx context.Context, payload map[string]interface{}) error {
	mandateRef, _ := payload["mandate_ref"].(string)
	status, _ := payload["status"].(string)
	if mandateRef == "" || status == "" {
		return fmt.Errorf("invalid mandate_response payload")
	}
	return nil
}
