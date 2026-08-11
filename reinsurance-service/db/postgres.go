package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"reinsurance-service/config"
)

type Postgres struct{ Pool *pgxpool.Pool }

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

func (p *Postgres) RunMigrations(ctx context.Context) error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS treaties (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			treaty_id VARCHAR(64) UNIQUE NOT NULL,
			name VARCHAR(255) NOT NULL,
			type VARCHAR(32) NOT NULL,
			reinsurer VARCHAR(255) NOT NULL,
			reinsurer_code VARCHAR(32),
			effective_date DATE NOT NULL,
			expiry_date DATE NOT NULL,
			period VARCHAR(16) NOT NULL,
			retention DECIMAL(15,2) NOT NULL DEFAULT 0,
			limit DECIMAL(15,2) NOT NULL DEFAULT 0,
			cession_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
			premium_share DECIMAL(6,4) NOT NULL DEFAULT 0,
			commission_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
			clawback_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
			minimum_ceded DECIMAL(15,2) NOT NULL DEFAULT 0,
			status VARCHAR(32) NOT NULL DEFAULT 'draft',
			currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_treaties_status ON treaties(status)`,
		`CREATE INDEX IF NOT EXISTS idx_treaties_reinsurer ON treaties(reinsurer)`,
		`CREATE INDEX IF NOT EXISTS idx_treaties_period ON treaties(period)`,
		`CREATE INDEX IF NOT EXISTS idx_treaties_type ON treaties(type)`,

		`CREATE TABLE IF NOT EXISTS cessions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			cession_id VARCHAR(64) UNIQUE NOT NULL,
			treaty_id UUID NOT NULL REFERENCES treaties(id),
			policy_id VARCHAR(64) NOT NULL,
			risk_type VARCHAR(64),
			gross_amount DECIMAL(15,2) NOT NULL,
			retention DECIMAL(15,2) NOT NULL DEFAULT 0,
			ceded_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
			cession_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
			reinsurer VARCHAR(255),
			type VARCHAR(32) NOT NULL DEFAULT 'automatic',
			status VARCHAR(32) NOT NULL DEFAULT 'submitted',
			accepted_at TIMESTAMPTZ,
			rejected_at TIMESTAMPTZ,
			reject_reason TEXT,
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_cessions_treaty ON cessions(treaty_id)`,
		`CREATE INDEX IF NOT EXISTS idx_cessions_policy ON cessions(policy_id)`,
		`CREATE INDEX IF NOT EXISTS idx_cessions_status ON cessions(status)`,

		`CREATE TABLE IF NOT EXISTS recoveries (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			cession_id VARCHAR(64),
			treaty_id UUID NOT NULL REFERENCES treaties(id),
			policy_id VARCHAR(64) NOT NULL,
			claim_amount DECIMAL(15,2) NOT NULL,
			gross_recovery DECIMAL(15,2) NOT NULL DEFAULT 0,
			net_recovery DECIMAL(15,2) NOT NULL DEFAULT 0,
			commission DECIMAL(15,2) NOT NULL DEFAULT 0,
			clawback DECIMAL(15,2) NOT NULL DEFAULT 0,
			status VARCHAR(32) NOT NULL DEFAULT 'pending',
			processed_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_recoveries_treaty ON recoveries(treaty_id)`,
		`CREATE INDEX IF NOT EXISTS idx_recoveries_cession ON recoveries(cession_id)`,

		`CREATE TABLE IF NOT EXISTS commission_calculations (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			treaty_id UUID NOT NULL REFERENCES treaties(id),
			period VARCHAR(16) NOT NULL,
			ceded_premium DECIMAL(15,2) NOT NULL DEFAULT 0,
			gross_commission DECIMAL(15,2) NOT NULL DEFAULT 0,
			commission_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
			clawback_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
			net_commission DECIMAL(15,2) NOT NULL DEFAULT 0,
			paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
			outstanding DECIMAL(15,2) NOT NULL DEFAULT 0,
			status VARCHAR(32) NOT NULL DEFAULT 'pending',
			paid_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_commission_treaty ON commission_calculations(treaty_id)`,
		`CREATE INDEX IF NOT EXISTS idx_commission_period ON commission_calculations(period)`,
	}
	for _, migration := range migrations {
		if _, err := p.Pool.Exec(ctx, migration); err != nil {
			return fmt.Errorf("execute migration: %w", err)
		}
	}
	return nil
}

func (p *Postgres) InsertTreaty(ctx context.Context, t *TreatyDB) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO treaties (id, treaty_id, name, type, reinsurer, reinsurer_code,
			effective_date, expiry_date, period, retention, limit, cession_rate,
			premium_share, commission_rate, clawback_rate, minimum_ceded, status, currency, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
		ON CONFLICT (treaty_id) DO UPDATE SET updated_at = NOW()
	`, t.ID, t.TreatyID, t.Name, t.Type, t.Reinsurer, t.ReinsurerCode,
		t.EffectiveDate, t.ExpiryDate, t.Period, t.Retention, t.Limit, t.CessionRate,
		t.PremiumShare, t.CommissionRate, t.ClawbackRate, t.MinimumCeded, t.Status, t.Currency, t.Metadata)
	return fmt.Errorf("insert treaty: %w", err)
}

func (p *Postgres) GetTreaty(ctx context.Context, id string) (*TreatyDB, error) {
	t := &TreatyDB{}
	err := p.Pool.QueryRow(ctx, `
		SELECT id, treaty_id, name, type, reinsurer, reinsurer_code, effective_date, expiry_date,
			period, retention, limit, cession_rate, premium_share, commission_rate, clawback_rate,
			minimum_ceded, status, currency, metadata, created_at, updated_at
		FROM treaties WHERE id = $1
	`, id).Scan(
		&t.ID, &t.TreatyID, &t.Name, &t.Type, &t.Reinsurer, &t.ReinsurerCode,
		&t.EffectiveDate, &t.ExpiryDate, &t.Period, &t.Retention, &t.Limit,
		&t.CessionRate, &t.PremiumShare, &t.CommissionRate, &t.ClawbackRate,
		&t.MinimumCeded, &t.Status, &t.Currency, &t.Metadata, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get treaty: %w", err)
	}
	return t, nil
}

func (p *Postgres) GetTreatyByRef(ctx context.Context, refID string) (*TreatyDB, error) {
	t := &TreatyDB{}
	err := p.Pool.QueryRow(ctx, `
		SELECT id, treaty_id, name, type, reinsurer, reinsurer_code, effective_date, expiry_date,
			period, retention, limit, cession_rate, premium_share, commission_rate, clawback_rate,
			minimum_ceded, status, currency, metadata, created_at, updated_at
		FROM treaties WHERE treaty_id = $1
	`, refID).Scan(
		&t.ID, &t.TreatyID, &t.Name, &t.Type, &t.Reinsurer, &t.ReinsurerCode,
		&t.EffectiveDate, &t.ExpiryDate, &t.Period, &t.Retention, &t.Limit,
		&t.CessionRate, &t.PremiumShare, &t.CommissionRate, &t.ClawbackRate,
		&t.MinimumCeded, &t.Status, &t.Currency, &t.Metadata, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get treaty by ref: %w", err)
	}
	return t, nil
}

func (p *Postgres) ListTreaties(ctx context.Context, status, treatyType string, limit, offset int) ([]*TreatyDB, error) {
	query := `SELECT id, treaty_id, name, type, reinsurer, reinsurer_code, effective_date, expiry_date,
		period, retention, limit, cession_rate, premium_share, commission_rate, clawback_rate,
		minimum_ceded, status, currency, metadata, created_at, updated_at FROM treaties`
	args := []interface{}{}
	argCount := 1
	conds := []string{}
	if status != "" {
		conds = append(conds, fmt.Sprintf("status = $%d", argCount))
		args = append(args, status)
		argCount++
	}
	if treatyType != "" {
		conds = append(conds, fmt.Sprintf("type = $%d", argCount))
		args = append(args, treatyType)
		argCount++
	}
	if len(conds) > 0 {
		query += " WHERE " + joinConds(conds)
	}
	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", argCount, argCount+1)
	args = append(args, limit, offset)

	rows, err := p.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list treaties: %w", err)
	}
	defer rows.Close()

	var treaties []*TreatyDB
	for rows.Next() {
		t := &TreatyDB{}
		if err := rows.Scan(
			&t.ID, &t.TreatyID, &t.Name, &t.Type, &t.Reinsurer, &t.ReinsurerCode,
			&t.EffectiveDate, &t.ExpiryDate, &t.Period, &t.Retention, &t.Limit,
			&t.CessionRate, &t.PremiumShare, &t.CommissionRate, &t.ClawbackRate,
			&t.MinimumCeded, &t.Status, &t.Currency, &t.Metadata, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan treaty: %w", err)
		}
		treaties = append(treaties, t)
	}
	return treaties, nil
}

func (p *Postgres) UpdateTreatyStatus(ctx context.Context, id, status string) error {
	_, err := p.Pool.Exec(ctx, "UPDATE treaties SET status = $1, updated_at = NOW() WHERE id = $2", status, id)
	return fmt.Errorf("update treaty status: %w", err)
}

func (p *Postgres) InsertCession(ctx context.Context, c *CessionDB) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO cessions (id, cession_id, treaty_id, policy_id, risk_type, gross_amount,
			retention, ceded_amount, cession_rate, reinsurer, type, status, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (cession_id) DO UPDATE SET updated_at = NOW()
	`, c.ID, c.CessionID, c.TreatyID, c.PolicyID, c.RiskType, c.GrossAmount,
		c.Retention, c.CededAmount, c.CessionRate, c.Reinsurer, c.Type, c.Status, c.Metadata)
	return fmt.Errorf("insert cession: %w", err)
}

func (p *Postgres) GetCession(ctx context.Context, cessionID string) (*CessionDB, error) {
	c := &CessionDB{}
	err := p.Pool.QueryRow(ctx, `
		SELECT id, cession_id, treaty_id, policy_id, risk_type, gross_amount, retention,
			ceded_amount, cession_rate, reinsurer, type, status, accepted_at, rejected_at,
			reject_reason, metadata, created_at, updated_at
		FROM cessions WHERE cession_id = $1
	`, cessionID).Scan(
		&c.ID, &c.CessionID, &c.TreatyID, &c.PolicyID, &c.RiskType, &c.GrossAmount,
		&c.Retention, &c.CededAmount, &c.CessionRate, &c.Reinsurer, &c.Type, &c.Status,
		&c.AcceptedAt, &c.RejectedAt, &c.RejectReason, &c.Metadata, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get cession: %w", err)
	}
	return c, nil
}

func (p *Postgres) InsertRecovery(ctx context.Context, r *RecoveryDB) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO recoveries (id, cession_id, treaty_id, policy_id, claim_amount,
			gross_recovery, net_recovery, commission, clawback, status, processed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
	`, r.ID, r.CessionID, r.TreatyID, r.PolicyID, r.ClaimAmount, r.GrossRecovery,
		r.NetRecovery, r.Commission, r.Clawback, r.Status, r.ProcessedAt)
	return fmt.Errorf("insert recovery: %w", err)
}

func (p *Postgres) InsertCommission(ctx context.Context, c *CommissionDB) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO commission_calculations (id, treaty_id, period, ceded_premium,
			gross_commission, commission_rate, clawback_amount, net_commission,
			paid_amount, outstanding, status, paid_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
	`, c.ID, c.TreatyID, c.Period, c.CededPremium, c.GrossCommission, c.CommissionRate,
		c.ClawbackAmount, c.NetCommission, c.PaidAmount, c.Outstanding, c.Status, c.PaidAt)
	return fmt.Errorf("insert commission: %w", err)
}

func (p *Postgres) GetTreatySummary(ctx context.Context, treatyID string) (*TreatySummaryDB, error) {
	s := &TreatySummaryDB{}
	err := p.Pool.QueryRow(ctx, `
		SELECT treaty_id, name, type, reinsurer, status,
			COALESCE(SUM(gross_amount),0), COALESCE(SUM(ceded_amount),0),
			COALESCE(SUM(retention),0), COALESCE(SUM(claim_amount),0),
			COALESCE((SELECT SUM(net_recovery) FROM recoveries r WHERE r.treaty_id = treaties.id),0),
			COALESCE((SELECT SUM(net_commission) FROM commission_calculations c WHERE c.treaty_id = treaties.id),0)
		FROM treaties WHERE id = $1
	`, treatyID).Scan(
		&s.TreatyID, &s.Name, &s.Type, &s.Reinsurer, &s.Status,
		&s.GrossWritten, &s.CededPremium, &s.OutstandingRetention,
		&s.TotalClaims, &s.Recoveries, &s.CommissionEarned,
	)
	if err != nil {
		return nil, fmt.Errorf("get treaty summary: %w", err)
	}
	s.NetExposed = s.GrossWritten - s.CededPremium
	return s, nil
}

func joinConds(conds []string) string {
	result := ""
	for i, c := range conds {
		if i > 0 {
			result += " AND "
		}
		result += c
	}
	return result
}

// TreatyDB is the database model
type TreatyDB struct {
	ID             string  `db:"id"`
	TreatyID       string  `db:"treaty_id"`
	Name           string  `db:"name"`
	Type           string  `db:"type"`
	Reinsurer      string  `db:"reinsurer"`
	ReinsurerCode  string  `db:"reinsurer_code"`
	EffectiveDate  string  `db:"effective_date"`
	ExpiryDate     string  `db:"expiry_date"`
	Period         string  `db:"period"`
	Retention      float64 `db:"retention"`
	Limit          float64 `db:"limit"`
	CessionRate    float64 `db:"cession_rate"`
	PremiumShare   float64 `db:"premium_share"`
	CommissionRate float64 `db:"commission_rate"`
	ClawbackRate   float64 `db:"clawback_rate"`
	MinimumCeded   float64 `db:"minimum_ceded"`
	Status         string  `db:"status"`
	Currency       string  `db:"currency"`
	Metadata       string  `db:"metadata"`
	CreatedAt      string  `db:"created_at"`
	UpdatedAt      string  `db:"updated_at"`
}

// CessionDB is the database model
type CessionDB struct {
	ID           string  `db:"id"`
	CessionID    string  `db:"cession_id"`
	TreatyID     string  `db:"treaty_id"`
	PolicyID     string  `db:"policy_id"`
	RiskType     string  `db:"risk_type"`
	GrossAmount  float64 `db:"gross_amount"`
	Retention    float64 `db:"retention"`
	CededAmount  float64 `db:"ceded_amount"`
	CessionRate  float64 `db:"cession_rate"`
	Reinsurer    string  `db:"reinsurer"`
	Type         string  `db:"type"`
	Status       string  `db:"status"`
	AcceptedAt   *string `db:"accepted_at"`
	RejectedAt   *string `db:"rejected_at"`
	RejectReason string  `db:"reject_reason"`
	Metadata     string  `db:"metadata"`
	CreatedAt    string  `db:"created_at"`
	UpdatedAt    string  `db:"updated_at"`
}

// RecoveryDB is the database model
type RecoveryDB struct {
	ID            string  `db:"id"`
	CessionID     string  `db:"cession_id"`
	TreatyID      string  `db:"treaty_id"`
	PolicyID      string  `db:"policy_id"`
	ClaimAmount   float64 `db:"claim_amount"`
	GrossRecovery float64 `db:"gross_recovery"`
	NetRecovery   float64 `db:"net_recovery"`
	Commission    float64 `db:"commission"`
	Clawback      float64 `db:"clawback"`
	Status        string  `db:"status"`
	ProcessedAt   *string `db:"processed_at"`
	CreatedAt     string  `db:"created_at"`
}

// CommissionDB is the database model
type CommissionDB struct {
	ID              string  `db:"id"`
	TreatyID        string  `db:"treaty_id"`
	Period          string  `db:"period"`
	CededPremium    float64 `db:"ceded_premium"`
	GrossCommission float64 `db:"gross_commission"`
	CommissionRate  float64 `db:"commission_rate"`
	ClawbackAmount  float64 `db:"clawback_amount"`
	NetCommission   float64 `db:"net_commission"`
	PaidAmount      float64 `db:"paid_amount"`
	Outstanding     float64 `db:"outstanding"`
	Status          string  `db:"status"`
	PaidAt          *string `db:"paid_at"`
	CreatedAt       string  `db:"created_at"`
}

// TreatySummaryDB is the database model for treaty summaries
type TreatySummaryDB struct {
	TreatyID             string  `db:"treaty_id"`
	Name                 string  `db:"name"`
	Type                 string  `db:"type"`
	Reinsurer            string  `db:"reinsurer"`
	Status               string  `db:"status"`
	GrossWritten         float64 `db:"gross_written"`
	CededPremium         float64 `db:"ceded_premium"`
	OutstandingRetention float64 `db:"outstanding_retention"`
	TotalClaims          float64 `db:"total_claims"`
	Recoveries           float64 `db:"recoveries"`
	CommissionEarned     float64 `db:"commission_earned"`
	NetExposed           float64 `json:"net_exposed" db:"-"`
}
