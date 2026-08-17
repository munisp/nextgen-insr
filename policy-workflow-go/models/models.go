package models

import (
	"time"
)

// PolicyState represents valid workflow states
type PolicyState string

const (
	StateDraft        PolicyState = "draft"
	StateSubmitted    PolicyState = "submitted"
	StateUnderwriting PolicyState = "underwriting"
	StateReferred     PolicyState = "referred"
	StateApproved     PolicyState = "approved"
	StateDeclined     PolicyState = "declined"
	StateExpired      PolicyState = "expired"
	StateIssued       PolicyState = "issued"
	StateActive       PolicyState = "active"
	StateRenewal      PolicyState = "renewal"
	StateLapsed       PolicyState = "lapsed"
	StateCancelled    PolicyState = "cancelled"
	StateRefunded     PolicyState = "refunded"
)

// ValidTransitions defines allowed state transitions
var ValidTransitions = map[PolicyState][]PolicyState{
	StateDraft:        {StateSubmitted, StateCancelled},
	StateSubmitted:    {StateUnderwriting, StateReferred, StateCancelled},
	StateUnderwriting: {StateApproved, StateDeclined, StateReferred, StateReferred},
	StateReferred:     {StateUnderwriting, StateApproved, StateDeclined},
	StateApproved:     {StateIssued, StateExpired},
	StateDeclined:     {},
	StateExpired:      {},
	StateIssued:       {StateActive},
	StateActive:       {StateRenewal, StateLapsed, StateCancelled},
	StateRenewal:      {StateActive, StateLapsed},
	StateLapsed:       {StateActive, StateCancelled},
	StateCancelled:    {},
	StateRefunded:     {},
}

// Policy represents an insurance policy
type Policy struct {
	ID                 string      `json:"id" db:"id"`
	PolicyNumber       string      `json:"policy_number" db:"policy_number"`
	ProductID          string      `json:"product_id" db:"product_id"`
	ProductCode        string      `json:"product_code" db:"product_code"`
	ProductType        string      `json:"product_type" db:"product_type"` // life, health, general, motor
	HolderID           string      `json:"holder_id" db:"holder_id"`
	HolderType         string      `json:"holder_type" db:"holder_type"` // individual, corporate
	BeneficiaryID      *string     `json:"beneficiary_id" db:"beneficiary_id"`
	AgentID            *string     `json:"agent_id" db:"agent_id"`
	AgentCode          string      `json:"agent_code" db:"agent_code"`
	Status             PolicyState `json:"status" db:"status"`
	Premium            float64     `json:"premium" db:"premium"`
	SumAssured         float64     `json:"sum_assured" db:"sum_assured"`
	CoverageStart      time.Time   `json:"coverage_start" db:"coverage_start"`
	CoverageEnd        time.Time   `json:"coverage_end" db:"coverage_end"`
	PaymentFrequency   string      `json:"payment_frequency" db:"payment_frequency"` // monthly, quarterly, semi_annual, annual
	NextDueDate        *time.Time  `json:"next_due_date" db:"next_due_date"`
	LastPaymentDate    *time.Time  `json:"last_payment_date" db:"last_payment_date"`
	RiskScore          int         `json:"risk_score" db:"risk_score"`
	UnderwriterID      *string     `json:"underwriter_id" db:"underwriter_id"`
	Remarks            string      `json:"remarks" db:"remarks"`
	KYCVerified        bool        `json:"kyc_verified" db:"kyc_verified"`
	PaymentStatus      string      `json:"payment_status" db:"payment_status"` // pending, paid, failed, refunded
	CurrentState       PolicyState `json:"current_state" db:"current_state"`
	IssuedAt           *time.Time  `json:"issued_at" db:"issued_at"`
	ActiveSince        *time.Time  `json:"active_since" db:"active_since"`
	LapsedAt           *time.Time  `json:"lapsed_at" db:"lapsed_at"`
	CancelledAt        *time.Time  `json:"cancelled_at" db:"cancelled_at"`
	CancellationReason string      `json:"cancellation_reason" db:"cancellation_reason"`
	RefundAmount       float64     `json:"refund_amount" db:"refund_amount"`
	CreatedAt          time.Time   `json:"created_at" db:"created_at"`
	UpdatedAt          time.Time   `json:"updated_at" db:"updated_at"`
}

// PolicyTransition represents a state transition event
type PolicyTransition struct {
	ID           string      `json:"id" db:"id"`
	PolicyID     string      `json:"policy_id" db:"policy_id"`
	FromState    PolicyState `json:"from_state" db:"from_state"`
	ToState      PolicyState `json:"to_state" db:"to_state"`
	Actor        string      `json:"actor" db:"actor"`
	ActorRole    string      `json:"actor_role" db:"actor_role"` // agent, underwriter, system, customer
	Reason       string      `json:"reason" db:"reason"`
	Notes        string      `json:"notes" db:"notes"`
	TransitionAt time.Time   `json:"transition_at" db:"transition_at"`
	DurationSecs int         `json:"duration_secs" db:"duration_secs"`
}

// UnderwritingRecord tracks underwriting assessment
type UnderwritingRecord struct {
	ID             string     `json:"id" db:"id"`
	PolicyID       string     `json:"policy_id" db:"policy_id"`
	RiskScore      int        `json:"risk_score" db:"risk_score"`
	RiskFactors    string     `json:"risk_factors" db:"risk_factors"` // JSON object
	AutoRoute      bool       `json:"auto_route" db:"auto_route"`
	Recommendation string     `json:"recommendation" db:"recommendation"` // approve, decline, refer
	UnderwriterID  *string    `json:"underwriter_id" db:"underwriter_id"`
	Status         string     `json:"status" db:"status"` // pending, completed, escalated
	CompletedAt    *time.Time `json:"completed_at" db:"completed_at"`
	CreatedAt      time.Time  `json:"created_at" db:"created_at"`
}

// RenewalRecord tracks policy renewal
type RenewalRecord struct {
	ID             string     `json:"id" db:"id"`
	PolicyID       string     `json:"policy_id" db:"policy_id"`
	OriginalExpiry time.Time  `json:"original_expiry" db:"original_expiry"`
	RenewalDate    time.Time  `json:"renewal_date" db:"renewal_date"`
	NewExpiry      time.Time  `json:"new_expiry" db:"new_expiry"`
	NewPremium     float64    `json:"new_premium" db:"new_premium"`
	NewSumAssured  float64    `json:"new_sum_assured" db:"new_sum_assured"`
	RenewalStatus  string     `json:"renewal_status" db:"renewal_status"` // pending, offered, accepted, declined, lapsed
	PaymentStatus  string     `json:"payment_status" db:"payment_status"` // pending, paid, failed
	RenewalMethod  string     `json:"renewal_method" db:"renewal_method"` // auto, manual, portal
	RenewedAt      *time.Time `json:"renewed_at" db:"renewed_at"`
	LapsedAt       *time.Time `json:"lapsed_at" db:"lapsed_at"`
	GracePeriodEnd *time.Time `json:"grace_period_end" db:"grace_period_end"`
	CreatedAt      time.Time  `json:"created_at" db:"created_at"`
}

// Endorsement represents a policy change
type Endorsement struct {
	ID               string     `json:"id" db:"id"`
	PolicyID         string     `json:"policy_id" db:"policy_id"`
	ChangeType       string     `json:"change_type" db:"change_type"` // beneficiary, premium, sum_assured, coverage
	OldValue         string     `json:"old_value" db:"old_value"`
	NewValue         string     `json:"new_value" db:"new_value"`
	Reason           string     `json:"reason" db:"reason"`
	RequiresApproval bool       `json:"requires_approval" db:"requires_approval"`
	Status           string     `json:"status" db:"status"` // pending, approved, rejected
	ApprovedBy       *string    `json:"approved_by" db:"approved_by"`
	ApprovedAt       *time.Time `json:"approved_at" db:"approved_at"`
	CreatedBy        string     `json:"created_by" db:"created_by"`
	CreatedAt        time.Time  `json:"created_at" db:"created_at"`
}

// PolicyDashboard provides summary view
type PolicyDashboard struct {
	TotalPolicies      int     `json:"total_policies"`
	DraftCount         int     `json:"draft_count"`
	ActiveCount        int     `json:"active_count"`
	UnderwritingCount  int     `json:"underwriting_count"`
	RenewalCount       int     `json:"renewal_count"`
	LapsedCount        int     `json:"lapsed_count"`
	CancelledCount     int     `json:"cancelled_count"`
	TotalPremium       float64 `json:"total_premium"`
	TotalSumAssured    float64 `json:"total_sum_assured"`
	AutoUnderwritten   int     `json:"auto_underwritten"`
	ManualUnderwritten int     `json:"manual_underwritten"`
	DeclinedCount      int     `json:"declined_count"`
	ApprovalRate       float64 `json:"approval_rate"`
}

// LapseRule defines when a policy lapses
type LapseRule struct {
	ID              string     `json:"id" db:"id"`
	PolicyID        string     `json:"policy_id" db:"policy_id"`
	GracePeriodDays int        `json:"grace_period_days" db:"grace_period_days"`
	LastDueDate     time.Time  `json:"last_due_date" db:"last_due_date"`
	GracePeriodEnd  time.Time  `json:"grace_period_end" db:"grace_period_end"`
	Status          string     `json:"status" db:"status"` // current, in_grace, lapsed
	LapsedAt        *time.Time `json:"lapsed_at" db:"lapsed_at"`
	ReinstatedAt    *time.Time `json:"reinstated_at" db:"reinstated_at"`
	CreatedAt       time.Time  `json:"created_at" db:"created_at"`
}

// CancellationRecord tracks policy cancellations
type CancellationRecord struct {
	ID               string    `json:"id" db:"id"`
	PolicyID         string    `json:"policy_id" db:"policy_id"`
	Type             string    `json:"type" db:"type"` // voluntary, forced, cooling_off, non_payment
	Reason           string    `json:"reason" db:"reason"`
	CancellationDate time.Time `json:"cancellation_date" db:"cancellation_date"`
	CancelledBy      string    `json:"cancelled_by" db:"cancelled_by"`
	RefundAmount     float64   `json:"refund_amount" db:"refund_amount"`
	RefundStatus     string    `json:"refund_status" db:"refund_status"` // pending, processed
	CreatedAt        time.Time `json:"created_at" db:"created_at"`
}
