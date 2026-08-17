package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"insurance-platform/models"
)

// PolicyIssuanceWorkflow orchestrates the entire policy issuance process.
// It implements the Saga pattern with compensating actions for failure scenarios.
//
// Workflow Steps:
// 1. Verify Customer NIN
// 2. Calculate Risk and Premium
// 3. Create Policy Record (status: PENDING)
// 4. Process Premium Payment
// 5. Generate Policy Document
// 6. Issue Policy (status: ACTIVE)
// 7. Send Notifications
// 8. Schedule Premium Reminders
//
// If any step fails, compensating actions are executed to maintain consistency.
func PolicyIssuanceWorkflow(ctx workflow.Context, input PolicyIssuanceInput) (*PolicyIssuanceResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("PolicyIssuanceWorkflow started", "CustomerID", input.CustomerID, "PolicyType", input.PolicyType)

	// Configure activity options with timeouts and retries
	ao := workflow.ActivityOptions{
		StartToCloseTimeout:    10 * time.Minute,
		ScheduleToStartTimeout: 1 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    100 * time.Second,
			MaximumAttempts:    5,
			NonRetryableErrorTypes: []string{
				"NIN_VERIFICATION_FAILED",
				"PAYMENT_FAILED",
				"INVALID_POLICY_DATA",
			},
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Initialize workflow state for saga pattern
	var workflowState PolicyIssuanceState
	workflowState.CompletedSteps = make([]string, 0)

	// Defer compensation logic in case of panic or failure
	defer func() {
		if r := recover(); r != nil {
			logger.Error("Workflow panicked, executing compensations", "error", r)
			executeCompensations(ctx, &workflowState)
		}
	}()

	// Step 1: Verify Customer NIN
	logger.Info("Step 1: Verifying customer NIN")
	var verificationResult models.VerificationResult
	err := workflow.ExecuteActivity(ctx, "VerifyCustomerNINActivity", input.CustomerID).Get(ctx, &verificationResult)
	if err != nil {
		logger.Error("NIN verification failed", "error", err)
		return nil, temporal.NewApplicationError("NIN_VERIFICATION_FAILED", "VERIFICATION_ERROR", err)
	}

	if !verificationResult.Success {
		logger.Warn("NIN verification unsuccessful", "reason", verificationResult.FailureReason)
		return nil, temporal.NewApplicationError(
			"NIN_VERIFICATION_FAILED",
			"VERIFICATION_ERROR",
			fmt.Sprintf("NIN verification failed: %s", verificationResult.FailureReason),
		)
	}

	workflowState.CompletedSteps = append(workflowState.CompletedSteps, "NIN_VERIFIED")
	workflowState.VerificationResult = &verificationResult
	logger.Info("Step 1 completed: NIN verified successfully")

	// Step 2: Calculate Risk and Premium
	logger.Info("Step 2: Calculating risk and premium")
	policy := models.Policy{
		CustomerID:       input.CustomerID,
		PolicyType:       input.PolicyType,
		SumAssured:       input.SumAssured,
		PremiumFrequency: input.PremiumFrequency,
		DurationMonths:   input.DurationMonths,
		StartDate:        input.StartDate,
		EndDate:          input.StartDate.AddDate(0, input.DurationMonths, 0),
	}

	var premiumDetails models.PremiumDetails
	err = workflow.ExecuteActivity(ctx, "CalculateRiskAndPremiumActivity", policy).Get(ctx, &premiumDetails)
	if err != nil {
		logger.Error("Premium calculation failed", "error", err)
		return nil, err
	}

	policy.Premium = premiumDetails.Amount
	workflowState.CompletedSteps = append(workflowState.CompletedSteps, "PREMIUM_CALCULATED")
	workflowState.PremiumDetails = &premiumDetails
	logger.Info("Step 2 completed: Premium calculated", "amount", premiumDetails.Amount, "riskScore", premiumDetails.RiskScore)

	// Step 3: Create Policy Record
	logger.Info("Step 3: Creating policy record")
	var policyID string
	err = workflow.ExecuteActivity(ctx, "CreatePolicyRecordActivity", policy).Get(ctx, &policyID)
	if err != nil {
		logger.Error("Policy record creation failed", "error", err)
		return nil, err
	}

	workflowState.CompletedSteps = append(workflowState.CompletedSteps, "POLICY_CREATED")
	workflowState.PolicyID = policyID
	logger.Info("Step 3 completed: Policy record created", "policyID", policyID)

	// Step 4: Process Premium Payment (CRITICAL STEP)
	logger.Info("Step 4: Processing premium payment")
	paymentRequest := models.PaymentRequest{
		PolicyID:      policyID,
		CustomerID:    input.CustomerID,
		Amount:        premiumDetails.Amount,
		Currency:      "NGN",
		PaymentMethod: input.PaymentMethod,
	}

	var paymentResult models.PaymentResult
	err = workflow.ExecuteActivity(ctx, "ProcessPremiumPaymentActivity", paymentRequest).Get(ctx, &paymentResult)
	if err != nil {
		logger.Error("Payment processing activity failed with error", "error", err)
		// Execute compensations before returning
		executeCompensations(ctx, &workflowState)
		return nil, err
	}

	// Check payment result status
	if paymentResult.Status != models.PaymentStatusCompleted {
		logger.Error("Payment processing failed",
			"status", paymentResult.Status,
			"reason", paymentResult.FailureReason)

		// Payment failed - execute compensations
		executeCompensations(ctx, &workflowState)

		return &PolicyIssuanceResult{
			Success:       false,
			PolicyID:      policyID,
			FailureReason: fmt.Sprintf("Payment failed: %s", paymentResult.FailureReason),
			FailureStep:   "PAYMENT_PROCESSING",
		}, nil // Return nil error but failed result
	}

	workflowState.CompletedSteps = append(workflowState.CompletedSteps, "PAYMENT_COMPLETED")
	workflowState.PaymentResult = &paymentResult
	logger.Info("Step 4 completed: Payment processed successfully",
		"transactionID", paymentResult.TransactionID,
		"paymentID", paymentResult.PaymentID)

	// Step 5: Generate Policy Document
	logger.Info("Step 5: Generating policy document")
	var documentURL string
	err = workflow.ExecuteActivity(ctx, "GeneratePolicyDocumentActivity", policyID).Get(ctx, &documentURL)
	if err != nil {
		logger.Error("Document generation failed", "error", err)
		// Document generation failure is not critical - we can retry later
		// But we should still compensate the payment
		logger.Warn("Executing compensations due to document generation failure")
		executeCompensations(ctx, &workflowState)
		return nil, err
	}

	workflowState.CompletedSteps = append(workflowState.CompletedSteps, "DOCUMENT_GENERATED")
	workflowState.DocumentURL = documentURL
	logger.Info("Step 5 completed: Policy document generated", "documentURL", documentURL)

	// Step 6: Issue Policy (Update status to ACTIVE)
	logger.Info("Step 6: Issuing policy")
	err = workflow.ExecuteActivity(ctx, "IssuePolicyActivity", policyID).Get(ctx, nil)
	if err != nil {
		logger.Error("Policy issuance failed", "error", err)
		// Policy issuance failure is critical - compensate everything
		executeCompensations(ctx, &workflowState)
		return nil, err
	}

	workflowState.CompletedSteps = append(workflowState.CompletedSteps, "POLICY_ISSUED")
	logger.Info("Step 6 completed: Policy issued successfully")

	// Step 7: Send Notifications (Non-critical)
	logger.Info("Step 7: Sending notifications")
	notificationRequest := models.NotificationRequest{
		CustomerID:  input.CustomerID,
		PolicyID:    policyID,
		DocumentURL: documentURL,
	}

	err = workflow.ExecuteActivity(ctx, "SendPolicyNotificationsActivity", notificationRequest).Get(ctx, nil)
	if err != nil {
		// Notification failure is non-critical - log and continue
		logger.Warn("Failed to send notifications", "error", err)
	} else {
		workflowState.CompletedSteps = append(workflowState.CompletedSteps, "NOTIFICATIONS_SENT")
		logger.Info("Step 7 completed: Notifications sent")
	}

	// Step 8: Schedule Premium Reminders (Non-critical)
	logger.Info("Step 8: Scheduling premium reminders")
	err = workflow.ExecuteActivity(ctx, "SchedulePremiumRemindersActivity", policyID).Get(ctx, nil)
	if err != nil {
		// Reminder scheduling failure is non-critical - log and continue
		logger.Warn("Failed to schedule reminders", "error", err)
	} else {
		workflowState.CompletedSteps = append(workflowState.CompletedSteps, "REMINDERS_SCHEDULED")
		logger.Info("Step 8 completed: Premium reminders scheduled")
	}

	// Workflow completed successfully
	result := &PolicyIssuanceResult{
		Success:        true,
		PolicyID:       policyID,
		PolicyNumber:   generatePolicyNumber(policyID),
		TransactionID:  paymentResult.TransactionID,
		PaymentID:      paymentResult.PaymentID,
		DocumentURL:    documentURL,
		Premium:        premiumDetails.Amount,
		RiskScore:      premiumDetails.RiskScore,
		CompletedSteps: workflowState.CompletedSteps,
		CompletedAt:    workflow.Now(ctx),
	}

	logger.Info("PolicyIssuanceWorkflow completed successfully",
		"policyID", policyID,
		"transactionID", paymentResult.TransactionID)

	return result, nil
}

// executeCompensations executes compensating actions for completed steps
// This implements the Saga pattern for distributed transaction management
func executeCompensations(ctx workflow.Context, state *PolicyIssuanceState) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Executing compensations", "completedSteps", state.CompletedSteps)

	// Configure compensation activity options (shorter timeout, no retries)
	compensationAO := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval: time.Second,
			MaximumAttempts: 3,
		},
	}
	compensationCtx := workflow.WithActivityOptions(ctx, compensationAO)

	// Execute compensations in reverse order
	for i := len(state.CompletedSteps) - 1; i >= 0; i-- {
		step := state.CompletedSteps[i]

		switch step {
		case "POLICY_ISSUED":
			logger.Info("Compensating: Cancelling policy", "policyID", state.PolicyID)
			err := workflow.ExecuteActivity(compensationCtx, "CancelPolicyActivity", state.PolicyID).Get(compensationCtx, nil)
			if err != nil {
				logger.Error("Failed to cancel policy", "error", err)
			}

		case "DOCUMENT_GENERATED":
			logger.Info("Compensating: Deleting policy document", "policyID", state.PolicyID)
			err := workflow.ExecuteActivity(compensationCtx, "DeletePolicyDocumentActivity", state.PolicyID).Get(compensationCtx, nil)
			if err != nil {
				logger.Error("Failed to delete document", "error", err)
			}

		case "PAYMENT_COMPLETED":
			logger.Info("Compensating: Refunding payment", "transactionID", state.PaymentResult.TransactionID)
			refundRequest := models.RefundRequest{
				PaymentID: state.PaymentResult.PaymentID,
				Amount:    state.PremiumDetails.Amount,
				Reason:    "Policy issuance failed - automatic refund",
			}
			err := workflow.ExecuteActivity(compensationCtx, "ProcessRefundActivity", refundRequest).Get(compensationCtx, nil)
			if err != nil {
				logger.Error("Failed to process refund", "error", err)
			}

		case "POLICY_CREATED":
			logger.Info("Compensating: Deleting policy record", "policyID", state.PolicyID)
			err := workflow.ExecuteActivity(compensationCtx, "DeletePolicyRecordActivity", state.PolicyID).Get(compensationCtx, nil)
			if err != nil {
				logger.Error("Failed to delete policy record", "error", err)
			}

		case "PREMIUM_CALCULATED":
			// No compensation needed for calculation
			logger.Info("No compensation needed for premium calculation")

		case "NIN_VERIFIED":
			// No compensation needed for verification
			logger.Info("No compensation needed for NIN verification")
		}
	}

	logger.Info("Compensations completed")
}

// generatePolicyNumber generates a unique policy number based on policy ID
func generatePolicyNumber(policyID string) string {
	// Format: POL-YYYY-XXXXXX
	year := time.Now().Year()
	return fmt.Sprintf("POL-%d-%s", year, policyID[len(policyID)-6:])
}

// PolicyIssuanceInput represents the input to the policy issuance workflow
type PolicyIssuanceInput struct {
	CustomerID       string                  `json:"customer_id"`
	PolicyType       models.PolicyType       `json:"policy_type"`
	SumAssured       float64                 `json:"sum_assured"`
	PremiumFrequency models.PremiumFrequency `json:"premium_frequency"`
	DurationMonths   int                     `json:"duration_months"`
	StartDate        time.Time               `json:"start_date"`
	PaymentMethod    models.PaymentMethod    `json:"payment_method"`
}

// PolicyIssuanceResult represents the result of the policy issuance workflow
type PolicyIssuanceResult struct {
	Success        bool      `json:"success"`
	PolicyID       string    `json:"policy_id,omitempty"`
	PolicyNumber   string    `json:"policy_number,omitempty"`
	TransactionID  string    `json:"transaction_id,omitempty"`
	PaymentID      int64     `json:"payment_id,omitempty"`
	DocumentURL    string    `json:"document_url,omitempty"`
	Premium        float64   `json:"premium,omitempty"`
	RiskScore      float64   `json:"risk_score,omitempty"`
	CompletedSteps []string  `json:"completed_steps,omitempty"`
	CompletedAt    time.Time `json:"completed_at,omitempty"`
	FailureReason  string    `json:"failure_reason,omitempty"`
	FailureStep    string    `json:"failure_step,omitempty"`
}

// PolicyIssuanceState tracks the workflow state for saga compensation
type PolicyIssuanceState struct {
	CompletedSteps     []string                   `json:"completed_steps"`
	PolicyID           string                     `json:"policy_id"`
	VerificationResult *models.VerificationResult `json:"verification_result"`
	PremiumDetails     *models.PremiumDetails     `json:"premium_details"`
	PaymentResult      *models.PaymentResult      `json:"payment_result"`
	DocumentURL        string                     `json:"document_url"`
}
