package models

import (
	"time"

	"github.com/google/uuid"
)

type VehicleRecord struct {
	ID             uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	RegistrationNo string     `json:"registration_no" gorm:"uniqueIndex;not null"`
	ChassisNo      string     `json:"chassis_no" gorm:"index"`
	EngineNo       string     `json:"engine_no"`
	Make           string     `json:"make"`
	Model          string     `json:"model"`
	Year           int        `json:"year"`
	Color          string     `json:"color"`
	VehicleType    string     `json:"vehicle_type"`
	OwnerName      string     `json:"owner_name"`
	OwnerPhone     string     `json:"owner_phone"`
	OwnerAddress   string     `json:"owner_address"`
	State          string     `json:"state"`
	LGA            string     `json:"lga"`
	NMIDVerified   bool       `json:"nmid_verified" gorm:"default:false"`
	LastVerifiedAt *time.Time `json:"last_verified_at"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type PolicyRegistration struct {
	ID                 uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	NMIDPolicyRef      string     `json:"nmid_policy_ref" gorm:"uniqueIndex"`
	InternalPolicyNo   string     `json:"internal_policy_no" gorm:"index;not null"`
	RegistrationNo     string     `json:"registration_no" gorm:"index;not null"`
	InsuredName        string     `json:"insured_name"`
	InsurerCode        string     `json:"insurer_code"`
	InsurerName        string     `json:"insurer_name"`
	CoverType          string     `json:"cover_type"` // comprehensive, third_party, third_party_fire_theft
	SumInsured         float64    `json:"sum_insured"`
	Premium            float64    `json:"premium"`
	InceptionDate      time.Time  `json:"inception_date"`
	ExpiryDate         time.Time  `json:"expiry_date"`
	CertificateNo      string     `json:"certificate_no" gorm:"uniqueIndex"`
	CertificateURL     string     `json:"certificate_url"`
	Status             string     `json:"status" gorm:"default:'active'"`       // active, expired, cancelled, suspended
	SyncStatus         string     `json:"sync_status" gorm:"default:'pending'"` // pending, synced, failed
	SyncedAt           *time.Time `json:"synced_at"`
	CancelledAt        *time.Time `json:"cancelled_at"`
	CancellationReason string     `json:"cancellation_reason"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type ClaimHistoryRecord struct {
	ID              uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	RegistrationNo  string     `json:"registration_no" gorm:"index;not null"`
	ClaimRef        string     `json:"claim_ref" gorm:"uniqueIndex"`
	PolicyRef       string     `json:"policy_ref"`
	ClaimType       string     `json:"claim_type"` // accident, theft, fire, third_party
	ClaimAmount     float64    `json:"claim_amount"`
	PaidAmount      float64    `json:"paid_amount"`
	AccidentDate    time.Time  `json:"accident_date"`
	ReportDate      time.Time  `json:"report_date"`
	SettlementDate  *time.Time `json:"settlement_date"`
	Status          string     `json:"status"` // reported, assessed, approved, paid, declined
	Description     string     `json:"description"`
	Location        string     `json:"location"`
	PoliceReportRef string     `json:"police_report_ref"`
	CreatedAt       time.Time  `json:"created_at"`
}

type CertificateVerification struct {
	ID              uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	CertificateNo   string     `json:"certificate_no" gorm:"index"`
	RegistrationNo  string     `json:"registration_no"`
	VerifiedBy      string     `json:"verified_by"` // frsc, police, insurer, public
	IsValid         bool       `json:"is_valid"`
	PolicyStatus    string     `json:"policy_status"`
	InsurerName     string     `json:"insurer_name"`
	ExpiryDate      *time.Time `json:"expiry_date"`
	VerificationRef string     `json:"verification_ref" gorm:"uniqueIndex"`
	CreatedAt       time.Time  `json:"created_at"`
}

type BatchRegistration struct {
	ID           uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	BatchRef     string     `json:"batch_ref" gorm:"uniqueIndex;not null"`
	InsurerCode  string     `json:"insurer_code"`
	TotalRecords int        `json:"total_records"`
	SuccessCount int        `json:"success_count" gorm:"default:0"`
	FailureCount int        `json:"failure_count" gorm:"default:0"`
	Status       string     `json:"status" gorm:"default:'processing'"` // processing, completed, failed
	FileURL      string     `json:"file_url"`
	ErrorDetails string     `json:"error_details"`
	CompletedAt  *time.Time `json:"completed_at"`
	CreatedAt    time.Time  `json:"created_at"`
}

type RenewalTracking struct {
	ID             uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	PolicyRegID    uuid.UUID  `json:"policy_reg_id" gorm:"type:uuid;index"`
	RegistrationNo string     `json:"registration_no" gorm:"index"`
	ExpiryDate     time.Time  `json:"expiry_date"`
	ReminderSentAt *time.Time `json:"reminder_sent_at"`
	RenewedAt      *time.Time `json:"renewed_at"`
	NewPolicyRegID *uuid.UUID `json:"new_policy_reg_id" gorm:"type:uuid"`
	Status         string     `json:"status" gorm:"default:'pending'"` // pending, reminded, renewed, lapsed
	CreatedAt      time.Time  `json:"created_at"`
}

type NMIDSyncLog struct {
	ID           uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	Operation    string    `json:"operation"` // register, verify, cancel, batch_register
	RequestData  string    `json:"request_data"`
	ResponseData string    `json:"response_data"`
	StatusCode   int       `json:"status_code"`
	Success      bool      `json:"success"`
	ErrorMsg     string    `json:"error_msg"`
	Duration     int64     `json:"duration_ms"`
	CreatedAt    time.Time `json:"created_at"`
}
