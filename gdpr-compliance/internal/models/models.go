package models

import (
	"github.com/google/uuid"
	"time"
)

type DataSubject struct {
	ID             uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	SubjectRef     string    `json:"subject_ref" gorm:"uniqueIndex;not null"`
	SubjectType    string    `json:"subject_type"` // customer, employee, agent, partner
	FirstName      string    `json:"first_name"`
	LastName       string    `json:"last_name"`
	Email          string    `json:"email" gorm:"index"`
	Phone          string    `json:"phone"`
	Country        string    `json:"country"`
	ConsentStatus  string    `json:"consent_status" gorm:"default:'pending'"` // pending, granted, withdrawn, expired
	DataCategories string    `json:"data_categories"`                         // comma-separated: personal, financial, health, biometric
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type ConsentRecord struct {
	ID          uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	SubjectRef  string     `json:"subject_ref" gorm:"index;not null"`
	Purpose     string     `json:"purpose"`     // marketing, analytics, policy_admin, claims_processing, third_party_sharing
	LegalBasis  string     `json:"legal_basis"` // consent, contract, legal_obligation, legitimate_interest, vital_interest
	Granted     bool       `json:"granted"`
	GrantedAt   *time.Time `json:"granted_at"`
	WithdrawnAt *time.Time `json:"withdrawn_at"`
	ExpiresAt   *time.Time `json:"expires_at"`
	IPAddress   string     `json:"ip_address"`
	Channel     string     `json:"channel"` // web, mobile, paper, phone
	Version     string     `json:"version"`
	CreatedAt   time.Time  `json:"created_at"`
}

type DataAccessRequest struct {
	ID          uuid.UUID              `json:"id" gorm:"type:uuid;primaryKey"`
	RequestRef  string                 `json:"request_ref" gorm:"uniqueIndex;not null"`
	SubjectRef  string                 `json:"subject_ref" gorm:"index"`
	RequestType string                 `json:"request_type"` // access, rectification, erasure, portability, restriction, objection
	Reason      string                 `json:"reason"`
	Status      string                 `json:"status" gorm:"default:'received'"` // received, in_progress, completed, rejected, overdue
	AssignedTo  string                 `json:"assigned_to"`
	DueDate     time.Time              `json:"due_date"`
	CompletedAt *time.Time             `json:"completed_at"`
	Response    map[string]interface{} `json:"response" gorm:"serializer:json"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
}

type DataProcessingRecord struct {
	ID                uuid.UUID              `json:"id" gorm:"type:uuid;primaryKey"`
	ProcessingName    string                 `json:"processing_name"`
	Purpose           string                 `json:"purpose"`
	LegalBasis        string                 `json:"legal_basis"`
	DataCategories    string                 `json:"data_categories"`
	SubjectCategories string                 `json:"subject_categories"`
	Recipients        string                 `json:"recipients"`
	ThirdCountries    string                 `json:"third_countries"`
	RetentionPeriod   string                 `json:"retention_period"`
	TechnicalMeasures string                 `json:"technical_measures"`
	DPIARequired      bool                   `json:"dpia_required"`
	DPIACompleted     bool                   `json:"dpia_completed"`
	Details           map[string]interface{} `json:"details" gorm:"serializer:json"`
	CreatedAt         time.Time              `json:"created_at"`
}

type DataBreach struct {
	ID               uuid.UUID              `json:"id" gorm:"type:uuid;primaryKey"`
	BreachRef        string                 `json:"breach_ref" gorm:"uniqueIndex;not null"`
	Description      string                 `json:"description"`
	Severity         string                 `json:"severity"` // low, medium, high, critical
	DataCategories   string                 `json:"data_categories"`
	AffectedCount    int                    `json:"affected_count"`
	DetectedAt       time.Time              `json:"detected_at"`
	ReportedAt       *time.Time             `json:"reported_at"`
	NotifiedDPA      bool                   `json:"notified_dpa"`
	NotifiedSubjects bool                   `json:"notified_subjects"`
	Measures         string                 `json:"measures_taken"`
	Status           string                 `json:"status" gorm:"default:'detected'"` // detected, investigating, contained, resolved
	Details          map[string]interface{} `json:"details" gorm:"serializer:json"`
	CreatedAt        time.Time              `json:"created_at"`
}
