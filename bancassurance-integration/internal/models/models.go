package models

import (
	"time"

	"github.com/google/uuid"
)

type BankPartner struct {
	ID                 uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	BankCode           string     `json:"bank_code" gorm:"uniqueIndex;not null"`
	BankName           string     `json:"bank_name" gorm:"not null"`
	CBNLicenseNumber   string     `json:"cbn_license_number"`
	ContactEmail       string     `json:"contact_email"`
	ContactPhone       string     `json:"contact_phone"`
	RelationshipMgr    string     `json:"relationship_manager"`
	APIEndpoint        string     `json:"api_endpoint"`
	WebhookURL         string     `json:"webhook_url"`
	CommissionRate     float64    `json:"commission_rate"`
	IsActive           bool       `json:"is_active" gorm:"default:true"`
	IntegrationType    string     `json:"integration_type"` // api, file_upload, webhook
	AgreementStartDate time.Time  `json:"agreement_start_date"`
	AgreementEndDate   *time.Time `json:"agreement_end_date"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type BankCustomerMapping struct {
	ID                  uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	BankPartnerID       uuid.UUID  `json:"bank_partner_id" gorm:"type:uuid;index"`
	BankCustomerID      string     `json:"bank_customer_id" gorm:"index;not null"`
	BankAccountNo       string     `json:"bank_account_no"`
	InsuranceCustomerID *uuid.UUID `json:"insurance_customer_id" gorm:"type:uuid"`
	BVN                 string     `json:"bvn" gorm:"index"`
	FirstName           string     `json:"first_name"`
	LastName            string     `json:"last_name"`
	Email               string     `json:"email"`
	Phone               string     `json:"phone"`
	KYCVerified         bool       `json:"kyc_verified" gorm:"default:false"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

type InsuranceOffer struct {
	ID               uuid.UUID              `json:"id" gorm:"type:uuid;primaryKey"`
	BankPartnerID    uuid.UUID              `json:"bank_partner_id" gorm:"type:uuid;index"`
	CustomerMapID    uuid.UUID              `json:"customer_map_id" gorm:"type:uuid;index"`
	OfferType        string                 `json:"offer_type"` // loan_protection, mortgage, credit_life, savings_linked
	ProductCode      string                 `json:"product_code"`
	SumAssured       float64                `json:"sum_assured"`
	Premium          float64                `json:"premium"`
	PremiumFrequency string                 `json:"premium_frequency"` // monthly, quarterly, annually, single
	Term             int                    `json:"term_months"`
	CoverageDetails  map[string]interface{} `json:"coverage_details" gorm:"serializer:json"`
	Status           string                 `json:"status" gorm:"default:'generated'"` // generated, presented, accepted, declined, expired
	PresentedAt      *time.Time             `json:"presented_at"`
	RespondedAt      *time.Time             `json:"responded_at"`
	ExpiresAt        time.Time              `json:"expires_at"`
	CreatedAt        time.Time              `json:"created_at"`
}

type LoanProtectionPolicy struct {
	ID                 uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	PolicyNumber       string    `json:"policy_number" gorm:"uniqueIndex;not null"`
	OfferID            uuid.UUID `json:"offer_id" gorm:"type:uuid;index"`
	BankPartnerID      uuid.UUID `json:"bank_partner_id" gorm:"type:uuid;index"`
	CustomerMapID      uuid.UUID `json:"customer_map_id" gorm:"type:uuid"`
	LoanAccountNo      string    `json:"loan_account_no" gorm:"index"`
	LoanAmount         float64   `json:"loan_amount"`
	LoanTenure         int       `json:"loan_tenure_months"`
	OutstandingBalance float64   `json:"outstanding_balance"`
	CoverType          string    `json:"cover_type"` // death, disability, retrenchment, critical_illness
	SumAssured         float64   `json:"sum_assured"`
	Premium            float64   `json:"premium"`
	Status             string    `json:"status" gorm:"default:'active'"` // active, claimed, cancelled, expired, lapsed
	InceptionDate      time.Time `json:"inception_date"`
	ExpiryDate         time.Time `json:"expiry_date"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

type DebitMandate struct {
	ID            uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	MandateRef    string     `json:"mandate_ref" gorm:"uniqueIndex;not null"`
	BankPartnerID uuid.UUID  `json:"bank_partner_id" gorm:"type:uuid;index"`
	PolicyID      uuid.UUID  `json:"policy_id" gorm:"type:uuid;index"`
	AccountNumber string     `json:"account_number"`
	AccountName   string     `json:"account_name"`
	BankCode      string     `json:"bank_code"`
	Amount        float64    `json:"amount"`
	Frequency     string     `json:"frequency"` // monthly, quarterly, annually
	StartDate     time.Time  `json:"start_date"`
	EndDate       *time.Time `json:"end_date"`
	Status        string     `json:"status" gorm:"default:'pending'"` // pending, active, suspended, cancelled
	LastDebitDate *time.Time `json:"last_debit_date"`
	NextDebitDate *time.Time `json:"next_debit_date"`
	FailureCount  int        `json:"failure_count" gorm:"default:0"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type PremiumCollection struct {
	ID             uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	MandateID      uuid.UUID `json:"mandate_id" gorm:"type:uuid;index"`
	PolicyID       uuid.UUID `json:"policy_id" gorm:"type:uuid;index"`
	BankPartnerID  uuid.UUID `json:"bank_partner_id" gorm:"type:uuid;index"`
	Amount         float64   `json:"amount"`
	TransactionRef string    `json:"transaction_ref" gorm:"uniqueIndex"`
	BankReference  string    `json:"bank_reference"`
	Status         string    `json:"status" gorm:"default:'pending'"` // pending, successful, failed, reversed
	FailureReason  string    `json:"failure_reason"`
	CollectionDate time.Time `json:"collection_date"`
	ValueDate      time.Time `json:"value_date"`
	CreatedAt      time.Time `json:"created_at"`
}

type CommissionSettlement struct {
	ID               uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	BankPartnerID    uuid.UUID  `json:"bank_partner_id" gorm:"type:uuid;index"`
	Period           string     `json:"period" gorm:"index"`
	TotalPremium     float64    `json:"total_premium"`
	CommissionRate   float64    `json:"commission_rate"`
	CommissionAmount float64    `json:"commission_amount"`
	WithholdingTax   float64    `json:"withholding_tax"`
	NetAmount        float64    `json:"net_amount"`
	PolicyCount      int        `json:"policy_count"`
	Status           string     `json:"status" gorm:"default:'calculated'"` // calculated, approved, paid
	PaidAt           *time.Time `json:"paid_at"`
	PaymentRef       string     `json:"payment_ref"`
	CreatedAt        time.Time  `json:"created_at"`
}

type BankWebhookEvent struct {
	ID            uuid.UUID              `json:"id" gorm:"type:uuid;primaryKey"`
	BankPartnerID uuid.UUID              `json:"bank_partner_id" gorm:"type:uuid;index"`
	EventType     string                 `json:"event_type" gorm:"index"` // loan_disbursed, loan_repaid, account_closed, mandate_response
	Payload       map[string]interface{} `json:"payload" gorm:"serializer:json"`
	Status        string                 `json:"status" gorm:"default:'received'"` // received, processed, failed
	ProcessedAt   *time.Time             `json:"processed_at"`
	ErrorMessage  string                 `json:"error_message"`
	CreatedAt     time.Time              `json:"created_at"`
}
