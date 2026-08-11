package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/insureportal/disaster_recovery_module/config"
	"github.com/insureportal/disaster_recovery_module/models"
	"go.uber.org/zap"
)

// PostgreSQL repository for DR service persistence
type PostgreSQL struct {
	db *sql.DB
}

// NewPostgreSQL creates and initializes a PostgreSQL connection
func NewPostgreSQL(cfg *config.Config) (*PostgreSQL, error) {
	dsn := cfg.DSN()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to postgres: %w", err)
	}

	db.SetMaxOpenConns(cfg.DBMaxConns)
	db.SetMaxIdleConns(cfg.DBMinConns)
	db.SetConnMaxLifetime(30 * time.Minute)
	db.SetConnMaxIdleTime(10 * time.Minute)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping postgres: %w", err)
	}

	zap.L().Info("PostgreSQL connected successfully",
		zap.String("host", cfg.DBHost),
		zap.Int("port", cfg.DBPort),
		zap.Int("maxConns", cfg.DBMaxConns),
	)

	pg := &PostgreSQL{db: db}
	if err := pg.Migrate(context.Background()); err != nil {
		return nil, fmt.Errorf("migration failed: %w", err)
	}

	return pg, nil
}

// Close closes the database connection
func (p *PostgreSQL) Close() error {
	return p.db.Close()
}

// Migrate runs all database migrations
func (p *PostgreSQL) Migrate(ctx context.Context) error {
	queries := []string{
		// Service registration table
		`CREATE TABLE IF NOT EXISTS service_registrations (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			service_name VARCHAR(255) NOT NULL,
			service_group VARCHAR(100) NOT NULL,
			version VARCHAR(50) DEFAULT '1.0.0',
			instance_id VARCHAR(255),
			host VARCHAR(255),
			port INTEGER,
			health_endpoint VARCHAR(255),
			is_protected BOOLEAN DEFAULT FALSE,
			failover_priority INTEGER DEFAULT 999,
			is_auto_failover BOOLEAN DEFAULT FALSE,
			dependencies TEXT,
			metadata TEXT,
			status VARCHAR(50) DEFAULT 'unknown',
			registered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			is_healthy BOOLEAN DEFAULT FALSE,
			CONSTRAINT uq_service_instance UNIQUE (service_name, instance_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_reg_service_name ON service_registrations(service_name)`,
		`CREATE INDEX IF NOT EXISTS idx_reg_status ON service_registrations(status)`,
		`CREATE INDEX IF NOT EXISTS idx_reg_protected ON service_registrations(is_protected)`,

		// Failover events table
		`CREATE TABLE IF NOT EXISTS failover_events (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			event_number VARCHAR(50) UNIQUE NOT NULL,
			type VARCHAR(50) NOT NULL,
			from_dc VARCHAR(255) NOT NULL,
			to_dc VARCHAR(255) NOT NULL,
			status VARCHAR(50) NOT NULL DEFAULT 'initiated',
			triggered_by VARCHAR(255),
			trigger_reason TEXT,
			started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			completed_at TIMESTAMP WITH TIME ZONE,
			actual_rto_secs INTEGER,
			actual_rpo_secs INTEGER,
			services_affected INTEGER DEFAULT 0,
			naicom_notified BOOLEAN DEFAULT FALSE,
			naicom_notified_at TIMESTAMP WITH TIME ZONE,
			rollback_requested BOOLEAN DEFAULT FALSE,
			rolled_back BOOLEAN DEFAULT FALSE,
			rolled_back_at TIMESTAMP WITH TIME ZONE,
			rollback_reason TEXT,
			notes TEXT,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_fo_status ON failover_events(status)`,
		`CREATE INDEX IF NOT EXISTS idx_fo_started ON failover_events(started_at)`,

		// DR drills table
		`CREATE TABLE IF NOT EXISTS dr_drills (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			drill_number VARCHAR(50) UNIQUE NOT NULL,
			type VARCHAR(50) NOT NULL,
			scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
			actual_at TIMESTAMP WITH TIME ZONE,
			status VARCHAR(50) NOT NULL DEFAULT 'scheduled',
			planned_rto VARCHAR(50),
			actual_rto VARCHAR(50),
			planned_rpo VARCHAR(50),
			actual_rpo VARCHAR(50),
			from_dc VARCHAR(255),
			to_dc VARCHAR(255),
			participants TEXT,
			findings TEXT,
			recommendations TEXT,
			naicom_report_submitted BOOLEAN DEFAULT FALSE,
			created_by VARCHAR(255),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_drills_status ON dr_drills(status)`,
		`CREATE INDEX IF NOT EXISTS idx_drills_scheduled ON dr_drills(scheduled_at)`,

		// Backup status table
		`CREATE TABLE IF NOT EXISTS backup_status (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			backup_type VARCHAR(50) NOT NULL,
			source_dc VARCHAR(255) NOT NULL,
			destination VARCHAR(255) NOT NULL,
			status VARCHAR(50) NOT NULL DEFAULT 'in_progress',
			backup_size_gb REAL,
			start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			end_time TIMESTAMP WITH TIME ZONE,
			duration_secs INTEGER,
			lag_secs INTEGER,
			is_verified BOOLEAN DEFAULT FALSE,
			verified_at TIMESTAMP WITH TIME ZONE,
			expires_at TIMESTAMP WITH TIME ZONE,
			s3_key VARCHAR(500),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_status(status)`,
		`CREATE INDEX IF NOT EXISTS idx_backup_time ON backup_status(start_time DESC)`,

		// RTO/RPO tracker table
		`CREATE TABLE IF NOT EXISTS rto_trackers (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			metric_name VARCHAR(100) NOT NULL,
			target_value REAL NOT NULL,
			actual_value REAL,
			unit VARCHAR(20) DEFAULT 'seconds',
			compliant BOOLEAN,
			period_start TIMESTAMP WITH TIME ZONE,
			period_end TIMESTAMP WITH TIME ZONE,
			avg_value REAL,
			min_value REAL,
			max_value REAL,
			p95_value REAL,
			p99_value REAL,
			recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_rto_metric ON rto_trackers(metric_name)`,
		`CREATE INDEX IF NOT EXISTS idx_rto_recorded ON rto_trackers(recorded_at)`,

		// NAICOM notifications table
		`CREATE TABLE IF NOT EXISTS naicom_notifications (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			notification_number VARCHAR(50) UNIQUE NOT NULL,
			event_type VARCHAR(50) NOT NULL,
			severity VARCHAR(20) NOT NULL,
			duration_min INTEGER,
			services_impacted TEXT,
			description TEXT,
			sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			channel VARCHAR(50),
			confirmation VARCHAR(255),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_naicom_type ON naicom_notifications(event_type)`,

		// Service heartbeat table (for high-frequency tracking)
		`CREATE TABLE IF NOT EXISTS service_heartbeats (
			id BIGSERIAL PRIMARY KEY,
			service_name VARCHAR(255) NOT NULL,
			instance_id VARCHAR(255),
			status VARCHAR(50),
			response_ms INTEGER,
			error_message TEXT,
			heartbeat_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_hb_service ON service_heartbeats(service_name)`,
		`CREATE INDEX IF NOT EXISTS idx_hb_time ON service_heartbeats(heartbeat_at DESC)`,
	}

	for _, q := range queries {
		if _, err := p.db.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("migration failed at '%s...': %w", q[:50], err)
		}
	}

	zap.L().Info("All DR database migrations completed")
	return nil
}

// --- Service Registration CRUD ---

// RegisterService registers a service for DR protection
func (p *PostgreSQL) RegisterService(ctx context.Context, reg *models.ServiceRegistration) error {
	query := `INSERT INTO service_registrations 
		(id, service_name, service_group, version, instance_id, host, port, 
		 health_endpoint, is_protected, failover_priority, is_auto_failover, 
		 dependencies, metadata, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`
	_, err := p.db.ExecContext(ctx, query,
		uuid.New().String(), reg.ServiceName, reg.ServiceGroup, reg.Version,
		reg.InstanceID, reg.Host, reg.Port, reg.HealthEndpoint,
		reg.IsProtected, reg.FailoverPriority, reg.IsAutoFailover,
		reg.Dependencies, reg.Metadata, reg.Status,
	)
	return err
}

// UpdateHeartbeat updates a service's heartbeat timestamp and status
func (p *PostgreSQL) UpdateHeartbeat(ctx context.Context, serviceName, instanceID, status string, responseMs int) error {
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx,
		`UPDATE service_registrations SET status=$1, last_heartbeat=NOW(), is_healthy=$2 
		 WHERE service_name=$3 AND instance_id=$4`,
		status, status == "healthy", serviceName, instanceID,
	)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx,
		`INSERT INTO service_heartbeats (service_name, instance_id, status, response_ms) 
		 VALUES ($1, $2, $3, $4)`,
		serviceName, instanceID, status, responseMs,
	)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// GetProtectedServices returns all services marked for protection
func (p *PostgreSQL) GetProtectedServices(ctx context.Context) ([]models.ServiceHealthStatus, error) {
	query := `SELECT id, service_name, service_group, is_protected, tier, status, 
		replication_lag, is_auto_failover, created_at, updated_at 
		FROM service_registrations WHERE is_protected=true ORDER BY failover_priority`
	rows, err := p.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanServiceHealthStatuses(rows)
}

// GetServiceStatus returns a single service's status
func (p *PostgreSQL) GetServiceStatus(ctx context.Context, serviceName, instanceID string) (*models.ServiceHealthStatus, error) {
	query := `SELECT id, service_name, service_group, is_protected, tier, status, 
		replication_lag, is_auto_failover, created_at, updated_at 
		FROM service_registrations WHERE service_name=$1 AND instance_id=$2`
	var s models.ServiceHealthStatus
	err := p.db.QueryRowContext(ctx, query, serviceName, instanceID).Scan(
		&s.ID, &s.ServiceName, &s.ServiceGroup, &s.IsProtected, &s.Tier,
		&s.Status, &s.ReplicationLag, &s.IsAutoFailover, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// GetDashboard returns the consolidated DR dashboard data
func (p *PostgreSQL) GetDashboard(ctx context.Context) (*models.DRDashboard, error) {
	dash := &models.DRDashboard{}

	// Service counts
	var degraded, down int
	err := p.db.QueryRowContext(ctx,
		`SELECT 
			COUNT(*) FILTER (WHERE status='healthy'),
			COUNT(*) FILTER (WHERE status='degraded'),
			COUNT(*) FILTER (WHERE status='down')
			FROM service_registrations WHERE is_protected=true`,
	).Scan(&dash.HealthyCount, &degraded, &down)
	if err != nil {
		return nil, err
	}
	dash.DegradedCount = degraded

	// Get last backup
	err = p.db.QueryRowContext(ctx,
		`SELECT status, end_time FROM backup_status 
		 WHERE status='completed' ORDER BY end_time DESC LIMIT 1`,
	).Scan(&dash.LastBackupStatus, &dash.LastBackup)
	if err == sql.ErrNoRows {
		dash.LastBackup = "never"
	} else if err != nil {
		return nil, err
	}

	// Get last failover
	err = p.db.QueryRowContext(ctx,
		`SELECT id, type, from_dc, to_dc, status, started_at, 
			actual_rto_secs, naicom_notified FROM failover_events 
		 ORDER BY started_at DESC LIMIT 1`,
	).Scan(&dash.LastFailover.ID, &dash.LastFailover.Type,
		&dash.LastFailover.FromDC, &dash.LastFailover.ToDC,
		&dash.LastFailover.Status, &dash.LastFailover.StartedAt,
		&dash.LastFailover.ActualRTOSecs, &dash.LastFailover.NAICOMNotified,
	)
	if err != nil {
		dash.LastFailover = nil
	} else {
		dash.LastFailover = &models.FailoverEvent{}
		err = p.db.QueryRowContext(ctx,
			`SELECT id, event_number, type, from_dc, to_dc, status, started_at,
			 actual_rto_secs, naicom_notified FROM failover_events ORDER BY started_at DESC LIMIT 1`,
			&dash.LastFailover.ID, &dash.LastFailover.EventNumber, &dash.LastFailover.Type,
			&dash.LastFailover.FromDC, &dash.LastFailover.ToDC, &dash.LastFailover.Status,
			&dash.LastFailover.StartedAt, &dash.LastFailover.ActualRTOSecs,
			&dash.LastFailover.NAICOMNotified,
		).Err()
	}

	return dash, nil
}

// --- Failover Events CRUD ---

// CreateFailoverEvent creates a new failover event
func (p *PostgreSQL) CreateFailoverEvent(ctx context.Context, ev *models.FailoverEvent) error {
	ev.ID = uuid.New().String()
	ev.EventNumber = fmt.Sprintf("FO-%s", time.Now().Format("20060102150405"))
	ev.StartedAt = time.Now()
	ev.Status = "initiated"

	query := `INSERT INTO failover_events 
		(id, event_number, type, from_dc, to_dc, status, triggered_by, trigger_reason, 
		 started_at, completed_at, actual_rto_secs, actual_rpo_secs, 
		 services_affected, naicom_notified, naicom_notified_at, 
		 rollback_requested, rolled_back, rolled_back_at, rollback_reason, notes)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`
	_, err := p.db.ExecContext(ctx, query,
		ev.ID, ev.EventNumber, ev.Type, ev.FromDC, ev.ToDC, ev.Status,
		ev.TriggeredBy, ev.TriggerReason, ev.StartedAt, ev.CompletedAt,
		ev.ActualRTOSecs, ev.ActualRPOSecs, ev.ServicesAffected,
		ev.NAICOMNotified, ev.NAICOMNotifiedAt,
		ev.RollbackRequested, ev.RolledBack, ev.RolledBackAt, ev.RollbackReason, ev.Notes,
	)
	return err
}

// CompleteFailover marks a failover event as completed
func (p *PostgreSQL) CompleteFailover(ctx context.Context, eventNumber string, rto, rpo *int, completedAt time.Time) error {
	_, err := p.db.ExecContext(ctx,
		`UPDATE failover_events SET status='completed', completed_at=NOW(), 
		 actual_rto_secs=$1, actual_rpo_secs=$2 
		 WHERE event_number=$3`,
		rto, rpo, eventNumber,
	)
	return err
}

// GetFailoverEvents returns failover events with pagination
func (p *PostgreSQL) GetFailoverEvents(ctx context.Context, status string, limit, offset int) ([]models.FailoverEvent, error) {
	query := `SELECT id, event_number, type, from_dc, to_dc, status, triggered_by, 
		trigger_reason, started_at, completed_at, actual_rto_secs, actual_rpo_secs, 
		services_affected, naicom_notified, naicom_notified_at,
		rollback_requested, rolled_back, rollback_reason, notes 
		FROM failover_events`
	args := []interface{}{}
	pos := 1

	if status != "" {
		query += fmt.Sprintf(" WHERE status=$%d", pos)
		args = append(args, status)
		pos++
	}
	query += " ORDER BY started_at DESC"

	if limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", pos)
		args = append(args, limit)
		pos++
	}
	if offset > 0 {
		query += fmt.Sprintf(" OFFSET $%d", pos)
		args = append(args, offset)
	}

	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []models.FailoverEvent
	for rows.Next() {
		var ev models.FailoverEvent
		err := rows.Scan(&ev.ID, &ev.EventNumber, &ev.Type, &ev.FromDC, &ev.ToDC,
			&ev.Status, &ev.TriggeredBy, &ev.TriggerReason, &ev.StartedAt, &ev.CompletedAt,
			&ev.ActualRTOSecs, &ev.ActualRPOSecs, &ev.ServicesAffected,
			&ev.NAICOMNotified, &ev.NAICOMNotifiedAt,
			&ev.RollbackRequested, &ev.RolledBack, &ev.RollbackReason, &ev.Notes,
		)
		if err != nil {
			return nil, err
		}
		events = append(events, ev)
	}
	return events, nil
}

// --- DR Drills CRUD ---

// CreateDRDrill creates a scheduled DR drill
func (p *PostgreSQL) CreateDRDrill(ctx context.Context, drill *models.DRDrill) error {
	drill.ID = uuid.New().String()
	drill.DrillNumber = fmt.Sprintf("DRL-%s", time.Now().Format("20060102"))
	drill.CreatedAt = time.Now()
	if drill.Status == "" {
		drill.Status = "scheduled"
	}

	query := `INSERT INTO dr_drills 
		(id, drill_number, type, scheduled_at, status, planned_rto, planned_rpo,
		 from_dc, to_dc, participants, created_by, findings, recommendations)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`
	_, err := p.db.ExecContext(ctx, query,
		drill.ID, drill.DrillNumber, drill.Type, drill.ScheduledAt, drill.Status,
		drill.PlannedRTO, drill.PlannedRPO, drill.FromDC, drill.ToDC,
		drill.Participants, drill.CreatedBy, drill.Findings, drill.Recommendations,
	)
	return err
}

// CompleteDRDrill marks a drill as completed with results
func (p *PostgreSQL) CompleteDRDrill(ctx context.Context, drillNumber, status, actualRTO, actualRPO, findings string) error {
	_, err := p.db.ExecContext(ctx,
		`UPDATE dr_drills SET status=$1, actual_at=NOW(), actual_rto=$2, 
		 actual_rpo=$3, findings=$4 
		 WHERE drill_number=$5`,
		status, actualRTO, actualRPO, findings, drillNumber,
	)
	return err
}

// GetDRDrills returns DR drills with optional filters
func (p *PostgreSQL) GetDRDrills(ctx context.Context, status string, limit int) ([]models.DRDrill, error) {
	query := `SELECT id, drill_number, type, scheduled_at, actual_at, status,
		planned_rto, actual_rto, planned_rpo, actual_rpo, from_dc, to_dc,
		participants, findings, recommendations, naicom_report_submitted,
		created_by, created_at FROM dr_drills`
	args := []interface{}{}
	pos := 1

	if status != "" {
		query += fmt.Sprintf(" WHERE status=$%d", pos)
		args = append(args, status)
		pos++
	}
	query += " ORDER BY scheduled_at DESC"

	if limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", pos)
		args = append(args, limit)
	}

	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var drills []models.DRDrill
	for rows.Next() {
		var d models.DRDrill
		err := rows.Scan(&d.ID, &d.DrillNumber, &d.Type, &d.ScheduledAt, &d.ActualAt,
			&d.Status, &d.PlannedRTO, &d.ActualRTO, &d.PlannedRPO, &d.ActualRPO,
			&d.FromDC, &d.ToDC, &d.Participants, &d.Findings, &d.Recommendations,
			&d.NAICOMReportSubmitted, &d.CreatedBy, &d.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		drills = append(drills, d)
	}
	return drills, nil
}

// --- Backup CRUD ---

// CreateBackupStatus records a new backup status
func (p *PostgreSQL) CreateBackupStatus(ctx context.Context, backup *models.BackupStatus) error {
	backup.ID = uuid.New().String()
	backup.CreatedAt = time.Now()
	if backup.Status == "" {
		backup.Status = "in_progress"
	}

	query := `INSERT INTO backup_status 
		(id, backup_type, source_dc, destination, status, backup_size_gb,
		 start_time, end_time, duration_secs, lag_secs, is_verified,
		 verified_at, expires_at, s3_key)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`
	_, err := p.db.ExecContext(ctx, query,
		backup.ID, backup.BackupType, backup.SourceDC, backup.Destination,
		backup.Status, backup.BackupSizeGB, backup.StartTime, backup.EndTime,
		backup.DurationSec, backup.LagSec, backup.IsVerified,
		backup.VerifiedAt, backup.ExpiresAt, backup.S3Key,
	)
	return err
}

// UpdateBackupStatus updates an existing backup status
func (p *PostgreSQL) UpdateBackupStatus(ctx context.Context, id string, status string, endTime *time.Time, durationSec, lagSec *int) error {
	_, err := p.db.ExecContext(ctx,
		`UPDATE backup_status SET status=$1, end_time=$2, duration_secs=$3, lag_secs=$4 
		 WHERE id=$5`,
		status, endTime, durationSec, lagSec, id,
	)
	return err
}

// GetLatestBackup returns the most recent completed backup
func (p *PostgreSQL) GetLatestBackup(ctx context.Context) (*models.BackupStatus, error) {
	query := `SELECT id, backup_type, source_dc, destination, status, backup_size_gb,
		start_time, end_time, duration_secs, lag_secs, is_verified, verified_at, expires_at, s3_key
		FROM backup_status WHERE status='completed' ORDER BY end_time DESC LIMIT 1`
	var b models.BackupStatus
	err := p.db.QueryRowContext(ctx, query).Scan(
		&b.ID, &b.BackupType, &b.SourceDC, &b.Destination, &b.Status, &b.BackupSizeGB,
		&b.StartTime, &b.EndTime, &b.DurationSec, &b.LagSec, &b.IsVerified,
		&b.VerifiedAt, &b.ExpiresAt, &b.S3Key,
	)
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// GetBackupStatuses returns backup statuses with optional filters
func (p *PostgreSQL) GetBackupStatuses(ctx context.Context, status string, limit int) ([]models.BackupStatus, error) {
	query := `SELECT id, backup_type, source_dc, destination, status, backup_size_gb,
		start_time, end_time, duration_secs, lag_secs, is_verified, verified_at, expires_at, s3_key
		FROM backup_status`
	args := []interface{}{}
	pos := 1

	if status != "" {
		query += fmt.Sprintf(" WHERE status=$%d", pos)
		args = append(args, status)
		pos++
	}
	query += " ORDER BY start_time DESC"

	if limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", pos)
		args = append(args, limit)
	}

	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var backups []models.BackupStatus
	for rows.Next() {
		var b models.BackupStatus
		err := rows.Scan(&b.ID, &b.BackupType, &b.SourceDC, &b.Destination, &b.Status,
			&b.BackupSizeGB, &b.StartTime, &b.EndTime, &b.DurationSec, &b.LagSec,
			&b.IsVerified, &b.VerifiedAt, &b.ExpiresAt, &b.S3Key,
		)
		if err != nil {
			return nil, err
		}
		backups = append(backups, b)
	}
	return backups, nil
}

// --- RTO/RPO Tracking CRUD ---

// RecordRTOTracker records an RTO/RPO metric
func (p *PostgreSQL) RecordRTOTracker(ctx context.Context, tracker *models.RTOTracker) error {
	tracker.ID = uuid.New().String()
	tracker.RecordedAt = time.Now()

	query := `INSERT INTO rto_trackers 
		(id, metric_name, target_value, actual_value, unit, compliant,
		 period_start, period_end, avg_value, min_value, max_value, p95_value, p99_value)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`
	_, err := p.db.ExecContext(ctx, query,
		tracker.ID, tracker.MetricName, tracker.TargetValue, tracker.ActualValue,
		tracker.Unit, tracker.Compliant, tracker.PeriodStart, tracker.PeriodEnd,
		tracker.AvgValue, tracker.MinValue, tracker.MaxValue, tracker.P95Value, tracker.P99Value,
	)
	return err
}

// GetRTOTracker returns RTO/RPO metrics for a given metric name
func (p *PostgreSQL) GetRTOTracker(ctx context.Context, metricName string) ([]models.RTOTracker, error) {
	query := `SELECT id, metric_name, target_value, actual_value, unit, compliant,
		period_start, period_end, avg_value, min_value, max_value, p95_value, p99_value, recorded_at
		FROM rto_trackers WHERE metric_name=$1 ORDER BY recorded_at DESC`
	rows, err := p.db.QueryContext(ctx, query, metricName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanRTOTrackers(rows)
}

// --- NAICOM Notifications CRUD ---

// CreateNAICOMNotification records a regulatory notification
func (p *PostgreSQL) CreateNAICOMNotification(ctx context.Context, notif *models.NAICOMNotification) error {
	notif.ID = uuid.New().String()
	notif.NotificationNumber = fmt.Sprintf("NAICOM-%s", time.Now().Format("20060102150405"))
	notif.SentAt = time.Now()
	notif.CreatedAt = time.Now()

	query := `INSERT INTO naicom_notifications 
		(id, notification_number, event_type, severity, duration_min,
		 services_impacted, description, sent_at, channel, confirmation)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`
	_, err := p.db.ExecContext(ctx, query,
		notif.ID, notif.NotificationNumber, notif.EventType, notif.Severity,
		notif.DurationMin, notif.ServicesImpacted, notif.Description,
		notif.SentAt, notif.Channel, notif.Confirmation,
	)
	return err
}

// GetNAICOMNotifications returns all regulatory notifications
func (p *PostgreSQL) GetNAICOMNotifications(ctx context.Context, limit int) ([]models.NAICOMNotification, error) {
	query := `SELECT id, notification_number, event_type, severity, duration_min,
		services_impacted, description, sent_at, channel, confirmation, created_at
		FROM naicom_notifications ORDER BY sent_at DESC`
	if limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", limit+1)
	}

	rows, err := p.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notifs []models.NAICOMNotification
	for rows.Next() {
		var n models.NAICOMNotification
		err := rows.Scan(&n.ID, &n.NotificationNumber, &n.EventType, &n.Severity,
			&n.DurationMin, &n.ServicesImpacted, &n.Description, &n.SentAt,
			&n.Channel, &n.Confirmation, &n.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		notifs = append(notifs, n)
	}
	return notifs, nil
}

// --- Helper functions ---

func scanServiceHealthStatuses(rows *sql.Rows) ([]models.ServiceHealthStatus, error) {
	var services []models.ServiceHealthStatus
	for rows.Next() {
		var s models.ServiceHealthStatus
		err := rows.Scan(&s.ID, &s.ServiceName, &s.ServiceGroup, &s.IsProtected,
			&s.Tier, &s.Status, &s.ReplicationLag, &s.IsAutoFailover,
			&s.CreatedAt, &s.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		services = append(services, s)
	}
	return services, nil
}

func scanRTOTrackers(rows *sql.Rows) ([]models.RTOTracker, error) {
	var trackers []models.RTOTracker
	for rows.Next() {
		var t models.RTOTracker
		err := rows.Scan(&t.ID, &t.MetricName, &t.TargetValue, &t.ActualValue,
			&t.Unit, &t.Compliant, &t.PeriodStart, &t.PeriodEnd,
			&t.AvgValue, &t.MinValue, &t.MaxValue, &t.P95Value, &t.P99Value, &t.RecordedAt,
		)
		if err != nil {
			return nil, err
		}
		trackers = append(trackers, t)
	}
	return trackers, nil
}
