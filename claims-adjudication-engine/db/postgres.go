package db

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/claims-adjudication-engine/config"
	"github.com/claims-adjudication-engine/models"
	_ "github.com/lib/pq"
	"go.uber.org/zap"
)

// ClaimsRepository handles all database operations for claims
type ClaimsRepository struct {
	db         *sql.DB
	logger     *zap.Logger
	migrations []string
}

// NewClaimsRepository creates a new repository with database connection and migrations
func NewClaimsRepository(cfg *config.DatabaseConfig, logger *zap.Logger) (*ClaimsRepository, error) {
	dsn := cfg.URL
	if dsn == "" {
		dsn = fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s connect_timeout=10",
			cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.DBName, cfg.SSLMode)
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	db.SetMaxOpenConns(cfg.MaxOpenConns)
	db.SetMaxIdleConns(cfg.MaxIdleConns)
	db.SetConnMaxLifetime(cfg.ConnMaxLifetime)
	db.SetConnMaxIdleTime(cfg.ConnMaxIdleTime)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	logger.Info("Database connection established",
		zap.String("host", cfg.Host),
		zap.Int("port", cfg.Port),
		zap.String("database", cfg.DBName),
		zap.Int("maxOpenConns", cfg.MaxOpenConns),
		zap.Int("maxIdleConns", cfg.MaxIdleConns),
	)

	repo := &ClaimsRepository{
		db:     db,
		logger: logger,
		migrations: []string{
			"001_create_claims_table",
			"002_create_evidence_table",
			"003_create_adjudication_history_table",
			"004_create_indexes",
			"005_create_claims_archive_table",
		},
	}

	if err := repo.runMigrations(ctx); err != nil {
		logger.Warn("Some migrations failed (may already be applied)", zap.Error(err))
	}

	return repo, nil
}

// Close closes the database connection
func (r *ClaimsRepository) Close() error {
	return r.db.Close()
}

// runMigrations applies all pending database migrations
func (r *ClaimsRepository) runMigrations(ctx context.Context) error {
	// Create schema table if it doesn't exist
	_, err := r.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS _schema_migrations (
			version BIGSERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL UNIQUE,
			applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			checksum VARCHAR(64) NOT NULL
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create schema_migrations table: %w", err)
	}

	// Get already applied migrations
	var appliedVersions []string
	rows, err := r.db.QueryContext(ctx, "SELECT name FROM _schema_migrations ORDER BY version DESC")
	if err != nil {
		return fmt.Errorf("failed to query applied migrations: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return fmt.Errorf("failed to scan migration name: %w", err)
		}
		appliedVersions = append(appliedVersions, name)
	}

	appliedMap := make(map[string]bool)
	for _, v := range appliedVersions {
		appliedMap[v] = true
	}

	// Migrations to run (in order)
	type migration struct {
		name     string
		sql      string
		checksum string
	}

	migrations := []migration{
		{
			name: "001_create_claims_table",
			sql: `
			CREATE TABLE IF NOT EXISTS claims (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				reference_id VARCHAR(100) UNIQUE,
				policy_id UUID NOT NULL,
				policy_number VARCHAR(50) NOT NULL,
				claimant_id UUID NOT NULL,
				claimant_name VARCHAR(255) NOT NULL,
				insurer_id UUID NOT NULL,
				amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
				type VARCHAR(50) NOT NULL,
				description TEXT NOT NULL,
				status VARCHAR(50) NOT NULL DEFAULT 'draft',
				decision VARCHAR(50),
				confidence NUMERIC(3,2),
				risk_score NUMERIC(3,2) DEFAULT 0,
				assigned_to UUID,
				queue VARCHAR(100),
				reason TEXT,
				sla_deadline TIMESTAMP WITH TIME ZONE NOT NULL,
				submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
				reviewed_at TIMESTAMP WITH TIME ZONE,
				approved_at TIMESTAMP WITH TIME ZONE,
				paid_at TIMESTAMP WITH TIME ZONE,
				updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
				workflow_id VARCHAR(255),
				notes TEXT,
				fraud_flags JSONB DEFAULT '[]'::jsonb,
				compliance_tags JSONB DEFAULT '[]'::jsonb,
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
				deleted_at TIMESTAMP WITH TIME ZONE,
				CONSTRAINT chk_status CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'denied', 'escalated', 'pending_review', 'paid', 'rejected', 'fraud_alert'))
			);
			
			CREATE INDEX IF NOT EXISTS idx_claims_policy_id ON claims(policy_id);
			CREATE INDEX IF NOT EXISTS idx_claims_claimant_id ON claims(claimant_id);
			CREATE INDEX IF NOT EXISTS idx_claims_insurer_id ON claims(insurer_id);
			CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
			CREATE INDEX IF NOT EXISTS idx_claims_sla_deadline ON claims(sla_deadline) WHERE status NOT IN ('paid', 'denied', 'rejected');
			CREATE INDEX IF NOT EXISTS idx_claims_type ON claims(type);
			CREATE INDEX IF NOT EXISTS idx_claims_created_at ON claims(created_at DESC);
			CREATE INDEX IF NOT EXISTS idx_claims_amount ON claims(amount);
			CREATE INDEX IF NOT EXISTS idx_claims_fraud_flags ON claims USING GIN(fraud_flags);
			CREATE INDEX IF NOT EXISTS idx_claims_compliance_tags ON claims USING GIN(compliance_tags);
			CREATE INDEX IF NOT EXISTS idx_claims_reference_id ON claims(reference_id);
			CREATE INDEX IF NOT EXISTS idx_claims_insurer_status ON claims(insurer_id, status);
			`,
			checksum: "claims_table_v1",
		},
		{
			name: "002_create_evidence_table",
			sql: `
			CREATE TABLE IF NOT EXISTS evidence_docs (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				claim_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
				type VARCHAR(50) NOT NULL,
				file_name VARCHAR(255) NOT NULL,
				file_size BIGINT NOT NULL,
				storage_url TEXT NOT NULL,
				uploaded_by UUID NOT NULL,
				uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
				verified BOOLEAN DEFAULT FALSE,
				verified_by UUID,
				verified_at TIMESTAMP WITH TIME ZONE,
				verification_notes TEXT,
				ai_classification VARCHAR(100),
				ai_confidence NUMERIC(3,2),
				content_type VARCHAR(100),
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
			);
			
			CREATE INDEX IF NOT EXISTS idx_evidence_claim_id ON evidence_docs(claim_id);
			CREATE INDEX IF NOT EXISTS idx_evidence_type ON evidence_docs(type);
			CREATE INDEX IF NOT EXISTS idx_evidence_verified ON evidence_docs(verified);
			CREATE INDEX IF NOT EXISTS idx_evidence_uploaded_at ON evidence_docs(uploaded_at DESC);
			`,
			checksum: "evidence_table_v1",
		},
		{
			name: "003_create_adjudication_history_table",
			sql: `
			CREATE TABLE IF NOT EXISTS adjudication_history (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				claim_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
				action VARCHAR(100) NOT NULL,
				previous_status VARCHAR(50),
				new_status VARCHAR(50),
				decision VARCHAR(50),
				risk_score NUMERIC(3,2),
				confidence NUMERIC(3,2),
				reason TEXT,
				assigned_to UUID,
				performed_by UUID,
				fraud_flags JSONB DEFAULT '[]'::jsonb,
				workflow_id VARCHAR(255),
				metadata JSONB DEFAULT '{}'::jsonb,
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
			);
			
			CREATE INDEX IF NOT EXISTS idx_adjudication_claim_id ON adjudication_history(claim_id);
			CREATE INDEX IF NOT EXISTS idx_adjudication_action ON adjudication_history(action);
			CREATE INDEX IF NOT EXISTS idx_adjudication_performed_by ON adjudication_history(performed_by);
			CREATE INDEX IF NOT EXISTS idx_adjudication_created_at ON adjudication_history(created_at DESC);
			CREATE INDEX IF NOT EXISTS idx_adjudication_metadata ON adjudication_history USING GIN(metadata);
			`,
			checksum: "adjudication_history_v1",
		},
		{
			name: "004_create_claims_archive_table",
			sql: `
			CREATE TABLE IF NOT EXISTS claims_archive (
				id UUID PRIMARY KEY,
				reference_id VARCHAR(100),
				policy_id UUID,
				policy_number VARCHAR(50),
				claimant_id UUID,
				claimant_name VARCHAR(255),
				insurer_id UUID,
				amount NUMERIC(15,2),
				type VARCHAR(50),
				description TEXT,
				final_status VARCHAR(50),
				final_decision VARCHAR(50),
				final_risk_score NUMERIC(3,2),
				total_processing_time INTERVAL,
				archived_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
				archive_metadata JSONB DEFAULT '{}'::jsonb
			);
			
			CREATE INDEX IF NOT EXISTS idx_claims_archive_final_status ON claims_archive(final_status);
			CREATE INDEX IF NOT EXISTS idx_claims_archive_archived_at ON claims_archive(archived_at DESC);
			CREATE INDEX IF NOT EXISTS idx_claims_archive_policy_id ON claims_archive(policy_id);
			CREATE INDEX IF NOT EXISTS idx_claims_archive_insurer_id ON claims_archive(insurer_id);
			`,
			checksum: "archive_table_v1",
		},
	}

	for _, mig := range migrations {
		if appliedMap[mig.name] {
			r.logger.Debug("Migration already applied, skipping", zap.String("migration", mig.name))
			continue
		}

		r.logger.Info("Applying migration", zap.String("migration", mig.name))

		tx, err := r.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("failed to begin transaction for migration %s: %w", mig.name, err)
		}

		if _, err := tx.ExecContext(ctx, mig.sql); err != nil {
			tx.Rollback()
			return fmt.Errorf("failed to execute migration %s: %w", mig.name, err)
		}

		migChecksum := fmt.Sprintf("%x", sha256.Sum256([]byte(mig.sql)))

		if _, err := tx.ExecContext(ctx,
			"INSERT INTO _schema_migrations (name, checksum) VALUES ($1, $2)",
			mig.name, migChecksum,
		); err != nil {
			tx.Rollback()
			return fmt.Errorf("failed to record migration %s: %w", mig.name, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("failed to commit migration %s: %w", mig.name, err)
		}

		r.logger.Info("Migration applied successfully", zap.String("migration", mig.name))
	}

	return nil
}

// CreateClaim creates a new claim with validation
func (r *ClaimsRepository) CreateClaim(ctx context.Context, claim *models.Claim) error {
	query := `
		INSERT INTO claims (
			id, reference_id, policy_id, policy_number, claimant_id, claimant_name,
			insurer_id, amount, type, description, status, sla_deadline,
			submitted_at, updated_at, fraud_flags, compliance_tags
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		RETURNING id, created_at
	`

	refID := generateReferenceID(claim.ID)

	_, err := r.db.ExecContext(ctx, query,
		claim.ID, refID, claim.PolicyID, claim.PolicyNumber,
		claim.ClaimantID, claim.ClaimantName, claim.InsurerID,
		claim.Amount, string(claim.Type), claim.Description,
		string(claim.Status), claim.SLADeadline,
		claim.SubmittedAt, claim.UpdatedAt,
		claim.FraudFlags, claim.ComplianceTags,
	)

	if err != nil {
		return fmt.Errorf("failed to create claim: %w", err)
	}

	return nil
}

// GetClaim retrieves a claim by ID
func (r *ClaimsRepository) GetClaim(ctx context.Context, id string) (*models.Claim, error) {
	query := `
		SELECT id, reference_id, policy_id, policy_number, claimant_id, claimant_name,
			insurer_id, amount, type, description, status, decision, confidence,
			risk_score, assigned_to, queue, reason, sla_deadline, submitted_at,
			reviewed_at, approved_at, paid_at, updated_at, workflow_id, notes,
			fraud_flags, compliance_tags
		FROM claims
		WHERE id = $1 AND deleted_at IS NULL
	`

	claim := &models.Claim{}
	err := r.db.QueryRowContext(ctx, query, id).Scan(
		&claim.ID, &claim.ReferenceID, &claim.PolicyID, &claim.PolicyNumber,
		&claim.ClaimantID, &claim.ClaimantName, &claim.InsurerID,
		&claim.Amount, &claim.Type, &claim.Description, &claim.Status,
		&claim.Decision, &claim.Confidence, &claim.RiskScore,
		&claim.AssignedTo, &claim.Queue, &claim.Reason, &claim.SLADeadline,
		&claim.SubmittedAt, &claim.ReviewedAt, &claim.ApprovedAt,
		&claim.PaidAt, &claim.UpdatedAt, &claim.WorkflowID, &claim.Notes,
		&claim.FraudFlags, &claim.ComplianceTags,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("claim not found: %s", id)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get claim: %w", err)
	}

	return claim, nil
}

// UpdateClaim updates a claim's fields
func (r *ClaimsRepository) UpdateClaim(ctx context.Context, claim *models.Claim) error {
	query := `
		UPDATE claims
		SET status = $1, decision = $2, confidence = $3, risk_score = $4,
			assigned_to = $5, queue = $6, reason = $7, sla_deadline = $8,
			reviewed_at = $9, approved_at = $10, notes = $11,
			fraud_flags = $12, compliance_tags = $13, updated_at = NOW()
		WHERE id = $14 AND deleted_at IS NULL
	`

	result, err := r.db.ExecContext(ctx, query,
		string(claim.Status), claim.Decision, claim.Confidence, claim.RiskScore,
		claim.AssignedTo, claim.Queue, claim.Reason, claim.SLADeadline,
		claim.ReviewedAt, claim.ApprovedAt, claim.Notes,
		claim.FraudFlags, claim.ComplianceTags, claim.ID,
	)

	if err != nil {
		return fmt.Errorf("failed to update claim: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rows == 0 {
		return fmt.Errorf("claim not found for update: %s", claim.ID)
	}

	return nil
}

// UpdateClaimStatus updates only the status and related fields
func (r *ClaimsRepository) UpdateClaimStatus(ctx context.Context, claimID string, newStatus models.ClaimStatus, decision models.ClaimDecision, metadata map[string]interface{}) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer func() {
		if err := tx.Rollback(); err != nil && err != sql.ErrTxDone {
			r.logger.Error("Failed to rollback transaction", zap.Error(err))
		}
	}()

	// Get current claim
	var currentStatus string
	err = tx.QueryRowContext(ctx, "SELECT status FROM claims WHERE id = $1 AND deleted_at IS NULL", claimID).Scan(&currentStatus)
	if err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("claim not found: %s", claimID)
		}
		return fmt.Errorf("failed to get claim: %w", err)
	}

	// Update status
	now := time.Now()
	switch newStatus {
	case models.ClaimStatusSubmitted:
		_, err = tx.ExecContext(ctx,
			"UPDATE claims SET status = $1, submitted_at = $2, updated_at = $3 WHERE id = $4",
			string(newStatus), now, now, claimID,
		)
	case models.ClaimStatusApproved, models.ClaimStatusDenied, models.ClaimStatusRejected:
		_, err = tx.ExecContext(ctx,
			"UPDATE claims SET status = $1, decision = $2, reviewed_at = $3, updated_at = $4 WHERE id = $5",
			string(newStatus), decision, now, now, claimID,
		)
	case models.ClaimStatusPaid:
		_, err = tx.ExecContext(ctx,
			"UPDATE claims SET status = $1, paid_at = $2, updated_at = $3 WHERE id = $4",
			string(newStatus), now, now, claimID,
		)
	default:
		_, err = tx.ExecContext(ctx,
			"UPDATE claims SET status = $1, updated_at = $2 WHERE id = $3",
			string(newStatus), now, claimID,
		)
	}

	if err != nil {
		return fmt.Errorf("failed to update claim status: %w", err)
	}

	// Record in adjudication history
	metadataJSON, _ := json.Marshal(metadata)
	_, err = tx.ExecContext(ctx,
		`INSERT INTO adjudication_history (claim_id, action, previous_status, new_status, decision, metadata)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		claimID, "status_change", currentStatus, string(newStatus), string(decision), metadataJSON,
	)

	if err != nil {
		return fmt.Errorf("failed to record adjudication history: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// GetClaimsByFilter retrieves claims with pagination and filters
func (r *ClaimsRepository) GetClaimsByFilter(ctx context.Context, filter *models.ClaimFilter) (*models.PaginatedClaims, error) {
	query := `
		SELECT id, reference_id, policy_id, policy_number, claimant_id, claimant_name,
			insurer_id, amount, type, description, status, decision, confidence,
			risk_score, assigned_to, queue, reason, sla_deadline, submitted_at,
			reviewed_at, approved_at, paid_at, updated_at, workflow_id, notes,
			fraud_flags, compliance_tags
		FROM claims
		WHERE deleted_at IS NULL
	`

	args := []interface{}{}
	argIdx := 1

	// Build dynamic WHERE clause
	if filter.Status != "" {
		query += fmt.Sprintf(" AND status = $%d", argIdx)
		args = append(args, string(filter.Status))
		argIdx++
	}
	if filter.Type != "" {
		query += fmt.Sprintf(" AND type = $%d", argIdx)
		args = append(args, string(filter.Type))
		argIdx++
	}
	if filter.InsurerID != "" {
		query += fmt.Sprintf(" AND insurer_id = $%d", argIdx)
		args = append(args, filter.InsurerID)
		argIdx++
	}
	if filter.MinAmount > 0 {
		query += fmt.Sprintf(" AND amount >= $%d", argIdx)
		args = append(args, filter.MinAmount)
		argIdx++
	}
	if filter.MaxAmount > 0 {
		query += fmt.Sprintf(" AND amount <= $%d", argIdx)
		args = append(args, filter.MaxAmount)
		argIdx++
	}
	if filter.MinRiskScore > 0 {
		query += fmt.Sprintf(" AND risk_score >= $%d", argIdx)
		args = append(args, filter.MinRiskScore)
		argIdx++
	}
	if filter.MaxRiskScore > 0 {
		query += fmt.Sprintf(" AND risk_score <= $%d", argIdx)
		args = append(args, filter.MaxRiskScore)
		argIdx++
	}
	if filter.Queue != "" {
		query += fmt.Sprintf(" AND queue = $%d", argIdx)
		args = append(args, filter.Queue)
		argIdx++
	}

	// Default sorting
	sortBy := filter.SortBy
	if sortBy == "" {
		sortBy = "created_at"
	}
	sortOrder := filter.SortOrder
	if sortOrder == "" {
		sortOrder = "DESC"
	}
	query += fmt.Sprintf(" ORDER BY %s %s", sortBy, sortOrder)

	// Total count
	countQuery := query[:len(query)-len(" ORDER BY "+sortBy+" "+sortOrder)]
	var total int
	countQuery += " COUNT(*) OVER()"

	countRows, err := r.db.QueryContext(ctx, countQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to get claims count: %w", err)
	}
	defer countRows.Close()

	if countRows.Next() {
		if err := countRows.Scan(&total); err != nil {
			return nil, fmt.Errorf("failed to scan count: %w", err)
		}
	}

	// Add pagination
	if filter.Limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", argIdx)
		args = append(args, filter.Limit)
		argIdx++
	}
	if filter.Offset > 0 {
		query += fmt.Sprintf(" OFFSET $%d", argIdx)
		args = append(args, filter.Offset)
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query claims: %w", err)
	}
	defer rows.Close()

	claims := make([]models.Claim, 0)
	for rows.Next() {
		claim := &models.Claim{}
		if err := rows.Scan(
			&claim.ID, &claim.ReferenceID, &claim.PolicyID, &claim.PolicyNumber,
			&claim.ClaimantID, &claim.ClaimantName, &claim.InsurerID,
			&claim.Amount, &claim.Type, &claim.Description, &claim.Status,
			&claim.Decision, &claim.Confidence, &claim.RiskScore,
			&claim.AssignedTo, &claim.Queue, &claim.Reason, &claim.SLADeadline,
			&claim.SubmittedAt, &claim.ReviewedAt, &claim.ApprovedAt,
			&claim.PaidAt, &claim.UpdatedAt, &claim.WorkflowID, &claim.Notes,
			&claim.FraudFlags, &claim.ComplianceTags,
		); err != nil {
			return nil, fmt.Errorf("failed to scan claim: %w", err)
		}
		claims = append(claims, *claim)
	}

	hasMore := (filter.Offset + len(claims)) < total

	return &models.PaginatedClaims{
		Claims:  claims,
		Total:   total,
		Limit:   filter.Limit,
		Offset:  filter.Offset,
		HasMore: hasMore,
	}, nil
}

// CreateEvidence creates a new evidence document
func (r *ClaimsRepository) CreateEvidence(ctx context.Context, evidence *models.EvidenceDoc) error {
	query := `
		INSERT INTO evidence_docs (
			claim_id, type, file_name, file_size, storage_url,
			uploaded_by, uploaded_at, content_type
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id
	`

	err := r.db.QueryRowContext(ctx, query,
		evidence.ID, evidence.Type, evidence.FileName,
		evidence.FileSize, evidence.URL,
		evidence.ID, // uploaded_by uses claimant ID as proxy
		evidence.UploadedAt,
		"application/octet-stream",
	).Scan(&evidence.ID)

	if err != nil {
		return fmt.Errorf("failed to create evidence: %w", err)
	}

	return nil
}

// GetEvidenceByClaim retrieves all evidence for a claim
func (r *ClaimsRepository) GetEvidenceByClaim(ctx context.Context, claimID string) ([]models.EvidenceDoc, error) {
	query := `
		SELECT id, claim_id, type, file_name, file_size, storage_url,
			uploaded_by, uploaded_at, verified, content_type
		FROM evidence_docs
		WHERE claim_id = $1
		ORDER BY uploaded_at DESC
	`

	rows, err := r.db.QueryContext(ctx, query, claimID)
	if err != nil {
		return nil, fmt.Errorf("failed to query evidence: %w", err)
	}
	defer rows.Close()

	evidence := make([]models.EvidenceDoc, 0)
	for rows.Next() {
		doc := models.EvidenceDoc{}
		if err := rows.Scan(
			&doc.ID, &doc.ID, &doc.Type, &doc.FileName,
			&doc.FileSize, &doc.URL,
			&doc.ID, &doc.UploadedAt, &doc.Verified,
			&doc.Type,
		); err != nil {
			return nil, fmt.Errorf("failed to scan evidence: %w", err)
		}
		evidence = append(evidence, doc)
	}

	return evidence, nil
}

// GetClaimsInQueue retrieves claims for a specific queue
func (r *ClaimsRepository) GetClaimsInQueue(ctx context.Context, queue string, limit int) ([]models.Claim, error) {
	query := `
		SELECT id, reference_id, policy_id, policy_number, claimant_id, claimant_name,
			insurer_id, amount, type, description, status, decision, confidence,
			risk_score, assigned_to, queue, reason, sla_deadline, submitted_at,
			reviewed_at, approved_at, paid_at, updated_at, workflow_id, notes,
			fraud_flags, compliance_tags
		FROM claims
		WHERE queue = $1 AND status IN ('pending_review', 'escalated', 'under_review')
		ORDER BY sla_deadline ASC
		LIMIT $2
	`

	rows, err := r.db.QueryContext(ctx, query, queue, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query queue claims: %w", err)
	}
	defer rows.Close()

	claims := make([]models.Claim, 0)
	for rows.Next() {
		claim := &models.Claim{}
		if err := rows.Scan(
			&claim.ID, &claim.ReferenceID, &claim.PolicyID, &claim.PolicyNumber,
			&claim.ClaimantID, &claim.ClaimantName, &claim.InsurerID,
			&claim.Amount, &claim.Type, &claim.Description, &claim.Status,
			&claim.Decision, &claim.Confidence, &claim.RiskScore,
			&claim.AssignedTo, &claim.Queue, &claim.Reason, &claim.SLADeadline,
			&claim.SubmittedAt, &claim.ReviewedAt, &claim.ApprovedAt,
			&claim.PaidAt, &claim.UpdatedAt, &claim.WorkflowID, &claim.Notes,
			&claim.FraudFlags, &claim.ComplianceTags,
		); err != nil {
			return nil, fmt.Errorf("failed to scan claim: %w", err)
		}
		claims = append(claims, *claim)
	}

	return claims, nil
}

// ArchiveClaim moves a closed claim to archive
func (r *ClaimsRepository) ArchiveClaim(ctx context.Context, claimID string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	var claim models.Claim
	err = tx.QueryRowContext(ctx, `
		SELECT id, reference_id, policy_id, policy_number, claimant_id, claimant_name,
			insurer_id, amount, type, description, status, decision, confidence,
			risk_score, assigned_to, queue, reason, sla_deadline, submitted_at,
			reviewed_at, approved_at, paid_at, updated_at, workflow_id, notes,
			fraud_flags, compliance_tags
		FROM claims WHERE id = $1 AND deleted_at IS NULL
	`, claimID).Scan(
		&claim.ID, &claim.ReferenceID, &claim.PolicyID, &claim.PolicyNumber,
		&claim.ClaimantID, &claim.ClaimantName, &claim.InsurerID,
		&claim.Amount, &claim.Type, &claim.Description, &claim.Status,
		&claim.Decision, &claim.Confidence, &claim.RiskScore,
		&claim.AssignedTo, &claim.Queue, &claim.Reason, &claim.SLADeadline,
		&claim.SubmittedAt, &claim.ReviewedAt, &claim.ApprovedAt,
		&claim.PaidAt, &claim.UpdatedAt, &claim.WorkflowID, &claim.Notes,
		&claim.FraudFlags, &claim.ComplianceTags,
	)

	if err == sql.ErrNoRows {
		return fmt.Errorf("claim not found: %s", claimID)
	}
	if err != nil {
		return fmt.Errorf("failed to get claim: %w", err)
	}

	// Insert into archive
	_, err = tx.ExecContext(ctx, `
		INSERT INTO claims_archive (
			id, reference_id, policy_id, policy_number, claimant_id, claimant_name,
			insurer_id, amount, type, description, final_status, final_decision,
			final_risk_score, archived_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
	`,
		claim.ID, claim.ReferenceID, claim.PolicyID, claim.PolicyNumber,
		claim.ClaimantID, claim.ClaimantName, claim.InsurerID,
		claim.Amount, claim.Type, claim.Description, claim.Status,
		claim.Decision, claim.RiskScore,
	)

	if err != nil {
		return fmt.Errorf("failed to archive claim: %w", err)
	}

	// Soft delete the claim
	_, err = tx.ExecContext(ctx,
		"UPDATE claims SET deleted_at = NOW() WHERE id = $1",
		claimID,
	)

	if err != nil {
		return fmt.Errorf("failed to soft delete claim: %w", err)
	}

	return tx.Commit()
}

// GetMetrics retrieves claims processing metrics
func (r *ClaimsRepository) GetMetrics(ctx context.Context) (*models.ClaimMetrics, error) {
	query := `
		SELECT
			COUNT(*) FILTER (WHERE status IN ('approved', 'denied', 'rejected', 'paid')) as total_processed,
			COUNT(*) FILTER (WHERE status = 'approved' AND reviewed_at - submitted_at <= INTERVAL '48 hours')::float /
				COUNT(*) FILTER (WHERE status = 'approved') as auto_approved_rate,
			COUNT(*) FILTER (WHERE status = 'denied')::float /
				COUNT(*) FILTER (WHERE status IN ('approved', 'denied', 'rejected')) as denied_rate,
			COUNT(*) FILTER (WHERE status = 'escalated')::float /
				COUNT(*) FILTER (WHERE status IN ('approved', 'denied', 'rejected')) as escalated_rate,
			AVG(EXTRACT(EPOCH FROM (reviewed_at - submitted_at))) FILTER (WHERE reviewed_at IS NOT NULL) as avg_processing,
			MAX(EXTRACT(EPOCH FROM (reviewed_at - submitted_at))) FILTER (WHERE reviewed_at IS NOT NULL) as max_processing,
			COUNT(*) FILTER (WHERE sla_deadline > NOW() AND status NOT IN ('approved', 'denied', 'rejected', 'paid', 'fraud_alert')) as queue_size,
			AVG(amount) FILTER (WHERE status IN ('approved', 'denied', 'rejected', 'paid')) as avg_amount,
			COUNT(*) FILTER (WHERE status = 'fraud_alert') as fraud_alerts,
			COUNT(*) FILTER (WHERE sla_deadline > NOW() AND status IN ('under_review', 'pending_review', 'escalated')) as sla_at_risk
		FROM claims
		WHERE deleted_at IS NULL
	`

	metrics := &models.ClaimMetrics{}
	var avgProcessing, maxProcessing, autoRate, deniedRate, escalatedRate, avgAmt *float64

	err := r.db.QueryRowContext(ctx, query).Scan(
		&metrics.TotalClaimsProcessed,
		&autoRate, &deniedRate, &escalatedRate,
		&avgProcessing, &maxProcessing,
		&metrics.CurrentQueueSize,
		&avgAmt, &metrics.FraudAlertCount, &metrics.SLACompliance,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to get metrics: %w", err)
	}

	if autoRate != nil {
		metrics.AutoApprovedRate = *autoRate
	}
	if deniedRate != nil {
		metrics.DeniedRate = *deniedRate
	}
	if escalatedRate != nil {
		metrics.EscalatedRate = *escalatedRate
	}
	if avgProcessing != nil {
		metrics.AvgProcessingTime = *avgProcessing
	}
	if maxProcessing != nil {
		metrics.MaxProcessingTime = *maxProcessing
	}
	if avgAmt != nil {
		metrics.AvgClaimAmount = *avgAmt
	}

	return metrics, nil
}

// generateReferenceID creates a unique reference ID for a claim
func generateReferenceID(claimID string) string {
	return fmt.Sprintf("CLM-%s-%d", claimID[:8], time.Now().Unix())
}
