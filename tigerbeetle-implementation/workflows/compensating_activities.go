package workflows

import (
	"context"
	"fmt"
	"log"

	"insurance-platform/models"
)

// Compensating Activities
// These activities are executed when the workflow needs to roll back due to failures.
// They implement the compensation logic for the Saga pattern.

// CancelPolicyActivity cancels a policy by updating its status to CANCELLED.
// This is a compensating action for IssuePolicyActivity.
func (a *Activities) CancelPolicyActivity(ctx context.Context, policyID string) error {
	log.Printf("Compensating Activity: CancelPolicyActivity started for policy: %s", policyID)

	err := a.PolicyRepository.UpdateStatus(ctx, policyID, models.PolicyStatusCancelled)
	if err != nil {
		log.Printf("ERROR: Failed to cancel policy: %v", err)
		return fmt.Errorf("failed to cancel policy: %w", err)
	}

	log.Printf("Compensating Activity: CancelPolicyActivity completed. Policy %s cancelled", policyID)
	return nil
}

// DeletePolicyDocumentActivity deletes a generated policy document.
// This is a compensating action for GeneratePolicyDocumentActivity.
func (a *Activities) DeletePolicyDocumentActivity(ctx context.Context, policyID string) error {
	log.Printf("Compensating Activity: DeletePolicyDocumentActivity started for policy: %s", policyID)

	err := a.DocumentService.DeletePolicyDocument(ctx, policyID)
	if err != nil {
		log.Printf("ERROR: Failed to delete policy document: %v", err)
		return fmt.Errorf("failed to delete policy document: %w", err)
	}

	log.Printf("Compensating Activity: DeletePolicyDocumentActivity completed. Document deleted for policy %s", policyID)
	return nil
}

// ProcessRefundActivity processes a refund for a completed payment.
// This is a compensating action for ProcessPremiumPaymentActivity.
func (a *Activities) ProcessRefundActivity(ctx context.Context, req models.RefundRequest) error {
	log.Printf("Compensating Activity: ProcessRefundActivity started for payment: %d", req.PaymentID)

	response, err := a.PaymentService.ProcessRefund(ctx, req)
	if err != nil {
		log.Printf("ERROR: Failed to process refund: %v", err)
		return fmt.Errorf("failed to process refund: %w", err)
	}

	if response.Status != models.PaymentStatusCompleted {
		log.Printf("WARNING: Refund not completed. Status: %s, Reason: %s",
			response.Status, response.FailureReason)
		return fmt.Errorf("refund failed: %s", response.FailureReason)
	}

	log.Printf("Compensating Activity: ProcessRefundActivity completed. Refund transaction: %s",
		response.TransactionID)
	return nil
}

// DeletePolicyRecordActivity deletes a policy record from the database.
// This is a compensating action for CreatePolicyRecordActivity.
func (a *Activities) DeletePolicyRecordActivity(ctx context.Context, policyID string) error {
	log.Printf("Compensating Activity: DeletePolicyRecordActivity started for policy: %s", policyID)

	err := a.PolicyRepository.Delete(ctx, policyID)
	if err != nil {
		log.Printf("ERROR: Failed to delete policy record: %v", err)
		return fmt.Errorf("failed to delete policy record: %w", err)
	}

	log.Printf("Compensating Activity: DeletePolicyRecordActivity completed. Policy %s deleted", policyID)
	return nil
}

// SendCompensationNotificationActivity sends a notification to the customer
// informing them that the policy issuance failed and a refund has been processed.
func (a *Activities) SendCompensationNotificationActivity(ctx context.Context, req CompensationNotificationRequest) error {
	log.Printf("Compensating Activity: SendCompensationNotificationActivity started for customer: %s", req.CustomerID)

	notificationReq := models.NotificationRequest{
		CustomerID: req.CustomerID,
		PolicyID:   req.PolicyID,
	}

	notificationReq.Message = req.Reason
	err := a.NotificationService.SendCompensationNotification(ctx, notificationReq)
	if err != nil {
		// Log error but don't fail - notification is non-critical
		log.Printf("WARNING: Failed to send compensation notification: %v", err)
		return nil
	}

	log.Printf("Compensating Activity: SendCompensationNotificationActivity completed")
	return nil
}

// CompensationNotificationRequest represents a request to send a compensation notification.
type CompensationNotificationRequest struct {
	CustomerID string `json:"customer_id"`
	PolicyID   string `json:"policy_id"`
	Reason     string `json:"reason"`
}
