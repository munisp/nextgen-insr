package models

import (
	"time"

	"github.com/google/uuid"
)

type Customer struct {
	ID                uuid.UUID              `json:"id" gorm:"type:uuid;primary_key"`
	CustomerNumber    string                 `json:"customer_number" gorm:"uniqueIndex"`
	FirstName         string                 `json:"first_name"`
	LastName          string                 `json:"last_name"`
	Email             string                 `json:"email" gorm:"uniqueIndex"`
	Phone             string                 `json:"phone"`
	DateOfBirth       *time.Time             `json:"date_of_birth"`
	Gender            string                 `json:"gender"`
	MaritalStatus     string                 `json:"marital_status"`
	Occupation        string                 `json:"occupation"`
	EmployerName      string                 `json:"employer_name"`
	AnnualIncome      float64                `json:"annual_income"`
	Address           string                 `json:"address"`
	City              string                 `json:"city"`
	State             string                 `json:"state"`
	Country           string                 `json:"country"`
	PostalCode        string                 `json:"postal_code"`
	KYCStatus         string                 `json:"kyc_status"`
	KYCVerifiedAt     *time.Time             `json:"kyc_verified_at"`
	RiskScore         float64                `json:"risk_score"`
	CustomerSegment   string                 `json:"customer_segment"`
	LifetimeValue     float64                `json:"lifetime_value"`
	ChurnRisk         float64                `json:"churn_risk"`
	SentimentScore    float64                `json:"sentiment_score"`
	PreferredChannel  string                 `json:"preferred_channel"`
	PreferredLanguage string                 `json:"preferred_language"`
	Tags              []string               `json:"tags" gorm:"type:text[]"`
	Metadata          map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
	CreatedAt         time.Time              `json:"created_at"`
	UpdatedAt         time.Time              `json:"updated_at"`
}

type CustomerPolicy struct {
	ID               uuid.UUID  `json:"id"`
	CustomerID       uuid.UUID  `json:"customer_id"`
	PolicyNumber     string     `json:"policy_number"`
	ProductType      string     `json:"product_type"`
	ProductName      string     `json:"product_name"`
	Status           string     `json:"status"`
	EffectiveDate    time.Time  `json:"effective_date"`
	ExpiryDate       time.Time  `json:"expiry_date"`
	PremiumAmount    float64    `json:"premium_amount"`
	PremiumFrequency string     `json:"premium_frequency"`
	SumInsured       float64    `json:"sum_insured"`
	Currency         string     `json:"currency"`
	PaymentStatus    string     `json:"payment_status"`
	LastPaymentDate  *time.Time `json:"last_payment_date"`
	NextPaymentDate  *time.Time `json:"next_payment_date"`
	RenewalDate      *time.Time `json:"renewal_date"`
	AutoRenewal      bool       `json:"auto_renewal"`
}

type CustomerClaim struct {
	ID                uuid.UUID  `json:"id"`
	CustomerID        uuid.UUID  `json:"customer_id"`
	PolicyID          uuid.UUID  `json:"policy_id"`
	ClaimNumber       string     `json:"claim_number"`
	ClaimType         string     `json:"claim_type"`
	Status            string     `json:"status"`
	IncidentDate      time.Time  `json:"incident_date"`
	ReportedDate      time.Time  `json:"reported_date"`
	ClaimAmount       float64    `json:"claim_amount"`
	ApprovedAmount    float64    `json:"approved_amount"`
	PaidAmount        float64    `json:"paid_amount"`
	Currency          string     `json:"currency"`
	Description       string     `json:"description"`
	Resolution        string     `json:"resolution"`
	ResolvedAt        *time.Time `json:"resolved_at"`
	SatisfactionScore *float64   `json:"satisfaction_score"`
}

type CustomerInteraction struct {
	ID              uuid.UUID              `json:"id"`
	CustomerID      uuid.UUID              `json:"customer_id"`
	InteractionType string                 `json:"interaction_type"`
	Channel         string                 `json:"channel"`
	Subject         string                 `json:"subject"`
	Description     string                 `json:"description"`
	Status          string                 `json:"status"`
	Priority        string                 `json:"priority"`
	AssignedTo      *uuid.UUID             `json:"assigned_to"`
	ResolvedAt      *time.Time             `json:"resolved_at"`
	SentimentScore  float64                `json:"sentiment_score"`
	Tags            []string               `json:"tags"`
	Metadata        map[string]interface{} `json:"metadata"`
	CreatedAt       time.Time              `json:"created_at"`
	UpdatedAt       time.Time              `json:"updated_at"`
}

type CustomerDocument struct {
	ID           uuid.UUID  `json:"id"`
	CustomerID   uuid.UUID  `json:"customer_id"`
	DocumentType string     `json:"document_type"`
	FileName     string     `json:"file_name"`
	FilePath     string     `json:"file_path"`
	FileSize     int64      `json:"file_size"`
	MimeType     string     `json:"mime_type"`
	Status       string     `json:"status"`
	VerifiedAt   *time.Time `json:"verified_at"`
	ExpiresAt    *time.Time `json:"expires_at"`
	CreatedAt    time.Time  `json:"created_at"`
}

type CustomerPayment struct {
	ID            uuid.UUID  `json:"id"`
	CustomerID    uuid.UUID  `json:"customer_id"`
	PolicyID      *uuid.UUID `json:"policy_id"`
	ClaimID       *uuid.UUID `json:"claim_id"`
	PaymentType   string     `json:"payment_type"`
	Amount        float64    `json:"amount"`
	Currency      string     `json:"currency"`
	Status        string     `json:"status"`
	PaymentMethod string     `json:"payment_method"`
	Reference     string     `json:"reference"`
	Description   string     `json:"description"`
	PaidAt        *time.Time `json:"paid_at"`
	CreatedAt     time.Time  `json:"created_at"`
}

type Customer360View struct {
	Customer        *Customer             `json:"customer"`
	Policies        []CustomerPolicy      `json:"policies"`
	Claims          []CustomerClaim       `json:"claims"`
	Interactions    []CustomerInteraction `json:"interactions"`
	Documents       []CustomerDocument    `json:"documents"`
	Payments        []CustomerPayment     `json:"payments"`
	Analytics       *CustomerAnalytics    `json:"analytics"`
	Recommendations []Recommendation      `json:"recommendations"`
	JourneyEvents   []JourneyEvent        `json:"journey_events"`
	RiskProfile     *RiskProfile          `json:"risk_profile"`
}

type CustomerAnalytics struct {
	TotalPolicies        int       `json:"total_policies"`
	ActivePolicies       int       `json:"active_policies"`
	TotalPremiumPaid     float64   `json:"total_premium_paid"`
	TotalClaimsPaid      float64   `json:"total_claims_paid"`
	ClaimFrequency       float64   `json:"claim_frequency"`
	AverageClaimAmount   float64   `json:"average_claim_amount"`
	LossRatio            float64   `json:"loss_ratio"`
	RetentionRate        float64   `json:"retention_rate"`
	CrossSellScore       float64   `json:"cross_sell_score"`
	UpSellScore          float64   `json:"up_sell_score"`
	EngagementScore      float64   `json:"engagement_score"`
	NPS                  float64   `json:"nps"`
	CSAT                 float64   `json:"csat"`
	CustomerSince        time.Time `json:"customer_since"`
	DaysSinceLastContact int       `json:"days_since_last_contact"`
}

type Recommendation struct {
	ID            string     `json:"id"`
	Type          string     `json:"type"`
	Title         string     `json:"title"`
	Description   string     `json:"description"`
	ProductID     string     `json:"product_id,omitempty"`
	ProductName   string     `json:"product_name,omitempty"`
	Confidence    float64    `json:"confidence"`
	Priority      int        `json:"priority"`
	Reason        string     `json:"reason"`
	ExpectedValue float64    `json:"expected_value,omitempty"`
	ValidUntil    *time.Time `json:"valid_until,omitempty"`
	Status        string     `json:"status"`
	CreatedAt     time.Time  `json:"created_at"`
}

type JourneyEvent struct {
	ID          string                 `json:"id"`
	CustomerID  uuid.UUID              `json:"customer_id"`
	EventType   string                 `json:"event_type"`
	EventName   string                 `json:"event_name"`
	Channel     string                 `json:"channel"`
	Description string                 `json:"description"`
	EntityType  string                 `json:"entity_type,omitempty"`
	EntityID    string                 `json:"entity_id,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
	Timestamp   time.Time              `json:"timestamp"`
}

type RiskProfile struct {
	OverallRiskScore   float64      `json:"overall_risk_score"`
	FraudRiskScore     float64      `json:"fraud_risk_score"`
	CreditRiskScore    float64      `json:"credit_risk_score"`
	ChurnRiskScore     float64      `json:"churn_risk_score"`
	ClaimRiskScore     float64      `json:"claim_risk_score"`
	RiskFactors        []RiskFactor `json:"risk_factors"`
	RiskTrend          string       `json:"risk_trend"`
	LastAssessmentDate time.Time    `json:"last_assessment_date"`
	NextAssessmentDate time.Time    `json:"next_assessment_date"`
}

type RiskFactor struct {
	Factor      string  `json:"factor"`
	Score       float64 `json:"score"`
	Weight      float64 `json:"weight"`
	Impact      string  `json:"impact"`
	Description string  `json:"description"`
}
