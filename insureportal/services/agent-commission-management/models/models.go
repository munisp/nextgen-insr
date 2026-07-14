package models

import (
	"time"
)

// CommissionStatus represents the payment status
type CommissionStatus string

const (
	StatusCalculated    CommissionStatus = "calculated"
	StatusPending       CommissionStatus = "pending"
	StatusApproved      CommissionStatus = "approved"
	StatusPaid          CommissionStatus = "paid"
	StatusClawedBack    CommissionStatus = "clawed_back"
	StatusDisputed      CommissionStatus = "disputed"
	StatusRejected      CommissionStatus = "rejected"
	StatusVoided        CommissionStatus = "voided"
)

// CommissionType represents the type of commission
type CommissionType string

const (
	TypeNewPolicy      CommissionType = "new_policy"
	TypeRenewal        CommissionType = "renewal"
	TypeUpsell         CommissionType = "upsell"
	TypeCrossSell      CommissionType = "cross_sell"
	TypeBonus          CommissionType = "bonus"
	TypePenalty        CommissionType = "penalty"
	TypeAdjustment     CommissionType = "adjustment"
)

// Commission represents an agent's commission record
type Commission struct {
	ID              string           `json:"id" db:"id"`
	CommissionID    string           `json:"commission_id" db:"commission_id"`
	AgentID         string           `json:"agent_id" db:"agent_id"`
	AgentCode       string           `json:"agent_code" db:"agent_code"`
	AgentName       string           `json:"agent_name" db:"agent_name"`
	PolicyID        string           `json:"policy_id" db:"policy_id"`
	PolicyNumber    string           `json:"policy_number" db:"policy_number"`
	ProductCode     string           `json:"product_code" db:"product_code"`
	ProductType     string           `json:"product_type" db:"product_type"`
	CommissionType  CommissionType   `json:"commission_type" db:"commission_type"`
	Premium         float64          `json:"premium" db:"premium"`
	CommissionRate  float64          `json:"commission_rate" db:"commission_rate"` // percentage
	CommissionAmount float64         `json:"commission_amount" db:"commission_amount"`
	NetCommission   float64          `json:"net_commission" db:"net_commission"` // after clawbacks/adjustments
	WithholdingTax  float64          `json:"withholding_tax" db:"withholding_tax"`
	PayableAmount   float64          `json:"payable_amount" db:"payable_amount"`
	Status          CommissionStatus `json:"status" db:"status"`
	PaymentDate     *time.Time       `json:"payment_date" db:"payment_date"`
	PaymentRef      string           `json:"payment_ref" db:"payment_ref"`
	BankAccount     string           `json:"bank_account" db:"bank_account"`
	BankName        string           `json:"bank_name" db:"bank_name"`
	IssuedAt        time.Time        `json:"issued_at" db:"issued_at"`
	PolicyStart     time.Time        `json:"policy_start" db:"policy_start"`
	PolicyEnd       time.Time        `json:"policy_end" db:"policy_end"`
	RenewalYear     int              `json:"renewal_year" db:"renewal_year"`
	IsRenewal       bool             `json:"is_renewal" db:"is_renewal"`
	ClawbackAmount  float64          `json:"clawback_amount" db:"clawback_amount"`
	ClawbackReason  string           `json:"clawback_reason" db:"clawback_reason"`
	Notes           string           `json:"notes" db:"notes"`
	CreatedAt       time.Time        `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time        `json:"updated_at" db:"updated_at"`
}

// CommissionPeriod represents a billing period for commission aggregation
type CommissionPeriod struct {
	ID            string    `json:"id" db:"id"`
	AgentID       string    `json:"agent_id" db:"agent_id"`
	PeriodStart   time.Time `json:"period_start" db:"period_start"`
	PeriodEnd     time.Time `json:"period_end" db:"period_end"`
	TotalPremium  float64   `json:"total_premium" db:"total_premium"`
	TotalCommission float64 `json:"total_commission" db:"total_commission"`
	TotalClawbacks float64  `json:"total_clawbacks" db:"total_clawbacks"`
	NetCommission float64   `json:"net_commission" db:"net_commission"`
	TaxAmount     float64   `json:"tax_amount" db:"tax_amount"`
	PayableAmount float64   `json:"payable_amount" db:"payable_amount"`
	Status        string    `json:"status" db:"status"` // pending, approved, paid
	PaidAt        *time.Time `json:"paid_at" db:"paid_at"`
	PaymentRef    string    `json:"payment_ref" db:"payment_ref"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

// AgentProfile stores agent master data and commission settings
type AgentProfile struct {
	ID              string    `json:"id" db:"id"`
	AgentCode       string    `json:"agent_code" db:"agent_code"`
	AgentName       string    `json:"agent_name" db:"agent_name"`
	Email           string    `json:"email" db:"email"`
	Phone           string    `json:"phone" db:"phone"`
	LicenseNo       string    `json:"license_no" db:"license_no"`
	LicenseExpiry   time.Time `json:"license_expiry" db:"license_expiry"`
	Status          string    `json:"status" db:"status"` // active, suspended, revoked
	CommissionRate  float64   `json:"commission_rate" db:"commission_rate"`
	BonusThreshold  float64   `json:"bonus_threshold" db:"bonus_threshold"`
	BonusRate       float64   `json:"bonus_rate" db:"bonus_rate"`
	BankAccount     string    `json:"bank_account" db:"bank_account"`
	BankName        string    `json:"bank_name" db:"bank_name"`
	BranchCode      string    `json:"branch_code" db:"branch_code"`
	Region          string    `json:"region" db:"region"`
	ProductsAuthorized string `json:"products_authorized" db:"products_authorized"`
	JoinDate        time.Time `json:"join_date" db:"join_date"`
	LastCommissionDate time.Time `json:"last_commission_date" db:"last_commission_date"`
	TotalCommissionEarned float64 `json:"total_commission_earned" db:"total_commission_earned"`
	TotalPolicies   int        `json:"total_policies" db:"total_policies"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time `json:"updated_at" db:"updated_at"`
}

// CommissionAdjustment tracks manual adjustments
type CommissionAdjustment struct {
	ID             string           `json:"id" db:"id"`
	CommissionID   string           `json:"commission_id" db:"commission_id"`
	AdjustmentType string           `json:"adjustment_type" db:"adjustment_type"` // bonus, penalty, correction
	OriginalAmount float64          `json:"original_amount" db:"original_amount"`
	AdjustmentAmount float64        `json:"adjustment_amount" db:"adjustment_amount"`
	NewAmount      float64          `json:"new_amount" db:"new_amount"`
	Reason         string           `json:"reason" db:"reason"`
	ApprovedBy     string           `json:"approved_by" db:"approved_by"`
	ApprovedAt     *time.Time       `json:"approved_at" db:"approved_at"`
	Status         string           `json:"status" db:"status"` // pending, approved, rejected
	CreatedBy      string           `json:"created_by" db:"created_by"`
	CreatedAt      time.Time        `json:"created_at" db:"created_at"`
}

// CommissionReport provides aggregated commission data
type CommissionReport struct {
	ID              string    `json:"id" db:"id"`
	ReportName      string    `json:"report_name" db:"report_name"`
	ReportType      string    `json:"report_type" db:"report_type"` // agent, product, period, channel
	PeriodStart     time.Time `json:"period_start" db:"period_start"`
	PeriodEnd       time.Time `json:"period_end" db:"period_end"`
	TotalPolicies   int       `json:"total_policies" db:"total_policies"`
	TotalPremium    float64   `json:"total_premium" db:"total_premium"`
	TotalCommission float64   `json:"total_commission" db:"total_commission"`
	TotalClawbacks  float64   `json:"total_clawbacks" db:"total_clawbacks"`
	NetCommission   float64   `json:"net_commission" db:"net_commission"`
	TotalTax        float64   `json:"total_tax" db:"total_tax"`
	PayableTotal    float64   `json:"payable_total" db:"payable_total"`
	AgentIDs        string    `json:"agent_ids" db:"agent_ids"` // comma-separated
	ProductCodes    string    `json:"product_codes" db:"product_codes"`
	Status          string    `json:"status" db:"status"` // draft, finalized, approved
	GeneratedBy     string    `json:"generated_by" db:"generated_by"`
	GeneratedAt     time.Time `json:"generated_at" db:"generated_at"`
}

// PaymentRecord tracks actual commission payments
type PaymentRecord struct {
	ID              string     `json:"id" db:"id"`
	PaymentID       string     `json:"payment_id" db:"payment_id"`
	AgentID         string     `json:"agent_id" db:"agent_id"`
	AgentCode       string     `json:"agent_code" db:"agent_code"`
	AgentName       string     `json:"agent_name" db:"agent_name"`
	Amount          float64    `json:"amount" db:"amount"`
	PeriodStart     time.Time  `json:"period_start" db:"period_start"`
	PeriodEnd       time.Time  `json:"period_end" db:"period_end"`
	PaymentDate     time.Time  `json:"payment_date" db:"payment_date"`
	PaymentMethod   string     `json:"payment_method" db:"payment_method"`
	BankAccount     string     `json:"bank_account" db:"bank_account"`
	BankName        string     `json:"bank_name" db:"bank_name"`
	Status          string     `json:"status" db:"status"` // processed, pending, failed, reversed
	ReferenceNo     string     `json:"reference_no" db:"reference_no"`
	CommissionCount int        `json:"commission_count" db:"commission_count"`
	CommissionIDs   string     `json:"commission_ids" db:"commission_ids"` // comma-separated
	Notes           string     `json:"notes" db:"notes"`
	CreatedAt       time.Time  `json:"created_at" db:"created_at"`
}

// Clawback tracks policy cancellations that trigger commission clawbacks
type Clawback struct {
	ID              string     `json:"id" db:"id"`
	CommissionID    string     `json:"commission_id" db:"commission_id"`
	AgentID         string     `json:"agent_id" db:"agent_id"`
	PolicyID        string     `json:"policy_id" db:"policy_id"`
	PolicyNumber    string     `json:"policy_number" db:"policy_number"`
	OriginalAmount  float64    `json:"original_amount" db:"original_amount"`
	ClawbackAmount  float64    `json:"clawback_amount" db:"clawback_amount"`
	ClawbackReason  string     `json:"clawback_reason" db:"clawback_reason"` // cancellation, non_payment, fraud, error
	CancellationDate time.Time `json:"cancellation_date" db:"cancellation_date"`
	IsWithinClawbackPeriod bool `json:"is_within_clawback_period" db:"is_within_clawback_period"`
	Status          string     `json:"status" db:"status"` // pending, processed, disputed
	ProcessedAt     *time.Time `json:"processed_at" db:"processed_at"`
	CreatedAt       time.Time  `json:"created_at" db:"created_at"`
}

// CommissionDashboard provides aggregated view
type CommissionDashboard struct {
	TotalCommissions    int64         `json:"total_commissions"`
	PendingCommissions  int64         `json:"pending_commissions"`
	PaidCommissions     int64         `json:"paid_commissions"`
	TotalCommissionAmt  float64       `json:"total_commission_amount"`
	PendingAmount       float64       `json:"pending_amount"`
	PaidAmount          float64       `json:"paid_amount"`
	TotalClawbacks      float64       `json:"total_clawbacks"`
	TotalClawbackCount  int           `json:"total_clawback_count"`
	ActiveAgents        int           `json:"active_agents"`
	TotalPolicies       int           `json:"total_policies"`
	TotalPremium        float64       `json:"total_premium"`
	AvgCommissionRate   float64       `json:"avg_commission_rate"`
	TopAgent            AgentRank     `json:"top_agent"`
	TopProduct          ProductRank   `json:"top_product"`
	PeriodStart         time.Time     `json:"period_start"`
	PeriodEnd           time.Time     `json:"period_end"`
}

type AgentRank struct {
	AgentID   string  `json:"agent_id"`
	AgentName string  `json:"agent_name"`
	Amount    float64 `json:"amount"`
}

type ProductRank struct {
	ProductCode string  `json:"product_code"`
	Amount      float64 `json:"amount"`
}
