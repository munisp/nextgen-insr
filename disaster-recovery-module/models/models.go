package models

import (
	"time"
)

// ServiceHealthStatus represents the health state of a registered service
type ServiceHealthStatus struct {
	ID            string    `json:"id" db:"id"`
	ServiceName   string    `json:"service_name" db:"service_name"`
	ServiceGroup  string    `json:"service_group" db:"service_group"`
	IsProtected   bool      `json:"is_protected" db:"is_protected"`
	Tier          int       `json:"tier" db:"tier"` // 1=critical, 2=important, 3=optional
	Status        string    `json:"status" db:"status"` // healthy, degraded, down, unknown
	LastHeartbeat time.Time `json:"last_heartbeat" db:"last_heartbeat"`
	ReplicationLag string  `json:"replication_lag" db:"replication_lag"`
	IsAutoFailover bool     `json:"is_auto_failover" db:"is_auto_failover"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time `json:"updated_at" db:"updated_at"`
}

// FailoverEvent represents a DR failover operation
type FailoverEvent struct {
	ID                string    `json:"id" db:"id"`
	EventNumber       string    `json:"event_number" db:"event_number"`
	Type              string    `json:"type" db:"type"` // full, partial, planned, unplanned
	FromDC            string    `json:"from_dc" db:"from_dc"`
	ToDC              string    `json:"to_dc" db:"to_dc"`
	Status            string    `json:"status" db:"status"` // initiated, in_progress, completed, failed, rolled_back
	TriggeredBy       string    `json:"triggered_by" db:"triggered_by"`
	TriggerReason     string    `json:"trigger_reason" db:"trigger_reason"`
	StartedAt         time.Time `json:"started_at" db:"started_at"`
	CompletedAt       *time.Time `json:"completed_at" db:"completed_at"`
	ActualRTOSecs     *int      `json:"actual_rto_secs" db:"actual_rto_secs"`
	ActualRPOSecs     *int      `json:"actual_rpo_secs" db:"actual_rpo_secs"`
	ServicesAffected  int       `json:"services_affected" db:"services_affected"`
	NAICOMNotified    bool      `json:"naicom_notified" db:"naicom_notified"`
	NAICOMNotifiedAt  *time.Time `json:"naicom_notified_at" db:"naicom_notified_at"`
	RollbackRequested bool      `json:"rollback_requested" db:"rollback_requested"`
	RolledBack        bool      `json:"rolled_back" db:"rolled_back"`
	RolledBackAt      *time.Time `json:"rolled_back_at" db:"rolled_back_at"`
	RollbackReason    string    `json:"rollback_reason" db:"rollback_reason"`
	Notes             string    `json:"notes" db:"notes"`
	CreatedAt         time.Time `json:"created_at" db:"created_at"`
}

// DRDrill represents a scheduled or executed DR drill
type DRDrill struct {
	ID            string    `json:"id" db:"id"`
	DrillNumber   string    `json:"drill_number" db:"drill_number"`
	Type          string    `json:"type" db:"type"` // full_failover, partial_failover, failback, backup_restore, network_partition
	ScheduledAt   time.Time `json:"scheduled_at" db:"scheduled_at"`
	ActualAt      *time.Time `json:"actual_at" db:"actual_at"`
	Status        string    `json:"status" db:"status"` // scheduled, in_progress, passed, failed, cancelled, pending_review
	PlannedRTO    string    `json:"planned_rto" db:"planned_rto"`
	ActualRTO     string    `json:"actual_rto" db:"actual_rto"`
	PlannedRPO    string    `json:"planned_rpo" db:"planned_rpo"`
	ActualRPO     string    `json:"actual_rpo" db:"actual_rpo"`
	FromDC        string    `json:"from_dc" db:"from_dc"`
	ToDC          string    `json:"to_dc" db:"to_dc"`
	Participants  string    `json:"participants" db:"participants"`
	Findings      string    `json:"findings" db:"findings"`
	Recommendations string  `json:"recommendations" db:"recommendations"`
	NAICOMReportSubmitted bool `json:"naicom_report_submitted" db:"naicom_report_submitted"`
	CreatedBy     string    `json:"created_by" db:"created_by"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

// BackupStatus tracks backup state for DR compliance
type BackupStatus struct {
	ID            string    `json:"id" db:"id"`
	BackupType    string    `json:"backup_type" db:"backup_type"` // db_snapshot, full_backup, incremental, log_shipping
	SourceDC      string    `json:"source_dc" db:"source_dc"`
	Destination   string    `json:"destination" db:"destination"`
	Status        string    `json:"status" db:"status"` // completed, in_progress, failed, expired
	BackupSizeGB  float64   `json:"backup_size_gb" db:"backup_size_gb"`
	StartTime     time.Time `json:"start_time" db:"start_time"`
	EndTime       *time.Time `json:"end_time" db:"end_time"`
	DurationSec   *int      `json:"duration_secs" db:"duration_secs"`
	LagSec        *int      `json:"lag_secs" db:"lag_secs"`
	IsVerified    bool      `json:"is_verified" db:"is_verified"`
	VerifiedAt    *time.Time `json:"verified_at" db:"verified_at"`
	ExpiresAt     time.Time `json:"expires_at" db:"expires_at"`
	S3Key         string    `json:"s3_key" db:"s3_key"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

// RTOTracker tracks RTO compliance metrics
type RTOTracker struct {
	ID            string    `json:"id" db:"id"`
	MetricName    string    `json:"metric_name" db:"metric_name"`
	TargetValue   float64   `json:"target_value" db:"target_value"` // seconds
	ActualValue   *float64  `json:"actual_value" db:"actual_value"`
	Unit          string    `json:"unit" db:"unit"` // seconds, minutes, hours
	Compliant     bool      `json:"compliant" db:"compliant"`
	PeriodStart   time.Time `json:"period_start" db:"period_start"`
	PeriodEnd     time.Time `json:"period_end" db:"period_end"`
	AvgValue      *float64  `json:"avg_value" db:"avg_value"`
	MinValue      *float64  `json:"min_value" db:"min_value"`
	MaxValue      *float64  `json:"max_value" db:"max_value"`
	P95Value      *float64  `json:"p95_value" db:"p95_value"`
	P99Value      *float64  `json:"p99_value" db:"p99_value"`
	RecordedAt    time.Time `json:"recorded_at" db:"recorded_at"`
}

// ServiceRegistration represents a service registered with the DR system
type ServiceRegistration struct {
	ID              string    `json:"id" db:"id"`
	ServiceName     string    `json:"service_name" db:"service_name"`
	ServiceGroup    string    `json:"service_group" db:"service_group"`
	Version         string    `json:"version" db:"version"`
	InstanceID      string    `json:"instance_id" db:"instance_id"`
	Host            string    `json:"host" db:"host"`
	Port            int       `json:"port" db:"port"`
	HealthEndpoint  string    `json:"health_endpoint" db:"health_endpoint"`
	IsProtected     bool      `json:"is_protected" db:"is_protected"`
	FailoverPriority int     `json:"failover_priority" db:"failover_priority"` // lower = higher priority
	IsAutoFailover  bool      `json:"is_auto_failover" db:"is_auto_failover"`
	Dependencies    string    `json:"dependencies" db:"dependencies"` // JSON array of service names
	Metadata        string    `json:"metadata" db:"metadata"` // JSON metadata
	Status          string    `json:"status" db:"status"`
	RegisteredAt    time.Time `json:"registered_at" db:"registered_at"`
	LastHeartbeat   time.Time `json:"last_heartbeat" db:"last_heartbeat"`
	IsHealthy       bool      `json:"is_healthy" db:"is_healthy"`
}

// NAICOMNotification represents a regulatory notification sent to NAICOM
type NAICOMNotification struct {
	ID            string    `json:"id" db:"id"`
	NotificationNumber string `json:"notification_number" db:"notification_number"`
	EventType     string    `json:"event_type" db:"event_type"` // outage, dr_activation, drill, recovery
	Severity      string    `json:"severity" db:"severity"` // critical, major, minor
	DurationMin   *int      `json:"duration_min" db:"duration_min"`
	ServicesImpacted string  `json:"services_impacted" db:"services_impacted"` // JSON array
	Description   string    `json:"description" db:"description"`
	SentAt        time.Time `json:"sent_at" db:"sent_at"`
	Channel       string    `json:"channel" db:"channel"` // email, portal, api
	Confirmation  string    `json:"confirmation" db:"confirmation"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

// DRDashboard provides the consolidated DR status view
type DRDashboard struct {
	PrimaryDC       string        `json:"primary_dc"`
	SecondaryDC     string        `json:"secondary_dc"`
	OverallStatus   string        `json:"overall_status"` // healthy, degraded, critical, disaster
	TotalServices   int           `json:"total_services"`
	ProtectedCount  int           `json:"protected_count"`
	HealthyCount    int           `json:"healthy_count"`
	DegradedCount   int           `json:"degraded_count"`
	DownCount       int           `json:"down_count"`
	ReplicationLag  float64       `json:"replication_lag_seconds"`
	LastBackup      string        `json:"last_backup"`
	LastBackupStatus string       `json:"last_backup_status"`
	LastFailover    *FailoverEvent `json:"last_failover"`
	LastDrill       *DRDrill      `json:"last_drill"`
	RTOCompliant    bool          `json:"rto_compliant"`
	RPOCompliant    bool          `json:"rpo_compliant"`
	RTOTarget       string        `json:"rto_target"`
	RPOTarget       string        `json:"rpo_target"`
	NAICOMNotifCount int          `json:"naicom_notif_count"`
	NextDrillDate   string        `json:"next_drill_date"`
}
