package models

import (
	"time"
)

// KYCStatus represents the lifecycle status of a KYC record.
type KYCStatus string

const (
	Draft          KYCStatus = "draft"
	Submitted      KYCStatus = "submitted"
	UnderReview    KYCStatus = "under_review"
	Verified       KYCStatus = "verified"
	Rejected       KYCStatus = "rejected"
	Expired        KYCStatus = "expired"
	PendingRefresh KYCStatus = "pending_refresh"
)

// RiskLevel represents the assessed risk category.
type RiskLevel string

const (
	RiskLow     RiskLevel = "low"
	RiskMedium  RiskLevel = "medium"
	RiskHigh    RiskLevel = "high"
	RiskCritical RiskLevel = "critical"
)

// VerificationMethod describes how a document was verified.
type VerificationMethod string

const (
	VerifyManual   VerificationMethod = "manual"
	VerifyNINAPI   VerificationMethod = "nin_api"
	VerifyBVNAPI   VerificationMethod = "bvn_api"
	VerifyCACAPI   VerificationMethod = "cac_api"
	VerifyFIRSAPI  VerificationMethod = "firs_api"
)

// DocumentType represents the type of identity/business document.
type DocumentType string

const (
	DocumentNIN       DocumentType = "nin"
	DocumentBVN       DocumentType = "bvn"
	DocumentPassport  DocumentType = "passport"
	DocumentDriverLic DocumentType = "driver_license"
	DocumentUtilityBill DocumentType = "utility_bill"
	DocumentCAC       DocumentType = "cac_registration"
	DocumentTIN       DocumentType = "tin"
)

// Source indicates where KYC data originated.
type KYCSource string

const (
	SourceDirect  KYCSource = "direct"
	SourceThirdParty KYCSource = "third_party"
	SourceBroker   KYCSource = "broker"
)

// IndividualKYC stores verified information for a natural person.
type IndividualKYC struct {
	ID              string        `json:"id" gorm:"primaryKey"`
	CustomerID      string        `json:"customer_id" gorm:"uniqueIndex;not null"`
	NIN             string        `json:"nin" gorm:"uniqueIndex;size:11"`
	BVN             string        `json:"bvn" gorm:"uniqueIndex;size:11"`
	FullName        string        `json:"full_name" gorm:"not null"`
	FirstName       string        `json:"first_name"`
	LastName        string        `json:"last_name"`
	DOB             time.Time     `json:"date_of_birth"`
	Gender          string        `json:"gender"`
	Address         string        `json:"address"`
	Phone           string        `json:"phone"`
	Email           string        `json:"email"`
	RiskLevel       RiskLevel     `json:"risk_level"`
	Status          KYCStatus     `json:"status"`
	VerificationDate time.Time    `json:"verification_date"`
	ExpiresAt       time.Time     `json:"expires_at"`
	CreatedAt       time.Time     `json:"created_at"`
	UpdatedAt       time.Time     `json:"updated_at"`
	Documents       []KYCDocument `json:"documents" gorm:"foreignKey:IndividualKYCID"`
	NINRecord       *NINVerification `json:"nin_record,omitempty" gorm:"foreignKey:IndividualKYCID"`
	BVNRecord       *BVNVerification   `json:"bvn_record,omitempty" gorm:"foreignKey:IndividualKYCID"`
	Tier            int           `json:"tier" gorm:"default:1"`
	DailyLimit      int64         `json:"daily_limit" gorm:"default:300000"`
}

// BusinessKYC stores verified information for a corporate entity.
type BusinessKYC struct {
	ID              string          `json:"id" gorm:"primaryKey"`
	CustomerID      string          `json:"customer_id" gorm:"uniqueIndex;not null"`
	RCNumber        string          `json:"rc_number" gorm:"size:50"`
	CompanyName     string          `json:"company_name" gorm:"not null"`
	Industry        string          `json:"industry"`
	Address         string          `json:"address"`
	Directors       []DirectorInfo  `json:"directors" gorm:"type:text"`
	Financials      BusinessFinancials `json:"financials" gorm:"type:text"`
	Status          KYCStatus       `json:"status"`
	VerificationDate time.Time      `json:"verification_date"`
	ExpiresAt       time.Time       `json:"expires_at"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
	Documents       []KYCDocument   `json:"documents" gorm:"foreignKey:BusinessKYCID"`
	TIN             string          `json:"tin" gorm:"size:50"`
	CACVerified     bool            `json:"cac_verified" gorm:"default:false"`
	TINVerified     bool            `json:"tin_verified" gorm:"default:false"`
	DirectorsScreened int           `json:"directors_screened" gorm:"default:0"`
	PEPScreened     bool            `json:"pep_screened" gorm:"default:false"`
	RiskLevel       RiskLevel       `json:"risk_level"`
}

// DirectorInfo represents a company director with screening data.
type DirectorInfo struct {
	Name          string    `json:"name"`
	IDNumber      string    `json:"id_number"`
	DateOfBirth   time.Time `json:"date_of_birth"`
	Nationality   string    `json:"nationality"`
	PEPScreened   bool      `json:"pep_screened"`
	PEPMatch      bool      `json:"pep_match"`
	RiskFlag      string    `json:"risk_flag"`
}

// BusinessFinancials holds high-level financial information for KYB.
type BusinessFinancials struct {
	AnnualRevenue float64 `json:"annual_revenue"`
	Currency      string  `json:"currency"`
	BankAccounts  []string `json:"bank_accounts"`
	SourceOfFunds string  `json:"source_of_funds"`
}

// KYCDocument stores metadata about a submitted verification document.
type KYCDocument struct {
	ID                  string             `json:"id" gorm:"primaryKey"`
	IndividualKYCID     *string            `json:"-" gorm:"index"`
	BusinessKYCID       *string            `json:"-" gorm:"index"`
	DocType             DocumentType       `json:"doc_type" gorm:"not null"`
	Number              string             `json:"number"`
	Issuer              string             `json:"issuer"`
	IssueDate           *time.Time         `json:"issue_date,omitempty"`
	ExpiryDate          *time.Time         `json:"expiry_date,omitempty"`
	Verified            bool               `json:"verified" gorm:"default:false"`
	VerificationMethod  VerificationMethod `json:"verification_method"`
	VerificationDate    *time.Time         `json:"verification_date,omitempty"`
	SHA256Checksum      string             `json:"-"`
	FilePath            string             `json:"-"`
	CreatedAt           time.Time          `json:"created_at"`
}

// VerificationRequest is the payload submitted by clients to initiate verification.
type VerificationRequest struct {
	Type      string            `json:"type"`
	CustomerID string           `json:"customer_id"`
	Documents []DocumentInput   `json:"documents"`
	Source    KYCSource         `json:"source"`
	// Individual fields
	NIN   string `json:"nin"`
	BVN   string `json:"bvn"`
	FullName string `json:"full_name"`
	DOB   string `json:"dob"`
	Gender string `json:"gender"`
	Address string `json:"address"`
	Phone string `json:"phone"`
	Email string `json:"email"`
	// Business fields
	RCNumber    string `json:"rc_number"`
	CompanyName string `json:"company_name"`
	Industry    string `json:"industry"`
	Directors   []DirectorInput `json:"directors"`
	TIN         string `json:"tin"`
}

// DocumentInput represents a document submitted for verification.
type DocumentInput struct {
	DocType string `json:"doc_type"`
	Number  string `json:"number"`
	Issuer  string `json:"issuer"`
	Expiry  string `json:"expiry"`
}

// DirectorInput represents a director for KYB submission.
type DirectorInput struct {
	Name        string `json:"name"`
	IDNumber    string `json:"id_number"`
	DateOfBirth string `json:"date_of_birth"`
	Nationality string `json:"nationality"`
}

// VerificationResult holds the outcome of a verification attempt.
type VerificationResult struct {
	Success  bool           `json:"success"`
	Status   KYCStatus      `json:"status"`
	Score    int            `json:"score"`
	RiskLevel RiskLevel     `json:"risk_level"`
	Details  []string       `json:"details"`
	Flags    []string       `json:"flags"`
	NINResult *NINResult   `json:"nin_result,omitempty"`
	BVNResult *BVNResult   `json:"bvn_result,omitempty"`
}

// NINVerification is the database model for NIN verification records.
type NINVerification struct {
	ID           string     `json:"id" gorm:"primaryKey"`
	IndividualKYCID string   `json:"-"`
	NIN          string     `json:"nin" gorm:"size:11;not null"`
	Status       string     `json:"status"`
	Name         string     `json:"name"`
	NameMatch    *bool      `json:"name_match,omitempty"`
	DOB          *time.Time `json:"dob,omitempty"`
	DOBMatch     *bool      `json:"dob_match,omitempty"`
	PhotoMatch   *bool      `json:"photo_match,omitempty"`
	Source       string     `json:"source"`
	RequestedAt  time.Time  `json:"requested_at"`
}

// BVNVerification is the database model for BVN verification records.
type BVNVerification struct {
	ID              string     `json:"id" gorm:"primaryKey"`
	IndividualKYCID string     `json:"-"`
	BVN             string     `json:"bvn" gorm:"size:11;not null"`
	Status          string     `json:"status"`
	Name            string     `json:"name"`
	NameMatch       *bool      `json:"name_match,omitempty"`
	BiometricMatch  *bool      `json:"biometric_match,omitempty"`
	AccountCount    int        `json:"account_count"`
	Source          string     `json:"source"`
	RequestedAt     time.Time  `json:"requested_at"`
}

// NINResult is the API-level response from NIN verification.
type NINResult struct {
	NIN       string `json:"nin"`
	Status    string `json:"status"`
	NameMatch *bool  `json:"name_match,omitempty"`
	DOBMatch  *bool  `json:"dob_match,omitempty"`
	PhotoMatch *bool `json:"photo_match,omitempty"`
}

// BVNResult is the API-level response from BVN verification.
type BVNResult struct {
	BVN          string `json:"bvn"`
	Status       string `json:"status"`
	NameMatch    *bool  `json:"name_match,omitempty"`
	BiometricMatch *bool `json:"biometric_match,omitempty"`
	AccountCount int    `json:"account_count"`
}

// AuditTrail records every KYC action for compliance.
type AuditTrail struct {
	ID        string    `json:"id" gorm:"primaryKey"`
	Timestamp time.Time `json:"timestamp"`
	Action    string    `json:"action"`
	EntityType string  `json:"entity_type"`
	EntityID  string    `json:"entity_id"`
	UserID    string    `json:"user_id"`
	IPAddress string    `json:"ip_address"`
	Details   string    `json:"details"`
}

// KYCStats holds dashboard metrics.
type KYCStats struct {
	TotalKYC         int64     `json:"total_kyc"`
	VerifiedKYC      int64     `json:"verified_kyc"`
	UnderReviewKYC   int64     `json:"under_review_kyc"`
	RejectedKYC      int64     `json:"rejected_kyc"`
	ExpiredKYC       int64     `json:"expired_kyc"`
	PendingRefresh   int64     `json:"pending_refresh"`
	TotalBusiness    int64     `json:"total_business"`
	VerifiedBusiness int64     `json:"verified_business"`
	AvgRiskScore     float64   `json:"avg_risk_score"`
	LastRefresh      time.Time `json:"last_refresh"`
}

// RefreshReminder is a record for KYC refresh tracking.
type RefreshReminder struct {
	ID         string    `json:"id" gorm:"primaryKey"`
	CustomerID string    `json:"customer_id"`
	EntityType string    `json:"entity_type"`
	EntityID   string    `json:"entity_id"`
	ExpiresAt  time.Time `json:"expires_at"`
	SentAt     *time.Time `json:"sent_at,omitempty"`
	ReminderType string   `json:"reminder_type"`
	CreatedAt  time.Time `json:"created_at"`
}
