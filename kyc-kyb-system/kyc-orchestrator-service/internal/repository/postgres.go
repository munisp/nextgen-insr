package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
	"go.uber.org/zap"

	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/models"
)

type PostgresRepository struct {
	db     *sql.DB
	logger *zap.Logger
}

func NewPostgresRepository(logger *zap.Logger, connStr string) (*PostgresRepository, error) {
	if connStr == "" {
		connStr = "postgres://localhost:5432/kyc_db?sslmode=disable"
	}

	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open postgres connection: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		logger.Warn("postgres_not_available", zap.Error(err))
	}

	repo := &PostgresRepository{db: db, logger: logger}
	if err := repo.migrate(); err != nil {
		logger.Warn("migration_failed", zap.Error(err))
	}

	return repo, nil
}

func (r *PostgresRepository) migrate() error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS kyc_verifications (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			session_id TEXT UNIQUE NOT NULL,
			level INTEGER DEFAULT 0,
			status TEXT DEFAULT 'pending',
			verification_type TEXT,
			document_type TEXT,
			document_number TEXT,
			nin_verified BOOLEAN DEFAULT FALSE,
			bvn_verified BOOLEAN DEFAULT FALSE,
			phone_verified BOOLEAN DEFAULT FALSE,
			document_verified BOOLEAN DEFAULT FALSE,
			biometric_verified BOOLEAN DEFAULT FALSE,
			liveness_verified BOOLEAN DEFAULT FALSE,
			address_verified BOOLEAN DEFAULT FALSE,
			aml_cleared BOOLEAN DEFAULT FALSE,
			risk_score REAL DEFAULT 0,
			face_match_score REAL DEFAULT 0,
			reviewer_id TEXT,
			review_notes TEXT,
			rejection_reason TEXT,
			metadata JSONB DEFAULT '{}',
			verified_at TIMESTAMPTZ,
			expires_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS kyc_events (
			id TEXT PRIMARY KEY,
			verification_id TEXT NOT NULL REFERENCES kyc_verifications(session_id),
			event_type TEXT NOT NULL,
			actor TEXT NOT NULL,
			details TEXT,
			metadata JSONB DEFAULT '{}',
			timestamp TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS kyb_verifications (
			id TEXT PRIMARY KEY,
			session_id TEXT UNIQUE NOT NULL,
			business_id TEXT NOT NULL,
			company_name TEXT NOT NULL,
			rc_number TEXT NOT NULL,
			tin TEXT,
			status TEXT DEFAULT 'pending',
			cac_verified BOOLEAN DEFAULT FALSE,
			tin_verified BOOLEAN DEFAULT FALSE,
			directors JSONB DEFAULT '[]',
			ubos JSONB DEFAULT '[]',
			risk_score REAL DEFAULT 0,
			reviewer_id TEXT,
			review_notes TEXT,
			rejection_reason TEXT,
			metadata JSONB DEFAULT '{}',
			verified_at TIMESTAMPTZ,
			expires_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS kyc_audit_log (
			id SERIAL PRIMARY KEY,
			session_id TEXT NOT NULL,
			action TEXT NOT NULL,
			actor TEXT NOT NULL,
			ip_address TEXT,
			user_agent TEXT,
			request_body JSONB,
			response_body JSONB,
			status_code INTEGER,
			duration_ms INTEGER,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_kyc_user_id ON kyc_verifications(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_kyc_session_id ON kyc_verifications(session_id)`,
		`CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_verifications(status)`,
		`CREATE INDEX IF NOT EXISTS idx_kyc_events_verification ON kyc_events(verification_id)`,
		`CREATE INDEX IF NOT EXISTS idx_kyb_business_id ON kyb_verifications(business_id)`,
		`CREATE INDEX IF NOT EXISTS idx_kyc_audit_session ON kyc_audit_log(session_id)`,
	}

	for _, m := range migrations {
		if _, err := r.db.Exec(m); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}
	return nil
}

func (r *PostgresRepository) SaveVerification(ctx context.Context, v *models.KYCVerification) error {
	query := `INSERT INTO kyc_verifications (
		id, user_id, session_id, level, status, verification_type, document_type,
		document_number, nin_verified, bvn_verified, phone_verified, document_verified,
		biometric_verified, liveness_verified, address_verified, aml_cleared,
		risk_score, face_match_score, reviewer_id, review_notes, rejection_reason,
		metadata, verified_at, expires_at, created_at, updated_at
	) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
	ON CONFLICT (session_id) DO UPDATE SET
		level=$4, status=$5, document_type=$6, document_number=$7,
		nin_verified=$9, bvn_verified=$10, phone_verified=$11, document_verified=$12,
		biometric_verified=$13, liveness_verified=$14, address_verified=$15, aml_cleared=$16,
		risk_score=$17, face_match_score=$18, reviewer_id=$19, review_notes=$20,
		rejection_reason=$21, metadata=$22, verified_at=$23, expires_at=$24, updated_at=$26`

	metadata := []byte("{}")

	_, err := r.db.ExecContext(ctx, query,
		v.ID, v.UserID, v.SessionID, v.Level, v.Status, v.VerificationType, v.DocumentType,
		v.DocumentNumber, v.NINVerified, v.BVNVerified, v.PhoneVerified, v.DocumentVerified,
		v.BiometricVerified, v.LivenessVerified, v.AddressVerified, v.AMLCleared,
		v.RiskScore, v.FaceMatchScore, ptrStr(v.ReviewerID), ptrStr(v.ReviewNotes), ptrStr(v.RejectionReason),
		string(metadata), ptrTime(v.VerifiedAt), ptrTime(v.ExpiresAt), v.CreatedAt, v.UpdatedAt,
	)
	if err != nil {
		r.logger.Error("save_verification_failed", zap.Error(err), zap.String("session_id", v.SessionID))
	}
	return err
}

func (r *PostgresRepository) GetVerification(ctx context.Context, sessionID string) (*models.KYCVerification, error) {
	query := `SELECT id, user_id, session_id, level, status, verification_type, document_type,
		document_number, nin_verified, bvn_verified, phone_verified, document_verified,
		biometric_verified, liveness_verified, address_verified, aml_cleared,
		risk_score, face_match_score, reviewer_id, review_notes, rejection_reason,
		verified_at, expires_at, created_at, updated_at
		FROM kyc_verifications WHERE session_id=$1`

	v := &models.KYCVerification{}
	var reviewerID, reviewNotes, rejectionReason sql.NullString
	var verifiedAt, expiresAt sql.NullTime

	err := r.db.QueryRowContext(ctx, query, sessionID).Scan(
		&v.ID, &v.UserID, &v.SessionID, &v.Level, &v.Status, &v.VerificationType, &v.DocumentType,
		&v.DocumentNumber, &v.NINVerified, &v.BVNVerified, &v.PhoneVerified, &v.DocumentVerified,
		&v.BiometricVerified, &v.LivenessVerified, &v.AddressVerified, &v.AMLCleared,
		&v.RiskScore, &v.FaceMatchScore, &reviewerID, &reviewNotes, &rejectionReason,
		&verifiedAt, &expiresAt, &v.CreatedAt, &v.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if reviewerID.Valid {
		v.ReviewerID = &reviewerID.String
	}
	if reviewNotes.Valid {
		v.ReviewNotes = &reviewNotes.String
	}
	if rejectionReason.Valid {
		v.RejectionReason = &rejectionReason.String
	}
	if verifiedAt.Valid {
		v.VerifiedAt = &verifiedAt.Time
	}
	if expiresAt.Valid {
		v.ExpiresAt = &expiresAt.Time
	}

	return v, nil
}

func (r *PostgresRepository) GetUserVerifications(ctx context.Context, userID string) ([]*models.KYCVerification, error) {
	query := `SELECT id, user_id, session_id, level, status, verification_type,
		nin_verified, bvn_verified, phone_verified, document_verified,
		biometric_verified, liveness_verified, aml_cleared, risk_score,
		created_at, updated_at
		FROM kyc_verifications WHERE user_id=$1 ORDER BY created_at DESC`

	rows, err := r.db.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []*models.KYCVerification
	for rows.Next() {
		v := &models.KYCVerification{}
		if err := rows.Scan(
			&v.ID, &v.UserID, &v.SessionID, &v.Level, &v.Status, &v.VerificationType,
			&v.NINVerified, &v.BVNVerified, &v.PhoneVerified, &v.DocumentVerified,
			&v.BiometricVerified, &v.LivenessVerified, &v.AMLCleared, &v.RiskScore,
			&v.CreatedAt, &v.UpdatedAt,
		); err != nil {
			return nil, err
		}
		results = append(results, v)
	}
	return results, nil
}

func (r *PostgresRepository) SaveEvent(ctx context.Context, event *models.VerificationEvent) error {
	query := `INSERT INTO kyc_events (id, verification_id, event_type, actor, details, timestamp)
		VALUES ($1, $2, $3, $4, $5, $6)`
	_, err := r.db.ExecContext(ctx, query,
		event.ID, event.VerificationID, event.EventType, event.Actor, event.Details, event.Timestamp)
	return err
}

func (r *PostgresRepository) GetEvents(ctx context.Context, sessionID string) ([]models.VerificationEvent, error) {
	query := `SELECT id, verification_id, event_type, actor, details, timestamp
		FROM kyc_events WHERE verification_id=$1 ORDER BY timestamp ASC`

	rows, err := r.db.QueryContext(ctx, query, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []models.VerificationEvent
	for rows.Next() {
		var e models.VerificationEvent
		if err := rows.Scan(&e.ID, &e.VerificationID, &e.EventType, &e.Actor, &e.Details, &e.Timestamp); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, nil
}

func (r *PostgresRepository) SaveAuditLog(ctx context.Context, sessionID, action, actor, ipAddr, userAgent string, statusCode, durationMs int) error {
	query := `INSERT INTO kyc_audit_log (session_id, action, actor, ip_address, user_agent, status_code, duration_ms)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`
	_, err := r.db.ExecContext(ctx, query, sessionID, action, actor, ipAddr, userAgent, statusCode, durationMs)
	return err
}

func (r *PostgresRepository) Close() error {
	return r.db.Close()
}

func ptrStr(s *string) interface{} {
	if s == nil {
		return nil
	}
	return *s
}

func ptrTime(t *time.Time) interface{} {
	if t == nil {
		return nil
	}
	return *t
}
