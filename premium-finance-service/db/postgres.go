package db

import (
	"context"
	"fmt"

	"github.com/insureportal/premium-finance-service/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres wraps a connection pool with convenience methods
type Postgres struct {
	Pool *pgxpool.Pool
}

// NewPostgres creates a new pool from config
func NewPostgres(ctx context.Context, cfg *config.PostgresConfig) (*Postgres, error) {
	connStr := cfg.DSN()
	poolCfg, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		return nil, fmt.Errorf("parse postgres config: %w", err)
	}
	poolCfg.MaxConns = int32(cfg.MaxOpenConns)
	poolCfg.MinConns = 3
	poolCfg.MaxConnLifetime = cfg.ConnMaxLifetime
	poolCfg.MaxConnIdleTime = cfg.ConnMaxLifetime / 2

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("connect to postgres: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}

	return &Postgres{Pool: pool}, nil
}

// Close releases the pool back to the system
func (p *Postgres) Close() {
	if p != nil && p.Pool != nil {
		p.Pool.Close()
	}
}

// RunMigrations executes all SQL migrations
func (p *Postgres) RunMigrations(ctx context.Context) error {
	migrations := []string{
		// Finance applications table
		`CREATE TABLE IF NOT EXISTS finance_applications (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			application_id VARCHAR(64) UNIQUE NOT NULL,
			policy_id VARCHAR(64) NOT NULL,
			customer_id VARCHAR(64) NOT NULL,
			premium_amount DECIMAL(15,2) NOT NULL,
			currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
			term_months INT NOT NULL,
			frequency VARCHAR(32) NOT NULL DEFAULT 'monthly',
			status VARCHAR(32) NOT NULL DEFAULT 'draft',
			credit_score INT,
			credit_rating VARCHAR(32),
			interest_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
			total_payable DECIMAL(15,2) NOT NULL DEFAULT 0,
			monthly_payment DECIMAL(15,2) NOT NULL DEFAULT 0,
			approved_by VARCHAR(128),
			approved_at TIMESTAMPTZ,
			rejected_at TIMESTAMPTZ,
			rejection_reason TEXT,
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_applications_policy_id ON finance_applications(policy_id)`,
		`CREATE INDEX IF NOT EXISTS idx_applications_customer_id ON finance_applications(customer_id)`,
		`CREATE INDEX IF NOT EXISTS idx_applications_status ON finance_applications(status)`,
		`CREATE INDEX IF NOT EXISTS idx_applications_created_at ON finance_applications(created_at DESC)`,

		// Credit profiles table
		`CREATE TABLE IF NOT EXISTS credit_profiles (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			customer_id VARCHAR(64) NOT NULL,
			credit_score INT NOT NULL,
			score_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			payment_history DECIMAL(6,4) NOT NULL DEFAULT 0,
			claims_ratio DECIMAL(6,4) NOT NULL DEFAULT 0,
			tenure_years INT NOT NULL DEFAULT 0,
			active_policies INT NOT NULL DEFAULT 0,
			default_history INT NOT NULL DEFAULT 0,
			income_estimate DECIMAL(15,2) NOT NULL DEFAULT 0,
			employment_status VARCHAR(64),
			rating VARCHAR(32),
			recommendation TEXT,
			max_financed_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
			recommended_interest_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_credit_profiles_customer ON credit_profiles(customer_id)`,

		// Payment schedule entries
		`CREATE TABLE IF NOT EXISTS payment_schedule_entries (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			loan_id UUID NOT NULL REFERENCES finance_applications(id) ON DELETE CASCADE,
			installment_number INT NOT NULL,
			due_date DATE NOT NULL,
			amount DECIMAL(15,2) NOT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'pending',
			paid_at TIMESTAMPTZ,
			payment_reference VARCHAR(128),
			late_fee DECIMAL(15,2) NOT NULL DEFAULT 0,
			paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_schedule_loan_id ON payment_schedule_entries(loan_id)`,
		`CREATE INDEX IF NOT EXISTS idx_schedule_due_date ON payment_schedule_entries(due_date)`,
		`CREATE INDEX IF NOT EXISTS idx_schedule_status ON payment_schedule_entries(status)`,

		// Collateral table
		`CREATE TABLE IF NOT EXISTS collateral (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			loan_id UUID NOT NULL REFERENCES finance_applications(id) ON DELETE CASCADE,
			type VARCHAR(64) NOT NULL,
			details TEXT NOT NULL,
			value DECIMAL(15,2) NOT NULL,
			currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
			status VARCHAR(32) NOT NULL DEFAULT 'pending',
			verified_at TIMESTAMPTZ,
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Collection actions table
		`CREATE TABLE IF NOT EXISTS collection_actions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			loan_id UUID NOT NULL REFERENCES finance_applications(id) ON DELETE CASCADE,
			customer_id VARCHAR(64) NOT NULL,
			action_type VARCHAR(64) NOT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
			performed_by VARCHAR(128),
			scheduled_at TIMESTAMPTZ,
			completed_at TIMESTAMPTZ,
			notes TEXT,
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_collection_loan_id ON collection_actions(loan_id)`,
		`CREATE INDEX IF NOT EXISTS idx_collection_status ON collection_actions(status)`,

		// Early settlements table
		`CREATE TABLE IF NOT EXISTS early_settlements (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			loan_id UUID NOT NULL REFERENCES finance_applications(id) ON DELETE CASCADE,
			requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			remaining_balance DECIMAL(15,2) NOT NULL,
			remaining_interest DECIMAL(15,2) NOT NULL,
			rebate_amount DECIMAL(15,2) NOT NULL,
			rebate_percent DECIMAL(6,4) NOT NULL,
			total_payable DECIMAL(15,2) NOT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'requested',
			processed_by VARCHAR(128),
			processed_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Loan summary materialized view
		`CREATE OR REPLACE VIEW loan_summary AS
		SELECT
			fa.id,
			fa.application_id,
			fa.policy_id,
			fa.customer_id,
			fa.premium_amount,
			fa.term_months,
			fa.status,
			fa.credit_score,
			fa.interest_rate,
			fa.monthly_payment,
			COALESCE(SUM(ps.amount - ps.paid_amount), 0) as outstanding_balance,
			COUNT(ps.id) FILTER (WHERE ps.status = 'paid') as paid_installments,
			COUNT(ps.id) as total_installments,
			fa.created_at
		FROM finance_applications fa
		LEFT JOIN payment_schedule_entries ps ON ps.loan_id = fa.id
		GROUP BY fa.id
		`,
	}

	for _, migration := range migrations {
		if _, err := p.Pool.Exec(ctx, migration); err != nil {
			return fmt.Errorf("execute migration: %w", err)
		}
	}
	return nil
}

// InsertApplication creates a new finance application
func (p *Postgres) InsertApplication(ctx context.Context, app *ApplicationDB) error {
	query := `
		INSERT INTO finance_applications (id, application_id, policy_id, customer_id,
			premium_amount, currency, term_months, frequency, status, credit_score,
			credit_rating, interest_rate, total_payable, monthly_payment,
			approved_by, approved_at, rejected_at, rejection_reason, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
		ON CONFLICT (application_id) DO UPDATE SET
			updated_at = NOW(),
			premium_amount = EXCLUDED.premium_amount,
			term_months = EXCLUDED.term_months,
			status = EXCLUDED.status
	`
	_, err := p.Pool.Exec(ctx, query,
		app.ID, app.ApplicationID, app.PolicyID, app.CustomerID,
		app.PremiumAmount, app.Currency, app.TermMonths, app.Frequency, app.Status,
		app.CreditScore, app.CreditRating, app.InterestRate, app.TotalPayable, app.MonthlyPayment,
		app.ApprovedBy, app.ApprovedAt, app.RejectedAt, app.RejectionReason, app.Metadata,
	)
	if err != nil {
		return fmt.Errorf("insert application: %w", err)
	}
	return nil
}

// GetApplication retrieves a finance application by ID
func (p *Postgres) GetApplication(ctx context.Context, id string) (*ApplicationDB, error) {
	app := &ApplicationDB{}
	query := `
		SELECT id, application_id, policy_id, customer_id, premium_amount, currency,
			term_months, frequency, status, credit_score, credit_rating, interest_rate,
			total_payable, monthly_payment, approved_by, approved_at, rejected_at,
			rejection_reason, metadata, created_at, updated_at
		FROM finance_applications
		WHERE id = $1
	`
	err := p.Pool.QueryRow(ctx, query, id).Scan(
		&app.ID, &app.ApplicationID, &app.PolicyID, &app.CustomerID,
		&app.PremiumAmount, &app.Currency, &app.TermMonths, &app.Frequency,
		&app.Status, &app.CreditScore, &app.CreditRating, &app.InterestRate,
		&app.TotalPayable, &app.MonthlyPayment, &app.ApprovedBy, &app.ApprovedAt,
		&app.RejectedAt, &app.RejectionReason, &app.Metadata, &app.CreatedAt, &app.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get application: %w", err)
	}
	return app, nil
}

// GetApplicationByReference retrieves by application ID
func (p *Postgres) GetApplicationByReference(ctx context.Context, refID string) (*ApplicationDB, error) {
	app := &ApplicationDB{}
	query := `
		SELECT id, application_id, policy_id, customer_id, premium_amount, currency,
			term_months, frequency, status, credit_score, credit_rating, interest_rate,
			total_payable, monthly_payment, approved_by, approved_at, rejected_at,
			rejection_reason, metadata, created_at, updated_at
		FROM finance_applications
		WHERE application_id = $1
	`
	err := p.Pool.QueryRow(ctx, query, refID).Scan(
		&app.ID, &app.ApplicationID, &app.PolicyID, &app.CustomerID,
		&app.PremiumAmount, &app.Currency, &app.TermMonths, &app.Frequency,
		&app.Status, &app.CreditScore, &app.CreditRating, &app.InterestRate,
		&app.TotalPayable, &app.MonthlyPayment, &app.ApprovedBy, &app.ApprovedAt,
		&app.RejectedAt, &app.RejectionReason, &app.Metadata, &app.CreatedAt, &app.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get application by reference: %w", err)
	}
	return app, nil
}

// UpdateApplicationStatus updates the status of a finance application
func (p *Postgres) UpdateApplicationStatus(ctx context.Context, id, status string) error {
	query := `UPDATE finance_applications SET status = $1, updated_at = NOW() WHERE id = $2`
	_, err := p.Pool.Exec(ctx, query, status, id)
	if err != nil {
		return fmt.Errorf("update application status: %w", err)
	}
	return nil
}

// ListApplications retrieves applications with pagination and filtering
func (p *Postgres) ListApplications(ctx context.Context, status string, limit, offset int) ([]*ApplicationDB, error) {
	query := `
		SELECT id, application_id, policy_id, customer_id, premium_amount, currency,
			term_months, frequency, status, credit_score, credit_rating, interest_rate,
			total_payable, monthly_payment, approved_by, approved_at, rejected_at,
			rejection_reason, metadata, created_at, updated_at
		FROM finance_applications
	`
	args := []interface{}{}
	argCount := 1

	if status != "" {
		query += fmt.Sprintf(" WHERE status = $%d", argCount)
		args = append(args, status)
		argCount++
	}

	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", argCount, argCount+1)
	args = append(args, limit, offset)

	rows, err := p.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list applications: %w", err)
	}
	defer rows.Close()

	var apps []*ApplicationDB
	for rows.Next() {
		app := &ApplicationDB{}
		if err := rows.Scan(
			&app.ID, &app.ApplicationID, &app.PolicyID, &app.CustomerID,
			&app.PremiumAmount, &app.Currency, &app.TermMonths, &app.Frequency,
			&app.Status, &app.CreditScore, &app.CreditRating, &app.InterestRate,
			&app.TotalPayable, &app.MonthlyPayment, &app.ApprovedBy, &app.ApprovedAt,
			&app.RejectedAt, &app.RejectionReason, &app.Metadata, &app.CreatedAt, &app.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan application: %w", err)
		}
		apps = append(apps, app)
	}
	return apps, nil
}

// InsertCreditProfile creates or updates a credit profile for a customer
func (p *Postgres) UpsertCreditProfile(ctx context.Context, profile *CreditProfileDB) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO credit_profiles (id, customer_id, credit_score, score_date,
			payment_history, claims_ratio, tenure_years, active_policies,
			default_history, income_estimate, employment_status, rating,
			recommendation, max_financed_amount, recommended_interest_rate)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
		ON CONFLICT (customer_id) DO UPDATE SET
			credit_score = EXCLUDED.credit_score,
			score_date = EXCLUDED.score_date,
			payment_history = EXCLUDED.payment_history,
			claims_ratio = EXCLUDED.claims_ratio,
			rating = EXCLUDED.rating,
			recommendation = EXCLUDED.recommendation,
			max_financed_amount = EXCLUDED.max_financed_amount,
			recommended_interest_rate = EXCLUDED.recommended_interest_rate
	`, profile.ID, profile.CustomerID, profile.CreditScore, profile.ScoreDate,
		profile.PaymentHistory, profile.ClaimsRatio, profile.TenureYears,
		profile.ActivePolicies, profile.DefaultHistory, profile.IncomeEstimate,
		profile.EmploymentStatus, profile.Rating, profile.Recommendation,
		profile.MaxFinanced, profile.RecommendedRate)
	if err != nil {
		return fmt.Errorf("upsert credit profile: %w", err)
	}
	return nil
}

// GetCreditProfile retrieves a credit profile by customer
func (p *Postgres) GetCreditProfile(ctx context.Context, customerID string) (*CreditProfileDB, error) {
	profile := &CreditProfileDB{}
	query := `
		SELECT id, customer_id, credit_score, score_date, payment_history, claims_ratio,
			tenure_years, active_policies, default_history, income_estimate,
			employment_status, rating, recommendation, max_financed_amount,
			recommended_interest_rate, created_at
		FROM credit_profiles
		WHERE customer_id = $1
		ORDER BY score_date DESC
		LIMIT 1
	`
	err := p.Pool.QueryRow(ctx, query, customerID).Scan(
		&profile.ID, &profile.CustomerID, &profile.CreditScore, &profile.ScoreDate,
		&profile.PaymentHistory, &profile.ClaimsRatio, &profile.TenureYears,
		&profile.ActivePolicies, &profile.DefaultHistory, &profile.IncomeEstimate,
		&profile.EmploymentStatus, &profile.Rating, &profile.Recommendation,
		&profile.MaxFinanced, &profile.RecommendedRate, &profile.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get credit profile: %w", err)
	}
	return profile, nil
}

// GeneratePaymentSchedule creates payment schedule entries for an application
func (p *Postgres) GeneratePaymentSchedule(ctx context.Context, loanID string, entries []*ScheduleEntryDB) error {
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, entry := range entries {
		_, err := tx.Exec(ctx, `
			INSERT INTO payment_schedule_entries (id, loan_id, installment_number, due_date, amount, status)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, entry.ID, loanID, entry.InstallmentNumber, entry.DueDate, entry.Amount, entry.Status)
		if err != nil {
			return fmt.Errorf("insert schedule entry: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit schedule: %w", err)
	}
	return nil
}

// GetPaymentSchedule retrieves all schedule entries for a loan
func (p *Postgres) GetPaymentSchedule(ctx context.Context, loanID string) ([]*ScheduleEntryDB, error) {
	query := `
		SELECT id, loan_id, installment_number, due_date, amount, status,
			paid_at, payment_reference, late_fee, paid_amount, created_at
		FROM payment_schedule_entries
		WHERE loan_id = $1
		ORDER BY installment_number ASC
	`
	rows, err := p.Pool.Query(ctx, query, loanID)
	if err != nil {
		return nil, fmt.Errorf("query schedule: %w", err)
	}
	defer rows.Close()

	var entries []*ScheduleEntryDB
	for rows.Next() {
		entry := &ScheduleEntryDB{}
		if err := rows.Scan(
			&entry.ID, &entry.LoanID, &entry.InstallmentNumber, &entry.DueDate,
			&entry.Amount, &entry.Status, &entry.PaidAt, &entry.PaymentReference,
			&entry.LateFee, &entry.PaidAmount, &entry.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan schedule entry: %w", err)
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

// UpdateScheduleEntryStatus updates a schedule entry status
func (p *Postgres) UpdateScheduleEntryStatus(ctx context.Context, id, status string) error {
	query := `UPDATE payment_schedule_entries SET status = $1, paid_at = NOW() WHERE id = $2`
	_, err := p.Pool.Exec(ctx, query, status, id)
	if err != nil {
		return fmt.Errorf("update schedule entry: %w", err)
	}
	return nil
}

// InsertCollateral creates collateral for a loan
func (p *Postgres) InsertCollateral(ctx context.Context, coll *CollateralDB) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO collateral (id, loan_id, type, details, value, currency, status, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, coll.ID, coll.LoanID, coll.Type, coll.Details, coll.Value, coll.Currency, coll.Status, coll.Metadata)
	if err != nil {
		return fmt.Errorf("insert collateral: %w", err)
	}
	return nil
}

// GetCollateral retrieves collateral for a loan
func (p *Postgres) GetCollateral(ctx context.Context, loanID string) (*CollateralDB, error) {
	coll := &CollateralDB{}
	query := `
		SELECT id, loan_id, type, details, value, currency, status, verified_at, metadata, created_at
		FROM collateral WHERE loan_id = $1
	`
	err := p.Pool.QueryRow(ctx, query, loanID).Scan(
		&coll.ID, &coll.LoanID, &coll.Type, &coll.Details, &coll.Value,
		&coll.Currency, &coll.Status, &coll.VerifiedAt, &coll.Metadata, &coll.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get collateral: %w", err)
	}
	return coll, nil
}

// InsertCollectionAction creates a collection action record
func (p *Postgres) InsertCollectionAction(ctx context.Context, action *CollectionActionDB) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO collection_actions (id, loan_id, customer_id, action_type,
			status, performed_by, scheduled_at, notes, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, action.ID, action.LoanID, action.CustomerID, action.ActionType,
		action.Status, action.PerformedBy, action.ScheduledAt, action.Notes, action.Metadata)
	if err != nil {
		return fmt.Errorf("insert collection action: %w", err)
	}
	return nil
}

// InsertEarlySettlement creates an early settlement record
func (p *Postgres) InsertEarlySettlement(ctx context.Context, settlement *EarlySettlementDB) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO early_settlements (id, loan_id, requested_at, remaining_balance,
			remaining_interest, rebate_amount, rebate_percent, total_payable,
			status, processed_by, processed_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, settlement.ID, settlement.LoanID, settlement.RequestedAt,
		settlement.RemainingBalance, settlement.RemainingInterest,
		settlement.RebateAmount, settlement.RebatePercent,
		settlement.TotalPayable, settlement.Status,
		settlement.ProcessedBy, settlement.ProcessedAt)
	if err != nil {
		return fmt.Errorf("insert early settlement: %w", err)
	}
	return nil
}

// GetLoanSummary retrieves the materialized loan summary
func (p *Postgres) GetLoanSummary(ctx context.Context) ([]map[string]interface{}, error) {
	rows, err := p.Pool.Query(ctx, `SELECT * FROM loan_summary`)
	if err != nil {
		return nil, fmt.Errorf("query loan summary: %w", err)
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		columns := rows.FieldDescriptions()
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, fmt.Errorf("scan summary row: %w", err)
		}
		row := make(map[string]interface{})
		for i, col := range columns {
			row[col.Name] = values[i]
		}
		results = append(results, row)
	}
	return results, nil
}

// ApplicationDB is the database model for finance applications
type ApplicationDB struct {
	ID              string  `db:"id"`
	ApplicationID   string  `db:"application_id"`
	PolicyID        string  `db:"policy_id"`
	CustomerID      string  `db:"customer_id"`
	PremiumAmount   float64 `db:"premium_amount"`
	Currency        string  `db:"currency"`
	TermMonths      int     `db:"term_months"`
	Frequency       string  `db:"frequency"`
	Status          string  `db:"status"`
	CreditScore     int     `db:"credit_score"`
	CreditRating    string  `db:"credit_rating"`
	InterestRate    float64 `db:"interest_rate"`
	TotalPayable    float64 `db:"total_payable"`
	MonthlyPayment  float64 `db:"monthly_payment"`
	ApprovedBy      string  `db:"approved_by"`
	ApprovedAt      *string `db:"approved_at"`
	RejectedAt      *string `db:"rejected_at"`
	RejectionReason string  `db:"rejection_reason"`
	Metadata        string  `db:"metadata"`
	CreatedAt       string  `db:"created_at"`
	UpdatedAt       string  `db:"updated_at"`
}

// CreditProfileDB is the database model for credit profiles
type CreditProfileDB struct {
	ID               string  `db:"id"`
	CustomerID       string  `db:"customer_id"`
	CreditScore      int     `db:"credit_score"`
	ScoreDate        string  `db:"score_date"`
	PaymentHistory   float64 `db:"payment_history"`
	ClaimsRatio      float64 `db:"claims_ratio"`
	TenureYears      int     `db:"tenure_years"`
	ActivePolicies   int     `db:"active_policies"`
	DefaultHistory   int     `db:"default_history"`
	IncomeEstimate   float64 `db:"income_estimate"`
	EmploymentStatus string  `db:"employment_status"`
	Rating           string  `db:"rating"`
	Recommendation   string  `db:"recommendation"`
	MaxFinanced      float64 `db:"max_financed_amount"`
	RecommendedRate  float64 `db:"recommended_interest_rate"`
	CreatedAt        string  `db:"created_at"`
}

// ScheduleEntryDB is the database model for payment schedule entries
type ScheduleEntryDB struct {
	ID                string  `db:"id"`
	LoanID            string  `db:"loan_id"`
	InstallmentNumber int     `db:"installment_number"`
	DueDate           string  `db:"due_date"`
	Amount            float64 `db:"amount"`
	Status            string  `db:"status"`
	PaidAt            *string `db:"paid_at"`
	PaymentReference  string  `db:"payment_reference"`
	LateFee           float64 `db:"late_fee"`
	PaidAmount        float64 `db:"paid_amount"`
	CreatedAt         string  `db:"created_at"`
}

// CollateralDB is the database model for collateral
type CollateralDB struct {
	ID         string  `db:"id"`
	LoanID     string  `db:"loan_id"`
	Type       string  `db:"type"`
	Details    string  `db:"details"`
	Value      float64 `db:"value"`
	Currency   string  `db:"currency"`
	Status     string  `db:"status"`
	VerifiedAt *string `db:"verified_at"`
	Metadata   string  `db:"metadata"`
	CreatedAt  string  `db:"created_at"`
}

// CollectionActionDB is the database model for collection actions
type CollectionActionDB struct {
	ID          string  `db:"id"`
	LoanID      string  `db:"loan_id"`
	CustomerID  string  `db:"customer_id"`
	ActionType  string  `db:"action_type"`
	Status      string  `db:"status"`
	PerformedBy string  `db:"performed_by"`
	ScheduledAt *string `db:"scheduled_at"`
	CompletedAt *string `db:"completed_at"`
	Notes       string  `db:"notes"`
	Metadata    string  `db:"metadata"`
	CreatedAt   string  `db:"created_at"`
}

// EarlySettlementDB is the database model for early settlements
type EarlySettlementDB struct {
	ID                string  `db:"id"`
	LoanID            string  `db:"loan_id"`
	RequestedAt       string  `db:"requested_at"`
	RemainingBalance  float64 `db:"remaining_balance"`
	RemainingInterest float64 `db:"remaining_interest"`
	RebateAmount      float64 `db:"rebate_amount"`
	RebatePercent     float64 `db:"rebate_percent"`
	TotalPayable      float64 `db:"total_payable"`
	Status            string  `db:"status"`
	ProcessedBy       string  `db:"processed_by"`
	ProcessedAt       *string `db:"processed_at"`
	CreatedAt         string  `db:"created_at"`
}
