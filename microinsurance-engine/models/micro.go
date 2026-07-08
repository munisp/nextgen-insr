package models

import "time"

// ProductType represents a microinsurance product category
type ProductType string

const (
	ProductCrop       ProductType = "crop"
	ProductHealth     ProductType = "health"
	ProductLife       ProductType = "life"
	ProductDevice     ProductType = "device"
	ProductTravel     ProductType = "travel"
	ProductFuneral    ProductType = "funeral"
	ProductSavings    ProductType = "savings"
)

// ProductStatus represents the lifecycle of a micro product
type ProductStatus string

const (
	ProductDraft      ProductStatus = "draft"
	ProductActive     ProductStatus = "active"
	ProductSuspended  ProductStatus = "suspended"
	ProductRetired    ProductStatus = "retired"
)

// EnrollmentChannel represents how a customer enrolls
type EnrollmentChannel string

const (
	ChannelUSSD   EnrollmentChannel = "ussd"
	ChannelAgent  EnrollmentChannel = "agent"
	ChannelMobile EnrollmentChannel = "mobile"
	ChannelWeb    EnrollmentChannel = "web"
	ChannelMNO    EnrollmentChannel = "mno"
	ChannelGroup  EnrollmentChannel = "group"
)

// CoverageType represents the type of coverage
type CoverageType string

const (
	CoverageIndemnity CoverageType = "indemnity"
	CoverageBenefit   CoverageType = "benefit"
	CoverageParametric CoverageType = "parametric"
)

// MicroProduct represents a microinsurance product definition
type MicroProduct struct {
	ID                string         `json:"id"`
	ProductID         string         `json:"product_id"`
	Name              string         `json:"name"`
	Type              ProductType    `json:"type"`
	Description       string         `json:"description"`
	Premium           float64        `json:"premium"`
	Currency          string         `json:"currency"`
	CoverageAmount    float64        `json:"coverage_amount"`
	CoverageType      CoverageType   `json:"coverage_type"`
	Duration          string         `json:"duration"`
	ClaimSLA          string         `json:"claim_sla"`
	MaxAge            int            `json:"max_age"`
	MinAge            int            `json:"min_age"`
	MaxSumInsured     float64        `json:"max_sum_insured"`
	WaitingPeriod     string         `json:"waiting_period"`
	ParametricTrigger string         `json:"parametric_trigger,omitempty"`
	Exclusions        []string       `json:"exclusions,omitempty"`
	Status            ProductStatus  `json:"status"`
	Metadata          map[string]any `json:"metadata,omitempty"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
}

// EnrollmentStatus represents the status of an enrollment
type EnrollmentStatus string

const (
	EnrollmentPending  EnrollmentStatus = "pending"
	EnrollmentActive   EnrollmentStatus = "active"
	EnrollmentExpired  EnrollmentStatus = "expired"
	EnrollmentCancelled EnrollmentStatus = "cancelled"
	EnrollmentSuspended EnrollmentStatus = "suspended"
)

// Enrollment represents a customer enrolled in a micro product
type Enrollment struct {
	ID              string          `json:"id"`
	EnrollmentID    string          `json:"enrollment_id"`
	ProductID       string          `json:"product_id"`
	CustomerID      string          `json:"customer_id"`
	PhoneNumber     string          `json:"phone_number"`
	FirstName       string          `json:"first_name"`
	LastName        string          `json:"last_name"`
	Channel         EnrollmentChannel `json:"channel"`
	Status          EnrollmentStatus `json:"status"`
	StartDate       time.Time       `json:"start_date"`
	EndDate         time.Time       `json:"end_date"`
	Premium         float64         `json:"premium"`
	PaymentMethod   string          `json:"payment_method"`
	GroupID         string          `json:"group_id,omitempty"`
	USSDCode        string          `json:"ussd_code,omitempty"`
	NextPaymentDue  time.Time       `json:"next_payment_due"`
	AutoRenew       bool            `json:"auto_renew"`
	Metadata        map[string]any  `json:"metadata,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

// ClaimType represents the type of claim
type ClaimType string

const (
	ClaimDeath      ClaimType = "death"
	ClaimIllness    ClaimType = "illness"
	ClaimHospital   ClaimType = "hospitalization"
	ClaimCropDamage ClaimType = "crop_damage"
	ClaimDeviceLoss ClaimType = "device_loss"
	ClaimTravel     ClaimType = "travel"
	ClaimParametric ClaimType = "parametric_trigger"
)

// ClaimStatus represents the status of a claim
type ClaimStatus string

const (
	ClaimSubmitted    ClaimStatus = "submitted"
	ClaimUnderReview  ClaimStatus = "under_review"
	ClaimApproved     ClaimStatus = "approved"
	ClaimRejected     ClaimStatus = "rejected"
	ClaimPaid         ClaimStatus = "paid"
	ClaimSettled      ClaimStatus = "settled"
	ClaimEscalated    ClaimStatus = "escalated"
)

// Claim represents a claim filing
type Claim struct {
	ID              string       `json:"id"`
	ClaimID         string       `json:"claim_id"`
	EnrollmentID    string       `json:"enrollment_id"`
	ProductID       string       `json:"product_id"`
	CustomerID      string       `json:"customer_id"`
	Type            ClaimType    `json:"type"`
	Description     string       `json:"description"`
	ClaimAmount     float64      `json:"claim_amount"`
	SettlementAmount float64     `json:"settlement_amount"`
	Status          ClaimStatus  `json:"status"`
	Documents       int          `json:"documents_required"`
	DocumentsSubmitted int       `json:"documents_submitted"`
	ParametricValue float64      `json:"parametric_value,omitempty"`
	ParametricTrigger string   `json:"parametric_trigger,omitempty"`
	ApprovedBy      string       `json:"approved_by,omitempty"`
	ApprovedAt      *time.Time   `json:"approved_at,omitempty"`
	RejectedAt      *time.Time   `json:"rejected_at,omitempty"`
	RejectReason    string       `json:"reject_reason,omitempty"`
	PaidAt          *time.Time   `json:"paid_at,omitempty"`
	SettlementDate  *time.Time   `json:"settlement_date,omitempty"`
	CreatedAt       time.Time    `json:"created_at"`
	UpdatedAt       time.Time    `json:"updated_at"`
}

// Micropayment represents a premium payment
type Micropayment struct {
	ID             string     `json:"id"`
	PaymentID      string     `json:"payment_id"`
	EnrollmentID   string     `json:"enrollment_id"`
	CustomerID     string     `json:"customer_id"`
	Amount         float64    `json:"amount"`
	Currency       string     `json:"currency"`
	Method         string     `json:"method"` // mobile_money, bank_transfer, agent_cash
	Status         string     `json:"status"`
	Reference      string     `json:"reference"`
	PeriodFrom     time.Time  `json:"period_from"`
	PeriodTo       time.Time  `json:"period_to"`
	PaidAt         time.Time  `json:"paid_at"`
	Metadata       map[string]any `json:"metadata,omitempty"`
}

// GroupPolicy represents a group enrollment (e.g., cooperative, union)
type GroupPolicy struct {
	ID              string         `json:"id"`
	GroupID         string         `json:"group_id"`
	GroupName       string         `json:"group_name"`
	ProductID       string         `json:"product_id"`
	ProductType     ProductType    `json:"product_type"`
	GroupLeader     string         `json:"group_leader"`
	MemberCount     int            `json:"member_count"`
	EnrolledCount   int            `json:"enrolled_count"`
	PremiumPerMember float64       `json:"premium_per_member"`
	TotalPremium    float64        `json:"total_premium"`
	Status          string         `json:"status"`
	StartDate       time.Time      `json:"start_date"`
	EndDate         time.Time      `json:"end_date"`
	Metadata        map[string]any `json:"metadata,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
}

// USSDSession represents a USSD enrollment session
type USSDSession struct {
	ID          string    `json:"id"`
	PhoneNumber string    `json:"phone_number"`
	SessionID   string    `json:"session_id"`
	Step        int       `json:"step"`
	Status      string    `json:"status"`
	ProductID   string    `json:"product_id"`
	CustomerInfo map[string]string `json:"customer_info,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`
}

// ParametricTrigger represents a parametric insurance trigger event
type ParametricTrigger struct {
	ID            string    `json:"id"`
	ProductID     string    `json:"product_id"`
	TriggerType   string    `json:"trigger_type"` // rainfall, temperature, seismic, epidemic
	TriggerValue  float64   `json:"trigger_value"`
	Threshold     float64   `json:"threshold"`
	Triggered     bool      `json:"triggered"`
	TriggeredAt   *time.Time `json:"triggered_at,omitempty"`
	DataSource    string    `json:"data_source"`
	DataReference string    `json:"data_reference"`
	TotalPayout   float64   `json:"total_payout"`
	EnrolledCount int       `json:"enrolled_count"`
}

// PolicyStats holds aggregated microinsurance statistics
type PolicyStats struct {
	TotalEnrolled    int64   `json:"total_enrolled"`
	ActivePolicies   int64   `json:"active_policies"`
	ExpiringSoon     int64   `json:"expiring_soon"`
	TotalPremium     float64 `json:"total_premium"`
	ClaimsThisPeriod int64   `json:"claims_this_period"`
	ClaimsApproved   int64   `json:"claims_approved"`
	ClaimsRejected   int64   `json:"claims_rejected"`
	TotalPayout      float64 `json:"total_payout"`
	AvgPremium       float64 `json:"avg_premium"`
	LossRatio        float64 `json:"loss_ratio"`
	PenetrationRate  float64 `json:"penetration_rate"`
}
