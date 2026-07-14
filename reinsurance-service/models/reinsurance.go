package models

import "time"

// TreatyType represents the type of reinsurance treaty
type TreatyType string

const (
	TreatyQuotaShare  TreatyType = "quota_share"
	TreatySurplus     TreatyType = "surplus"
	TreatyXL          TreatyType = "excess_of_loss"
	TreatyFacultative TreatyType = "facultative"
	TreatyCatXL       TreatyType = "cat_xl"
	TreatyStopLoss    TreatyType = "stop_loss"
)

// TreatyStatus represents the lifecycle of a reinsurance treaty
type TreatyStatus string

const (
	TreatyDraft    TreatyStatus = "draft"
	TreatyActive   TreatyStatus = "active"
	TreatyPending  TreatyStatus = "pending_approval"
	TreatyExpired  TreatyStatus = "expired"
	TreatySuspended TreatyStatus = "suspended"
	TreatyTerminated TreatyStatus = "terminated"
)

// Treaty represents a reinsurance treaty arrangement
type Treaty struct {
	ID             string        `json:"id"`
	TreatyID       string        `json:"treaty_id"`
	Name           string        `json:"name"`
	Type           TreatyType    `json:"type"`
	Reinsurer      string        `json:"reinsurer"`
	ReinsurerCode  string        `json:"reinsurer_code"`
	EffectiveDate  time.Time     `json:"effective_date"`
	ExpiryDate     time.Time     `json:"expiry_date"`
	Period         string        `json:"period"`
	Retention      float64       `json:"retention"`
	Limit          float64       `json:"limit"`
	CessionRate    float64       `json:"cession_rate"`
	PremiumShare   float64       `json:"premium_share"`
	CommissionRate float64       `json:"commission_rate"`
	ClawbackRate   float64       `json:"clawback_rate"`
	MinimumCeded   float64       `json:"minimum_ceded"`
	Status         TreatyStatus  `json:"status"`
	Currency       string        `json:"currency"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	CreatedAt      time.Time     `json:"created_at"`
	UpdatedAt      time.Time     `json:"updated_at"`
}

// CessionType represents the type of cession
type CessionType string

const (
	CessionAutomatic CessionType = "automatic"
	CessionFacultative CessionType = "facultative"
	CessionOptional  CessionType = "optional"
)

// CessionStatus represents the status of a cession
type CessionStatus string

const (
	CessionDraft      CessionStatus = "draft"
	CessionSubmitted  CessionStatus = "submitted"
	CessionAccepted   CessionStatus = "accepted"
	CessionRejected   CessionStatus = "rejected"
	CessionPartial    CessionStatus = "partial"
	CessionCancelled  CessionStatus = "cancelled"
)

// Cession represents the cession of risk to reinsurer
type Cession struct {
	ID            string        `json:"id"`
	CessionID     string        `json:"cession_id"`
	TreatyID      string        `json:"treaty_id"`
	PolicyID      string        `json:"policy_id"`
	RiskType      string        `json:"risk_type"`
	GrossAmount   float64       `json:"gross_amount"`
	Retention     float64       `json:"retention"`
	CededAmount   float64       `json:"ceded_amount"`
	CessionRate   float64       `json:"cession_rate"`
	Reinsurer     string        `json:"reinsurer"`
	Type          CessionType   `json:"type"`
	Status        CessionStatus `json:"status"`
	AcceptedAt    *time.Time    `json:"accepted_at,omitempty"`
	RejectedAt    *time.Time    `json:"rejected_at,omitempty"`
	RejectReason  string        `json:"reject_reason,omitempty"`
	Metadata      map[string]any `json:"metadata,omitempty"`
	CreatedAt     time.Time     `json:"created_at"`
	UpdatedAt     time.Time     `json:"updated_at"`
}

// Recovery represents reinsurance recovery calculation
type Recovery struct {
	ID            string    `json:"id"`
	CessionID     string    `json:"cession_id"`
	TreatyID      string    `json:"treaty_id"`
	PolicyID      string    `json:"policy_id"`
	ClaimAmount   float64   `json:"claim_amount"`
	GrossRecovery float64   `json:"gross_recovery"`
	NetRecovery   float64   `json:"net_recovery"`
	Commission    float64   `json:"commission"`
	Clawback      float64   `json:"clawback"`
	Status        string    `json:"status"`
	ProcessedAt   *time.Time `json:"processed_at,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// CommissionCalculation represents commission earned from reinsurance cessions
type CommissionCalculation struct {
	ID            string    `json:"id"`
	TreatyID      string    `json:"treaty_id"`
	Period        string    `json:"period"`
	CededPremium  float64   `json:"ceded_premium"`
	GrossCommission float64 `json:"gross_commission"`
	CommissionRate float64  `json:"commission_rate"`
	ClawbackAmount float64  `json:"clawback_amount"`
	NetCommission float64   `json:"net_commission"`
	PaidAmount    float64   `json:"paid_amount"`
	Outstanding   float64   `json:"outstanding"`
	Status        string    `json:"status"`
	PaidAt        *time.Time `json:"paid_at,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// TreatySummary provides aggregated treaty statistics
type TreatySummary struct {
	TreatyID         string  `json:"treaty_id"`
	Name             string  `json:"name"`
	Type             string  `json:"type"`
	Reinsurer        string  `json:"reinsurer"`
	Status           string  `json:"status"`
	GrossWritten     float64 `json:"gross_written"`
	CededPremium     float64 `json:"ceded_premium"`
	OutstandingRetention float64 `json:"outstanding_retention"`
	TotalClaims      float64 `json:"total_claims"`
	Recoveries       float64 `json:"recoveries"`
	CommissionEarned float64 `json:"commission_earned"`
	NetExposed       float64 `json:"net_exposed"`
}

// QuotaShareParams holds parameters for quota share calculations
type QuotaShareParams struct {
	GrossPremium float64
	RetentionPercent float64
	CessionPercent float64
	CommissionRate float64
}

// QuotaShareResult holds the result of quota share calculation
type QuotaShareResult struct {
	GrossPremium  float64 `json:"gross_premium"`
	RetainedPremium float64 `json:"retained_premium"`
	CededPremium  float64 `json:"ceded_premium"`
	Commission    float64 `json:"commission"`
	NetPremium    float64 `json:"net_premium"`
	ReinsurerShare float64 `json:"reinsurer_share"`
}

// ExcessOfLossParams holds parameters for XL calculations
type ExcessOfLossParams struct {
	GrossLoss    float64
	Attachment   float64
	Limit        float64
	CommissionRate float64
}

// ExcessOfLossResult holds the result of XL calculation
type ExcessOfLossResult struct {
	GrossLoss      float64 `json:"gross_loss"`
	Attachment     float64 `json:"attachment"`
	ReinsurerShare float64 `json:"reinsurer_share"`
	Retention      float64 `json:"retention"`
	Commission     float64 `json:"commission"`
	NetLoss        float64 `json:"net_loss"`
	Exceeded       bool    `json:"exceeded"`
}

// SurplusParams holds surplus treaty parameters
type SurplusParams struct {
	GrossSumInsured float64
	LineValue       float64
	NumLines        int
	Retention       float64
	CessionPercent  float64
}

// SurplusResult holds surplus treaty calculation result
type SurplusResult struct {
	GrossSumInsured float64 `json:"gross_sum_insured"`
	Retention       float64 `json:"retention"`
	CededAmount     float64 `json:"ceded_amount"`
	NumLinesUsed    float64 `json:"num_lines_used"`
	AvailableLines  float64 `json:"available_lines"`
	MaxCeded        float64 `json:"max_ceded"`
}
