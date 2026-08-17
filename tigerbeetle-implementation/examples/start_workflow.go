package main

import (
	"context"
	"log"
	"time"

	"go.temporal.io/api/workflowservice/v1"
	"go.temporal.io/sdk/client"

	"insurance-platform/models"
	"insurance-platform/workflows"
)

// Example: How to start a PolicyIssuanceWorkflow from a client application
func main() {
	log.Println("Starting Policy Issuance Workflow Client Example...")

	// Create Temporal client
	c, err := client.Dial(client.Options{
		HostPort:  "localhost:7233",
		Namespace: "default",
	})
	if err != nil {
		log.Fatalf("Failed to create Temporal client: %v", err)
	}
	defer c.Close()

	// Example 1: Start workflow with successful payment scenario
	log.Println("\n=== Example 1: Successful Policy Issuance ===")
	startSuccessfulWorkflow(c)

	// Example 2: Start workflow that will fail due to insufficient funds
	log.Println("\n=== Example 2: Policy Issuance with Payment Failure ===")
	startFailedPaymentWorkflow(c)

	// Example 3: Query workflow status
	log.Println("\n=== Example 3: Query Workflow Status ===")
	queryWorkflowStatus(c, "policy-workflow-success-001")

	log.Println("\nAll examples completed")
}

// startSuccessfulWorkflow demonstrates starting a workflow that should succeed
func startSuccessfulWorkflow(c client.Client) {
	ctx := context.Background()

	// Prepare workflow input
	input := workflows.PolicyIssuanceInput{
		CustomerID:       "12345",
		PolicyType:       models.PolicyTypeLife,
		SumAssured:       1000000.00, // 1M NGN
		PremiumFrequency: models.PremiumFrequencyMonthly,
		DurationMonths:   12,
		StartDate:        time.Now(),
		PaymentMethod:    models.PaymentMethodCard,
	}

	// Configure workflow options
	workflowOptions := client.StartWorkflowOptions{
		ID:        "policy-workflow-success-001",
		TaskQueue: "policy-task-queue",
	}

	// Start workflow execution
	we, err := c.ExecuteWorkflow(ctx, workflowOptions, workflows.PolicyIssuanceWorkflow, input)
	if err != nil {
		log.Fatalf("Failed to start workflow: %v", err)
	}

	log.Printf("Started workflow with ID: %s, RunID: %s", we.GetID(), we.GetRunID())

	// Wait for workflow to complete (synchronous)
	var result workflows.PolicyIssuanceResult
	err = we.Get(ctx, &result)
	if err != nil {
		log.Printf("Workflow execution failed: %v", err)
		return
	}

	// Display result
	if result.Success {
		log.Printf("✓ Policy issued successfully!")
		log.Printf("  Policy ID: %s", result.PolicyID)
		log.Printf("  Policy Number: %s", result.PolicyNumber)
		log.Printf("  Transaction ID: %s", result.TransactionID)
		log.Printf("  Payment ID: %d", result.PaymentID)
		log.Printf("  Premium: %.2f NGN", result.Premium)
		log.Printf("  Risk Score: %.2f", result.RiskScore)
		log.Printf("  Document URL: %s", result.DocumentURL)
		log.Printf("  Completed Steps: %v", result.CompletedSteps)
	} else {
		log.Printf("✗ Policy issuance failed")
		log.Printf("  Failure Reason: %s", result.FailureReason)
		log.Printf("  Failed at Step: %s", result.FailureStep)
	}
}

// startFailedPaymentWorkflow demonstrates a workflow that fails due to payment issues
func startFailedPaymentWorkflow(c client.Client) {
	ctx := context.Background()

	// Prepare workflow input with a customer that has insufficient funds
	input := workflows.PolicyIssuanceInput{
		CustomerID:       "99999", // Customer with insufficient funds
		PolicyType:       models.PolicyTypeMotor,
		SumAssured:       500000.00,
		PremiumFrequency: models.PremiumFrequencyMonthly,
		DurationMonths:   12,
		StartDate:        time.Now(),
		PaymentMethod:    models.PaymentMethodCard,
	}

	workflowOptions := client.StartWorkflowOptions{
		ID:        "policy-workflow-failed-payment-001",
		TaskQueue: "policy-task-queue",
	}

	we, err := c.ExecuteWorkflow(ctx, workflowOptions, workflows.PolicyIssuanceWorkflow, input)
	if err != nil {
		log.Fatalf("Failed to start workflow: %v", err)
	}

	log.Printf("Started workflow with ID: %s, RunID: %s", we.GetID(), we.GetRunID())

	// Wait for workflow to complete
	var result workflows.PolicyIssuanceResult
	err = we.Get(ctx, &result)
	if err != nil {
		log.Printf("Workflow execution failed: %v", err)
		return
	}

	// Display result
	if !result.Success {
		log.Printf("✗ Policy issuance failed (expected)")
		log.Printf("  Policy ID: %s", result.PolicyID)
		log.Printf("  Failure Reason: %s", result.FailureReason)
		log.Printf("  Failed at Step: %s", result.FailureStep)
		log.Printf("  Note: Compensations were executed automatically")
	}
}

// queryWorkflowStatus demonstrates how to query a running or completed workflow
func queryWorkflowStatus(c client.Client, workflowID string) {
	ctx := context.Background()

	// Get workflow execution
	we := c.GetWorkflow(ctx, workflowID, "")

	// Check if workflow is running
	var result workflows.PolicyIssuanceResult
	err := we.Get(ctx, &result)
	if err != nil {
		log.Printf("Failed to get workflow result: %v", err)
		return
	}

	log.Printf("Workflow Status for ID: %s", workflowID)
	log.Printf("  Success: %v", result.Success)
	if result.Success {
		log.Printf("  Policy ID: %s", result.PolicyID)
		log.Printf("  Transaction ID: %s", result.TransactionID)
		log.Printf("  Completed At: %s", result.CompletedAt)
	} else {
		log.Printf("  Failure Reason: %s", result.FailureReason)
	}
}

// startAsyncWorkflow demonstrates starting a workflow asynchronously (fire and forget)
func startAsyncWorkflow(c client.Client) {
	ctx := context.Background()

	input := workflows.PolicyIssuanceInput{
		CustomerID:       "54321",
		PolicyType:       models.PolicyTypeHealth,
		SumAssured:       750000.00,
		PremiumFrequency: models.PremiumFrequencyQuarterly,
		DurationMonths:   12,
		StartDate:        time.Now(),
		PaymentMethod:    models.PaymentMethodBankTransfer,
	}

	workflowOptions := client.StartWorkflowOptions{
		ID:        "policy-workflow-async-001",
		TaskQueue: "policy-task-queue",
	}

	// Start workflow without waiting for result
	we, err := c.ExecuteWorkflow(ctx, workflowOptions, workflows.PolicyIssuanceWorkflow, input)
	if err != nil {
		log.Fatalf("Failed to start workflow: %v", err)
	}

	log.Printf("Started async workflow with ID: %s, RunID: %s", we.GetID(), we.GetRunID())
	log.Println("Workflow is running in the background")
}

// cancelWorkflow demonstrates how to cancel a running workflow
func cancelWorkflow(c client.Client, workflowID string) {
	ctx := context.Background()

	err := c.CancelWorkflow(ctx, workflowID, "")
	if err != nil {
		log.Printf("Failed to cancel workflow: %v", err)
		return
	}

	log.Printf("Workflow %s cancelled successfully", workflowID)
}

// listWorkflows demonstrates how to list workflows
func listWorkflows(c client.Client) {
	ctx := context.Background()

	// List open workflows
	query := "WorkflowType='PolicyIssuanceWorkflow' AND ExecutionStatus='Running'"
	request := &workflowservice.ListWorkflowExecutionsRequest{
		PageSize: 10,
		Query:    query,
	}

	resp, err := c.ListWorkflow(ctx, request)
	if err != nil {
		log.Printf("Failed to list workflows: %v", err)
		return
	}

	log.Println("Running Policy Issuance Workflows:")
	for _, execution := range resp.Executions {
		log.Printf("  - ID: %s, Start Time: %s",
			execution.Execution.WorkflowId,
			execution.StartTime)
	}
}
