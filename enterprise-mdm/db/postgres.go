package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/insureportal/enterprise_mdm/config"
	"github.com/insureportal/enterprise_mdm/models"
	"go.uber.org/zap"
)

type PostgreSQL struct {
	db *sql.DB
}

func NewPostgreSQL(cfg *config.Config) (*PostgreSQL, error) {
	db, err := sql.Open("postgres", cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("postgres connect: %w", err)
	}
	db.SetMaxOpenConns(cfg.DBMaxConns)
	db.SetMaxIdleConns(cfg.DBMinConns)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("postgres ping: %w", err)
	}
	zap.L().Info("PostgreSQL connected", zap.String("host", cfg.DBHost), zap.Int("port", cfg.DBPort))
	pg := &PostgreSQL{db: db}
	if err := pg.Migrate(context.Background()); err != nil {
		return nil, fmt.Errorf("migration: %w", err)
	}
	return pg, nil
}

func (p *PostgreSQL) Close() error { return p.db.Close() }

func (p *PostgreSQL) Migrate(ctx context.Context) error {
	tables := []string{
		`CREATE TABLE IF NOT EXISTS golden_records (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			entity_id VARCHAR(255) NOT NULL,
			entity_type VARCHAR(30) NOT NULL,
			source_system VARCHAR(100),
			source_record_id VARCHAR(255),
			name VARCHAR(255),
			email VARCHAR(255),
			phone VARCHAR(50),
			phone_number VARCHAR(20),
			nin VARCHAR(50),
			dob DATE,
			address TEXT,
			city VARCHAR(100),
			state VARCHAR(100),
			country VARCHAR(100),
			quality_score REAL DEFAULT 0,
			status VARCHAR(20) DEFAULT 'active',
			is_golden BOOLEAN DEFAULT FALSE,
			primary_source VARCHAR(100),
			last_synced_at TIMESTAMP WITH TIME ZONE,
			record_count INTEGER DEFAULT 1,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			UNIQUE(entity_id, entity_type)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_gd_entity ON golden_records(entity_type, entity_id)`,
		`CREATE INDEX IF NOT EXISTS idx_gd_nin ON golden_records(nin)`,
		`CREATE INDEX IF NOT EXISTS idx_gd_email ON golden_records(email)`,
		`CREATE INDEX IF NOT EXISTS idx_gd_status ON golden_records(status)`,

		`CREATE TABLE IF NOT EXISTS record_sources (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			golden_record_id UUID NOT NULL REFERENCES golden_records(id),
			source_system VARCHAR(100) NOT NULL,
			source_record_id VARCHAR(255) NOT NULL,
			entity_name VARCHAR(255),
			entity_email VARCHAR(255),
			entity_phone VARCHAR(50),
			nin VARCHAR(50),
			dob DATE,
			address TEXT,
			match_score REAL DEFAULT 0,
			synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			status VARCHAR(20) DEFAULT 'synced',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_rs_golden ON record_sources(golden_record_id)`,
		`CREATE INDEX IF NOT EXISTS idx_rs_system ON record_sources(source_system)`,

		`CREATE TABLE IF NOT EXISTS merge_candidates (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			golden_record_id UUID NOT NULL REFERENCES golden_records(id),
			candidate_record_id VARCHAR(255),
			source_system VARCHAR(100),
			source_record_id VARCHAR(255),
			match_score REAL DEFAULT 0,
			match_reasons TEXT,
			is_approved BOOLEAN DEFAULT FALSE,
			approved_by UUID,
			approved_at TIMESTAMP WITH TIME ZONE,
			action VARCHAR(20) DEFAULT 'merge',
			status VARCHAR(20) DEFAULT 'pending',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_mc_golden ON merge_candidates(golden_record_id)`,
		`CREATE INDEX IF NOT EXISTS idx_mc_status ON merge_candidates(status)`,

		`CREATE TABLE IF NOT EXISTS data_quality_metrics (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			entity_id VARCHAR(255) NOT NULL,
			entity_type VARCHAR(30) NOT NULL,
			overall_score REAL DEFAULT 0,
			completeness REAL DEFAULT 0,
			accuracy REAL DEFAULT 0,
			consistency REAL DEFAULT 0,
			timeliness REAL DEFAULT 0,
			uniqueness REAL DEFAULT 0,
			validity REAL DEFAULT 0,
			source_count INTEGER DEFAULT 0,
			issue_count INTEGER DEFAULT 0,
			last_assessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			status VARCHAR(20) DEFAULT 'pass'
		)`,
		`CREATE INDEX IF NOT EXISTS idx_dq_entity ON data_quality_metrics(entity_type, entity_id)`,

		`CREATE TABLE IF NOT EXISTS data_issues (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			entity_id VARCHAR(255) NOT NULL,
			entity_type VARCHAR(30) NOT NULL,
			issue_type VARCHAR(50) NOT NULL,
			severity VARCHAR(20) DEFAULT 'minor',
			field_name VARCHAR(100),
			description TEXT,
			current_value TEXT,
			expected_value TEXT,
			is_resolved BOOLEAN DEFAULT FALSE,
			resolved_at TIMESTAMP WITH TIME ZONE,
			resolved_by VARCHAR(255),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_issues_entity ON data_issues(entity_id)`,
		`CREATE INDEX IF NOT EXISTS idx_issues_type ON data_issues(issue_type)`,
		`CREATE INDEX IF NOT EXISTS idx_issues_resolved ON data_issues(is_resolved)`,

		`CREATE TABLE IF NOT EXISTS sync_logs (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			sync_id VARCHAR(50) NOT NULL,
			source_system VARCHAR(100) NOT NULL,
			target_system VARCHAR(100),
			entity_type VARCHAR(30) NOT NULL,
			direction VARCHAR(20) DEFAULT 'inbound',
			status VARCHAR(30) DEFAULT 'started',
			records_total INTEGER DEFAULT 0,
			records_created INTEGER DEFAULT 0,
			records_updated INTEGER DEFAULT 0,
			records_deleted INTEGER DEFAULT 0,
			records_failed INTEGER DEFAULT 0,
			error_message TEXT,
			started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			completed_at TIMESTAMP WITH TIME ZONE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_sync_id ON sync_logs(sync_id)`,
		`CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_logs(status)`,

		`CREATE TABLE IF NOT EXISTS data_lineage (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			entity_id VARCHAR(255) NOT NULL,
			entity_type VARCHAR(30) NOT NULL,
			source_system VARCHAR(100) NOT NULL,
			source_field VARCHAR(100),
			target_field VARCHAR(100),
			transform_rule TEXT,
			consumers TEXT,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_lineage_entity ON data_lineage(entity_type, entity_id)`,

		`CREATE TABLE IF NOT EXISTS agent_records (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			agent_code VARCHAR(50) UNIQUE NOT NULL,
			agent_name VARCHAR(255) NOT NULL,
			license_no VARCHAR(100),
			license_expiry DATE,
			email VARCHAR(255),
			phone VARCHAR(50),
			address TEXT,
			city VARCHAR(100),
			state VARCHAR(100),
			status VARCHAR(20) DEFAULT 'active',
			commission_rate REAL DEFAULT 0,
			product_types TEXT,
			region VARCHAR(100),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_agents_status ON agent_records(status)`,
		`CREATE INDEX IF NOT EXISTS idx_agents_code ON agent_records(agent_code)`,

		`CREATE TABLE IF NOT EXISTS product_records (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			product_code VARCHAR(50) UNIQUE NOT NULL,
			product_name VARCHAR(255) NOT NULL,
			category VARCHAR(50),
			risk_type VARCHAR(50),
			description TEXT,
			is_active BOOLEAN DEFAULT TRUE,
			coverage_min REAL DEFAULT 0,
			coverage_max REAL DEFAULT 0,
			premium_range TEXT,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_products_code ON product_records(product_code)`,
		`CREATE INDEX IF NOT EXISTS idx_products_active ON product_records(is_active)`,
	}

	for _, q := range tables {
		if _, err := p.db.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("migrate '%s...': %w", q[:50], err)
		}
	}
	zap.L().Info("Enterprise MDM migrations completed")
	return nil
}

// --- Golden Record CRUD ---
func (p *PostgreSQL) UpsertGoldenRecord(ctx context.Context, gr *models.GoldenRecord) error {
	if gr.ID == "" {
		gr.ID = uuid.New().String()
	}
	gr.UpdatedAt = time.Now()
	query := `INSERT INTO golden_records (id,entity_id,entity_type,source_system,source_record_id,
		name,email,phone,phone_number,nin,dob,address,city,state,country,
		quality_score,status,is_golden,primary_source,record_count)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
			$16,$17,$18,$19,$20)
		ON CONFLICT (entity_id, entity_type) DO UPDATE SET
			name=EXCLUDED.name,email=EXCLUDED.email,phone=EXCLUDED.phone,
			quality_score=EXCLUDED.quality_score,status=EXCLUDED.status,
			primary_source=EXCLUDED.primary_source,last_synced_at=NOW(),
			updated_at=NOW(),record_count=golden_records.record_count+1`
	_, err := p.db.ExecContext(ctx, query, gr.ID, gr.EntityID, string(gr.EntityType),
		gr.SourceSystem, gr.SourceRecordID, gr.Name, gr.Email, gr.Phone,
		gr.PhoneNumber, gr.NIN, gr.DOB, gr.Address, gr.City, gr.State, gr.Country,
		gr.QualityScore, gr.Status, gr.IsGolden, gr.PrimarySource, gr.RecordCount)
	return err
}

func (p *PostgreSQL) GetGoldenRecord(ctx context.Context, entityID string, entityType models.EntityType) (*models.GoldenRecord, error) {
	var gr models.GoldenRecord
	q := `SELECT id,entity_id,entity_type,source_system,source_record_id,name,email,phone,
		phone_number,nin,dob,address,city,state,country,quality_score,status,is_golden,
		primary_source,last_synced_at,record_count,created_at,updated_at
		FROM golden_records WHERE entity_id=$1 AND entity_type=$2`
	err := p.db.QueryRowContext(ctx, q, entityID, string(entityType)).Scan(
		&gr.ID, &gr.EntityID, &gr.EntityType, &gr.SourceSystem, &gr.SourceRecordID,
		&gr.Name, &gr.Email, &gr.Phone, &gr.PhoneNumber, &gr.NIN, &gr.DOB,
		&gr.Address, &gr.City, &gr.State, &gr.Country, &gr.QualityScore,
		&gr.Status, &gr.IsGolden, &gr.PrimarySource, &gr.LastSyncedAt,
		&gr.RecordCount, &gr.CreatedAt, &gr.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &gr, nil
}

func (p *PostgreSQL) ListGoldenRecords(ctx context.Context, entityType models.EntityType, status string, limit, offset int) ([]models.GoldenRecord, error) {
	query := `SELECT id,entity_id,entity_type,source_system,source_record_id,name,email,phone,
		phone_number,nin,dob,address,city,state,country,quality_score,status,is_golden,
		primary_source,last_synced_at,record_count,created_at,updated_at
		FROM golden_records WHERE 1=1`
	args := []interface{}{}
	pos := 1
	if entityType != "" {
		query += fmt.Sprintf(" AND entity_type=$%d", pos)
		args = append(args, string(entityType))
		pos++
	}
	if status != "" {
		query += fmt.Sprintf(" AND status=$%d", pos)
		args = append(args, status)
		pos++
	}
	query += " ORDER BY quality_score DESC"
	if limit > 0 { query += fmt.Sprintf(" LIMIT $%d", pos); args = append(args, limit); pos++ }
	if offset > 0 { query += fmt.Sprintf(" OFFSET $%d", pos); args = append(args, offset) }

	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanGoldenRecords(rows)
}

func (p *PostgreSQL) CountByEntityType(ctx context.Context) (map[string]models.EntityQuality, error) {
	rows, err := p.db.QueryContext(ctx, `SELECT entity_type, COUNT(*), SUM(CASE WHEN is_golden THEN 1 ELSE 0 END), 
		AVG(quality_score), SUM(duplicates_count) FROM (SELECT entity_type, COUNT(*) as cnt FROM golden_records GROUP BY entity_type) g
		GROUP BY entity_type`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]models.EntityQuality)
	for rows.Next() {
		var et EntityType
		var total, golden int
		var avgScore float64
		if err := rows.Scan(&et, &total, &golden, &avgScore, &result[string(et)].Duplicates); err != nil {
			return nil, err
		}
		result[string(et)] = models.EntityQuality{
			EntityType:      et,
			TotalRecords:    total,
			GoldenRecords:   golden,
			QualityScore:    avgScore,
		}
	}
	return result, nil
}

// --- Record Source CRUD ---
func (p *PostgreSQL) CreateRecordSource(ctx context.Context, rs *models.RecordSource) error {
	rs.ID = uuid.New().String()
	rs.SyncedAt = time.Now()
	rs.CreatedAt = time.Now()
	query := `INSERT INTO record_sources (id,golden_record_id,source_system,source_record_id,
		entity_name,entity_email,entity_phone,nin,dob,address,match_score,synced_at,status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`
	_, err := p.db.ExecContext(ctx, query, rs.ID, rs.GoldenRecordID, rs.SourceSystem,
		rs.SourceRecordID, rs.EntityName, rs.EntityEmail, rs.EntityPhone, rs.NIN,
		rs.DOB, rs.Address, rs.MatchScore, rs.SyncedAt, rs.Status)
	return err
}

func (p *PostgreSQL) GetRecordSources(ctx context.Context, goldenRecordID string) ([]models.RecordSource, error) {
	rows, err := p.db.QueryContext(ctx,
		`SELECT id,golden_record_id,source_system,source_record_id,entity_name,entity_email,
			entity_phone,nin,dob,address,match_score,synced_at,status,created_at
			FROM record_sources WHERE golden_record_id=$1 ORDER BY synced_at DESC`, goldenRecordID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRecordSources(rows)
}

// --- Merge Candidate CRUD ---
func (p *PostgreSQL) CreateMergeCandidate(ctx context.Context, mc *models.MergeCandidate) error {
	mc.ID = uuid.New().String()
	mc.CreatedAt = time.Now()
	if mc.Status == "" {
		mc.Status = "pending"
	}
	query := `INSERT INTO merge_candidates (id,golden_record_id,candidate_record_id,source_system,
		source_record_id,match_score,match_reasons,is_approved,approved_by,approved_at,action,status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`
	_, err := p.db.ExecContext(ctx, query, mc.ID, mc.GoldenRecordID, mc.CandidateRecordID,
		mc.SourceSystem, mc.SourceRecordID, mc.MatchScore, mc.MatchReasons,
		mc.IsApproved, mc.ApprovedBy, mc.ApprovedAt, mc.Action, mc.Status)
	return err
}

func (p *PostgreSQL) GetPendingMergeCandidates(ctx context.Context, limit int) ([]models.MergeCandidate, error) {
	query := `SELECT id,golden_record_id,candidate_record_id,source_system,source_record_id,
		match_score,match_reasons,is_approved,approved_by,approved_at,action,status,created_at
		FROM merge_candidates WHERE status='pending'`
	args := []interface{}{}
	pos := 1
	if limit > 0 {
		query += fmt.Sprintf(" ORDER BY match_score DESC LIMIT $%d", pos)
		args = append(args, limit)
	}
	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMergeCandidates(rows)
}

func (p *PostgreSQL) ApproveMerge(ctx context.Context, candidateID, approvedBy string) error {
	now := time.Now()
	_, err := p.db.ExecContext(ctx,
		`UPDATE merge_candidates SET is_approved=true, approved_by=$1, approved_at=$2,
		 status='approved', action='merge' WHERE id=$3`, approvedBy, &now, candidateID)
	return err
}

func (p *PostgreSQL) CountMergeCandidates(ctx context.Context, status string) (int, error) {
	query := `SELECT COUNT(*) FROM merge_candidates`
	args := []interface{}{}
	pos := 1
	if status != "" {
		query += fmt.Sprintf(" WHERE status=$%d", pos)
		args = append(args, status)
	}
	var count int
	err := p.db.QueryRowContext(ctx, query, args...).Scan(&count)
	return count, err
}

// --- Data Quality Metrics ---
func (p *PostgreSQL) UpsertQualityMetric(ctx context.Context, qm *models.DataQualityMetric) error {
	qm.LastAssessedAt = time.Now()
	query := `INSERT INTO data_quality_metrics (entity_id,entity_type,overall_score,completeness,
		accuracy,consistency,timeliness,uniqueness,validity,source_count,issue_count,last_assessed_at,status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT DO NOTHING`
	_, err := p.db.ExecContext(ctx, query, qm.EntityID, string(qm.EntityType), qm.OverallScore,
		qm.Completeness, qm.Accuracy, qm.Consistency, qm.Timeliness, qm.Uniqueness,
		qm.Validity, qm.SourceCount, qm.IssueCount, qm.LastAssessedAt, qm.Status)
	return err
}

func (p *PostgreSQL) GetQualityMetrics(ctx context.Context, entityType models.EntityType, entityID string) (*models.DataQualityMetric, error) {
	var qm models.DataQualityMetric
	q := `SELECT id,entity_id,entity_type,overall_score,completeness,accuracy,consistency,
		timeliness,uniqueness,validity,source_count,issue_count,last_assessed_at,status
		FROM data_quality_metrics WHERE entity_id=$1 AND entity_type=$2`
	err := p.db.QueryRowContext(ctx, q, entityID, string(entityType)).Scan(
		&qm.ID, &qm.EntityID, &qm.EntityType, &qm.OverallScore, &qm.Completeness,
		&qm.Accuracy, &qm.Consistency, &qm.Timeliness, &qm.Uniqueness, &qm.Validity,
		&qm.SourceCount, &qm.IssueCount, &qm.LastAssessedAt, &qm.Status)
	if err != nil {
		return nil, err
	}
	return &qm, nil
}

// --- Data Issues ---
func (p *PostgreSQL) CreateDataIssue(ctx context.Context, di *models.DataIssue) error {
	di.ID = uuid.New().String()
	di.CreatedAt = time.Now()
	query := `INSERT INTO data_issues (id,entity_id,entity_type,issue_type,severity,field_name,
		description,current_value,expected_value,is_resolved,resolved_at,resolved_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`
	_, err := p.db.ExecContext(ctx, query, di.ID, di.EntityID, string(di.EntityType),
		di.IssueType, di.Severity, di.FieldName, di.Description, di.CurrentValue,
		di.ExpectedValue, di.IsResolved, di.ResolvedAt, di.ResolvedBy)
	return err
}

func (p *PostgreSQL) GetOpenIssues(ctx context.Context, entityType models.EntityType, severity string) ([]models.DataIssue, error) {
	query := `SELECT id,entity_id,entity_type,issue_type,severity,field_name,description,
		current_value,expected_value,is_resolved,resolved_at,resolved_by,created_at
		FROM data_issues WHERE is_resolved=false AND entity_type=$1`
	args := []interface{}{string(entityType)}
	pos := 2
	if severity != "" {
		query += fmt.Sprintf(" AND severity=$%d", pos)
		args = append(args, severity)
	}
	query += " ORDER BY severity ASC, created_at DESC"
	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanDataIssues(rows)
}

func (p *PostgreSQL) ResolveIssue(ctx context.Context, issueID, resolvedBy string) error {
	now := time.Now()
	_, err := p.db.ExecContext(ctx,
		`UPDATE data_issues SET is_resolved=true, resolved_at=$1, resolved_by=$2 WHERE id=$3`,
		&now, resolvedBy, issueID)
	return err
}

// --- Sync Logs ---
func (p *PostgreSQL) CreateSyncLog(ctx context.Context, sl *models.SyncLog) error {
	sl.ID = uuid.New().String()
	sl.StartedAt = time.Now()
	sl.CreatedAt = time.Now()
	query := `INSERT INTO sync_logs (id,sync_id,source_system,target_system,entity_type,
		direction,status,records_total,records_created,records_updated,records_deleted,
		records_failed,error_message,started_at,completed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`
	_, err := p.db.ExecContext(ctx, query, sl.ID, sl.SyncID, sl.SourceSystem, sl.TargetSystem,
		string(sl.EntityType), sl.Direction, sl.Status, sl.RecordsTotal, sl.RecordsCreated,
		sl.RecordsUpdated, sl.RecordsDeleted, sl.RecordsFailed, sl.ErrorMessage,
		sl.StartedAt, sl.CompletedAt)
	return err
}

func (p *PostgreSQL) CompleteSyncLog(ctx context.Context, syncID string, status string, errMsg string) error {
	now := time.Now()
	_, err := p.db.ExecContext(ctx,
		`UPDATE sync_logs SET status=$1, completed_at=$2, error_message=$3 WHERE sync_id=$4`,
		status, &now, errMsg, syncID)
	return err
}

func (p *PostgreSQL) GetRecentSyncs(ctx context.Context, limit int) ([]models.SyncLog, error) {
	query := `SELECT id,sync_id,source_system,target_system,entity_type,direction,status,
		records_total,records_created,records_updated,records_deleted,records_failed,
		error_message,started_at,completed_at,created_at FROM sync_logs ORDER BY started_at DESC`
	if limit > 0 { query += fmt.Sprintf(" LIMIT $%d", limit+1) }
	rows, err := p.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSyncLogs(rows)
}

// --- Agent Records ---
func (p *PostgreSQL) CreateAgentRecord(ctx context.Context, ar *models.AgentRecord) error {
	ar.ID = uuid.New().String()
	ar.CreatedAt = time.Now()
	ar.UpdatedAt = time.Now()
	query := `INSERT INTO agent_records (id,agent_code,agent_name,license_no,license_expiry,
		email,phone,address,city,state,status,commission_rate,product_types,region)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`
	_, err := p.db.ExecContext(ctx, query, ar.ID, ar.AgentCode, ar.AgentName, ar.LicenseNo,
		ar.LicenseExpiry, ar.Email, ar.Phone, ar.Address, ar.City, ar.State,
		ar.Status, ar.CommissionRate, ar.ProductTypes, ar.Region)
	return err
}

func (p *PostgreSQL) GetAgentRecord(ctx context.Context, code string) (*models.AgentRecord, error) {
	var ar models.AgentRecord
	q := `SELECT id,agent_code,agent_name,license_no,license_expiry,email,phone,address,
		city,state,status,commission_rate,product_types,region,created_at,updated_at
		FROM agent_records WHERE agent_code=$1`
	err := p.db.QueryRowContext(ctx, q, code).Scan(
		&ar.ID, &ar.AgentCode, &ar.AgentName, &ar.LicenseNo, &ar.LicenseExpiry,
		&ar.Email, &ar.Phone, &ar.Address, &ar.City, &ar.State, &ar.Status,
		&ar.CommissionRate, &ar.ProductTypes, &ar.Region, &ar.CreatedAt, &ar.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &ar, nil
}

func (p *PostgreSQL) ListAgentRecords(ctx context.Context, status string, limit, offset int) ([]models.AgentRecord, error) {
	query := `SELECT id,agent_code,agent_name,license_no,license_expiry,email,phone,address,
		city,state,status,commission_rate,product_types,region,created_at,updated_at
		FROM agent_records`
	args := []interface{}{}
	pos := 1
	if status != "" {
		query += fmt.Sprintf(" WHERE status=$%d", pos)
		args = append(args, status)
		pos++
	}
	query += " ORDER BY agent_name"
	if limit > 0 { query += fmt.Sprintf(" LIMIT $%d", pos); args = append(args, limit); pos++ }
	if offset > 0 { query += fmt.Sprintf(" OFFSET $%d", pos); args = append(args, offset) }

	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAgentRecords(rows)
}

// --- Product Records ---
func (p *PostgreSQL) CreateProductRecord(ctx context.Context, pr *models.ProductRecord) error {
	pr.ID = uuid.New().String()
	pr.CreatedAt = time.Now()
	pr.UpdatedAt = time.Now()
	query := `INSERT INTO product_records (id,product_code,product_name,category,risk_type,
		description,is_active,coverage_min,coverage_max,premium_range)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`
	_, err := p.db.ExecContext(ctx, query, pr.ID, pr.ProductCode, pr.ProductName, pr.Category,
		pr.RiskType, pr.Description, pr.IsActive, pr.CoverageMin, pr.CoverageMax, pr.PremiumRange)
	return err
}

func (p *PostgreSQL) GetProductRecord(ctx context.Context, code string) (*models.ProductRecord, error) {
	var pr models.ProductRecord
	q := `SELECT id,product_code,product_name,category,risk_type,description,is_active,
		coverage_min,coverage_max,premium_range,created_at,updated_at
		FROM product_records WHERE product_code=$1`
	err := p.db.QueryRowContext(ctx, q, code).Scan(
		&pr.ID, &pr.ProductCode, &pr.ProductName, &pr.Category, &pr.RiskType,
		&pr.Description, &pr.IsActive, &pr.CoverageMin, &pr.CoverageMax,
		&pr.PremiumRange, &pr.CreatedAt, &pr.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &pr, nil
}

func (p *PostgreSQL) ListProductRecords(ctx context.Context, isActive bool) ([]models.ProductRecord, error) {
	query := `SELECT id,product_code,product_name,category,risk_type,description,is_active,
		coverage_min,coverage_max,premium_range,created_at,updated_at
		FROM product_records`
	if !isActive {
		query += " WHERE is_active=true"
	}
	query += " ORDER BY product_name"
	rows, err := p.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanProductRecords(rows)
}

// --- Helpers ---
func scanGoldenRecords(rows *sql.Rows) ([]models.GoldenRecord, error) {
	var records []models.GoldenRecord
	for rows.Next() {
		var gr models.GoldenRecord
		err := rows.Scan(&gr.ID, &gr.EntityID, &gr.EntityType, &gr.SourceSystem, &gr.SourceRecordID,
			&gr.Name, &gr.Email, &gr.Phone, &gr.PhoneNumber, &gr.NIN, &gr.DOB,
			&gr.Address, &gr.City, &gr.State, &gr.Country, &gr.QualityScore,
			&gr.Status, &gr.IsGolden, &gr.PrimarySource, &gr.LastSyncedAt,
			&gr.RecordCount, &gr.CreatedAt, &gr.UpdatedAt)
		if err != nil {
			return nil, err
		}
		records = append(records, gr)
	}
	return records, nil
}

func scanRecordSources(rows *sql.Rows) ([]models.RecordSource, error) {
	var rs []models.RecordSource
	for rows.Next() {
		var r models.RecordSource
		err := rows.Scan(&r.ID, &r.GoldenRecordID, &r.SourceSystem, &r.SourceRecordID,
			&r.EntityName, &r.EntityEmail, &r.EntityPhone, &r.NIN, &r.DOB,
			&r.Address, &r.MatchScore, &r.SyncedAt, &r.Status, &r.CreatedAt)
		if err != nil {
			return nil, err
		}
		rs = append(rs, r)
	}
	return rs, nil
}

func scanMergeCandidates(rows *sql.Rows) ([]models.MergeCandidate, error) {
	var mcs []models.MergeCandidate
	for rows.Next() {
		var mc models.MergeCandidate
		err := rows.Scan(&mc.ID, &mc.GoldenRecordID, &mc.CandidateRecordID, &mc.SourceSystem,
			&mc.SourceRecordID, &mc.MatchScore, &mc.MatchReasons, &mc.IsApproved,
			&mc.ApprovedBy, &mc.ApprovedAt, &mc.Action, &mc.Status, &mc.CreatedAt)
		if err != nil {
			return nil, err
		}
		mcs = append(mcs, mc)
	}
	return mcs, nil
}

func scanDataIssues(rows *sql.Rows) ([]models.DataIssue, error) {
	var issues []models.DataIssue
	for rows.Next() {
		var di models.DataIssue
		err := rows.Scan(&di.ID, &di.EntityID, &di.EntityType, &di.IssueType, &di.Severity,
			&di.FieldName, &di.Description, &di.CurrentValue, &di.ExpectedValue,
			&di.IsResolved, &di.ResolvedAt, &di.ResolvedBy, &di.CreatedAt)
		if err != nil {
			return nil, err
		}
		issues = append(issues, di)
	}
	return issues, nil
}

func scanSyncLogs(rows *sql.Rows) ([]models.SyncLog, error) {
	var logs []models.SyncLog
	for rows.Next() {
		var sl models.SyncLog
		err := rows.Scan(&sl.ID, &sl.SyncID, &sl.SourceSystem, &sl.TargetSystem, &sl.EntityType,
			&sl.Direction, &sl.Status, &sl.RecordsTotal, &sl.RecordsCreated, &sl.RecordsUpdated,
			&sl.RecordsDeleted, &sl.RecordsFailed, &sl.ErrorMessage, &sl.StartedAt,
			&sl.CompletedAt, &sl.CreatedAt)
		if err != nil {
			return nil, err
		}
		logs = append(logs, sl)
	}
	return logs, nil
}

func scanAgentRecords(rows *sql.Rows) ([]models.AgentRecord, error) {
	var agents []models.AgentRecord
	for rows.Next() {
		var ar models.AgentRecord
		err := rows.Scan(&ar.ID, &ar.AgentCode, &ar.AgentName, &ar.LicenseNo, &ar.LicenseExpiry,
			&ar.Email, &ar.Phone, &ar.Address, &ar.City, &ar.State, &ar.Status,
			&ar.CommissionRate, &ar.ProductTypes, &ar.Region, &ar.CreatedAt, &ar.UpdatedAt)
		if err != nil {
			return nil, err
		}
		agents = append(agents, ar)
	}
	return agents, nil
}

func scanProductRecords(rows *sql.Rows) ([]models.ProductRecord, error) {
	var products []models.ProductRecord
	for rows.Next() {
		var pr models.ProductRecord
		err := rows.Scan(&pr.ID, &pr.ProductCode, &pr.ProductName, &pr.Category, &pr.RiskType,
			&pr.Description, &pr.IsActive, &pr.CoverageMin, &pr.CoverageMax,
			&pr.PremiumRange, &pr.CreatedAt, &pr.UpdatedAt)
		if err != nil {
			return nil, err
		}
		products = append(products, pr)
	}
	return products, nil
}
