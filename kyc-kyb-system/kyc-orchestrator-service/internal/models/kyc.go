package models

import "time"

type KYCLevel int

const (
	KYCLevelNone   KYCLevel = 0
	KYCLevel1Phone KYCLevel = 1
	KYCLevel2ID    KYCLevel = 2
	KYCLevel3Full  KYCLevel = 3
)

type VerificationStatus string

const (
	StatusPending    VerificationStatus = "pending"
	StatusInProgress VerificationStatus = "in_progress"
	StatusApproved   VerificationStatus = "approved"
	StatusRejected   VerificationStatus = "rejected"
	StatusExpired    VerificationStatus = "expired"
	StatusFailed     VerificationStatus = "failed"
)

type DocumentType string

const (
	DocNationalID     DocumentType = "national_id"
	DocDriversLicense DocumentType = "drivers_license"
	DocPassport       DocumentType = "passport"
	DocVotersCard     DocumentType = "voters_card"
	DocUtilityBill    DocumentType = "utility_bill"
	DocBankStatement  DocumentType = "bank_statement"
	DocCACCertificate DocumentType = "cac_certificate"
	DocMEMART         DocumentType = "memart"
	DocBoardRes       DocumentType = "board_resolution"
	DocTaxClearance   DocumentType = "tax_clearance"
	DocBVNSlip        DocumentType = "bvn_slip"
	DocNINSlip        DocumentType = "nin_slip"
)

type KYCVerification struct {
	ID                 string             `json:"id" db:"id"`
	UserID             string             `json:"user_id" db:"user_id"`
	SessionID          string             `json:"session_id" db:"session_id"`
	Level              KYCLevel           `json:"level" db:"level"`
	Status             VerificationStatus `json:"status" db:"status"`
	VerificationType   string             `json:"verification_type" db:"verification_type"`
	DocumentType       DocumentType       `json:"document_type,omitempty" db:"document_type"`
	DocumentNumber     string             `json:"document_number,omitempty" db:"document_number"`
	NINVerified        bool               `json:"nin_verified" db:"nin_verified"`
	BVNVerified        bool               `json:"bvn_verified" db:"bvn_verified"`
	PhoneVerified      bool               `json:"phone_verified" db:"phone_verified"`
	BiometricVerified  bool               `json:"biometric_verified" db:"biometric_verified"`
	DocumentVerified   bool               `json:"document_verified" db:"document_verified"`
	AddressVerified    bool               `json:"address_verified" db:"address_verified"`
	LivenessVerified   bool               `json:"liveness_verified" db:"liveness_verified"`
	FaceMatchScore     float64            `json:"face_match_score" db:"face_match_score"`
	RiskScore          float64            `json:"risk_score" db:"risk_score"`
	AMLCleared         bool               `json:"aml_cleared" db:"aml_cleared"`
	PEPChecked         bool               `json:"pep_checked" db:"pep_checked"`
	SanctionsCleared   bool               `json:"sanctions_cleared" db:"sanctions_cleared"`
	ReviewerID         *string            `json:"reviewer_id,omitempty" db:"reviewer_id"`
	ReviewNotes        *string            `json:"review_notes,omitempty" db:"review_notes"`
	RejectionReason    *string            `json:"rejection_reason,omitempty" db:"rejection_reason"`
	VerifiedAt         *time.Time         `json:"verified_at,omitempty" db:"verified_at"`
	ExpiresAt          *time.Time         `json:"expires_at,omitempty" db:"expires_at"`
	CreatedAt          time.Time          `json:"created_at" db:"created_at"`
	UpdatedAt          time.Time          `json:"updated_at" db:"updated_at"`
}

type KYBVerification struct {
	ID                   string             `json:"id" db:"id"`
	BusinessID           string             `json:"business_id" db:"business_id"`
	SessionID            string             `json:"session_id" db:"session_id"`
	Status               VerificationStatus `json:"status" db:"status"`
	CompanyName          string             `json:"company_name" db:"company_name"`
	RCNumber             string             `json:"rc_number" db:"rc_number"`
	TIN                  string             `json:"tin,omitempty" db:"tin"`
	CACVerified          bool               `json:"cac_verified" db:"cac_verified"`
	TINVerified          bool               `json:"tin_verified" db:"tin_verified"`
	DirectorsVerified    bool               `json:"directors_verified" db:"directors_verified"`
	UBOIdentified        bool               `json:"ubo_identified" db:"ubo_identified"`
	AddressVerified      bool               `json:"address_verified" db:"address_verified"`
	AMLCleared           bool               `json:"aml_cleared" db:"aml_cleared"`
	SanctionsCleared     bool               `json:"sanctions_cleared" db:"sanctions_cleared"`
	RiskScore            float64            `json:"risk_score" db:"risk_score"`
	Directors            []Director         `json:"directors,omitempty"`
	UBOs                 []UBO              `json:"ubos,omitempty"`
	Documents            []KYBDocument      `json:"documents,omitempty"`
	ReviewerID           *string            `json:"reviewer_id,omitempty" db:"reviewer_id"`
	ReviewNotes          *string            `json:"review_notes,omitempty" db:"review_notes"`
	VerifiedAt           *time.Time         `json:"verified_at,omitempty" db:"verified_at"`
	ExpiresAt            *time.Time         `json:"expires_at,omitempty" db:"expires_at"`
	CreatedAt            time.Time          `json:"created_at" db:"created_at"`
	UpdatedAt            time.Time          `json:"updated_at" db:"updated_at"`
}

type Director struct {
	Name         string `json:"name"`
	NIN          string `json:"nin,omitempty"`
	BVN          string `json:"bvn,omitempty"`
	Position     string `json:"position"`
	KYCVerified  bool   `json:"kyc_verified"`
	KYCSessionID string `json:"kyc_session_id,omitempty"`
}

type UBO struct {
	Name            string  `json:"name"`
	OwnershipPct    float64 `json:"ownership_pct"`
	NIN             string  `json:"nin,omitempty"`
	KYCVerified     bool    `json:"kyc_verified"`
	PEPStatus       bool    `json:"pep_status"`
	SanctionStatus  bool    `json:"sanction_status"`
}

type KYBDocument struct {
	Type       DocumentType       `json:"type"`
	Status     VerificationStatus `json:"status"`
	UploadedAt time.Time          `json:"uploaded_at"`
	VerifiedAt *time.Time         `json:"verified_at,omitempty"`
}

type VerificationEvent struct {
	ID             string    `json:"id" db:"id"`
	VerificationID string    `json:"verification_id" db:"verification_id"`
	EventType      string    `json:"event_type" db:"event_type"`
	Actor          string    `json:"actor" db:"actor"`
	Details        string    `json:"details" db:"details"`
	Timestamp      time.Time `json:"timestamp" db:"timestamp"`
}

type AMLScreeningResult struct {
	SessionID       string    `json:"session_id"`
	FullName        string    `json:"full_name"`
	PEPMatch        bool      `json:"pep_match"`
	SanctionsMatch  bool      `json:"sanctions_match"`
	AdverseMedia    bool      `json:"adverse_media"`
	MatchedEntities []string  `json:"matched_entities,omitempty"`
	RiskLevel       string    `json:"risk_level"`
	ScreenedAt      time.Time `json:"screened_at"`
}

type RiskAssessment struct {
	SessionID       string             `json:"session_id"`
	OverallScore    float64            `json:"overall_score"`
	RiskLevel       string             `json:"risk_level"`
	Factors         []RiskFactor       `json:"factors"`
	Recommendation  string             `json:"recommendation"`
	RequiredLevel   KYCLevel           `json:"required_level"`
}

type RiskFactor struct {
	Name   string  `json:"name"`
	Score  float64 `json:"score"`
	Weight float64 `json:"weight"`
	Detail string  `json:"detail"`
}
