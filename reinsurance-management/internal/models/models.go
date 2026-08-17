package models

import (
	"time"

	"github.com/google/uuid"
)

type Treaty struct {
	ID                uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	TreatyNumber      string    `json:"treaty_number" gorm:"uniqueIndex;not null"`
	TreatyName        string    `json:"treaty_name" gorm:"not null"`
	TreatyType        string    `json:"treaty_type"` // quota_share, surplus, excess_of_loss, stop_loss
	LineOfBusiness    string    `json:"line_of_business" gorm:"index"`
	LeadReinsurer     string    `json:"lead_reinsurer"`
	EffectiveDate     time.Time `json:"effective_date"`
	ExpiryDate        time.Time `json:"expiry_date"`
	RetentionLimit    float64   `json:"retention_limit"`
	CessionPercentage float64   `json:"cession_percentage"`
	CommissionRate    float64   `json:"commission_rate"`
	ProfitCommission  float64   `json:"profit_commission"`
	Status            string    `json:"status" gorm:"default:'active'"` // draft, active, expired, cancelled
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

type ReinsurerParticipation struct {
	ID              uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	TreatyID        uuid.UUID `json:"treaty_id" gorm:"type:uuid;index"`
	ReinsurerName   string    `json:"reinsurer_name"`
	ReinsurerCode   string    `json:"reinsurer_code"`
	SharePercentage float64   `json:"share_percentage"`
	CreditRating    string    `json:"credit_rating"` // AAA, AA, A, BBB
	Country         string    `json:"country"`
	ContactEmail    string    `json:"contact_email"`
	IsLeader        bool      `json:"is_leader" gorm:"default:false"`
	CreatedAt       time.Time `json:"created_at"`
}

type FacultativePlacement struct {
	ID              uuid.UUID              `json:"id" gorm:"type:uuid;primaryKey"`
	PlacementRef    string                 `json:"placement_ref" gorm:"uniqueIndex;not null"`
	PolicyID        string                 `json:"policy_id" gorm:"index"`
	InsuredName     string                 `json:"insured_name"`
	RiskDescription string                 `json:"risk_description"`
	LineOfBusiness  string                 `json:"line_of_business"`
	SumInsured      float64                `json:"sum_insured"`
	RetainedAmount  float64                `json:"retained_amount"`
	CededAmount     float64                `json:"ceded_amount"`
	Premium         float64                `json:"premium"`
	CededPremium    float64                `json:"ceded_premium"`
	Commission      float64                `json:"commission"`
	RiskDetails     map[string]interface{} `json:"risk_details" gorm:"serializer:json"`
	Status          string                 `json:"status" gorm:"default:'pending'"` // pending, placed, declined, expired
	PlacedWith      string                 `json:"placed_with"`
	CreatedAt       time.Time              `json:"created_at"`
	UpdatedAt       time.Time              `json:"updated_at"`
}

type CessionRecord struct {
	ID             uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	TreatyID       uuid.UUID `json:"treaty_id" gorm:"type:uuid;index"`
	PolicyID       string    `json:"policy_id" gorm:"index"`
	PolicyNumber   string    `json:"policy_number"`
	LineOfBusiness string    `json:"line_of_business"`
	SumInsured     float64   `json:"sum_insured"`
	RetainedAmount float64   `json:"retained_amount"`
	CededAmount    float64   `json:"ceded_amount"`
	GrossPremium   float64   `json:"gross_premium"`
	CededPremium   float64   `json:"ceded_premium"`
	Commission     float64   `json:"commission"`
	EffectiveDate  time.Time `json:"effective_date"`
	ExpiryDate     time.Time `json:"expiry_date"`
	CreatedAt      time.Time `json:"created_at"`
}

type ClaimRecovery struct {
	ID               uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	ClaimID          string     `json:"claim_id" gorm:"index"`
	TreatyID         uuid.UUID  `json:"treaty_id" gorm:"type:uuid;index"`
	PolicyID         string     `json:"policy_id"`
	GrossClaimAmount float64    `json:"gross_claim_amount"`
	RetainedAmount   float64    `json:"retained_amount"`
	RecoveryAmount   float64    `json:"recovery_amount"`
	Status           string     `json:"status" gorm:"default:'pending'"` // pending, submitted, agreed, paid, disputed
	SubmittedAt      *time.Time `json:"submitted_at"`
	AgreedAt         *time.Time `json:"agreed_at"`
	PaidAt           *time.Time `json:"paid_at"`
	PaymentRef       string     `json:"payment_ref"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type BordereauEntry struct {
	ID            uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	TreatyID      uuid.UUID `json:"treaty_id" gorm:"type:uuid;index"`
	Period        string    `json:"period" gorm:"index"`
	EntryType     string    `json:"entry_type"` // premium, claims, paid_claims
	PolicyNumber  string    `json:"policy_number"`
	InsuredName   string    `json:"insured_name"`
	RiskClass     string    `json:"risk_class"`
	InceptionDate time.Time `json:"inception_date"`
	ExpiryDate    time.Time `json:"expiry_date"`
	SumInsured    float64   `json:"sum_insured"`
	GrossPremium  float64   `json:"gross_premium"`
	CededPremium  float64   `json:"ceded_premium"`
	Commission    float64   `json:"commission"`
	ClaimAmount   float64   `json:"claim_amount"`
	CreatedAt     time.Time `json:"created_at"`
}

type ReinsuranceAccount struct {
	ID               uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	TreatyID         uuid.UUID `json:"treaty_id" gorm:"type:uuid;index"`
	Period           string    `json:"period" gorm:"index"`
	CededPremium     float64   `json:"ceded_premium"`
	Commission       float64   `json:"commission"`
	ClaimsRecovered  float64   `json:"claims_recovered"`
	ProfitCommission float64   `json:"profit_commission"`
	Balance          float64   `json:"balance"`
	Status           string    `json:"status" gorm:"default:'open'"` // open, closed, settled
	CreatedAt        time.Time `json:"created_at"`
}

type ReinsuranceAnalytics struct {
	ID               uuid.UUID          `json:"id" gorm:"type:uuid;primaryKey"`
	Period           string             `json:"period"`
	TotalCeded       float64            `json:"total_ceded"`
	TotalRecovered   float64            `json:"total_recovered"`
	NetRetention     float64            `json:"net_retention"`
	CessionRatio     float64            `json:"cession_ratio"`
	RecoveryRatio    float64            `json:"recovery_ratio"`
	ByLineOfBusiness map[string]float64 `json:"by_line_of_business" gorm:"serializer:json"`
	CreatedAt        time.Time          `json:"created_at"`
}
