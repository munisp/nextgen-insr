package models

import (
	"time"

	"github.com/google/uuid"
)

type GroupScheme struct {
	ID              uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	SchemeNumber    string    `json:"scheme_number" gorm:"uniqueIndex;not null"`
	EmployerName    string    `json:"employer_name" gorm:"not null"`
	EmployerCode    string    `json:"employer_code" gorm:"index"`
	Industry        string    `json:"industry"`
	ContactPerson   string    `json:"contact_person"`
	ContactEmail    string    `json:"contact_email"`
	ContactPhone    string    `json:"contact_phone"`
	Address         string    `json:"address"`
	State           string    `json:"state"`
	TotalMembers    int       `json:"total_members" gorm:"default:0"`
	TotalSumAssured float64   `json:"total_sum_assured" gorm:"default:0"`
	AnnualPremium   float64   `json:"annual_premium" gorm:"default:0"`
	InceptionDate   time.Time `json:"inception_date"`
	RenewalDate     time.Time `json:"renewal_date"`
	Status          string    `json:"status" gorm:"default:'active'"` // active, suspended, cancelled, expired
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type SchemeMember struct {
	ID              uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	SchemeID        uuid.UUID  `json:"scheme_id" gorm:"type:uuid;index;not null"`
	EmployeeID      string     `json:"employee_id" gorm:"index"`
	FirstName       string     `json:"first_name"`
	LastName        string     `json:"last_name"`
	DateOfBirth     time.Time  `json:"date_of_birth"`
	Gender          string     `json:"gender"`
	Designation     string     `json:"designation"`
	Salary          float64    `json:"salary"`
	SumAssured      float64    `json:"sum_assured"`
	BenefitMultiple float64    `json:"benefit_multiple"` // e.g., 3x salary
	JoinDate        time.Time  `json:"join_date"`
	ExitDate        *time.Time `json:"exit_date"`
	Status          string     `json:"status" gorm:"default:'active'"` // active, exited, deceased, disabled
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type MemberBeneficiary struct {
	ID            uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	MemberID      uuid.UUID `json:"member_id" gorm:"type:uuid;index;not null"`
	FullName      string    `json:"full_name"`
	Relationship  string    `json:"relationship"`
	DateOfBirth   time.Time `json:"date_of_birth"`
	Phone         string    `json:"phone"`
	SharePercent  float64   `json:"share_percent"`
	BankName      string    `json:"bank_name"`
	AccountNumber string    `json:"account_number"`
	CreatedAt     time.Time `json:"created_at"`
}

type GroupClaim struct {
	ID             uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	ClaimNumber    string     `json:"claim_number" gorm:"uniqueIndex;not null"`
	SchemeID       uuid.UUID  `json:"scheme_id" gorm:"type:uuid;index"`
	MemberID       uuid.UUID  `json:"member_id" gorm:"type:uuid;index"`
	ClaimType      string     `json:"claim_type"` // death, permanent_disability, temporary_disability, critical_illness, funeral
	EventDate      time.Time  `json:"event_date"`
	ReportDate     time.Time  `json:"report_date"`
	SumAssured     float64    `json:"sum_assured"`
	ClaimAmount    float64    `json:"claim_amount"`
	ApprovedAmount float64    `json:"approved_amount"`
	CauseOfEvent   string     `json:"cause_of_event"`
	MedicalReport  string     `json:"medical_report"`
	DeathCertRef   string     `json:"death_cert_ref"`
	Status         string     `json:"status" gorm:"default:'submitted'"` // submitted, under_review, approved, declined, paid
	DeclineReason  string     `json:"decline_reason"`
	ApprovedAt     *time.Time `json:"approved_at"`
	PaidAt         *time.Time `json:"paid_at"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type PremiumSchedule struct {
	ID           uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	SchemeID     uuid.UUID  `json:"scheme_id" gorm:"type:uuid;index"`
	Period       string     `json:"period"` // YYYY-MM
	DueDate      time.Time  `json:"due_date"`
	GrossPremium float64    `json:"gross_premium"`
	Discount     float64    `json:"discount"`
	Tax          float64    `json:"tax"`
	NetPremium   float64    `json:"net_premium"`
	PaidAmount   float64    `json:"paid_amount" gorm:"default:0"`
	PaymentDate  *time.Time `json:"payment_date"`
	PaymentRef   string     `json:"payment_ref"`
	Status       string     `json:"status" gorm:"default:'pending'"` // pending, paid, overdue, partially_paid
	CreatedAt    time.Time  `json:"created_at"`
}

type SchemeEndorsement struct {
	ID              uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	EndorsementNo   string    `json:"endorsement_no" gorm:"uniqueIndex;not null"`
	SchemeID        uuid.UUID `json:"scheme_id" gorm:"type:uuid;index"`
	EndorsementType string    `json:"endorsement_type"` // member_addition, member_deletion, salary_revision, benefit_change, scheme_amendment
	Description     string    `json:"description"`
	EffectiveDate   time.Time `json:"effective_date"`
	PremiumImpact   float64   `json:"premium_impact"`                  // positive = additional, negative = refund
	Status          string    `json:"status" gorm:"default:'pending'"` // pending, approved, applied, rejected
	ApprovedBy      string    `json:"approved_by"`
	CreatedAt       time.Time `json:"created_at"`
}

type ExperienceRating struct {
	ID             uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	SchemeID       uuid.UUID `json:"scheme_id" gorm:"type:uuid;index"`
	Period         string    `json:"period"`
	EarnedPremium  float64   `json:"earned_premium"`
	IncurredClaims float64   `json:"incurred_claims"`
	LossRatio      float64   `json:"loss_ratio"`
	ExpenseRatio   float64   `json:"expense_ratio"`
	CombinedRatio  float64   `json:"combined_ratio"`
	RenewalRate    float64   `json:"renewal_rate"` // suggested rate adjustment
	CreatedAt      time.Time `json:"created_at"`
}
