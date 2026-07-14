package db

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/insureportal/ndpr_compliance/config"
	"github.com/insureportal/ndpr_compliance/models"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres provides database access for NDPR compliance.
type Postgres struct {
	Pool *pgxpool.Pool
}

// NewPostgres creates and verifies a database connection pool.
func NewPostgres(ctx context.Context, cfg *config.PostgresConfig) (*Postgres, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("parse postgres config: %w", err)
	}
	poolCfg.MaxConns = int32(cfg.MaxOpenConns)
	poolCfg.MinConns = 3
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("connect to postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return &Postgres{Pool: pool}, nil
}

func (p *Postgres) Close() {
	if p != nil && p.Pool != nil {
		p.Pool.Close()
	}
}

// RunMigrations creates all NDPR compliance tables.
func (p *Postgres) RunMigrations(ctx context.Context) error {
	migrations := []string{
		// Consent table
		`CREATE TABLE IF NOT EXISTS consents (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			consent_id VARCHAR(64) UNIQUE NOT NULL,
			subject_id VARCHAR(64) NOT NULL,
			purposes TEXT[] NOT NULL DEFAULT '{}',
			method VARCHAR(32) NOT NULL,
			lawful_basis VARCHAR(32) NOT NULL DEFAULT 'consent',
			ip_address VARCHAR(45),
			user_agent TEXT,
			version VARCHAR(16) NOT NULL DEFAULT 'v1.0',
			consent_text TEXT NOT NULL,
			withdrawn BOOLEAN NOT NULL DEFAULT false,
			withdrawn_at TIMESTAMPTZ,
			withdrawn_by VARCHAR(128),
			withdrawal_reason TEXT,
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_consents_subject ON consents(subject_id)`,
		`CREATE INDEX IF NOT EXISTS idx_consents_withdrawn ON consents(withdrawn)`,
		`CREATE INDEX IF NOT EXISTS idx_consents_created ON consents(created_at)`,

		// DSAR table
		`CREATE TABLE IF NOT EXISTS dsars (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			dsar_id VARCHAR(64) UNIQUE NOT NULL,
			subject_id VARCHAR(64) NOT NULL,
			full_name VARCHAR(255),
			email VARCHAR(255),
			type VARCHAR(32) NOT NULL,
			description TEXT,
			status VARCHAR(32) NOT NULL DEFAULT 'received',
			sla_days INT NOT NULL DEFAULT 30,
			received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			deadline TIMESTAMPTZ NOT NULL,
			completed_at TIMESTAMPTZ,
			assigned_to VARCHAR(128),
			data_sources TEXT[] DEFAULT '{}',
			records_found INT NOT NULL DEFAULT 0,
			data_export_url TEXT,
			rejection_reason TEXT,
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_dsars_subject ON dsars(subject_id)`,
		`CREATE INDEX IF NOT EXISTS idx_dsars_status ON dsars(status)`,
		`CREATE INDEX IF NOT EXISTS idx_dsars_deadline ON dsars(deadline)`,
		`CREATE INDEX IF NOT EXISTS idx_dsars_dsar_id ON dsars(dsar_id)`,

		// Breach table
		`CREATE TABLE IF NOT EXISTS breaches (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			breach_id VARCHAR(64) UNIQUE NOT NULL,
			title VARCHAR(255) NOT NULL,
			description TEXT,
			severity VARCHAR(32) NOT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'reported',
			detection_date DATE NOT NULL,
			notification_date TIMESTAMPTZ,
			reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			reported_by VARCHAR(128) NOT NULL,
			affected_persons BIGINT NOT NULL DEFAULT 0,
			data_types_affected TEXT[] DEFAULT '{}',
			cause TEXT,
			nitda_deadline TIMESTAMPTZ NOT NULL,
			nitda_notified_at TIMESTAMPTZ,
			nitda_notification_id VARCHAR(128),
			affected_notified_at TIMESTAMPTZ,
			remediation_steps TEXT[] DEFAULT '{}',
			remediation_complete BOOLEAN NOT NULL DEFAULT false,
			resolution_date TIMESTAMPTZ,
			impact_assessment TEXT,
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_breaches_status ON breaches(status)`,
		`CREATE INDEX IF NOT EXISTS idx_breaches_severity ON breaches(severity)`,
		`CREATE INDEX IF NOT EXISTS idx_breaches_breach_id ON breaches(breach_id)`,
		`CREATE INDEX IF NOT EXISTS idx_breaches_deadline ON breaches(nitda_deadline)`,

		// DPIA table
		`CREATE TABLE IF NOT EXISTS dpias (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			dpia_id VARCHAR(64) UNIQUE NOT NULL,
			title VARCHAR(255) NOT NULL,
			description TEXT,
			processing_purpose TEXT NOT NULL,
			data_controller VARCHAR(255) NOT NULL,
			data_processor VARCHAR(255),
			risk_level VARCHAR(32) NOT NULL DEFAULT 'low',
			status VARCHAR(32) NOT NULL DEFAULT 'draft',
			data_categories TEXT[] DEFAULT '{}',
			data_subjects TEXT[] DEFAULT '{}',
			necessity_assessment TEXT,
			proportionality_assessment TEXT,
			risks TEXT[] DEFAULT '{}',
			metadata JSONB DEFAULT '{}'::jsonb,
			dpo_reviewed BOOLEAN NOT NULL DEFAULT false,
			dpo_reviewed_at TIMESTAMPTZ,
			dpo_comments TEXT,
			review_due_date TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_dpias_status ON dpias(status)`,
		`CREATE INDEX IF NOT EXISTS idx_dpias_risk ON dpias(risk_level)`,
		`CREATE INDEX IF NOT EXISTS idx_dpias_dpia_id ON dpias(dpia_id)`,

		// DPIA mitigations (sub-table)
		`CREATE TABLE IF NOT EXISTS dpias_mitigations (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			dpia_id UUID NOT NULL REFERENCES dpias(id) ON DELETE CASCADE,
			description TEXT NOT NULL,
			responsible VARCHAR(128),
			due_date DATE NOT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'not_started',
			completed_at TIMESTAMPTZ
		)`,
		`CREATE INDEX IF NOT EXISTS idx_mitigations_dpia ON dpias_mitigations(dpia_id)`,

		// Retention policies
		`CREATE TABLE IF NOT EXISTS retention_policies (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255) NOT NULL,
			description TEXT,
			data_category VARCHAR(128) NOT NULL UNIQUE,
			retention_period VARCHAR(32) NOT NULL,
			action VARCHAR(32) NOT NULL DEFAULT 'delete',
			auto_execute BOOLEAN NOT NULL DEFAULT true,
			last_executed_at TIMESTAMPTZ,
			exceptions TEXT[] DEFAULT '{}',
			is_active BOOLEAN NOT NULL DEFAULT true,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_retention_category ON retention_policies(data_category)`,

		// Audit reports
		`CREATE TABLE IF NOT EXISTS audit_reports (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			year INT NOT NULL,
			report_date DATE NOT NULL,
			overall_status VARCHAR(32) NOT NULL DEFAULT 'pending',
			consent_records BIGINT NOT NULL DEFAULT 0,
			active_consents BIGINT NOT NULL DEFAULT 0,
			withdrawn_consents BIGINT NOT NULL DEFAULT 0,
			dsar_total BIGINT NOT NULL DEFAULT 0,
			dsar_completed BIGINT NOT NULL DEFAULT 0,
			dsar_on_time BIGINT NOT NULL DEFAULT 0,
			dsar_overdue BIGINT NOT NULL DEFAULT 0,
			breach_total BIGINT NOT NULL DEFAULT 0,
			breach_resolved BIGINT NOT NULL DEFAULT 0,
			dpia_total BIGINT NOT NULL DEFAULT 0,
			dpia_complete BIGINT NOT NULL DEFAULT 0,
			gap_analysis TEXT,
			recommendations TEXT[] DEFAULT '{}',
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_year ON audit_reports(year)`,

		// Nitda filings
		`CREATE TABLE IF NOT EXISTS nitda_filings (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			audit_report_id UUID REFERENCES audit_reports(id),
			filing_type VARCHAR(64) NOT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'draft',
			submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			reference_id VARCHAR(128),
			metadata JSONB DEFAULT '{}'::jsonb
		)`,

		// Compliance audit log
		`CREATE TABLE IF NOT EXISTS audit_log (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			entity_type VARCHAR(64) NOT NULL,
			entity_id VARCHAR(128) NOT NULL,
			action VARCHAR(64) NOT NULL,
			changed_by VARCHAR(128),
			old_values JSONB,
			new_values JSONB,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)`,
	}

	for _, migration := range migrations {
		if _, err := p.Pool.Exec(ctx, migration); err != nil {
			return fmt.Errorf("execute migration: %w", err)
		}
	}
	return nil
}

// ===== JSON Helpers =====

func toJSON(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}

func fromJSON(data string, v interface{}) error {
	if data == "" || data == "null" {
		return nil
	}
	return json.Unmarshal([]byte(data), v)
}

// ===== Consent CRUD =====

// InsertConsent creates a new consent record.
func (p *Postgres) InsertConsent(ctx context.Context, consent *models.Consent) error {
	purposesArray, _ := toJSON(consent.Purposes)
	metadataJSON, _ := toJSON(consent.Metadata)

	_, err := p.Pool.Exec(ctx, `
		INSERT INTO consents
			(id, consent_id, subject_id, purposes, method, lawful_basis,
			 ip_address, user_agent, version, consent_text, withdrawn,
			 withdrawn_at, withdrawn_by, withdrawal_reason, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
	`, consent.ID, consent.ConsentID, consent.SubjectID,
		string(purposesArray), string(consent.Method), string(consent.LawfulBasis),
		consent.IPAddress, consent.UserAgent, consent.Version, consent.ConsentText,
		consent.Withdrawn, consent.WithdrawnAt, consent.WithdrawnBy,
		consent.WithdrawalReason, metadataJSON)
	return err
}

// GetConsentsBySubject retrieves all consents for a data subject.
func (p *Postgres) GetConsentsBySubject(ctx context.Context, subjectID string) ([]*models.Consent, error) {
	rows, err := p.Pool.Query(ctx, `
		SELECT id, consent_id, subject_id, purposes, method, lawful_basis,
			ip_address, user_agent, version, consent_text, withdrawn,
			withdrawn_at, withdrawn_by, withdrawal_reason, metadata,
			created_at, updated_at
		FROM consents WHERE subject_id = $1 ORDER BY created_at DESC
	`, subjectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanConsents(rows)
}

// GetConsent retrieves a single consent by ID.
func (p *Postgres) GetConsent(ctx context.Context, consentID string) (*models.Consent, error) {
	c := &models.Consent{}
	var purposesJSON string
	var metadataJSON string
	err := p.Pool.QueryRow(ctx, `
		SELECT id, consent_id, subject_id, purposes, method, lawful_basis,
			ip_address, user_agent, version, consent_text, withdrawn,
			withdrawn_at, withdrawn_by, withdrawal_reason, metadata,
			created_at, updated_at
		FROM consents WHERE consent_id = $1
	`, consentID).Scan(
		&c.ID, &c.ConsentID, &c.SubjectID, &purposesJSON,
		(*string)(&c.Method), (*string)(&c.LawfulBasis),
		&c.IPAddress, &c.UserAgent, &c.Version, &c.ConsentText,
		&c.Withdrawn, &c.WithdrawnAt, &c.WithdrawnBy, &c.WithdrawalReason,
		&metadataJSON, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	fromJSON(purposesJSON, &c.Purposes)
	fromJSON(metadataJSON, &c.Metadata)
	return c, nil
}

// WithdrawConsent marks a consent as withdrawn.
func (p *Postgres) WithdrawConsent(ctx context.Context, consentID, withdrawnBy, reason string) error {
	now := time.Now().UTC()
	_, err := p.Pool.Exec(ctx, `
		UPDATE consents SET
			withdrawn = true, withdrawn_at = $1,
			withdrawn_by = $2, withdrawal_reason = $3, updated_at = NOW()
		WHERE consent_id = $4
	`, now, withdrawnBy, reason, consentID)
	return err
}

func scanConsents(rows pgx.Rows) ([]*models.Consent, error) {
	var consents []*models.Consent
	for rows.Next() {
		c := &models.Consent{}
		var purposesJSON, metadataJSON string
		if err := rows.Scan(
			&c.ID, &c.ConsentID, &c.SubjectID, &purposesJSON,
			(*string)(&c.Method), (*string)(&c.LawfulBasis),
			&c.IPAddress, &c.UserAgent, &c.Version, &c.ConsentText,
			&c.Withdrawn, &c.WithdrawnAt, &c.WithdrawnBy, &c.WithdrawalReason,
			&metadataJSON, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		fromJSON(purposesJSON, &c.Purposes)
		fromJSON(metadataJSON, &c.Metadata)
		consents = append(consents, c)
	}
	return consents, rows.Err()
}

// ===== DSAR CRUD =====

// InsertDSAR creates a new DSAR request.
func (p *Postgres) InsertDSAR(ctx context.Context, dsar *models.DSAR) error {
	dataSources, _ := toJSON(dsar.DataSources)
	metadataJSON, _ := toJSON(dsar.Metadata)

	_, err := p.Pool.Exec(ctx, `
		INSERT INTO dsars
			(id, dsar_id, subject_id, full_name, email, type, description,
			 status, sla_days, received_at, deadline, completed_at,
			 assigned_to, data_sources, records_found, data_export_url,
			 rejection_reason, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
	`, dsar.ID, dsar.DSARID, dsar.SubjectID, dsar.FullName, dsar.Email,
		string(dsar.Type), dsar.Description, string(dsar.Status),
		dsar.SLADays, dsar.ReceivedAt, dsar.Deadline, dsar.CompletedAt,
		dsar.AssignedTo, string(dataSources), dsar.RecordsFound,
		dsar.DataExportURL, dsar.RejectionReason, metadataJSON)
	return err
}

// GetDSAR retrieves a DSAR by its ID.
func (p *Postgres) GetDSAR(ctx context.Context, dsarID string) (*models.DSAR, error) {
	d := &models.DSAR{}
	var dataSourcesJSON, metadataJSON string
	err := p.Pool.QueryRow(ctx, `
		SELECT id, dsar_id, subject_id, full_name, email, type, description,
			status, sla_days, received_at, deadline, completed_at,
			assigned_to, data_sources, records_found, data_export_url,
			rejection_reason, metadata, created_at, updated_at
		FROM dsars WHERE dsar_id = $1
	`, dsarID).Scan(
		&d.ID, &d.DSARID, &d.SubjectID, &d.FullName, &d.Email,
		(*string)(&d.Type), &d.Description, (*string)(&d.Status),
		&d.SLADays, &d.ReceivedAt, &d.Deadline, &d.CompletedAt,
		&d.AssignedTo, &dataSourcesJSON, &d.RecordsFound, &d.DataExportURL,
		&d.RejectionReason, &metadataJSON, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	fromJSON(dataSourcesJSON, &d.DataSources)
	fromJSON(metadataJSON, &d.Metadata)
	return d, nil
}

// UpdateDSARStatus updates a DSAR's status and related fields.
func (p *Postgres) UpdateDSAR(ctx context.Context, dsarID string, updates map[string]interface{}) error {
	setParts := []string{"updated_at = NOW()"}
	args := []interface{}{}
	argCount := 1

	for k, v := range updates {
		setParts = append(setParts, fmt.Sprintf("%s = $%d", k, argCount))
		args = append(args, v)
		argCount++
	}
	args = append(args, dsarID)

	_, err := p.Pool.Exec(ctx, fmt.Sprintf("UPDATE dsars SET %s WHERE dsar_id = $%d",
		strings.Join(setParts, ", "), argCount), args...)
	return err
}

// ListDSARs returns DSARs with filtering and pagination.
func (p *Postgres) ListDSARs(ctx context.Context, status, subjectID string, limit, offset int) ([]*models.DSAR, int64, error) {
	base := `SELECT id, dsar_id, subject_id, full_name, email, type, description,
		status, sla_days, received_at, deadline, completed_at,
		assigned_to, data_sources, records_found, data_export_url,
		rejection_reason, metadata, created_at, updated_at FROM dsars`

	var conditions []string
	var args []interface{}
	argCount := 1

	if status != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", argCount))
		args = append(args, status)
		argCount++
	}
	if subjectID != "" {
		conditions = append(conditions, fmt.Sprintf("subject_id = $%d", argCount))
		args = append(args, subjectID)
		argCount++
	}

	var whereClause string
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM dsars %s", whereClause)
	var total int64
	if err := p.Pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf("%s %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d",
		base, whereClause, argCount, argCount+1)
	args = append(args, limit, offset)

	rows, err := p.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	return scanDSARs(rows)
}

func scanDSARs(rows pgx.Rows) ([]*models.DSAR, error) {
	var dsars []*models.DSAR
	for rows.Next() {
		d := &models.DSAR{}
		var dataSourcesJSON, metadataJSON string
		if err := rows.Scan(
			&d.ID, &d.DSARID, &d.SubjectID, &d.FullName, &d.Email,
			(*string)(&d.Type), &d.Description, (*string)(&d.Status),
			&d.SLADays, &d.ReceivedAt, &d.Deadline, &d.CompletedAt,
			&d.AssignedTo, &dataSourcesJSON, &d.RecordsFound, &d.DataExportURL,
			&d.RejectionReason, &metadataJSON, &d.CreatedAt, &d.UpdatedAt,
		); err != nil {
			return nil, err
		}
		fromJSON(dataSourcesJSON, &d.DataSources)
		fromJSON(metadataJSON, &d.Metadata)
		dsars = append(dsars, d)
	}
	return dsars, rows.Err()
}

// GetDSARReporting returns aggregated DSAR metrics.
func (p *Postgres) GetDSARReporting(ctx context.Context) (*models.DSARStats, error) {
	type statRow struct {
		Total, Received, InProgress, Completed, Overdue int64
	}
	var row statRow
	err := p.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*),
			COUNT(CASE WHEN status = 'received' THEN 1 END),
			COUNT(CASE WHEN status IN ('validated', 'data_gathering', 'in_review') THEN 1 END),
			COUNT(CASE WHEN status IN ('completed', 'partially_fulfilled') THEN 1 END),
			COUNT(CASE WHEN deadline < NOW() AND status NOT IN ('completed', 'partially_fulfilled', 'denied') THEN 1 END)
		FROM dsars
	`).Scan(&row.Total, &row.Received, &row.InProgress, &row.Completed, &row.Overdue)
	if err != nil {
		return nil, err
	}
	return &models.DSARStats{
		Total:   row.Total,
		Received: row.Received,
		InProgress: row.InProgress,
		Completed: row.Completed,
		Overdue: row.Overdue,
	}, nil
}

// ===== Breach CRUD =====

// InsertBreach creates a new breach record.
func (p *Postgres) InsertBreach(ctx context.Context, breach *models.Breach) error {
	dataTypes, remediation, _ := toJSON(breach.DataTypes), toJSON(breach.RemediationSteps), (any)(nil)
	metadataJSON, _ := toJSON(breach.Metadata)

	_, err := p.Pool.Exec(ctx, `
		INSERT INTO breaches
			(id, breach_id, title, description, severity, status, detection_date,
			 notification_date, reported_at, reported_by, affected_persons,
			 data_types_affected, cause, nitda_deadline, nitda_notified_at,
			 nitda_notification_id, affected_notified_at, remediation_steps,
			 remediation_complete, resolution_date, impact_assessment, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
	`, breach.ID, breach.BreachID, breach.Title, breach.Description,
		string(breach.Severity), string(breach.Status), breach.DetectionDate,
		breach.NotificationDate, breach.ReportedAt, breach.Reporter,
		breach.AffectedPersons, string(dataTypes), breach.Cause, breach.NITDADeadline,
		breach.NITDANotifiedAt, breach.NITDANotificationID, breach.AffectedNotifiedAt,
		string(remediation), breach.RemediationComplete, breach.ResolutionDate,
		breach.ImpactAssessment, metadataJSON)
	return err
}

// GetBreach retrieves a breach by ID.
func (p *Postgres) GetBreach(ctx context.Context, breachID string) (*models.Breach, error) {
	b := &models.Breach{}
	var dataTypesJSON, remediationJSON, metadataJSON string
	err := p.Pool.QueryRow(ctx, `
		SELECT id, breach_id, title, description, severity, status, detection_date,
			notification_date, reported_at, reported_by, affected_persons,
			data_types_affected, cause, nitda_deadline, nitda_notified_at,
			nitda_notification_id, affected_notified_at, remediation_steps,
			remediation_complete, resolution_date, impact_assessment, metadata,
			created_at, updated_at
		FROM breaches WHERE breach_id = $1
	`, breachID).Scan(
		&b.ID, &b.BreachID, &b.Title, &b.Description, (*string)(&b.Severity),
		(*string)(&b.Status), &b.DetectionDate, &b.NotificationDate,
		&b.ReportedAt, &b.Reporter, &b.AffectedPersons,
		&dataTypesJSON, &b.Cause, &b.NITDADeadline, &b.NITDANotifiedAt,
		&b.NITDANotificationID, &b.AffectedNotifiedAt, &remediationJSON,
		&b.RemediationComplete, &b.ResolutionDate, &b.ImpactAssessment,
		&metadataJSON, &b.CreatedAt, &b.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	fromJSON(dataTypesJSON, &b.DataTypes)
	fromJSON(remediationJSON, &b.RemediationSteps)
	fromJSON(metadataJSON, &b.Metadata)
	return b, nil
}

// UpdateBreachStatus updates a breach's status and fields.
func (p *Postgres) UpdateBreach(ctx context.Context, breachID string, updates map[string]interface{}) error {
	setParts := []string{"updated_at = NOW()"}
	args := []interface{}{}
	argCount := 1
	for k, v := range updates {
		setParts = append(setParts, fmt.Sprintf("%s = $%d", k, argCount))
		args = append(args, v)
		argCount++
	}
	args = append(args, breachID)
	_, err := p.Pool.Exec(ctx, fmt.Sprintf("UPDATE breaches SET %s WHERE breach_id = $%d",
		strings.Join(setParts, ", "), argCount), args...)
	return err
}

// ListBreaches returns breaches with optional filtering.
func (p *Postgres) ListBreaches(ctx context.Context, status, severity string, limit, offset int) ([]*models.Breach, int64, error) {
	base := `SELECT id, breach_id, title, description, severity, status, detection_date,
		notification_date, reported_at, reported_by, affected_persons,
		data_types_affected, cause, nitda_deadline, nitda_notified_at,
		nitda_notification_id, affected_notified_at, remediation_steps,
		remediation_complete, resolution_date, impact_assessment, metadata,
		created_at, updated_at FROM breaches`

	var conditions []string
	var args []interface{}
	argCount := 1

	if status != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", argCount))
		args = append(args, status)
		argCount++
	}
	if severity != "" {
		conditions = append(conditions, fmt.Sprintf("severity = $%d", argCount))
		args = append(args, severity)
		argCount++
	}

	var whereClause string
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM breaches %s", whereClause)
	var total int64
	if err := p.Pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf("%s %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d",
		base, whereClause, argCount, argCount+1)
	args = append(args, limit, offset)

	rows, err := p.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var breaches []*models.Breach
	for rows.Next() {
		b := &models.Breach{}
		var dataTypesJSON, remediationJSON, metadataJSON string
		if err := rows.Scan(
			&b.ID, &b.BreachID, &b.Title, &b.Description, (*string)(&b.Severity),
			(*string)(&b.Status), &b.DetectionDate, &b.NotificationDate,
			&b.ReportedAt, &b.Reporter, &b.AffectedPersons,
			&dataTypesJSON, &b.Cause, &b.NITDADeadline, &b.NITDANotifiedAt,
			&b.NITDANotificationID, &b.AffectedNotifiedAt, &remediationJSON,
			&b.RemediationComplete, &b.ResolutionDate, &b.ImpactAssessment,
			&metadataJSON, &b.CreatedAt, &b.UpdatedAt,
		); err != nil {
			return nil, 0, err
		}
		fromJSON(dataTypesJSON, &b.DataTypes)
		fromJSON(remediationJSON, &b.RemediationSteps)
		fromJSON(metadataJSON, &b.Metadata)
		breaches = append(breaches, b)
	}
	return breaches, total, rows.Err()
}

// ===== DPIA CRUD =====

// InsertDPIA creates a new DPIA record.
func (p *Postgres) InsertDPIA(ctx context.Context, dpia *models.DPIA) error {
	dataCats, subjects, risks, mitigations, metadataJSON :=
		toJSON(dpia.DataCategories), toJSON(dpia.Subjects), toJSON(dpia.Risks), toJSON(dpia.Mitigations), toJSON(dpia.Metadata)

	_, err := p.Pool.Exec(ctx, `
		INSERT INTO dpias
			(id, dpia_id, title, description, processing_purpose, data_controller,
			 data_processor, risk_level, status, data_categories, data_subjects,
			 necessity_assessment, proportionality_assessment, risks, metadata,
			 dpo_reviewed, dpo_reviewed_at, dpo_comments, review_due_date)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
	`, dpia.ID, dpia.DPIAID, dpia.Title, dpia.Description, dpia.ProcessingPurpose,
		dpia.DataController, dpia.DataProcessor, string(dpia.RiskLevel), string(dpia.Status),
		string(dataCats), string(subjects), dpia.NecessityAssessment,
		dpia.ProportionalityAssessment, string(risks), metadataJSON,
		dpia.DPOReviewed, dpia.DPOReviewedAt, dpia.DPOComments, dpia.ReviewDueDate)
	return err
}

// UpdateDPIA updates a DPIA record.
func (p *Postgres) UpdateDPIA(ctx context.Context, dpia *models.DPIA) error {
	dataCats, subjects, risks, mitigations, metadataJSON :=
		toJSON(dpia.DataCategories), toJSON(dpia.Subjects), toJSON(dpia.Risks), toJSON(dpia.Mitigations), toJSON(dpia.Metadata)

	_, err := p.Pool.Exec(ctx, `
		UPDATE dpias SET
			title=$1, description=$2, processing_purpose=$3, data_controller=$4,
			data_processor=$5, risk_level=$6, status=$7, data_categories=$8,
			data_subjects=$9, necessity_assessment=$10, proportionality_assessment=$11,
			risks=$12, metadata=$13, dpo_reviewed=$14, dpo_reviewed_at=$15,
			dpo_comments=$16, review_due_date=$17, updated_at=NOW()
		WHERE id=$18
	`, dpia.Title, dpia.Description, dpia.ProcessingPurpose, dpia.DataController,
		dpia.DataProcessor, string(dpia.RiskLevel), string(dpia.Status),
		string(dataCats), string(subjects), dpia.NecessityAssessment,
		dpia.ProportionalityAssessment, string(risks), metadataJSON,
		dpia.DPOReviewed, dpia.DPOReviewedAt, dpia.DPOComments, dpia.ReviewDueDate, dpia.ID)
	return err
}

// GetDPIA retrieves a DPIA by its ID.
func (p *Postgres) GetDPIA(ctx context.Context, dpiaID string) (*models.DPIA, error) {
	d := &models.DPIA{}
	var dataCatsJSON, subjectsJSON, risksJSON, mitigationsJSON, metadataJSON string
	err := p.Pool.QueryRow(ctx, `
		SELECT id, dpia_id, title, description, processing_purpose, data_controller,
			data_processor, risk_level, status, data_categories, data_subjects,
			necessity_assessment, proportionality_assessment, risks, metadata,
			dpo_reviewed, dpo_reviewed_at, dpo_comments, review_due_date,
			created_at, updated_at
		FROM dpias WHERE dpia_id = $1
	`, dpiaID).Scan(
		&d.ID, &d.DPIAID, &d.Title, &d.Description, &d.ProcessingPurpose,
		&d.DataController, &d.DataProcessor, (*string)(&d.RiskLevel),
		(*string)(&d.Status), &dataCatsJSON, &subjectsJSON,
		&d.NecessityAssessment, &d.ProportionalityAssessment, &risksJSON,
		&metadataJSON, &d.DPOReviewed, &d.DPOReviewedAt, &d.DPOComments,
		&d.ReviewDueDate, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	fromJSON(dataCatsJSON, &d.DataCategories)
	fromJSON(subjectsJSON, &d.Subjects)
	fromJSON(risksJSON, &d.Risks)
	fromJSON(mitigationsJSON, &d.Mitigations)
	fromJSON(metadataJSON, &d.Metadata)
	return d, nil
}

// ListDPIAs returns DPIAs with optional filtering.
func (p *Postgres) ListDPIAs(ctx context.Context, status, riskLevel string, limit, offset int) ([]*models.DPIA, int64, error) {
	base := `SELECT id, dpia_id, title, description, processing_purpose, data_controller,
		data_processor, risk_level, status, data_categories, data_subjects,
		necessity_assessment, proportionality_assessment, risks, metadata,
		dpo_reviewed, dpo_reviewed_at, dpo_comments, review_due_date,
		created_at, updated_at FROM dpias`

	var conditions []string
	var args []interface{}
	argCount := 1

	if status != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", argCount))
		args = append(args, status)
		argCount++
	}
	if riskLevel != "" {
		conditions = append(conditions, fmt.Sprintf("risk_level = $%d", argCount))
		args = append(args, riskLevel)
		argCount++
	}

	var whereClause string
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM dpias %s", whereClause)
	var total int64
	if err := p.Pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf("%s %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d",
		base, whereClause, argCount, argCount+1)
	args = append(args, limit, offset)

	rows, err := p.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var dpias []*models.DPIA
	for rows.Next() {
		d := &models.DPIA{}
		var dataCatsJSON, subjectsJSON, risksJSON, mitigationsJSON, metadataJSON string
		if err := rows.Scan(
			&d.ID, &d.DPIAID, &d.Title, &d.Description, &d.ProcessingPurpose,
			&d.DataController, &d.DataProcessor, (*string)(&d.RiskLevel),
			(*string)(&d.Status), &dataCatsJSON, &subjectsJSON,
			&d.NecessityAssessment, &d.ProportionalityAssessment, &risksJSON,
			&metadataJSON, &d.DPOReviewed, &d.DPOReviewedAt, &d.DPOComments,
			&d.ReviewDueDate, &d.CreatedAt, &d.UpdatedAt,
		); err != nil {
			return nil, 0, err
		}
		fromJSON(dataCatsJSON, &d.DataCategories)
		fromJSON(subjectsJSON, &d.Subjects)
		fromJSON(risksJSON, &d.Risks)
		fromJSON(mitigationsJSON, &d.Mitigations)
		fromJSON(metadataJSON, &d.Metadata)
		dpias = append(dpias, d)
	}
	return dpias, total, rows.Err()
}

// ===== Retention Policies CRUD =====

// UpsertRetentionPolicy creates or updates a retention policy.
func (p *Postgres) UpsertRetentionPolicy(ctx context.Context, policy *models.RetentionPolicy) error {
	exceptionsJSON, _ := toJSON(policy.Exceptions)
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO retention_policies
			(id, name, description, data_category, retention_period, action,
			 auto_execute, last_executed_at, exceptions, is_active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (data_category) DO UPDATE SET
			name=EXCLUDED.name, description=EXCLUDED.description,
			retention_period=EXCLUDED.retention_period, action=EXCLUDED.action,
			auto_execute=EXCLUDED.auto_execute, last_executed_at=EXCLUDED.last_executed_at,
			exceptions=EXCLUDED.exceptions, is_active=EXCLUDED.is_active,
			updated_at=NOW()
	`, policy.ID, policy.Name, policy.Description, policy.DataCategory,
		policy.RetentionPeriod, policy.Action, policy.AutoExecute,
		policy.LastExecutedAt, string(exceptionsJSON), policy.IsActive)
	return err
}

// ListRetentionPolicies returns all retention policies.
func (p *Postgres) ListRetentionPolicies(ctx context.Context) ([]*models.RetentionPolicy, error) {
	rows, err := p.Pool.Query(ctx, `
		SELECT id, name, description, data_category, retention_period, action,
			auto_execute, last_executed_at, exceptions, is_active,
			created_at, updated_at
		FROM retention_policies ORDER BY data_category
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var policies []*models.RetentionPolicy
	for rows.Next() {
		p := &models.RetentionPolicy{}
		var exceptionsJSON string
		if err := rows.Scan(
			&p.ID, &p.Name, &p.Description, &p.DataCategory, &p.RetentionPeriod,
			&p.Action, &p.AutoExecute, &p.LastExecutedAt, &exceptionsJSON,
			&p.IsActive, &p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			return nil, err
		}
		fromJSON(exceptionsJSON, &p.Exceptions)
		policies = append(policies, p)
	}
	return policies, rows.Err()
}

// ===== Audit Reports =====

// CreateAuditReport generates and stores an annual audit report.
func (p *Postgres) CreateAuditReport(ctx context.Context, report *models.AuditReport) error {
	recommendations, _ := toJSON(report.Recommendations)
	metadataJSON, _ := toJSON(map[string]any{})

	_, err := p.Pool.Exec(ctx, `
		INSERT INTO audit_reports
			(year, report_date, overall_status, consent_records, active_consents,
			 withdrawn_consents, dsar_total, dsar_completed, dsar_on_time, dsar_overdue,
			 breach_total, breach_resolved, dpia_total, dpia_complete,
			 gap_analysis, recommendations, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
	`, report.Year, report.ReportDate, report.OverallStatus, report.ConsentRecords,
		report.ActiveConsents, report.WithdrawnConsents, report.DSARTotal,
		report.DSARCompleted, report.DSAROnTime, report.DSAROverdue,
		report.BreachTotal, report.BreachResolved, report.DPIATotal,
		report.DPIAComplete, report.GapAnalysis, string(recommendations), metadataJSON)
	return err
}

// GetLatestAuditReport retrieves the most recent audit report for a year.
func (p *Postgres) GetLatestAuditReport(ctx context.Context, year int) (*models.AuditReport, error) {
	report := &models.AuditReport{}
	var recommendationsJSON string
	err := p.Pool.QueryRow(ctx, `
		SELECT id, year, report_date, overall_status, consent_records, active_consents,
			withdrawn_consents, dsar_total, dsar_completed, dsar_on_time, dsar_overdue,
			breach_total, breach_resolved, dpia_total, dpia_complete, gap_analysis,
			recommendations, metadata, created_at
		FROM audit_reports WHERE year = $1 ORDER BY report_date DESC LIMIT 1
	`, year).Scan(
		&report.ID, &report.Year, &report.ReportDate, &report.OverallStatus,
		&report.ConsentRecords, &report.ActiveConsents, &report.WithdrawnConsents,
		&report.DSARTotal, &report.DSARCompleted, &report.DSAROnTime, &report.DSAROverdue,
		&report.BreachTotal, &report.BreachResolved, &report.DPIATotal, &report.DPIAComplete,
		&report.GapAnalysis, &recommendationsJSON, &metadataJSON, &report.GeneratedAt,
	)
	if err != nil {
		return nil, err
	}
	fromJSON(recommendationsJSON, &report.Recommendations)
	return report, nil
}

// GenerateAuditReportData computes all metrics needed for an audit report.
func (p *Postgres) GenerateAuditReportData(ctx context.Context, year int) (*models.AuditReport, error) {
	report := &models.AuditReport{
		Year:      year,
		ReportDate: time.Now().UTC(),
	}

	// Consent stats
	err := p.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
			COUNT(CASE WHEN withdrawn = false THEN 1 END),
			COUNT(CASE WHEN withdrawn = true THEN 1 END)
		FROM consents
	`).Scan(&report.ConsentRecords, &report.ActiveConsents, &report.WithdrawnConsents)
	if err != nil {
		return nil, err
	}

	// DSAR stats
	err = p.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
			COUNT(CASE WHEN status IN ('completed', 'partially_fulfilled') THEN 1 END),
			COUNT(CASE WHEN completed_at IS NOT NULL AND EXTRACT(DAY FROM completed_at - received_at) <= sla_days THEN 1 END),
			COUNT(CASE WHEN deadline < NOW() AND status NOT IN ('completed', 'partially_fulfilled', 'denied') THEN 1 END)
		FROM dsars WHERE EXTRACT(YEAR FROM received_at) = $1
	`, year).Scan(&report.DSARTotal, &report.DSARCompleted, &report.DSAROnTime, &report.DSAROverdue)
	if err != nil {
		return nil, err
	}

	// Breach stats
	err = p.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
			COUNT(CASE WHEN status IN ('resolved', 'closed') THEN 1 END)
		FROM breaches
	`).Scan(&report.BreachTotal, &report.BreachResolved)
	if err != nil {
		return nil, err
	}

	// DPIA stats
	err = p.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
			COUNT(CASE WHEN status IN ('complete', 'reviewed', 'signed_off') THEN 1 END)
		FROM dpias
	`).Scan(&report.DPIATotal, &report.DPIAComplete)
	if err != nil {
		return nil, err
	}

	// Determine overall compliance
	complianceScore := float64(0)
	if report.ConsentRecords > 0 {
		complianceScore += float64(report.ActiveConsents) / float64(report.ConsentRecords) * 25
	}
	if report.DSARTotal > 0 {
		complianceScore += float64(report.DSAROnTime) / float64(report.DSARTotal) * 25
	} else {
		complianceScore += 25
	}
	if report.BreachTotal > 0 {
		complianceScore += float64(report.BreachResolved) / float64(report.BreachTotal) * 25
	}
	if report.DPIATotal > 0 {
		complianceScore += float64(report.DPIAComplete) / float64(report.DPIATotal) * 25
	} else {
		complianceScore += 25
	}

	report.OverallStatus = "compliant"
	if complianceScore < 80 {
		report.OverallStatus = "partially_compliant"
	}
	if complianceScore < 50 {
		report.OverallStatus = "non_compliant"
	}

	return report, nil
}

// ===== Compliance Metrics =====

// GetComplianceMetrics returns aggregated compliance statistics.
func (p *Postgres) GetComplianceMetrics(ctx context.Context) (*models.ComplianceMetrics, error) {
	metrics := &models.ComplianceMetrics{}

	// Consent stats
	if err := p.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
			COUNT(CASE WHEN withdrawn = false THEN 1 END),
			COUNT(CASE WHEN withdrawn = true THEN 1 END),
			COUNT(CASE WHEN created_at >= NOW() - INTERVAL '90 days' AND withdrawn = false THEN 1 END)
		FROM consents
	`).Scan(&metrics.ConsentStats.Total, &metrics.ConsentStats.Active,
		&metrics.ConsentStats.Withdrawn, &metrics.ConsentStats.Expiring); err != nil {
		return nil, err
	}

	// DSAR stats
	if err := p.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
			COUNT(CASE WHEN status = 'received' THEN 1 END),
			COUNT(CASE WHEN status IN ('validated', 'data_gathering', 'in_review') THEN 1 END),
			COUNT(CASE WHEN status IN ('completed', 'partially_fulfilled') THEN 1 END),
			COUNT(CASE WHEN deadline < NOW() AND status NOT IN ('completed', 'partially_fulfilled', 'denied') THEN 1 END)
		FROM dsars
	`).Scan(&metrics.DSARStats.Total, &metrics.DSARStats.Received,
		&metrics.DSARStats.InProgress, &metrics.DSARStats.Completed, &metrics.DSARStats.Overdue); err != nil {
		return nil, err
	}

	// Breach stats
	if err := p.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
			COUNT(CASE WHEN status NOT IN ('resolved', 'closed') THEN 1 END),
			COUNT(CASE WHEN status IN ('resolved', 'closed') THEN 1 END),
			COUNT(CASE WHEN severity = 'critical' THEN 1 END)
		FROM breaches
	`).Scan(&metrics.BreachStats.Total, &metrics.BreachStats.Active,
		&metrics.BreachStats.Resolved, &metrics.BreachStats.Critical); err != nil {
		return nil, err
	}

	// DPIA stats
	if err := p.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
			COUNT(CASE WHEN status IN ('complete', 'reviewed', 'signed_off') THEN 1 END),
			COUNT(CASE WHEN risk_level = 'high' THEN 1 END)
		FROM dpias
	`).Scan(&metrics.DPIAStats.Total, &metrics.DPIAStats.Complete, &metrics.DPIAStats.HighRisk); err != nil {
		return nil, err
	}

	// Compliance score calculation
	score := 0.0
	if metrics.ConsentStats.Total > 0 {
		score += float64(metrics.ConsentStats.Active) / float64(metrics.ConsentStats.Total) * 25
	} else {
		score += 25
	}
	if metrics.DSARStats.Total > 0 {
		onTime := metrics.DSARStats.Completed - metrics.DSARStats.Overdue
		if onTime < 0 {
			onTime = 0
		}
		score += float64(onTime) / float64(metrics.DSARStats.Total) * 25
	} else {
		score += 25
	}
	if metrics.BreachStats.Total > 0 {
		score += float64(metrics.BreachStats.Resolved) / float64(metrics.BreachStats.Total) * 25
	} else {
		score += 25
	}
	if metrics.DPIAStats.Total > 0 {
		score += float64(metrics.DPIAStats.Complete) / float64(metrics.DPIAStats.Total) * 25
	} else {
		score += 25
	}
	metrics.ComplianceScore = score

	// Last audit year
	var lastYear int
	err := p.Pool.QueryRow(ctx, "SELECT MAX(year) FROM audit_reports").Scan(&lastYear)
	if err == nil {
		metrics.LastAuditYear = lastYear
	}

	return metrics, nil
}
