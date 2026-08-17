package models

import "time"

type ConsentPurpose string

const (
	PurposeServiceDelivery      ConsentPurpose = "service_delivery"
	PurposeMarketing            ConsentPurpose = "marketing"
	PurposeAnalytics            ConsentPurpose = "analytics"
	PurposeFraudPrevention      ConsentPurpose = "fraud_prevention"
	PurposeRegulatoryCompliance ConsentPurpose = "regulatory_compliance"
	PurposeResearch             ConsentPurpose = "research"
	PurposeThirdPartySharing    ConsentPurpose = "third_party_sharing"
	PurposeCreditChecking       ConsentPurpose = "credit_checking"
	PurposeClaimsProcessing     ConsentPurpose = "claims_processing"
)

type ConsentMethod string

const (
	ConsentWeb    ConsentMethod = "web"
	ConsentUSSD   ConsentMethod = "ussd"
	ConsentAgent  ConsentMethod = "agent"
	ConsentMobile ConsentMethod = "mobile_app"
	ConsentVoice  ConsentMethod = "voice"
	ConsentPaper  ConsentMethod = "paper_form"
)

type LawfulBasis string

const (
	BasisConsent            LawfulBasis = "consent"
	BasisContract           LawfulBasis = "contract"
	BasisLegalObligation    LawfulBasis = "legal_obligation"
	BasisVitalInterest      LawfulBasis = "vital_interest"
	BasisPublicInterest     LawfulBasis = "public_interest"
	BasisLegitimateInterest LawfulBasis = "legitimate_interest"
)

type Consent struct {
	ID               string           `json:"id"`
	ConsentID        string           `json:"consent_id"`
	SubjectID        string           `json:"subject_id"`
	Purposes         []ConsentPurpose `json:"purposes"`
	Method           ConsentMethod    `json:"method"`
	LawfulBasis      LawfulBasis      `json:"lawful_basis"`
	IPAddress        string           `json:"ip_address"`
	UserAgent        string           `json:"user_agent"`
	Version          string           `json:"version"`
	ConsentText      string           `json:"consent_text"`
	Withdrawn        bool             `json:"withdrawn"`
	WithdrawnAt      *time.Time       `json:"withdrawn_at,omitempty"`
	WithdrawnBy      string           `json:"withdrawn_by,omitempty"`
	WithdrawalReason string           `json:"withdrawal_reason,omitempty"`
	Metadata         map[string]any   `json:"metadata,omitempty"`
	CreatedAt        time.Time        `json:"created_at"`
	UpdatedAt        time.Time        `json:"updated_at"`
}

type DSARType string

const (
	DSARAccess        DSARType = "access"
	DSARRectification DSARType = "rectification"
	DSARErasure       DSARType = "erasure"
	DSARPortability   DSARType = "portability"
)

type DSARStatus string

const (
	DSARReceived    DSARStatus = "received"
	DSARValidated   DSARStatus = "validated"
	DSARInGathering DSARStatus = "data_gathering"
	DSARInReview    DSARStatus = "in_review"
	DSARCompleted   DSARStatus = "completed"
	DSARExpired     DSARStatus = "expired"
	DSARDenied      DSARStatus = "denied"
	DSARPartially   DSARStatus = "partially_fulfilled"
)

type DSARStats struct {
	Total      int64   `json:"total"`
	Received   int64   `json:"received"`
	InProgress int64   `json:"in_progress"`
	Completed  int64   `json:"completed"`
	Overdue    int64   `json:"overdue"`
	AvgSLAUsed float64 `json:"avg_sla_usage_pct"`
}

type DSAR struct {
	ID              string         `json:"id"`
	DSARID          string         `json:"dsar_id"`
	SubjectID       string         `json:"subject_id"`
	FullName        string         `json:"full_name"`
	Email           string         `json:"email"`
	Type            DSARType       `json:"type"`
	Description     string         `json:"description"`
	Status          DSARStatus     `json:"status"`
	SLADays         int            `json:"sla_days"`
	ReceivedAt      time.Time      `json:"received_at"`
	Deadline        time.Time      `json:"deadline"`
	CompletedAt     *time.Time     `json:"completed_at,omitempty"`
	AssignedTo      string         `json:"assigned_to"`
	DataSources     []string       `json:"data_sources"`
	RecordsFound    int            `json:"records_found"`
	DataExportURL   string         `json:"data_export_url,omitempty"`
	RejectionReason string         `json:"rejection_reason,omitempty"`
	Metadata        map[string]any `json:"metadata,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
}

type BreachSeverity string

const (
	BreachLow      BreachSeverity = "low"
	BreachMedium   BreachSeverity = "medium"
	BreachHigh     BreachSeverity = "high"
	BreachCritical BreachSeverity = "critical"
)

type BreachStatus string

const (
	BreachReported         BreachStatus = "reported"
	BreachAssessing        BreachStatus = "under_assessment"
	BreachNITDANotified    BreachStatus = "nitda_notified"
	BreachAffectedNotified BreachStatus = "affected_notified"
	BreachContained        BreachStatus = "contained"
	BreachResolved         BreachStatus = "resolved"
	BreachClosed           BreachStatus = "closed"
)

type Breach struct {
	ID                  string         `json:"id"`
	BreachID            string         `json:"breach_id"`
	Title               string         `json:"title"`
	Description         string         `json:"description"`
	Severity            BreachSeverity `json:"severity"`
	Status              BreachStatus   `json:"status"`
	DetectionDate       time.Time      `json:"detection_date"`
	NotificationDate    *time.Time     `json:"notification_date,omitempty"`
	ReportedAt          time.Time      `json:"reported_at"`
	Reporter            string         `json:"reported_by"`
	AffectedPersons     int64          `json:"affected_persons"`
	DataTypes           []string       `json:"data_types_affected"`
	Cause               string         `json:"cause"`
	NITDADeadline       time.Time      `json:"nitda_deadline"`
	NITDANotifiedAt     *time.Time     `json:"nitda_notified_at,omitempty"`
	NITDANotificationID string         `json:"nitda_notification_id,omitempty"`
	AffectedNotifiedAt  *time.Time     `json:"affected_notified_at,omitempty"`
	RemediationSteps    []string       `json:"remediation_steps"`
	RemediationComplete bool           `json:"remediation_complete"`
	ResolutionDate      *time.Time     `json:"resolution_date,omitempty"`
	ImpactAssessment    string         `json:"impact_assessment,omitempty"`
	Metadata            map[string]any `json:"metadata,omitempty"`
	CreatedAt           time.Time      `json:"created_at"`
	UpdatedAt           time.Time      `json:"updated_at"`
}

type DPiARiskLevel string

const (
	RiskLow    DPiARiskLevel = "low"
	RiskMedium DPiARiskLevel = "medium"
	RiskHigh   DPiARiskLevel = "high"
)

type DPIAStatus string

const (
	DPIADraft       DPIAStatus = "draft"
	DPIAInProgress  DPIAStatus = "in_progress"
	DPIAResearching DPIAStatus = "researching"
	DPIAComplete    DPIAStatus = "complete"
	DPIAReviewed    DPIAStatus = "reviewed"
	DPIASignedOff   DPIAStatus = "signed_off"
)

type DPIAMitigation struct {
	ID          string     `json:"id"`
	Description string     `json:"description"`
	Responsible string     `json:"responsible"`
	DueDate     time.Time  `json:"due_date"`
	Status      string     `json:"status"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

type DPIA struct {
	ID                        string           `json:"id"`
	DPIAID                    string           `json:"dpia_id"`
	Title                     string           `json:"title"`
	Description               string           `json:"description"`
	ProcessingPurpose         string           `json:"processing_purpose"`
	DataController            string           `json:"data_controller"`
	DataProcessor             string           `json:"data_processor"`
	RiskLevel                 DPiARiskLevel    `json:"risk_level"`
	Status                    DPIAStatus       `json:"status"`
	DataCategories            []string         `json:"data_categories"`
	Subjects                  []string         `json:"data_subjects"`
	NecessityAssessment       string           `json:"necessity_assessment"`
	ProportionalityAssessment string           `json:"proportionality_assessment"`
	Risks                     []string         `json:"risks"`
	Mitigations               []DPIAMitigation `json:"mitigations"`
	Metadata                  map[string]any   `json:"metadata,omitempty"`
	DPOReviewed               bool             `json:"dpo_reviewed"`
	DPOReviewedAt             *time.Time       `json:"dpo_reviewed_at,omitempty"`
	DPOComments               string           `json:"dpo_comments,omitempty"`
	ReviewDueDate             *time.Time       `json:"review_due_date,omitempty"`
	CreatedAt                 time.Time        `json:"created_at"`
	UpdatedAt                 time.Time        `json:"updated_at"`
}

type RetentionPolicy struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	Description     string     `json:"description"`
	DataCategory    string     `json:"data_category"`
	RetentionPeriod string     `json:"retention_period"`
	Action          string     `json:"action"`
	AutoExecute     bool       `json:"auto_execute"`
	LastExecutedAt  *time.Time `json:"last_executed_at,omitempty"`
	Exceptions      []string   `json:"exceptions,omitempty"`
	IsActive        bool       `json:"is_active"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type NitdaFiling struct {
	ID          string    `json:"id"`
	FilingType  string    `json:"filing_type"`
	Status      string    `json:"status"`
	SubmittedAt time.Time `json:"submitted_at"`
	ReferenceID string    `json:"reference_id,omitempty"`
}

type AuditReport struct {
	ID                string        `json:"id"`
	Year              int           `json:"year"`
	ReportDate        time.Time     `json:"report_date"`
	OverallStatus     string        `json:"overall_status"`
	ConsentRecords    int64         `json:"consent_records"`
	ActiveConsents    int64         `json:"active_consents"`
	WithdrawnConsents int64         `json:"withdrawn_consents"`
	DSARTotal         int64         `json:"dsar_total"`
	DSARCompleted     int64         `json:"dsar_completed"`
	DSAROnTime        int64         `json:"dsar_on_time"`
	DSAROverdue       int64         `json:"dsar_overdue"`
	BreachTotal       int64         `json:"breach_total"`
	BreachResolved    int64         `json:"breach_resolved"`
	DPIATotal         int64         `json:"dpia_total"`
	DPIAComplete      int64         `json:"dpia_complete"`
	NITDAFilings      []NitdaFiling `json:"nitda_filings,omitempty"`
	GapAnalysis       string        `json:"gap_analysis,omitempty"`
	Recommendations   []string      `json:"recommendations,omitempty"`
	GeneratedAt       time.Time     `json:"generated_at"`
}

type ComplianceMetrics struct {
	ConsentStats struct {
		Total     int64 `json:"total"`
		Active    int64 `json:"active"`
		Withdrawn int64 `json:"withdrawn"`
		Expiring  int64 `json:"expiring_soon"`
	} `json:"consent_stats"`
	DSARStats   DSARStats `json:"dsar_stats"`
	BreachStats struct {
		Total    int64 `json:"total"`
		Active   int64 `json:"active"`
		Resolved int64 `json:"resolved"`
		Critical int64 `json:"critical"`
	} `json:"breach_stats"`
	DPIAStats struct {
		Total    int64 `json:"total"`
		Complete int64 `json:"complete"`
		HighRisk int64 `json:"high_risk"`
	} `json:"dpia_stats"`
	ComplianceScore float64 `json:"compliance_score_pct"`
	LastAuditYear   int     `json:"last_audit_year"`
}
