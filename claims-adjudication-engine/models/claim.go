package models

import (
	"fmt"
	"time"
)

// ClaimStatus represents the lifecycle of a claim through the adjudication pipeline
type ClaimStatus string

const (
	ClaimStatusDraft         ClaimStatus = "draft"
	ClaimStatusSubmitted     ClaimStatus = "submitted"
	ClaimStatusUnderReview   ClaimStatus = "under_review"
	ClaimStatusApproved      ClaimStatus = "approved"
	ClaimStatusDenied        ClaimStatus = "denied"
	ClaimStatusEscalated     ClaimStatus = "escalated"
	ClaimStatusPendingReview ClaimStatus = "pending_review"
	ClaimStatusPaid          ClaimStatus = "paid"
	ClaimStatusRejected      ClaimStatus = "rejected"
	ClaimStatusFraudAlert    ClaimStatus = "fraud_alert"
)

// ClaimDecision represents the outcome of an adjudication
type ClaimDecision string

const (
	DecisionAutoApproved  ClaimDecision = "approved"
	DecisionDenied        ClaimDecision = "denied"
	DecisionEscalated     ClaimDecision = "escalated"
	DecisionPendingReview ClaimDecision = "pending_review"
	DecisionFraudAlert    ClaimDecision = "fraud_alert"
)

// ClaimType represents the insurance claim category
type ClaimType string

const (
	ClaimTypeLife             ClaimType = "life"
	ClaimTypeHealth           ClaimType = "health"
	ClaimTypeMotor            ClaimType = "motor"
	ClaimTypeProperty         ClaimType = "property"
	ClaimTypeMarine           ClaimType = "marine"
	ClaimTypeFire             ClaimType = "fire"
	ClaimTypeEngineering      ClaimType = "engineering"
	ClaimTypeGeneralLiability ClaimType = "general_liability"
	ClaimTypeMicroInsurance   ClaimType = "micro_insurance"
	ClaimTypeBancassurance    ClaimType = "bancassurance"
)

// Claim represents a full insurance claim entity
type Claim struct {
	ID             string        `json:"id"`
	PolicyID       string        `json:"policy_id"`
	PolicyNumber   string        `json:"policy_number"`
	ClaimantID     string        `json:"claimant_id"`
	ClaimantName   string        `json:"claimant_name"`
	InsurerID      string        `json:"insurer_id"`
	Amount         float64       `json:"amount"`
	Type           ClaimType     `json:"type"`
	Description    string        `json:"description"`
	Evidence       []EvidenceDoc `json:"evidence"`
	Status         ClaimStatus   `json:"status"`
	Decision       ClaimDecision `json:"decision,omitempty"`
	Confidence     float64       `json:"confidence,omitempty"`
	RiskScore      float64       `json:"risk_score"`
	AssignedTo     string        `json:"assigned_to,omitempty"`
	Queue          string        `json:"queue,omitempty"`
	Reason         string        `json:"reason,omitempty"`
	SLADeadline    time.Time     `json:"sla_deadline"`
	SubmittedAt    time.Time     `json:"submitted_at"`
	ReviewedAt     time.Time     `json:"reviewed_at,omitempty"`
	ApprovedAt     time.Time     `json:"approved_at,omitempty"`
	PaidAt         time.Time     `json:"paid_at,omitempty"`
	UpdatedAt      time.Time     `json:"updated_at"`
	WorkflowID     string        `json:"workflow_id,omitempty"`
	ReferenceID    string        `json:"reference_id,omitempty"`
	Notes          string        `json:"notes,omitempty"`
	FraudFlags     []string      `json:"fraud_flags,omitempty"`
	ComplianceTags []string      `json:"compliance_tags,omitempty"`
}

// EvidenceDoc represents a piece of claim evidence
type EvidenceDoc struct {
	ID         string    `json:"id"`
	Type       string    `json:"type"` // document, image, audio, video, medical_record, police_report
	FileName   string    `json:"file_name"`
	FileSize   int64     `json:"file_size"`
	UploadedAt time.Time `json:"uploaded_at"`
	Verified   bool      `json:"verified"`
	URL        string    `json:"url"`
}

// ClaimRequest is the input for submitting a new claim
type ClaimRequest struct {
	PolicyID     string          `json:"policy_id" validate:"required"`
	PolicyNumber string          `json:"policy_number" validate:"required"`
	ClaimantID   string          `json:"claimant_id" validate:"required"`
	ClaimantName string          `json:"claimant_name" validate:"required"`
	InsurerID    string          `json:"insurer_id" validate:"required"`
	Amount       float64         `json:"amount" validate:"required,gt=0"`
	Type         ClaimType       `json:"type" validate:"required"`
	Description  string          `json:"description" validate:"required,min=10,max=5000"`
	Evidence     []EvidenceInput `json:"evidence" validate:"required,min=2,max=20"`
}

// EvidenceInput is the input for evidence documents
type EvidenceInput struct {
	Type     string `json:"type" validate:"required"`
	FileName string `json:"file_name" validate:"required"`
	URL      string `json:"url" validate:"required"`
}

// AdjudicationResult is the structured output of the adjudication engine
type AdjudicationResult struct {
	ClaimID        string        `json:"claim_id"`
	Decision       ClaimDecision `json:"decision"`
	Confidence     float64       `json:"confidence"`
	Reason         string        `json:"reason"`
	AssignedTo     string        `json:"assigned_to,omitempty"`
	Queue          string        `json:"queue,omitempty"`
	SLADeadline    time.Time     `json:"sla_deadline"`
	RiskScore      float64       `json:"risk_score"`
	FraudFlags     []string      `json:"fraud_flags,omitempty"`
	ComplianceTags []string      `json:"compliance_tags,omitempty"`
	NextActions    []NextAction  `json:"next_actions,omitempty"`
	ProcessingTime time.Duration `json:"processing_time"`
}

// NextAction represents a follow-up action after adjudication
type NextAction struct {
	Type     string    `json:"type"`
	Label    string    `json:"label"`
	Priority string    `json:"priority"`
	DueBy    time.Time `json:"due_by"`
}

// ClaimMetrics tracks claims processing metrics
type ClaimMetrics struct {
	TotalClaimsProcessed int     `json:"total_claims_processed"`
	AutoApprovedRate     float64 `json:"auto_approved_rate"`
	DeniedRate           float64 `json:"denied_rate"`
	EscalatedRate        float64 `json:"escalated_rate"`
	AvgProcessingTime    float64 `json:"avg_processing_time_seconds"`
	MaxProcessingTime    float64 `json:"max_processing_time_seconds"`
	SLACompliance        float64 `json:"sla_compliance"`
	CurrentQueueSize     int     `json:"current_queue_size"`
	AvgClaimAmount       float64 `json:"avg_claim_amount"`
	FraudAlertCount      int     `json:"fraud_alert_count"`
}

// QueueStats represents the current state of review queues
type QueueStats struct {
	QueueName    string `json:"queue_name"`
	PendingCount int    `json:"pending_count"`
	AvgWaitTime  string `json:"avg_wait_time"`
}

// SLAConfig represents SLA thresholds per claim type
type SLAConfig struct {
	AutoApprovalMaxHours   int `json:"auto_approval_max_hours"`
	SupervisorReviewHours  int `json:"supervisor_review_hours"`
	ExecutiveApprovalDays  int `json:"executive_approval_days"`
	FraudInvestigationDays int `json:"fraud_investigation_days"`
}

// ClaimsBatch represents a batch of claims for bulk processing
type ClaimsBatch struct {
	ID        string        `json:"id"`
	Claims    []ClaimIDOnly `json:"claims"`
	Processed int           `json:"processed"`
	Failed    int           `json:"failed"`
	Status    string        `json:"status"`
	CreatedAt time.Time     `json:"created_at"`
}

// ClaimIDOnly is a minimal claim reference
type ClaimIDOnly struct {
	ID string `json:"id"`
}

// ClaimFilter represents filter criteria for querying claims
type ClaimFilter struct {
	Status       ClaimStatus `json:"status,omitempty"`
	Type         ClaimType   `json:"type,omitempty"`
	InsurerID    string      `json:"insurer_id,omitempty"`
	MinAmount    float64     `json:"min_amount,omitempty"`
	MaxAmount    float64     `json:"max_amount,omitempty"`
	MinRiskScore float64     `json:"min_risk_score,omitempty"`
	MaxRiskScore float64     `json:"max_risk_score,omitempty"`
	AssignedTo   string      `json:"assigned_to,omitempty"`
	Queue        string      `json:"queue,omitempty"`
	Limit        int         `json:"limit"`
	Offset       int         `json:"offset"`
	SortBy       string      `json:"sort_by"`
	SortOrder    string      `json:"sort_order"`
}

// PaginatedClaims represents a paginated response of claims
type PaginatedClaims struct {
	Claims  []Claim `json:"claims"`
	Total   int     `json:"total"`
	Limit   int     `json:"limit"`
	Offset  int     `json:"offset"`
	HasMore bool    `json:"has_more"`
}

// HealthStatus represents the health status of the claims service
type HealthStatus struct {
	Status         string        `json:"status"`
	Service        string        `json:"service"`
	Version        string        `json:"version"`
	Timestamp      time.Time     `json:"timestamp"`
	DBConnected    bool          `json:"db_connected"`
	RedisConnected bool          `json:"redis_connected"`
	KafkaConnected bool          `json:"kafka_connected"`
	UpTime         time.Duration `json:"uptime"`
	ClaimsInQueue  int           `json:"claims_in_queue"`
}

// Validate performs basic request validation per the field tags.
func (r *ClaimRequest) Validate() error {
	if r.PolicyID == "" || r.PolicyNumber == "" || r.ClaimantID == "" || r.ClaimantName == "" || r.InsurerID == "" {
		return fmt.Errorf("missing required fields: policy_id, policy_number, claimant_id, claimant_name, insurer_id are required")
	}
	if r.Amount <= 0 {
		return fmt.Errorf("amount must be greater than 0")
	}
	if r.Type == "" {
		return fmt.Errorf("type is required")
	}
	if len(r.Description) < 10 || len(r.Description) > 5000 {
		return fmt.Errorf("description must be between 10 and 5000 characters")
	}
	if len(r.Evidence) < 2 || len(r.Evidence) > 20 {
		return fmt.Errorf("evidence must contain between 2 and 20 items")
	}
	return nil
}
