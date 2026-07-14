package models

import (
	"time"
)

// TakafulProduct represents a Shariah-compliant insurance product
type TakafulProduct struct {
	ID                string    `json:"id" db:"id"`
	ProductCode       string    `json:"product_code" db:"product_code"`
	Name              string    `json:"name" db:"name"`
	Description       string    `json:"description" db:"description"`
	Category          string    `json:"category" db:"category"` // life, health, general, family, motor, marine
	RiskType          string    `json:"risk_type" db:"risk_type"`
	MinContribution   float64   `json:"min_contribution" db:"min_contribution"`
	MaxContribution   float64   `json:"max_contribution" db:"max_contribution"`
	MaxSumAssured     float64   `json:"max_sum_assured" db:"max_sum_assured"`
	WakalaFeePercent  float64   `json:"wakala_fee_percent" db:"wakala_fee_percent"`
	ParticipantShare  float64   `json:"participant_share" db:"participant_share"`
	TabarruPercent    float64   `json:"tabarru_percent" db:"tabarru_percent"`
	IsShariahCertified bool   `json:"is_shariah_certified" db:"is_shariah_certified"`
	ShariahBoardID    *string   `json:"shariah_board_id" db:"shariah_board_id"`
	ShariahCertDate   *time.Time `json:"shariah_cert_date" db:"shariah_cert_date"`
	ShariahExpiryDate *time.Time `json:"shariah_expiry_date" db:"shariah_expiry_date"`
	IsActive          bool      `json:"is_active" db:"is_active"`
	MaxCoverageAmount float64   `json:"max_coverage_amount" db:"max_coverage_amount"`
	WaitingPeriodDays int       `json:"waiting_period_days" db:"waiting_period_days"`
	CoInsurancePct    float64   `json:"co_insurance_pct" db:"co_insurance_pct"`
	CreatedAt         time.Time `json:"created_at" db:"created_at"`
	UpdatedAt         time.Time `json:"updated_at" db:"updated_at"`
}

// Participant represents a Takaful participant (policyholder)
type Participant struct {
	ID              string    `json:"id" db:"id"`
	ParticipantCode string    `json:"participant_code" db:"participant_code"`
	FirstName       string    `json:"first_name" db:"first_name"`
	LastName        string    `json:"last_name" db:"last_name"`
	MiddleName      string    `json:"middle_name" db:"middle_name"`
	NIN             string    `json:"nin" db:"nin"`
	Phone           string    `json:"phone" db:"phone"`
	Email           string    `json:"email" db:"email"`
	DOB             time.Time `json:"dob" db:"dob"`
	Gender          string    `json:"gender" db:"gender"`
	Address         string    `json:"address" db:"address"`
	City            string    `json:"city" db:"city"`
	State           string    `json:"state" db:"state"`
	KYCStatus       string    `json:"kyc_status" db:"kyc_status"` // pending, verified, rejected
	KYCVerifiedAt   *time.Time `json:"kyc_verified_at" db:"kyc_verified_at"`
	IsParticipant   bool      `json:"is_participant" db:"is_participant"`
	EnrollmentDate  time.Time `json:"enrollment_date" db:"enrollment_date"`
	LastContribution time.Time `json:"last_contribution" db:"last_contribution"`
	TotalContributions float64 `json:"total_contributions" db:"total_contributions"`
	CurrentShare    float64   `json:"current_share" db:"current_share"`
	SurplusBalance  float64   `json:"surplus_balance" db:"surplus_balance"`
	Status          string    `json:"status" db:"status"` // active, suspended, withdrawn
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time `json:"updated_at" db:"updated_at"`
}

// Contribution represents a participant's contribution to the Takaful pool
type Contribution struct {
	ID              string    `json:"id" db:"id"`
	ParticipantID   string    `json:"participant_id" db:"participant_id"`
	ProductID       string    `json:"product_id" db:"product_id"`
	TransactionID   string    `json:"transaction_id" db:"transaction_id"`
	Amount          float64   `json:"amount" db:"amount"`
	TabarruPortion  float64   `json:"tabarru_portion" db:"tabarru_portion"`
	WakalaFee       float64   `json:"wakala_fee" db:"wakala_fee"`
	InvestmentPortion float64 `json:"investment_portion" db:"investment_portion"`
	PaymentMethod   string    `json:"payment_method" db:"payment_method"` // bank_transfer, card, pos, bank_debit
	Status          string    `json:"status" db:"status"` // pending, completed, failed, refunded
	ProcessedAt     *time.Time `json:"processed_at" db:"processed_at"`
	ReferenceNo     string    `json:"reference_no" db:"reference_no"`
	Notes           string    `json:"notes" db:"notes"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
}

// TabarruPool tracks the donation pool for risk sharing
type TabarruPool struct {
	ID                string    `json:"id" db:"id"`
	PoolName          string    `json:"pool_name" db:"pool_name"`
	PoolType          string    `json:"pool_type" db:"pool_type"` // general, specific_product, risk_type
	TotalContributions float64  `json:"total_contributions" db:"total_contributions"`
	TotalClaims       float64   `json:"total_claims" db:"total_claims"`
	CurrentBalance    float64   `json:"current_balance" db:"current_balance"`
	InvestmentBalance float64   `json:"investment_balance" db:"investment_balance"`
	TotalParticipants int       `json:"total_participants" db:"total_participants"`
	TotalTabarru      float64   `json:"total_tabarru" db:"total_tabarru"`
	TotalWakalaFee    float64   `json:"total_wakala_fee" db:"total_wakala_fee"`
	InvestmentReturn  float64   `json:"investment_return" db:"investment_return"`
	IsShariahCompliant bool   `json:"is_shariah_compliant" db:"is_shariah_compliant"`
	PeriodStart       time.Time `json:"period_start" db:"period_start"`
	PeriodEnd         time.Time `json:"period_end" db:"period_end"`
	Status            string    `json:"status" db:"status"` // active, closed, suspended
	CreatedAt         time.Time `json:"created_at" db:"created_at"`
	UpdatedAt         time.Time `json:"updated_at" db:"updated_at"`
}

// SurplusDistribution tracks surplus sharing between participants and operator
type SurplusDistribution struct {
	ID               string    `json:"id" db:"id"`
	Period           string    `json:"period" db:"period"` // YYYY or YYYY-Q
	PoolID           string    `json:"pool_id" db:"pool_id"`
	TotalSurplus     float64   `json:"total_surplus" db:"total_surplus"`
	ParticipantShare float64   `json:"participant_share" db:"participant_share"`
	OperatorShare    float64   `json:"operator_share" db:"operator_share"`
	DistributionRatio string  `json:"distribution_ratio" db:"distribution_ratio"`
	ParticipantCount int       `json:"participant_count" db:"participant_count"`
	AvgParticipantShare float64 `json:"avg_participant_share" db:"avg_participant_share"`
	Status           string    `json:"status" db:"status"` // calculated, approved, distributed
	ApprovedBy       *string   `json:"approved_by" db:"approved_by"`
	ApprovedAt       *time.Time `json:"approved_at" db:"approved_at"`
	DistributedAt    *time.Time `json:"distributed_at" db:"distributed_at"`
	Notes            string    `json:"notes" db:"notes"`
	CreatedAt        time.Time `json:"created_at" db:"created_at"`
}

// Claim represents a Takaful claim
type Claim struct {
	ID               string    `json:"id" db:"id"`
	ClaimNumber      string    `json:"claim_number" db:"claim_number"`
	ParticipantID    string    `json:"participant_id" db:"participant_id"`
	ProductID        string    `json:"product_id" db:"product_id"`
	PoolID           string    `json:"pool_id" db:"pool_id"`
	ClaimType        string    `json:"claim_type" db:"claim_type"` // death, illness, accident, hospitalization, critical_illness
	ClaimAmount      float64   `json:"claim_amount" db:"claim_amount"`
	Deductible       float64   `json:"deductible" db:"deductible"`
	PaidAmount       float64   `json:"paid_amount" db:"paid_amount"`
	RejectionReason  string    `json:"rejection_reason" db:"rejection_reason"`
	Status           string    `json:"status" db:"status"` // filed, under_review, approved, partially_approved, rejected, paid, closed
	FiledAt          time.Time `json:"filed_at" db:"filed_at"`
	ApprovedAt       *time.Time `json:"approved_at" db:"approved_at"`
	PaidAt           *time.Time `json:"paid_at" db:"paid_at"`
	ReviewedBy       *string   `json:"reviewed_by" db:"reviewed_by"`
	ClaimDocuments   string    `json:"claim_documents" db:"claim_documents"` // JSON array of document refs
	CreatedAt        time.Time `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time `json:"updated_at" db:"updated_at"`
}

// ShariahBoard represents the Shariah Advisory Board
type ShariahBoard struct {
	ID            string    `json:"id" db:"id"`
	BoardName     string    `json:"board_name" db:"board_name"`
	MemberName    string    `json:"member_name" db:"member_name"`
	Title         string    `json:"title" db:"title"`
	Certification string    `json:"certification" db:"certification"`
	AppointedAt   time.Time `json:"appointed_at" db:"appointed_at"`
	ExpiryDate    time.Time `json:"expiry_date" db:"expiry_date"`
	IsActive      bool      `json:"is_active" db:"is_active"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

// ProductApproval represents Shariah board approval for a product
type ProductApproval struct {
	ID            string    `json:"id" db:"id"`
	ProductID     string    `json:"product_id" db:"product_id"`
	ShariahBoardID string   `json:"shariah_board_id" db:"shariah_board_id"`
	ApprovalNumber string   `json:"approval_number" db:"approval_number"`
	ApprovedAt    time.Time `json:"approved_at" db:"approved_at"`
	ExpiryDate    time.Time `json:"expiry_date" db:"expiry_date"`
	Notes         string    `json:"notes" db:"notes"`
	IsCertified   bool      `json:"is_certified" db:"is_certified"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

// ZakatRecord tracks zakat calculations and distributions
type ZakatRecord struct {
	ID               string    `json:"id" db:"id"`
	ParticipantID    string    `json:"participant_id" db:"participant_id"`
	Year             int       `json:"year" db:"year"`
	NetWealth        float64   `json:"net_wealth" db:"net_wealth"`
	NisabThreshold   float64   `json:"nisab_threshold" db:"nisab_threshold"`
	IsZakatObliged   bool      `json:"is_zakat_obliged" db:"is_zakat_obliged"`
	ZakatRate        float64   `json:"zakat_rate" db:"zakat_rate"`
	ZakatAmount      float64   `json:"zakat_amount" db:"zakat_amount"`
	Paid             bool      `json:"paid" db:"paid"`
	PaidAt           *time.Time `json:"paid_at" db:"paid_at"`
	Recipients       string    `json:"recipients" db:"recipients"` // JSON array of recipient categories
	Status           string    `json:"status" db:"status"` // calculated, paid, exempt
	CalculatedAt     time.Time `json:"calculated_at" db:"calculated_at"`
}

// RetakafulEntry tracks reinsurance arrangements
type RetakafulEntry struct {
	ID              string    `json:"id" db:"id"`
	CessionNumber   string    `json:"cession_number" db:"cession_number"`
	ParticipantID   string    `json:"participant_id" db:"participant_id"`
	ProductID       string    `json:"product_id" db:"product_id"`
	RetakafulOperator string  `json:"retakaful_operator" db:"retakaful_operator"`
	CededAmount     float64   `json:"ceded_amount" db:"ceded_amount"`
	CededPercentage float64   `json:"ceded_percentage" db:"ceded_percentage"`
	TreatyType      string    `json:"treaty_type" db:"treaty_type"` // quota_share, surplus, facultative
	IsActive        bool      `json:"is_active" db:"is_active"`
	EffectiveDate   time.Time `json:"effective_date" db:"effective_date"`
	ExpiryDate      time.Time `json:"expiry_date" db:"expiry_date"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
}

// PoolSnapshot is a time-snapshot of pool state for reporting
type PoolSnapshot struct {
	ID              string    `json:"id" db:"id"`
	PoolID          string    `json:"pool_id" db:"pool_id"`
	SnapshotDate    time.Time `json:"snapshot_date" db:"snapshot_date"`
	TotalBalance    float64   `json:"total_balance" db:"total_balance"`
	TotalClaims     float64   `json:"total_claims" db:"total_claims"`
	TotalParticipants int     `json:"total_participants" db:"total_participants"`
	InvestmentReturn float64  `json:"investment_return" db:"investment_return"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
}
