package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/insureportal/policy_workflow_go/config"
	"github.com/insureportal/policy_workflow_go/models"
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
		`CREATE TABLE IF NOT EXISTS policies (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			policy_number VARCHAR(50) UNIQUE NOT NULL,
			product_id UUID NOT NULL,
			product_code VARCHAR(50),
			product_type VARCHAR(50),
			holder_id UUID NOT NULL,
			holder_type VARCHAR(20) DEFAULT 'individual',
			beneficiary_id UUID,
			agent_id UUID,
			agent_code VARCHAR(50),
			status VARCHAR(30) DEFAULT 'draft',
			premium REAL NOT NULL DEFAULT 0,
			sum_assured REAL NOT NULL DEFAULT 0,
			coverage_start DATE,
			coverage_end DATE,
			payment_frequency VARCHAR(20) DEFAULT 'annual',
			next_due_date DATE,
			last_payment_date DATE,
			risk_score INTEGER DEFAULT 0,
			underwriter_id UUID,
			remarks TEXT,
			kyc_verified BOOLEAN DEFAULT FALSE,
			payment_status VARCHAR(20) DEFAULT 'pending',
			current_state VARCHAR(30) DEFAULT 'draft',
			issued_at TIMESTAMP WITH TIME ZONE,
			active_since TIMESTAMP WITH TIME ZONE,
			lapsed_at TIMESTAMP WITH TIME ZONE,
			cancelled_at TIMESTAMP WITH TIME ZONE,
			cancellation_reason TEXT,
			refund_amount REAL DEFAULT 0,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_policies_status ON policies(status)`,
		`CREATE INDEX IF NOT EXISTS idx_policies_product ON policies(product_id)`,
		`CREATE INDEX IF NOT EXISTS idx_policies_holder ON policies(holder_id)`,
		`CREATE INDEX IF NOT EXISTS idx_policies_current_state ON policies(current_state)`,

		`CREATE TABLE IF NOT EXISTS policy_transitions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			policy_id UUID NOT NULL REFERENCES policies(id),
			from_state VARCHAR(30) NOT NULL,
			to_state VARCHAR(30) NOT NULL,
			actor VARCHAR(255),
			actor_role VARCHAR(50),
			reason TEXT,
			notes TEXT,
			transition_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			duration_secs INTEGER DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_transitions_policy ON policy_transitions(policy_id)`,
		`CREATE INDEX IF NOT EXISTS idx_transitions_at ON policy_transitions(transition_at DESC)`,

		`CREATE TABLE IF NOT EXISTS underwriting_records (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			policy_id UUID NOT NULL REFERENCES policies(id),
			risk_score INTEGER NOT NULL DEFAULT 0,
			risk_factors TEXT,
			auto_route BOOLEAN DEFAULT FALSE,
			recommendation VARCHAR(30),
			underwriter_id UUID,
			status VARCHAR(20) DEFAULT 'pending',
			completed_at TIMESTAMP WITH TIME ZONE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_underwriting_policy ON underwriting_records(policy_id)`,
		`CREATE INDEX IF NOT EXISTS idx_underwriting_status ON underwriting_records(status)`,

		`CREATE TABLE IF NOT EXISTS renewal_records (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			policy_id UUID NOT NULL REFERENCES policies(id),
			original_expiry DATE NOT NULL,
			renewal_date DATE NOT NULL,
			new_expiry DATE,
			new_premium REAL DEFAULT 0,
			new_sum_assured REAL DEFAULT 0,
			renewal_status VARCHAR(30) DEFAULT 'pending',
			payment_status VARCHAR(20) DEFAULT 'pending',
			renewal_method VARCHAR(20) DEFAULT 'manual',
			renewed_at TIMESTAMP WITH TIME ZONE,
			lapsed_at TIMESTAMP WITH TIME ZONE,
			grace_period_end DATE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_renewals_policy ON renewal_records(policy_id)`,
		`CREATE INDEX IF NOT EXISTS idx_renewals_status ON renewal_records(renewal_status)`,

		`CREATE TABLE IF NOT EXISTS endorsements (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			policy_id UUID NOT NULL REFERENCES policies(id),
			change_type VARCHAR(50) NOT NULL,
			old_value TEXT,
			new_value TEXT,
			reason TEXT,
			requires_approval BOOLEAN DEFAULT FALSE,
			status VARCHAR(20) DEFAULT 'pending',
			approved_by UUID,
			approved_at TIMESTAMP WITH TIME ZONE,
			created_by VARCHAR(255),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_endorsements_policy ON endorsements(policy_id)`,
		`CREATE INDEX IF NOT EXISTS idx_endorsements_status ON endorsements(status)`,

		`CREATE TABLE IF NOT EXISTS lapse_rules (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			policy_id UUID NOT NULL REFERENCES policies(id),
			grace_period_days INTEGER DEFAULT 30,
			last_due_date DATE,
			grace_period_end DATE,
			status VARCHAR(20) DEFAULT 'current',
			lapsed_at TIMESTAMP WITH TIME ZONE,
			reinstated_at TIMESTAMP WITH TIME ZONE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_lapses_policy ON lapse_rules(policy_id)`,

		`CREATE TABLE IF NOT EXISTS cancellation_records (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			policy_id UUID NOT NULL REFERENCES policies(id),
			type VARCHAR(30) NOT NULL,
			reason TEXT,
			cancellation_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			cancelled_by VARCHAR(255),
			refund_amount REAL DEFAULT 0,
			refund_status VARCHAR(20) DEFAULT 'pending',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_cancellations_policy ON cancellation_records(policy_id)`,
	}

	for _, q := range tables {
		if _, err := p.db.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("migrate '%s...': %w", q[:50], err)
		}
	}
	zap.L().Info("Policy workflow migrations completed")
	return nil
}

// --- Policy CRUD ---
func (p *PostgreSQL) CreatePolicy(ctx context.Context, pol *models.Policy) error {
	pol.ID = uuid.New().String()
	pol.PolicyNumber = "POL-" + time.Now().Format("20060102") + "-" + uuid.New().String()[:6]
	pol.CreatedAt = time.Now()
	pol.UpdatedAt = time.Now()
	pol.CurrentState = models.StateDraft
	query := `INSERT INTO policies (id,policy_number,product_id,product_code,product_type,
		holder_id,holder_type,beneficiary_id,agent_id,agent_code,status,premium,sum_assured,
		coverage_start,coverage_end,payment_frequency,next_due_date,risk_score,underwriter_id,
		remarks,kyc_verified,payment_status,current_state)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`
	_, err := p.db.ExecContext(ctx, query, pol.ID, pol.PolicyNumber, pol.ProductID, pol.ProductCode,
		pol.ProductType, pol.HolderID, pol.HolderType, pol.BeneficiaryID, pol.AgentID, pol.AgentCode,
		pol.Status, pol.Premium, pol.SumAssured, pol.CoverageStart, pol.CoverageEnd,
		pol.PaymentFrequency, pol.NextDueDate, pol.RiskScore, pol.UnderwriterID,
		pol.Remarks, pol.KYCVerified, pol.PaymentStatus, pol.CurrentState)
	return err
}

func (p *PostgreSQL) GetPolicy(ctx context.Context, id string) (*models.Policy, error) {
	var pol models.Policy
	q := `SELECT id,policy_number,product_id,product_code,product_type,holder_id,holder_type,
		beneficiary_id,agent_id,agent_code,status,premium,sum_assured,coverage_start,coverage_end,
		payment_frequency,next_due_date,last_payment_date,risk_score,underwriter_id,remarks,
		kyc_verified,payment_status,current_state,issued_at,active_since,lapsed_at,cancelled_at,
		cancellation_reason,refund_amount,created_at,updated_at
		FROM policies WHERE id=$1`
	err := p.db.QueryRowContext(ctx, q, id).Scan(
		&pol.ID, &pol.PolicyNumber, &pol.ProductID, &pol.ProductCode, &pol.ProductType,
		&pol.HolderID, &pol.HolderType, &pol.BeneficiaryID, &pol.AgentID, &pol.AgentCode,
		&pol.Status, &pol.Premium, &pol.SumAssured, &pol.CoverageStart, &pol.CoverageEnd,
		&pol.PaymentFrequency, &pol.NextDueDate, &pol.LastPaymentDate, &pol.RiskScore,
		&pol.UnderwriterID, &pol.Remarks, &pol.KYCVerified, &pol.PaymentStatus,
		&pol.CurrentState, &pol.IssuedAt, &pol.ActiveSince, &pol.LapsedAt, &pol.CancelledAt,
		&pol.CancellationReason, &pol.RefundAmount, &pol.CreatedAt, &pol.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &pol, nil
}

func (p *PostgreSQL) GetPolicyByNumber(ctx context.Context, number string) (*models.Policy, error) {
	var pol models.Policy
	q := `SELECT id,policy_number,product_id,product_code,product_type,holder_id,holder_type,
		beneficiary_id,agent_id,agent_code,status,premium,sum_assured,coverage_start,coverage_end,
		payment_frequency,next_due_date,last_payment_date,risk_score,underwriter_id,remarks,
		kyc_verified,payment_status,current_state,issued_at,active_since,lapsed_at,cancelled_at,
		cancellation_reason,refund_amount,created_at,updated_at
		FROM policies WHERE policy_number=$1`
	err := p.db.QueryRowContext(ctx, q, number).Scan(
		&pol.ID, &pol.PolicyNumber, &pol.ProductID, &pol.ProductCode, &pol.ProductType,
		&pol.HolderID, &pol.HolderType, &pol.BeneficiaryID, &pol.AgentID, &pol.AgentCode,
		&pol.Status, &pol.Premium, &pol.SumAssured, &pol.CoverageStart, &pol.CoverageEnd,
		&pol.PaymentFrequency, &pol.NextDueDate, &pol.LastPaymentDate, &pol.RiskScore,
		&pol.UnderwriterID, &pol.Remarks, &pol.KYCVerified, &pol.PaymentStatus,
		&pol.CurrentState, &pol.IssuedAt, &pol.ActiveSince, &pol.LapsedAt, &pol.CancelledAt,
		&pol.CancellationReason, &pol.RefundAmount, &pol.CreatedAt, &pol.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &pol, nil
}

func (p *PostgreSQL) UpdatePolicy(ctx context.Context, id string, updates map[string]interface{}) error {
	setClauses := []string{}
	args := []interface{}{}
	pos := 1
	for k, v := range updates {
		setClauses = append(setClauses, fmt.Sprintf("%s=$%d", k, pos))
		args = append(args, v)
		pos++
	}
	setClauses = append(setClauses, fmt.Sprintf("updated_at=NOW()"))
	query := fmt.Sprintf("UPDATE policies SET %s WHERE id=$%d",
		join(setClauses, ","), pos)
	args = append(args, id)
	_, err := p.db.ExecContext(ctx, query, args...)
	return err
}

func (p *PostgreSQL) ListPolicies(ctx context.Context, status, productType string, limit, offset int) ([]models.Policy, error) {
	query := `SELECT id,policy_number,product_id,product_code,product_type,holder_id,holder_type,
		beneficiary_id,agent_id,agent_code,status,premium,sum_assured,coverage_start,coverage_end,
		payment_frequency,next_due_date,last_payment_date,risk_score,underwriter_id,remarks,
		kyc_verified,payment_status,current_state,issued_at,active_since,lapsed_at,cancelled_at,
		cancellation_reason,refund_amount,created_at,updated_at
		FROM policies WHERE 1=1`
	args := []interface{}{}
	pos := 1
	if status != "" {
		query += fmt.Sprintf(" AND status=$%d", pos)
		args = append(args, status)
		pos++
	}
	if productType != "" {
		query += fmt.Sprintf(" AND product_type=$%d", pos)
		args = append(args, productType)
		pos++
	}
	query += " ORDER BY created_at DESC"
	if limit > 0 { query += fmt.Sprintf(" LIMIT $%d", pos); args = append(args, limit); pos++ }
	if offset > 0 { query += fmt.Sprintf(" OFFSET $%d", pos); args = append(args, offset) }

	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPolicies(rows)
}

func (p *PostgreSQL) CountPoliciesByState(ctx context.Context) (map[string]int, error) {
	rows, err := p.db.QueryContext(ctx, `SELECT status, COUNT(*) FROM policies GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]int)
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		result[status] = count
	}
	return result, nil
}

// --- Transitions ---
func (p *PostgreSQL) CreateTransition(ctx context.Context, t *models.PolicyTransition) error {
	t.ID = uuid.New().String()
	t.TransitionAt = time.Now()
	query := `INSERT INTO policy_transitions (id,policy_id,from_state,to_state,actor,actor_role,
		reason,notes,transition_at,duration_secs)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`
	_, err := p.db.ExecContext(ctx, query, t.ID, t.PolicyID, t.FromState, t.ToState,
		t.Actor, t.ActorRole, t.Reason, t.Notes, t.TransitionAt, t.DurationSecs)
	return err
}

func (p *PostgreSQL) GetTransitions(ctx context.Context, policyID string, limit int) ([]models.PolicyTransition, error) {
	query := `SELECT id,policy_id,from_state,to_state,actor,actor_role,reason,notes,
		transition_at,duration_secs FROM policy_transitions WHERE policy_id=$1`
	args := []interface{}{policyID}
	pos := 2
	if limit > 0 { query += fmt.Sprintf(" ORDER BY transition_at DESC LIMIT $%d", pos) }
	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTransitions(rows)
}

// --- Underwriting ---
func (p *PostgreSQL) CreateUnderwritingRecord(ctx context.Context, uw *models.UnderwritingRecord) error {
	uw.ID = uuid.New().String()
	uw.CreatedAt = time.Now()
	if uw.Status == "" {
		uw.Status = "pending"
	}
	query := `INSERT INTO underwriting_records (id,policy_id,risk_score,risk_factors,auto_route,
		recommendation,underwriter_id,status,completed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`
	_, err := p.db.ExecContext(ctx, query, uw.ID, uw.PolicyID, uw.RiskScore, uw.RiskFactors,
		uw.AutoRoute, uw.Recommendation, uw.UnderwriterID, uw.Status, uw.CompletedAt)
	return err
}

func (p *PostgreSQL) GetUnderwritingRecord(ctx context.Context, policyID string) (*models.UnderwritingRecord, error) {
	var uw models.UnderwritingRecord
	q := `SELECT id,policy_id,risk_score,risk_factors,auto_route,recommendation,underwriter_id,
		status,completed_at,created_at FROM underwriting_records WHERE policy_id=$1`
	err := p.db.QueryRowContext(ctx, q, policyID).Scan(
		&uw.ID, &uw.PolicyID, &uw.RiskScore, &uw.RiskFactors, &uw.AutoRoute,
		&uw.Recommendation, &uw.UnderwriterID, &uw.Status, &uw.CompletedAt, &uw.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &uw, nil
}

func (p *PostgreSQL) UpdateUnderwritingStatus(ctx context.Context, id, status string, completedAt time.Time) error {
	_, err := p.db.ExecContext(ctx,
		`UPDATE underwriting_records SET status=$1, completed_at=$2 WHERE id=$3`,
		status, completedAt, id)
	return err
}

// --- Renewals ---
func (p *PostgreSQL) CreateRenewalRecord(ctx context.Context, r *models.RenewalRecord) error {
	r.ID = uuid.New().String()
	r.CreatedAt = time.Now()
	if r.RenewalStatus == "" {
		r.RenewalStatus = "pending"
	}
	query := `INSERT INTO renewal_records (id,policy_id,original_expiry,renewal_date,new_expiry,
		new_premium,new_sum_assured,renewal_status,payment_status,renewal_method,
		renewed_at,lapsed_at,grace_period_end)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`
	_, err := p.db.ExecContext(ctx, query, r.ID, r.PolicyID, r.OriginalExpiry, r.RenewalDate,
		r.NewExpiry, r.NewPremium, r.NewSumAssured, r.RenewalStatus, r.PaymentStatus,
		r.RenewalMethod, r.RenewedAt, r.LapsedAt, r.GracePeriodEnd)
	return err
}

func (p *PostgreSQL) GetRenewalRecords(ctx context.Context, policyID string) ([]models.RenewalRecord, error) {
	rows, err := p.db.QueryContext(ctx,
		`SELECT id,policy_id,original_expiry,renewal_date,new_expiry,new_premium,new_sum_assured,
			renewal_status,payment_status,renewal_method,renewed_at,lapsed_at,grace_period_end,created_at
			FROM renewal_records WHERE policy_id=$1 ORDER BY renewal_date DESC`, policyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRenewals(rows)
}

func (p *PostgreSQL) UpdateRenewalStatus(ctx context.Context, id, status string) error {
	_, err := p.db.ExecContext(ctx,
		`UPDATE renewal_records SET renewal_status=$1, updated_at=NOW() WHERE id=$2`,
		status, id)
	return err
}

// --- Endorsements ---
func (p *PostgreSQL) CreateEndorsement(ctx context.Context, e *models.Endorsement) error {
	e.ID = uuid.New().String()
	e.CreatedAt = time.Now()
	if e.Status == "" {
		e.Status = "pending"
	}
	query := `INSERT INTO endorsements (id,policy_id,change_type,old_value,new_value,reason,
		requires_approval,status,created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`
	_, err := p.db.ExecContext(ctx, query, e.ID, e.PolicyID, e.ChangeType, e.OldValue,
		e.NewValue, e.Reason, e.RequiresApproval, e.Status, e.CreatedBy)
	return err
}

func (p *PostgreSQL) GetEndorsements(ctx context.Context, policyID, status string, limit int) ([]models.Endorsement, error) {
	query := `SELECT id,policy_id,change_type,old_value,new_value,reason,requires_approval,
		status,approved_by,approved_at,created_by,created_at FROM endorsements WHERE policy_id=$1`
	args := []interface{}{policyID}
	pos := 2
	if status != "" {
		query += fmt.Sprintf(" AND status=$%d", pos)
		args = append(args, status)
		pos++
	}
	query += " ORDER BY created_at DESC"
	if limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", pos)
		args = append(args, limit)
	}
	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEndorsements(rows)
}

func (p *PostgreSQL) ApproveEndorsement(ctx context.Context, id, approvedBy string) error {
	_, err := p.db.ExecContext(ctx,
		`UPDATE endorsements SET status='approved', approved_by=$1, approved_at=NOW() WHERE id=$2`,
		approvedBy, id)
	return err
}

// --- Lapse Rules ---
func (p *PostgreSQL) CreateLapseRule(ctx context.Context, lr *models.LapseRule) error {
	lr.ID = uuid.New().String()
	lr.CreatedAt = time.Now()
	query := `INSERT INTO lapse_rules (id,policy_id,grace_period_days,last_due_date,
		grace_period_end,status,lapsed_at,reinstated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	_, err := p.db.ExecContext(ctx, query, lr.ID, lr.PolicyID, lr.GracePeriodDays,
		lr.LastDueDate, lr.GracePeriodEnd, lr.Status, lr.LapsedAt, lr.ReinstatedAt)
	return err
}

func (p *PostgreSQL) UpdateLapseRule(ctx context.Context, id, status string, lapsedAt *time.Time) error {
	_, err := p.db.ExecContext(ctx,
		`UPDATE lapse_rules SET status=$1, lapsed_at=$2 WHERE id=$3`,
		status, lapsedAt, id)
	return err
}

// --- Cancellations ---
func (p *PostgreSQL) CreateCancellationRecord(ctx context.Context, c *models.CancellationRecord) error {
	c.ID = uuid.New().String()
	c.CreatedAt = time.Now()
	query := `INSERT INTO cancellation_records (id,policy_id,type,reason,cancellation_date,
		cancelled_by,refund_amount,refund_status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	_, err := p.db.ExecContext(ctx, query, c.ID, c.PolicyID, c.Type, c.Reason,
		c.CancellationDate, c.CancelledBy, c.RefundAmount, c.RefundStatus)
	return err
}

func (p *PostgreSQL) GetCancellationRecord(ctx context.Context, policyID string) (*models.CancellationRecord, error) {
	var c models.CancellationRecord
	q := `SELECT id,policy_id,type,reason,cancellation_date,cancelled_by,refund_amount,
		refund_status,created_at FROM cancellation_records WHERE policy_id=$1`
	err := p.db.QueryRowContext(ctx, q, policyID).Scan(
		&c.ID, &c.PolicyID, &c.Type, &c.Reason, &c.CancellationDate, &c.CancelledBy,
		&c.RefundAmount, &c.RefundStatus, &c.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// --- Helpers ---
func scanPolicies(rows *sql.Rows) ([]models.Policy, error) {
	var policies []models.Policy
	for rows.Next() {
		var p models.Policy
		err := rows.Scan(&p.ID, &p.PolicyNumber, &p.ProductID, &p.ProductCode, &p.ProductType,
			&p.HolderID, &p.HolderType, &p.BeneficiaryID, &p.AgentID, &p.AgentCode,
			&p.Status, &p.Premium, &p.SumAssured, &p.CoverageStart, &p.CoverageEnd,
			&p.PaymentFrequency, &p.NextDueDate, &p.LastPaymentDate, &p.RiskScore,
			&p.UnderwriterID, &p.Remarks, &p.KYCVerified, &p.PaymentStatus,
			&p.CurrentState, &p.IssuedAt, &p.ActiveSince, &p.LapsedAt, &p.CancelledAt,
			&p.CancellationReason, &p.RefundAmount, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			return nil, err
		}
		policies = append(policies, p)
	}
	return policies, nil
}

func scanTransitions(rows *sql.Rows) ([]models.PolicyTransition, error) {
	var t []models.PolicyTransition
	for rows.Next() {
		var item models.PolicyTransition
		err := rows.Scan(&item.ID, &item.PolicyID, &item.FromState, &item.ToState,
			&item.Actor, &item.ActorRole, &item.Reason, &item.Notes,
			&item.TransitionAt, &item.DurationSecs)
		if err != nil {
			return nil, err
		}
		t = append(t, item)
	}
	return t, nil
}

func scanRenewals(rows *sql.Rows) ([]models.RenewalRecord, error) {
	var r []models.RenewalRecord
	for rows.Next() {
		var item models.RenewalRecord
		err := rows.Scan(&item.ID, &item.PolicyID, &item.OriginalExpiry, &item.RenewalDate,
			&item.NewExpiry, &item.NewPremium, &item.NewSumAssured, &item.RenewalStatus,
			&item.PaymentStatus, &item.RenewalMethod, &item.RenewedAt, &item.LapsedAt,
			&item.GracePeriodEnd, &item.CreatedAt)
		if err != nil {
			return nil, err
		}
		r = append(r, item)
	}
	return r, nil
}

func scanEndorsements(rows *sql.Rows) ([]models.Endorsement, error) {
	var e []models.Endorsement
	for rows.Next() {
		var item models.Endorsement
		err := rows.Scan(&item.ID, &item.PolicyID, &item.ChangeType, &item.OldValue,
			&item.NewValue, &item.Reason, &item.RequiresApproval, &item.Status,
			&item.ApprovedBy, &item.ApprovedAt, &item.CreatedBy, &item.CreatedAt)
		if err != nil {
			return nil, err
		}
		e = append(e, item)
	}
	return e, nil
}

func join(strs []string, sep string) string {
	result := ""
	for i, s := range strs {
		if i > 0 {
			result += sep
		}
		result += s
	}
	return result
}
