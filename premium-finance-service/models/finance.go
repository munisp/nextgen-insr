package models

import "time"

// LoanStatus represents the lifecycle of a premium finance loan
type LoanStatus string

const (
	LoanStatusDraft       LoanStatus = "draft"
	LoanStatusSubmitted   LoanStatus = "submitted"
	LoanStatusUnderReview LoanStatus = "under_review"
	LoanStatusApproved    LoanStatus = "approved"
	LoanStatusRejected    LoanStatus = "rejected"
	LoanStatusActive      LoanStatus = "active"
	LoanStatusSuspended   LoanStatus = "suspended"
	LoanStatusTerminated  LoanStatus = "terminated"
	LoanStatusPaidOff     LoanStatus = "paid_off"
	LoanStatusDefaulted   LoanStatus = "defaulted"
)

// CreditScoreRange represents credit score brackets
type CreditScoreRange string

const (
	CreditExcellent CreditScoreRange = "excellent"
	CreditGood      CreditScoreRange = "good"
	CreditFair      CreditScoreRange = "fair"
	CreditPoor      CreditScoreRange = "poor"
	CreditVeryPoor  CreditScoreRange = "very_poor"
)

// CollateralType represents types of collateral for financed premiums
type CollateralType string

const (
	CollateralSavings   CollateralType = "savings"
	CollateralGuarantor CollateralType = "guarantor"
	CollateralAsset     CollateralType = "asset"
	CollateralBond      CollateralType = "bond"
	CollateralNone      CollateralType = "none"
)

// InstallmentFrequency determines how often payments are due
type InstallmentFrequency string

const (
	FrequencyMonthly   InstallmentFrequency = "monthly"
	FrequencyBiWeekly  InstallmentFrequency = "bi_weekly"
	FrequencyWeekly    InstallmentFrequency = "weekly"
	FrequencyQuarterly InstallmentFrequency = "quarterly"
)

// FinanceApplication represents a loan application for premium financing
type FinanceApplication struct {
	ID              string               `json:"id"`
	ApplicationID   string               `json:"application_id"`
	PolicyID        string               `json:"policy_id"`
	CustomerID      string               `json:"customer_id"`
	PremiumAmount   float64              `json:"premium_amount"`
	Currency        string               `json:"currency"`
	TermMonths      int                  `json:"term_months"`
	Frequency       InstallmentFrequency `json:"frequency"`
	Status          LoanStatus           `json:"status"`
	CreditScore     int                  `json:"credit_score"`
	CreditRating    CreditScoreRange     `json:"credit_rating"`
	InterestRate    float64              `json:"interest_rate"`
	TotalPayable    float64              `json:"total_payable"`
	MonthlyPayment  float64              `json:"monthly_payment"`
	ApprovedBy      string               `json:"approved_by,omitempty"`
	ApprovedAt      *time.Time           `json:"approved_at,omitempty"`
	RejectedAt      *time.Time           `json:"rejected_at,omitempty"`
	RejectionReason string               `json:"rejection_reason,omitempty"`
	Metadata        map[string]any       `json:"metadata,omitempty"`
	CreatedAt       time.Time            `json:"created_at"`
	UpdatedAt       time.Time            `json:"updated_at"`
}

// CreditProfile holds credit scoring information
type CreditProfile struct {
	ID               string           `json:"id"`
	CustomerID       string           `json:"customer_id"`
	CreditScore      int              `json:"credit_score"`
	ScoreDate        time.Time        `json:"score_date"`
	PaymentHistory   float64          `json:"payment_history"`
	ClaimsRatio      float64          `json:"claims_ratio"`
	TenureYears      int              `json:"tenure_years"`
	ActivePolicies   int              `json:"active_policies"`
	DefaultHistory   int              `json:"default_history"`
	IncomeEstimate   float64          `json:"income_estimate"`
	EmploymentStatus string           `json:"employment_status"`
	Rating           CreditScoreRange `json:"rating"`
	Recommendation   string           `json:"recommendation"`
	MaxFinanced      float64          `json:"max_financed_amount"`
	RecommendedRate  float64          `json:"recommended_interest_rate"`
	CreatedAt        time.Time        `json:"created_at"`
}

// PaymentScheduleEntry represents a single payment installment
type PaymentScheduleEntry struct {
	ID            string            `json:"id"`
	LoanID        string            `json:"loan_id"`
	InstallmentNo int               `json:"installment_number"`
	DueDate       time.Time         `json:"due_date"`
	Amount        float64           `json:"amount"`
	Status        InstallmentStatus `json:"status"`
	PaidAt        *time.Time        `json:"paid_at,omitempty"`
	PaymentRef    string            `json:"payment_reference,omitempty"`
	LateFee       float64           `json:"late_fee,omitempty"`
	PaidAmount    float64           `json:"paid_amount,omitempty"`
	CreatedAt     time.Time         `json:"created_at"`
}

// InstallmentStatus is the status of an installment
type InstallmentStatus string

const (
	InstPending   InstallmentStatus = "pending"
	InstDue       InstallmentStatus = "due"
	InstOverdue   InstallmentStatus = "overdue"
	InstPaid      InstallmentStatus = "paid"
	InstWaived    InstallmentStatus = "waived"
	InstDefaulted InstallmentStatus = "defaulted"
)

// Collateral represents pledged collateral for a loan
type Collateral struct {
	ID         string         `json:"id"`
	LoanID     string         `json:"loan_id"`
	Type       CollateralType `json:"type"`
	Details    string         `json:"details"`
	Value      float64        `json:"value"`
	Currency   string         `json:"currency"`
	Status     string         `json:"status"`
	VerifiedAt *time.Time     `json:"verified_at,omitempty"`
	Metadata   map[string]any `json:"metadata,omitempty"`
	CreatedAt  time.Time      `json:"created_at"`
}

// CollectionAction represents a collection management action for overdue accounts
type CollectionAction struct {
	ID          string               `json:"id"`
	LoanID      string               `json:"loan_id"`
	CustomerID  string               `json:"customer_id"`
	ActionType  CollectionActionType `json:"action_type"`
	Status      string               `json:"status"`
	PerformedBy string               `json:"performed_by"`
	ScheduledAt *time.Time           `json:"scheduled_at,omitempty"`
	CompletedAt *time.Time           `json:"completed_at,omitempty"`
	Notes       string               `json:"notes"`
	Metadata    map[string]any       `json:"metadata,omitempty"`
	CreatedAt   time.Time            `json:"created_at"`
}

// CollectionActionType specifies the type of collection action
type CollectionActionType string

const (
	ActionSMS       CollectionActionType = "sms_reminder"
	ActionEmail     CollectionActionType = "email_reminder"
	ActionCall      CollectionActionType = "phone_call"
	ActionLetter    CollectionActionType = "physical_letter"
	ActionSuspend   CollectionActionType = "suspend_policy"
	ActionTerminate CollectionActionType = "terminate_policy"
	ActionLegal     CollectionActionType = "legal_action"
	ActionSettle    CollectionActionType = "settlement_offer"
)

// EarlySettlement represents an early settlement request
type EarlySettlement struct {
	ID                string     `json:"id"`
	LoanID            string     `json:"loan_id"`
	RequestedAt       time.Time  `json:"requested_at"`
	RemainingBalance  float64    `json:"remaining_balance"`
	RemainingInterest float64    `json:"remaining_interest"`
	RebateAmount      float64    `json:"rebate_amount"`
	RebatePercent     float64    `json:"rebate_percent"`
	TotalPayable      float64    `json:"total_payable"`
	Status            string     `json:"status"`
	ProcessedBy       string     `json:"processed_by,omitempty"`
	ProcessedAt       *time.Time `json:"processed_at,omitempty"`
}

// FinanceSummary provides aggregated financing statistics
type FinanceSummary struct {
	TotalApplications    int64   `json:"total_applications"`
	ApprovedApplications int64   `json:"approved_applications"`
	ActiveLoans          int64   `json:"active_loans"`
	TotalOrigination     float64 `json:"total_origination_amount"`
	TotalReceivable      float64 `json:"total_receivable"`
	TotalCollected       float64 `json:"total_collected"`
	OverdueAmount        float64 `json:"overdue_amount"`
	DefaultRate          float64 `json:"default_rate"`
	AvgCreditScore       int     `json:"avg_credit_score"`
	AvgInterestRate      float64 `json:"avg_interest_rate"`
}
