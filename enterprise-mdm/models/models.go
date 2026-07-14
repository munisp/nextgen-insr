package models

import (
	"time"
)

// EntityType represents the type of master data entity
type EntityType string

const (
	EntityCustomer EntityType = "customer"
	EntityPolicy   EntityType = "policy"
	EntityAgent    EntityType = "agent"
	EntityProduct  EntityType = "product"
	EntityBeneficiary EntityType = "beneficiary"
	EntityClaim    EntityType = "claim"
)

// GoldenRecord represents the single source of truth for an entity
type GoldenRecord struct {
	ID            string        `json:"id" db:"id"`
	EntityID      string        `json:"entity_id" db:"entity_id"`
	EntityType    EntityType    `json:"entity_type" db:"entity_type"`
	SourceSystem  string        `json:"source_system" db:"source_system"`
	SourceRecordID string       `json:"source_record_id" db:"source_record_id"`
	Name          string        `json:"name" db:"name"`
	Email         string        `json:"email" db:"email"`
	Phone         string        `json:"phone" db:"phone"`
	PhoneNumber   string        `json:"phone_number" db:"phone_number"`
	NIN           string        `json:"nin" db:"nin"`
	DOB           *time.Time    `json:"dob" db:"dob"`
	Address       string        `json:"address" db:"address"`
	City          string        `json:"city" db:"city"`
	State         string        `json:"state" db:"state"`
	Country       string        `json:"country" db:"country"`
	QualityScore  float64       `json:"quality_score" db:"quality_score"`
	Status        string        `json:"status" db:"status"` // active, inactive, merged, pending_review
	IsGolden      bool          `json:"is_golden" db:"is_golden"`
	PrimarySource string        `json:"primary_source" db:"primary_source"`
	LastSyncedAt  *time.Time    `json:"last_synced_at" db:"last_synced_at"`
	RecordCount   int           `json:"record_count" db:"record_count"`
	CreatedAt     time.Time     `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time     `json:"updated_at" db:"updated_at"`
}

// RecordSource tracks where a record came from
type RecordSource struct {
	ID            string    `json:"id" db:"id"`
	GoldenRecordID string   `json:"golden_record_id" db:"golden_record_id"`
	SourceSystem   string    `json:"source_system" db:"source_system"`
	SourceRecordID string    `json:"source_record_id" db:"source_record_id"`
	EntityName     string    `json:"entity_name" db:"entity_name"`
	EntityEmail    string    `json:"entity_email" db:"entity_email"`
	EntityPhone    string    `json:"entity_phone" db:"entity_phone"`
	NIN            string    `json:"nin" db:"nin"`
	DOB            *time.Time `json:"dob" db:"dob"`
	Address        string    `json:"address" db:"address"`
	MatchScore     float64   `json:"match_score" db:"match_score"`
	SyncedAt       time.Time `json:"synced_at" db:"synced_at"`
	Status         string    `json:"status" db:"status"` // synced, divergent, conflict
	CreatedAt      time.Time `json:"created_at" db:"created_at"`
}

// MergeCandidate represents potential duplicates to merge
type MergeCandidate struct {
	ID              string    `json:"id" db:"id"`
	GoldenRecordID  string    `json:"golden_record_id" db:"golden_record_id"`
	CandidateRecordID string `json:"candidate_record_id" db:"candidate_record_id"`
	SourceSystem    string    `json:"source_system" db:"source_system"`
	SourceRecordID  string    `json:"source_record_id" db:"source_record_id"`
	MatchScore      float64   `json:"match_score" db:"match_score"`
	MatchReasons    string    `json:"match_reasons" db:"match_reasons"` // JSON: name_match, email_match, etc
	IsApproved      bool      `json:"is_approved" db:"is_approved"`
	ApprovedBy      *string   `json:"approved_by" db:"approved_by"`
	ApprovedAt      *time.Time `json:"approved_at" db:"approved_at"`
	Action          string    `json:"action" db:"action"` // merge, keep_separate, review
	Status          string    `json:"status" db:"status"` // pending, approved, rejected, merged
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
}

// DataQualityMetric tracks quality dimensions for an entity
type DataQualityMetric struct {
	ID             string    `json:"id" db:"id"`
	EntityID       string    `json:"entity_id" db:"entity_id"`
	EntityType     EntityType `json:"entity_type" db:"entity_type"`
	OverallScore   float64   `json:"overall_score" db:"overall_score"`
	Completeness   float64   `json:"completeness" db:"completeness"`
	Accuracy       float64   `json:"accuracy" db:"accuracy"`
	Consistency    float64   `json:"consistency" db:"consistency"`
	Timeliness     float64   `json:"timeliness" db:"timeliness"`
	Uniqueness     float64   `json:"uniqueness" db:"uniqueness"`
	Validity       float64   `json:"validity" db:"validity"`
	SourceCount    int       `json:"source_count" db:"source_count"`
	IssueCount     int       `json:"issue_count" db:"issue_count"`
	LastAssessedAt time.Time `json:"last_assessed_at" db:"last_assessed_at"`
	Status         string    `json:"status" db:"status"` // pass, warning, fail
}

// DataIssue tracks data quality issues
type DataIssue struct {
	ID            string    `json:"id" db:"id"`
	EntityID      string    `json:"entity_id" db:"entity_id"`
	EntityType    EntityType `json:"entity_type" db:"entity_type"`
	IssueType     string    `json:"issue_type" db:"issue_type"` // missing_field, duplicate, invalid_format, stale_data, conflicting_value
	Severity      string    `json:"severity" db:"severity"` // critical, major, minor, info
	FieldName     string    `json:"field_name" db:"field_name"`
	Description   string    `json:"description" db:"description"`
	CurrentValue  string    `json:"current_value" db:"current_value"`
	ExpectedValue string    `json:"expected_value" db:"expected_value"`
	IsResolved    bool      `json:"is_resolved" db:"is_resolved"`
	ResolvedAt    *time.Time `json:"resolved_at" db:"resolved_at"`
	ResolvedBy    *string   `json:"resolved_by" db:"resolved_by"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

// SyncLog tracks data synchronization between systems
type SyncLog struct {
	ID            string    `json:"id" db:"id"`
	SyncID        string    `json:"sync_id" db:"sync_id"`
	SourceSystem  string    `json:"source_system" db:"source_system"`
	TargetSystem  string    `json:"target_system" db:"target_system"`
	EntityType    EntityType `json:"entity_type" db:"entity_type"`
	Direction     string    `json:"direction" db:"direction"` // inbound, outbound, bidirectional
	Status        string    `json:"status" db:"status"` // started, in_progress, completed, failed, partially_completed
	RecordsTotal  int       `json:"records_total" db:"records_total"`
	RecordsCreated int      `json:"records_created" db:"records_created"`
	RecordsUpdated int      `json:"records_updated" db:"records_updated"`
	RecordsDeleted int      `json:"records_deleted" db:"records_deleted"`
	RecordsFailed  int       `json:"records_failed" db:"records_failed"`
	ErrorMessage  string    `json:"error_message" db:"error_message"`
	StartedAt     time.Time `json:"started_at" db:"started_at"`
	CompletedAt   *time.Time `json:"completed_at" db:"completed_at"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

// DataLineage tracks data transformations and movement
type DataLineage struct {
	ID            string    `json:"id" db:"id"`
	EntityID      string    `json:"entity_id" db:"entity_id"`
	EntityType    EntityType `json:"entity_type" db:"entity_type"`
	SourceSystem  string    `json:"source_system" db:"source_system"`
	SourceField   string    `json:"source_field" db:"source_field"`
	TargetField   string    `json:"target_field" db:"target_field"`
	TransformRule string    `json:"transform_rule" db:"transform_rule"` // JSON: field_mapping, transformation
	Consumers     string    `json:"consumers" db:"consumers"` // JSON: list of consuming systems
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

// MasterDataDashboard provides the consolidated MDM view
type MasterDataDashboard struct {
	TotalGoldenRecords int                `json:"total_golden_records"`
	TotalSources       int                `json:"total_sources"`
	TotalIssues        int                `json:"total_issues"`
	OpenIssues         int                `json:"open_issues"`
	ResolvedIssues     int                `json:"resolved_issues"`
	PendingMerges      int                `json:"pending_merges"`
	CompletedMerges    int                `json:"completed_merges"`
	LastSyncAt         *time.Time         `json:"last_sync_at"`
	SyncStatus         string             `json:"sync_status"`
	ByEntityType       []EntityQuality    `json:"by_entity_type"`
	OverallQuality     float64            `json:"overall_quality"`
	DataStewards       int                `json:"data_stewards"`
	ActiveSyncs        int                `json:"active_syncs"`
}

type EntityQuality struct {
	EntityType       EntityType `json:"entity_type"`
	TotalRecords     int        `json:"total_records"`
	GoldenRecords    int        `json:"golden_records"`
	QualityScore     float64    `json:"quality_score"`
	Duplicates       int        `json:"duplicates"`
	Issues           int        `json:"issues"`
	LastSyncedAt     *time.Time `json:"last_synced_at"`
}

// AgentRecord represents an agent master record
type AgentRecord struct {
	ID            string    `json:"id" db:"id"`
	AgentCode     string    `json:"agent_code" db:"agent_code"`
	AgentName     string    `json:"agent_name" db:"agent_name"`
	LicenseNo     string    `json:"license_no" db:"license_no"`
	LicenseExpiry time.Time `json:"license_expiry" db:"license_expiry"`
	Email         string    `json:"email" db:"email"`
	Phone         string    `json:"phone" db:"phone"`
	Address       string    `json:"address" db:"address"`
	City          string    `json:"city" db:"city"`
	State         string    `json:"state" db:"state"`
	Status        string    `json:"status" db:"status"` // active, suspended, revoked
	CommissionRate float64  `json:"commission_rate" db:"commission_rate"`
	ProductTypes  string    `json:"product_types" db:"product_types"` // comma-separated
	Region        string    `json:"region" db:"region"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time `json:"updated_at" db:"updated_at"`
}

// ProductRecord represents a product master record
type ProductRecord struct {
	ID            string    `json:"id" db:"id"`
	ProductCode   string    `json:"product_code" db:"product_code"`
	ProductName   string    `json:"product_name" db:"product_name"`
	Category      string    `json:"category" db:"category"`
	RiskType      string    `json:"risk_type" db:"risk_type"`
	Description   string    `json:"description" db:"description"`
	IsActive      bool      `json:"is_active" db:"is_active"`
	CoverageMin   float64   `json:"coverage_min" db:"coverage_min"`
	CoverageMax   float64   `json:"coverage_max" db:"coverage_max"`
	PremiumRange  string    `json:"premium_range" db:"premium_range"` // "10000-500000"
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time `json:"updated_at" db:"updated_at"`
}
