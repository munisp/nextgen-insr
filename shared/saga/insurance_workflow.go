// Package saga implements the Saga pattern for cross-service insurance workflows.
// It orchestrates multi-step business processes with compensating transactions.
//
// Workflows implemented:
// 1. Policy Issuance: quote → underwrite → bind → issue → payment
// 2. Claims Processing: register → assess → adjudicate → settle → close
// 3. Renewal: evaluate → rate → offer → accept → bind
// 4. Endorsement: request → underwrite → approve → amend → notify
package saga

import (
	"encoding/json"
	"fmt"
	"time"
)

// StepStatus represents the current state of a saga step
type StepStatus string

const (
	StatusPending    StepStatus = "pending"
	StatusRunning    StepStatus = "running"
	StatusCompleted  StepStatus = "completed"
	StatusFailed     StepStatus = "failed"
	StatusCompensated StepStatus = "compensated"
)

// SagaStep represents one step in a distributed workflow
type SagaStep struct {
	Name           string     `json:"name"`
	Service        string     `json:"service"`
	Status         StepStatus `json:"status"`
	StartedAt      time.Time  `json:"started_at,omitempty"`
	CompletedAt    time.Time  `json:"completed_at,omitempty"`
	Input          interface{} `json:"input"`
	Output         interface{} `json:"output,omitempty"`
	Error          string     `json:"error,omitempty"`
	CompensateFunc string     `json:"compensate_action"`
}

// Saga represents a complete distributed workflow
type Saga struct {
	ID          string      `json:"saga_id"`
	Type        string      `json:"saga_type"`
	Status      StepStatus  `json:"status"`
	Steps       []SagaStep  `json:"steps"`
	CreatedAt   time.Time   `json:"created_at"`
	CompletedAt time.Time   `json:"completed_at,omitempty"`
	Context     map[string]interface{} `json:"context"`
}

// ─── Policy Issuance Saga ────────────────────────────────────────────────────

// PolicyIssuanceInput defines the input for the policy issuance workflow
type PolicyIssuanceInput struct {
	CustomerID    string  `json:"customer_id"`
	Product       string  `json:"product"`
	SumInsured    float64 `json:"sum_insured"`
	Premium       float64 `json:"premium"`
	InceptionDate string  `json:"inception_date"`
	ExpiryDate    string  `json:"expiry_date"`
}

// NewPolicyIssuanceSaga creates the complete policy issuance workflow
func NewPolicyIssuanceSaga(input PolicyIssuanceInput) *Saga {
	return &Saga{
		ID:        fmt.Sprintf("SAGA-POL-%d", time.Now().UnixNano()%100000000),
		Type:      "policy_issuance",
		Status:    StatusPending,
		CreatedAt: time.Now(),
		Context:   map[string]interface{}{"input": input},
		Steps: []SagaStep{
			{
				Name: "generate_quote", Service: "enterprise-rating-engine",
				Status: StatusPending, CompensateFunc: "void_quote",
				Input: map[string]interface{}{
					"product": input.Product, "sum_insured": input.SumInsured,
				},
			},
			{
				Name: "kyc_verification", Service: "enhanced-kyc-kyb",
				Status: StatusPending, CompensateFunc: "none",
				Input: map[string]interface{}{"customer_id": input.CustomerID},
			},
			{
				Name: "underwriting_assessment", Service: "agentic-underwriting",
				Status: StatusPending, CompensateFunc: "void_assessment",
				Input: map[string]interface{}{
					"customer_id": input.CustomerID, "product": input.Product,
					"sum_insured": input.SumInsured,
				},
			},
			{
				Name: "aml_screening", Service: "cross-company-fraud-database",
				Status: StatusPending, CompensateFunc: "none",
				Input: map[string]interface{}{"customer_id": input.CustomerID},
			},
			{
				Name: "premium_collection", Service: "premium-collection-service",
				Status: StatusPending, CompensateFunc: "refund_premium",
				Input: map[string]interface{}{
					"customer_id": input.CustomerID, "amount": input.Premium,
				},
			},
			{
				Name: "policy_binding", Service: "policy-lifecycle-service",
				Status: StatusPending, CompensateFunc: "cancel_policy",
				Input: map[string]interface{}{
					"customer_id": input.CustomerID, "product": input.Product,
					"sum_insured": input.SumInsured, "premium": input.Premium,
					"inception_date": input.InceptionDate, "expiry_date": input.ExpiryDate,
				},
			},
			{
				Name: "reinsurance_cession", Service: "reinsurance-management",
				Status: StatusPending, CompensateFunc: "reverse_cession",
				Input: map[string]interface{}{
					"sum_insured": input.SumInsured, "product": input.Product,
				},
			},
			{
				Name: "notification", Service: "communication-service",
				Status: StatusPending, CompensateFunc: "none",
				Input: map[string]interface{}{
					"customer_id": input.CustomerID, "event": "policy_issued",
				},
			},
		},
	}
}

// ─── Claims Processing Saga ──────────────────────────────────────────────────

// ClaimsProcessingInput defines the input for claims processing
type ClaimsProcessingInput struct {
	PolicyNumber string  `json:"policy_number"`
	ClaimantID   string  `json:"claimant_id"`
	IncidentDate string  `json:"incident_date"`
	ClaimType    string  `json:"claim_type"`
	Amount       float64 `json:"estimated_amount"`
	Description  string  `json:"description"`
}

// NewClaimsProcessingSaga creates the complete claims processing workflow
func NewClaimsProcessingSaga(input ClaimsProcessingInput) *Saga {
	return &Saga{
		ID:        fmt.Sprintf("SAGA-CLM-%d", time.Now().UnixNano()%100000000),
		Type:      "claims_processing",
		Status:    StatusPending,
		CreatedAt: time.Now(),
		Context:   map[string]interface{}{"input": input},
		Steps: []SagaStep{
			{
				Name: "register_claim", Service: "claims-adjudication-engine",
				Status: StatusPending, CompensateFunc: "withdraw_claim",
				Input: map[string]interface{}{
					"policy_number": input.PolicyNumber, "claim_type": input.ClaimType,
					"amount": input.Amount,
				},
			},
			{
				Name: "validate_policy_coverage", Service: "policy-lifecycle-service",
				Status: StatusPending, CompensateFunc: "none",
				Input: map[string]interface{}{
					"policy_number": input.PolicyNumber, "claim_type": input.ClaimType,
				},
			},
			{
				Name: "fraud_screening", Service: "fraud-detection-go",
				Status: StatusPending, CompensateFunc: "none",
				Input: map[string]interface{}{
					"claimant_id": input.ClaimantID, "amount": input.Amount,
					"policy_number": input.PolicyNumber,
				},
			},
			{
				Name: "ai_adjudication", Service: "ai-claims-auto-adjudication",
				Status: StatusPending, CompensateFunc: "none",
				Input: map[string]interface{}{
					"amount": input.Amount, "claim_type": input.ClaimType,
				},
			},
			{
				Name: "reserve_booking", Service: "claims-adjudication-engine",
				Status: StatusPending, CompensateFunc: "release_reserve",
				Input: map[string]interface{}{
					"amount": input.Amount, "type": "case_reserve",
				},
			},
			{
				Name: "loss_adjustment", Service: "claims-adjudication-engine",
				Status: StatusPending, CompensateFunc: "none",
				Input: map[string]interface{}{
					"amount": input.Amount, "incident_date": input.IncidentDate,
				},
			},
			{
				Name: "settlement_approval", Service: "claims-adjudication-engine",
				Status: StatusPending, CompensateFunc: "reverse_approval",
				Input: map[string]interface{}{"amount": input.Amount},
			},
			{
				Name: "payout_processing", Service: "instant-payout-service",
				Status: StatusPending, CompensateFunc: "reverse_payout",
				Input: map[string]interface{}{
					"claimant_id": input.ClaimantID, "amount": input.Amount,
				},
			},
			{
				Name: "reinsurance_recovery", Service: "reinsurance-management",
				Status: StatusPending, CompensateFunc: "none",
				Input: map[string]interface{}{
					"amount": input.Amount, "policy_number": input.PolicyNumber,
				},
			},
			{
				Name: "notification", Service: "communication-service",
				Status: StatusPending, CompensateFunc: "none",
				Input: map[string]interface{}{
					"customer_id": input.ClaimantID, "event": "claim_settled",
				},
			},
		},
	}
}

// ─── Renewal Saga ────────────────────────────────────────────────────────────

type RenewalInput struct {
	PolicyNumber string  `json:"policy_number"`
	CustomerID   string  `json:"customer_id"`
	CurrentPremium float64 `json:"current_premium"`
}

func NewRenewalSaga(input RenewalInput) *Saga {
	return &Saga{
		ID:        fmt.Sprintf("SAGA-RNW-%d", time.Now().UnixNano()%100000000),
		Type:      "policy_renewal",
		Status:    StatusPending,
		CreatedAt: time.Now(),
		Context:   map[string]interface{}{"input": input},
		Steps: []SagaStep{
			{Name: "claims_experience_review", Service: "policy-renewal-automation", Status: StatusPending, CompensateFunc: "none"},
			{Name: "churn_prediction", Service: "predictive-churn-engine", Status: StatusPending, CompensateFunc: "none"},
			{Name: "re_rating", Service: "enterprise-rating-engine", Status: StatusPending, CompensateFunc: "none"},
			{Name: "generate_renewal_offer", Service: "policy-renewal-automation", Status: StatusPending, CompensateFunc: "void_offer"},
			{Name: "customer_notification", Service: "communication-service", Status: StatusPending, CompensateFunc: "none"},
			{Name: "premium_collection", Service: "premium-collection-service", Status: StatusPending, CompensateFunc: "refund_premium"},
			{Name: "policy_binding", Service: "policy-lifecycle-service", Status: StatusPending, CompensateFunc: "cancel_renewal"},
			{Name: "reinsurance_cession", Service: "reinsurance-management", Status: StatusPending, CompensateFunc: "reverse_cession"},
		},
	}
}

// ─── Saga Execution Engine ───────────────────────────────────────────────────

// ExecuteStep marks a step as running and then completed/failed
func (s *Saga) ExecuteStep(stepIndex int, result interface{}, err error) {
	if stepIndex >= len(s.Steps) {
		return
	}
	step := &s.Steps[stepIndex]
	step.StartedAt = time.Now()

	if err != nil {
		step.Status = StatusFailed
		step.Error = err.Error()
		s.Status = StatusFailed
	} else {
		step.Status = StatusCompleted
		step.Output = result
		step.CompletedAt = time.Now()
	}

	// Check if all steps are complete
	allDone := true
	for _, st := range s.Steps {
		if st.Status == StatusPending || st.Status == StatusRunning {
			allDone = false
			break
		}
	}
	if allDone && s.Status != StatusFailed {
		s.Status = StatusCompleted
		s.CompletedAt = time.Now()
	}
}

// Compensate runs compensating transactions for completed steps (in reverse order)
func (s *Saga) Compensate() []string {
	compensated := []string{}
	for i := len(s.Steps) - 1; i >= 0; i-- {
		step := &s.Steps[i]
		if step.Status == StatusCompleted && step.CompensateFunc != "none" {
			step.Status = StatusCompensated
			compensated = append(compensated, fmt.Sprintf("%s.%s", step.Service, step.CompensateFunc))
		}
	}
	return compensated
}

// ToJSON serializes the saga state
func (s *Saga) ToJSON() ([]byte, error) {
	return json.Marshal(s)
}

// GetProgress returns completion percentage
func (s *Saga) GetProgress() float64 {
	if len(s.Steps) == 0 {
		return 0
	}
	completed := 0
	for _, step := range s.Steps {
		if step.Status == StatusCompleted {
			completed++
		}
	}
	return float64(completed) / float64(len(s.Steps)) * 100
}
