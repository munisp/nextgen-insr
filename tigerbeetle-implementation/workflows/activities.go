package workflows

import (
	"context"
	"fmt"
	"log"
	"time"

	"insurance-platform/models"
	"insurance-platform/service"
)

// Activities struct holds dependencies for all workflow activities.
// This struct is registered with Temporal workers and provides access to
// services, databases, and external APIs needed by activities.
type Activities struct {
	PaymentService      *service.PaymentService
	VerificationService VerificationServiceClient
	DocumentService     DocumentServiceClient
	NotificationService NotificationServiceClient
	PolicyRepository    PolicyRepository
}

// VerificationServiceClient is an interface for calling the Verification Service.
type VerificationServiceClient interface {
	VerifyNIN(ctx context.Context, customerID string) (*models.VerificationResult, error)
}

// DocumentServiceClient is an interface for document generation.
type DocumentServiceClient interface {
	GeneratePolicyDocument(ctx context.Context, policyID string) (string, error)
	DeletePolicyDocument(ctx context.Context, policyID string) error
}

// NotificationServiceClient is an interface for sending notifications.
type NotificationServiceClient interface {
	SendPolicyNotification(ctx context.Context, req models.NotificationRequest) error
	SendCompensationNotification(ctx context.Context, req models.NotificationRequest) error
}

// PolicyRepository is an interface for policy database operations.
type PolicyRepository interface {
	Create(ctx context.Context, policy models.Policy) (string, error)
	UpdateStatus(ctx context.Context, policyID string, status models.PolicyStatus) error
	GetByID(ctx context.Context, policyID string) (*models.Policy, error)
	Delete(ctx context.Context, policyID string) error
}

// VerifyCustomerNINActivity verifies a customer's National Identification Number.
// This activity calls the Verification Service to validate the customer's identity
// against the NIMC (National Identity Management Commission) database.
func (a *Activities) VerifyCustomerNINActivity(ctx context.Context, customerID string) (*models.VerificationResult, error) {
	log.Printf("Activity: VerifyCustomerNINActivity started for customer: %s", customerID)

	result, err := a.VerificationService.VerifyNIN(ctx, customerID)
	if err != nil {
		log.Printf("ERROR: NIN verification failed for customer %s: %v", customerID, err)
		return nil, fmt.Errorf("NIN verification failed: %w", err)
	}

	if !result.Success {
		log.Printf("WARNING: NIN verification unsuccessful for customer %s: %s", customerID, result.FailureReason)
		return result, nil
	}

	log.Printf("Activity: VerifyCustomerNINActivity completed successfully for customer: %s", customerID)
	return result, nil
}

// CalculateRiskAndPremiumActivity calculates the risk score and premium for a policy.
// This activity uses various factors including policy type, sum assured, duration,
// customer demographics, and geospatial risk data to determine the appropriate premium.
func (a *Activities) CalculateRiskAndPremiumActivity(ctx context.Context, policy models.Policy) (*models.PremiumDetails, error) {
	log.Printf("Activity: CalculateRiskAndPremiumActivity started for policy type: %s", policy.PolicyType)

	// Base premium calculation based on policy type and sum assured
	basePremium := calculateBasePremium(policy.PolicyType, policy.SumAssured)

	// Apply risk factors
	riskScore := calculateRiskScore(policy)
	riskMultiplier := 1.0 + (riskScore / 100.0)

	// Apply duration factor
	durationMultiplier := calculateDurationMultiplier(policy.DurationMonths)

	// Calculate final premium
	finalPremium := basePremium * riskMultiplier * durationMultiplier

	// Apply frequency adjustment
	frequencyDivisor := getFrequencyDivisor(policy.PremiumFrequency)
	premiumPerPayment := finalPremium / frequencyDivisor

	premiumDetails := &models.PremiumDetails{
		Amount:             premiumPerPayment,
		AnnualAmount:       finalPremium,
		RiskScore:          riskScore,
		BasePremium:        basePremium,
		RiskMultiplier:     riskMultiplier,
		DurationMultiplier: durationMultiplier,
		Frequency:          policy.PremiumFrequency,
		Currency:           "NGN",
	}

	log.Printf("Activity: CalculateRiskAndPremiumActivity completed. Premium: %.2f NGN, Risk Score: %.2f",
		premiumPerPayment, riskScore)

	return premiumDetails, nil
}

// CreatePolicyRecordActivity creates a new policy record in the database with PENDING status.
func (a *Activities) CreatePolicyRecordActivity(ctx context.Context, policy models.Policy) (string, error) {
	log.Printf("Activity: CreatePolicyRecordActivity started for customer: %s", policy.CustomerID)

	// Set initial status
	policy.Status = models.PolicyStatusPending
	policy.CreatedAt = time.Now()
	policy.UpdatedAt = time.Now()

	policyID, err := a.PolicyRepository.Create(ctx, policy)
	if err != nil {
		log.Printf("ERROR: Failed to create policy record: %v", err)
		return "", fmt.Errorf("failed to create policy record: %w", err)
	}

	log.Printf("Activity: CreatePolicyRecordActivity completed. PolicyID: %s", policyID)
	return policyID, nil
}

// ProcessPremiumPaymentActivity processes the initial premium payment for a policy.
// This is the core activity that integrates with the Payment Service and TigerBeetle
// to execute an atomic financial transaction.
func (a *Activities) ProcessPremiumPaymentActivity(ctx context.Context, req models.PaymentRequest) (*models.PaymentResult, error) {
	log.Printf("Activity: ProcessPremiumPaymentActivity started. PolicyID: %s, Amount: %.2f %s",
		req.PolicyID, req.Amount, req.Currency)

	// Validate payment request
	if req.Amount <= 0 {
		return nil, fmt.Errorf("invalid payment amount: %.2f", req.Amount)
	}
	if req.Currency != "NGN" {
		return nil, fmt.Errorf("unsupported currency: %s", req.Currency)
	}

	// Process payment through Payment Service
	// This will:
	// 1. Create an atomic transfer in TigerBeetle
	// 2. Record the transaction in PostgreSQL
	// 3. Publish a payment event to Kafka
	response, err := a.PaymentService.ProcessPremiumPayment(ctx, req)
	if err != nil {
		log.Printf("ERROR: Premium payment processing failed: %v", err)
		return &models.PaymentResult{
			Status:        models.PaymentStatusFailed,
			FailureReason: err.Error(),
		}, nil // Return nil error so workflow can handle the failure
	}

	// Check if payment was successful
	if response.Status != models.PaymentStatusCompleted {
		log.Printf("WARNING: Premium payment not completed. Status: %s, Reason: %s",
			response.Status, response.FailureReason)
		return &models.PaymentResult{
			Status:        response.Status,
			FailureReason: response.FailureReason,
		}, nil
	}

	result := &models.PaymentResult{
		Status:        models.PaymentStatusCompleted,
		TransactionID: response.TransactionID,
		PaymentID:     response.PaymentID,
		ProcessedAt:   time.Now(),
	}

	log.Printf("Activity: ProcessPremiumPaymentActivity completed successfully. TransactionID: %s, PaymentID: %d",
		result.TransactionID, result.PaymentID)

	return result, nil
}

// GeneratePolicyDocumentActivity generates a PDF policy document.
func (a *Activities) GeneratePolicyDocumentActivity(ctx context.Context, policyID string) (string, error) {
	log.Printf("Activity: GeneratePolicyDocumentActivity started for policy: %s", policyID)

	documentURL, err := a.DocumentService.GeneratePolicyDocument(ctx, policyID)
	if err != nil {
		log.Printf("ERROR: Failed to generate policy document: %v", err)
		return "", fmt.Errorf("failed to generate policy document: %w", err)
	}

	log.Printf("Activity: GeneratePolicyDocumentActivity completed. Document URL: %s", documentURL)
	return documentURL, nil
}

// IssuePolicyActivity updates the policy status to ACTIVE, officially issuing the policy.
func (a *Activities) IssuePolicyActivity(ctx context.Context, policyID string) error {
	log.Printf("Activity: IssuePolicyActivity started for policy: %s", policyID)

	err := a.PolicyRepository.UpdateStatus(ctx, policyID, models.PolicyStatusActive)
	if err != nil {
		log.Printf("ERROR: Failed to issue policy: %v", err)
		return fmt.Errorf("failed to issue policy: %w", err)
	}

	log.Printf("Activity: IssuePolicyActivity completed. Policy %s is now ACTIVE", policyID)
	return nil
}

// SendPolicyNotificationsActivity sends notifications to the customer about the new policy.
func (a *Activities) SendPolicyNotificationsActivity(ctx context.Context, req models.NotificationRequest) error {
	log.Printf("Activity: SendPolicyNotificationsActivity started for customer: %s", req.CustomerID)

	err := a.NotificationService.SendPolicyNotification(ctx, req)
	if err != nil {
		// Log error but don't fail the activity - notifications are non-critical
		log.Printf("WARNING: Failed to send policy notification: %v", err)
		return nil
	}

	log.Printf("Activity: SendPolicyNotificationsActivity completed successfully")
	return nil
}

// SchedulePremiumRemindersActivity schedules future premium payment reminders.
func (a *Activities) SchedulePremiumRemindersActivity(ctx context.Context, policyID string) error {
	log.Printf("Activity: SchedulePremiumRemindersActivity started for policy: %s", policyID)

	// Get policy details
	policy, err := a.PolicyRepository.GetByID(ctx, policyID)
	if err != nil {
		return fmt.Errorf("failed to get policy: %w", err)
	}

	// Calculate reminder schedule based on premium frequency
	reminderDates := calculateReminderDates(policy.PremiumFrequency, policy.StartDate, policy.DurationMonths)

	// In a real implementation, this would schedule reminders in a job queue or calendar system
	log.Printf("Scheduled %d premium reminders for policy %s", len(reminderDates), policyID)

	log.Printf("Activity: SchedulePremiumRemindersActivity completed")
	return nil
}

// Helper functions

func calculateBasePremium(policyType models.PolicyType, sumAssured float64) float64 {
	// Base premium rates (percentage of sum assured per year)
	rates := map[models.PolicyType]float64{
		models.PolicyTypeLife:     0.02, // 2% of sum assured
		models.PolicyTypeHealth:   0.05, // 5% of sum assured
		models.PolicyTypeMotor:    0.08, // 8% of sum assured
		models.PolicyTypeProperty: 0.03, // 3% of sum assured
		models.PolicyTypeTravel:   0.04, // 4% of sum assured
	}

	rate, exists := rates[policyType]
	if !exists {
		rate = 0.05 // Default rate
	}

	return sumAssured * rate
}

func calculateRiskScore(policy models.Policy) float64 {
	// Simple risk scoring algorithm
	// In a real system, this would use ML models and geospatial data
	baseScore := 50.0

	// Age factor (for life/health insurance)
	// Assuming customer age is available in policy data
	// Higher age = higher risk for life/health

	// Policy type factor
	typeRiskFactors := map[models.PolicyType]float64{
		models.PolicyTypeLife:     10.0,
		models.PolicyTypeHealth:   15.0,
		models.PolicyTypeMotor:    20.0,
		models.PolicyTypeProperty: 12.0,
		models.PolicyTypeTravel:   8.0,
	}

	typeRisk, exists := typeRiskFactors[policy.PolicyType]
	if !exists {
		typeRisk = 10.0
	}

	// Sum assured factor (higher coverage = higher risk)
	sumAssuredFactor := 0.0
	if policy.SumAssured > 10000000 { // > 10M NGN
		sumAssuredFactor = 15.0
	} else if policy.SumAssured > 5000000 { // > 5M NGN
		sumAssuredFactor = 10.0
	} else if policy.SumAssured > 1000000 { // > 1M NGN
		sumAssuredFactor = 5.0
	}

	totalScore := baseScore + typeRisk + sumAssuredFactor

	// Normalize to 0-100 range
	if totalScore > 100 {
		totalScore = 100
	}

	return totalScore
}

func calculateDurationMultiplier(durationMonths int) float64 {
	// Longer duration = slight discount
	if durationMonths >= 12 {
		return 0.95 // 5% discount for annual policies
	} else if durationMonths >= 6 {
		return 0.98 // 2% discount for 6-month policies
	}
	return 1.0
}

func getFrequencyDivisor(frequency models.PremiumFrequency) float64 {
	switch frequency {
	case models.PremiumFrequencyDaily:
		return 365.0
	case models.PremiumFrequencyWeekly:
		return 52.0
	case models.PremiumFrequencyMonthly:
		return 12.0
	case models.PremiumFrequencyQuarterly:
		return 4.0
	case models.PremiumFrequencyAnnually:
		return 1.0
	default:
		return 1.0
	}
}

func calculateReminderDates(frequency models.PremiumFrequency, startDate time.Time, durationMonths int) []time.Time {
	var dates []time.Time
	endDate := startDate.AddDate(0, durationMonths, 0)

	currentDate := startDate
	for currentDate.Before(endDate) {
		switch frequency {
		case models.PremiumFrequencyDaily:
			currentDate = currentDate.AddDate(0, 0, 1)
		case models.PremiumFrequencyWeekly:
			currentDate = currentDate.AddDate(0, 0, 7)
		case models.PremiumFrequencyMonthly:
			currentDate = currentDate.AddDate(0, 1, 0)
		case models.PremiumFrequencyQuarterly:
			currentDate = currentDate.AddDate(0, 3, 0)
		case models.PremiumFrequencyAnnually:
			currentDate = currentDate.AddDate(1, 0, 0)
		}

		if currentDate.Before(endDate) {
			// Schedule reminder 3 days before payment due
			reminderDate := currentDate.AddDate(0, 0, -3)
			dates = append(dates, reminderDate)
		}
	}

	return dates
}
