package models

import (
	"time"

	"github.com/google/uuid"
)

type PFAPartner struct {
	ID             uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	PFACode        string    `json:"pfa_code" gorm:"uniqueIndex;not null"`
	PFAName        string    `json:"pfa_name" gorm:"not null"`
	PenComLicense  string    `json:"pencom_license"`
	ContactEmail   string    `json:"contact_email"`
	ContactPhone   string    `json:"contact_phone"`
	APIEndpoint    string    `json:"api_endpoint"`
	CommissionRate float64   `json:"commission_rate"`
	IsActive       bool      `json:"is_active" gorm:"default:true"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type RSAHolder struct {
	ID             uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	RSAPIN         string     `json:"rsa_pin" gorm:"uniqueIndex;not null"`
	PFAPartnerID   uuid.UUID  `json:"pfa_partner_id" gorm:"type:uuid;index"`
	FirstName      string     `json:"first_name"`
	LastName       string     `json:"last_name"`
	DateOfBirth    time.Time  `json:"date_of_birth"`
	Gender         string     `json:"gender"`
	Email          string     `json:"email"`
	Phone          string     `json:"phone"`
	EmployerName   string     `json:"employer_name"`
	EmployerRCNo   string     `json:"employer_rc_no"`
	RSABalance     float64    `json:"rsa_balance"`
	RetirementDate *time.Time `json:"retirement_date"`
	IsRetired      bool       `json:"is_retired" gorm:"default:false"`
	KYCVerified    bool       `json:"kyc_verified" gorm:"default:false"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type AnnuityProduct struct {
	ID                uuid.UUID              `json:"id" gorm:"type:uuid;primaryKey"`
	ProductCode       string                 `json:"product_code" gorm:"uniqueIndex;not null"`
	ProductName       string                 `json:"product_name"`
	ProductType       string                 `json:"product_type"` // life_annuity, term_certain, joint_life, variable
	GuaranteedPeriod  int                    `json:"guaranteed_period_years"`
	MinPurchaseAmount float64                `json:"min_purchase_amount"`
	MaxEntryAge       int                    `json:"max_entry_age"`
	InterestRate      float64                `json:"interest_rate"`
	MortalityTable    string                 `json:"mortality_table"`
	Features          map[string]interface{} `json:"features" gorm:"serializer:json"`
	IsActive          bool                   `json:"is_active" gorm:"default:true"`
	CreatedAt         time.Time              `json:"created_at"`
	UpdatedAt         time.Time              `json:"updated_at"`
}

type AnnuityQuote struct {
	ID               uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	RSAHolderID      uuid.UUID `json:"rsa_holder_id" gorm:"type:uuid;index"`
	ProductID        uuid.UUID `json:"product_id" gorm:"type:uuid"`
	PurchaseAmount   float64   `json:"purchase_amount"`
	MonthlyPension   float64   `json:"monthly_pension"`
	AnnualPension    float64   `json:"annual_pension"`
	GuaranteedPeriod int       `json:"guaranteed_period_years"`
	CommencementDate time.Time `json:"commencement_date"`
	AnnuityFactor    float64   `json:"annuity_factor"`
	InterestRate     float64   `json:"interest_rate"`
	MortalityAdjust  float64   `json:"mortality_adjustment"`
	Status           string    `json:"status" gorm:"default:'quoted'"` // quoted, accepted, declined, expired
	ValidUntil       time.Time `json:"valid_until"`
	CreatedAt        time.Time `json:"created_at"`
}

type AnnuityPolicy struct {
	ID                uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	PolicyNumber      string     `json:"policy_number" gorm:"uniqueIndex;not null"`
	QuoteID           uuid.UUID  `json:"quote_id" gorm:"type:uuid"`
	RSAHolderID       uuid.UUID  `json:"rsa_holder_id" gorm:"type:uuid;index"`
	ProductID         uuid.UUID  `json:"product_id" gorm:"type:uuid"`
	PurchaseAmount    float64    `json:"purchase_amount"`
	MonthlyPension    float64    `json:"monthly_pension"`
	CommencementDate  time.Time  `json:"commencement_date"`
	GuaranteedEndDate time.Time  `json:"guaranteed_end_date"`
	Status            string     `json:"status" gorm:"default:'active'"` // active, suspended, terminated, matured
	LastPaymentDate   *time.Time `json:"last_payment_date"`
	NextPaymentDate   *time.Time `json:"next_payment_date"`
	TotalPaid         float64    `json:"total_paid" gorm:"default:0"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type PensionPayment struct {
	ID             uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	PolicyID       uuid.UUID `json:"policy_id" gorm:"type:uuid;index"`
	RSAHolderID    uuid.UUID `json:"rsa_holder_id" gorm:"type:uuid;index"`
	Amount         float64   `json:"amount"`
	PaymentDate    time.Time `json:"payment_date"`
	PaymentMethod  string    `json:"payment_method"` // bank_transfer, check
	BankAccountNo  string    `json:"bank_account_no"`
	BankCode       string    `json:"bank_code"`
	TransactionRef string    `json:"transaction_ref" gorm:"uniqueIndex"`
	Status         string    `json:"status" gorm:"default:'pending'"` // pending, processed, failed
	WithholdingTax float64   `json:"withholding_tax"`
	NetAmount      float64   `json:"net_amount"`
	CreatedAt      time.Time `json:"created_at"`
}

type GroupLifeForPension struct {
	ID              uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	PFAPartnerID    uuid.UUID `json:"pfa_partner_id" gorm:"type:uuid;index"`
	EmployerRCNo    string    `json:"employer_rc_no" gorm:"index"`
	EmployerName    string    `json:"employer_name"`
	MemberCount     int       `json:"member_count"`
	TotalSumAssured float64   `json:"total_sum_assured"`
	AnnualPremium   float64   `json:"annual_premium"`
	CoverMultiple   float64   `json:"cover_multiple"` // typically 3x annual emolument
	InceptionDate   time.Time `json:"inception_date"`
	ExpiryDate      time.Time `json:"expiry_date"`
	Status          string    `json:"status" gorm:"default:'active'"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type PenComReport struct {
	ID          uuid.UUID              `json:"id" gorm:"type:uuid;primaryKey"`
	ReportType  string                 `json:"report_type" gorm:"not null"` // annuity_register, payment_schedule, compliance
	Period      string                 `json:"period" gorm:"index"`
	ReportData  map[string]interface{} `json:"report_data" gorm:"serializer:json"`
	Status      string                 `json:"status" gorm:"default:'draft'"`
	SubmittedAt *time.Time             `json:"submitted_at"`
	CreatedAt   time.Time              `json:"created_at"`
}

type FundTransfer struct {
	ID             uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	RSAHolderID    uuid.UUID  `json:"rsa_holder_id" gorm:"type:uuid;index"`
	SourcePFAID    uuid.UUID  `json:"source_pfa_id" gorm:"type:uuid"`
	Amount         float64    `json:"amount"`
	TransferType   string     `json:"transfer_type"` // programmed_withdrawal, lump_sum, annuity_purchase
	TransactionRef string     `json:"transaction_ref" gorm:"uniqueIndex"`
	Status         string     `json:"status" gorm:"default:'initiated'"` // initiated, approved, transferred, failed
	ApprovedBy     string     `json:"approved_by"`
	TransferDate   *time.Time `json:"transfer_date"`
	CreatedAt      time.Time  `json:"created_at"`
}
