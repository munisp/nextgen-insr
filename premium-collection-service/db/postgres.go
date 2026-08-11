package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"premium-collection-service/config"
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
		// Payments table
		`CREATE TABLE IF NOT EXISTS payments (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			policy_id VARCHAR(64) NOT NULL,
			customer_id VARCHAR(64) NOT NULL,
			amount DECIMAL(15,2) NOT NULL,
			currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
			method VARCHAR(32) NOT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'pending',
			fee DECIMAL(15,2) NOT NULL DEFAULT 0,
			fee_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
			net_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
			receipt_id VARCHAR(64) UNIQUE,
			reference_id VARCHAR(128) UNIQUE,
			settled_at TIMESTAMPTZ,
			failed_at TIMESTAMPTZ,
			failed_reason TEXT,
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_payments_policy_id ON payments(policy_id)`,
		`CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id)`,
		`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)`,
		`CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_payments_method ON payments(method)`,

		// Installment plans
		`CREATE TABLE IF NOT EXISTS installment_plans (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			policy_id VARCHAR(64) NOT NULL,
			customer_id VARCHAR(64) NOT NULL,
			total_amount DECIMAL(15,2) NOT NULL,
			remaining DECIMAL(15,2) NOT NULL,
			installments INT NOT NULL,
			installment_amount DECIMAL(15,2) NOT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'active',
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_installment_plans_policy_id ON installment_plans(policy_id)`,
		`CREATE INDEX IF NOT EXISTS idx_installment_plans_status ON installment_plans(status)`,

		// Installment schedule entries
		`CREATE TABLE IF NOT EXISTS installment_entries (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			plan_id UUID NOT NULL REFERENCES installment_plans(id) ON DELETE CASCADE,
			installment_number INT NOT NULL,
			due_date DATE NOT NULL,
			amount DECIMAL(15,2) NOT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'pending',
			paid_at TIMESTAMPTZ,
			payment_id UUID REFERENCES payments(id),
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_installment_entries_plan_id ON installment_entries(plan_id)`,
		`CREATE INDEX IF NOT EXISTS idx_installment_entries_due_date ON installment_entries(due_date)`,
		`CREATE INDEX IF NOT EXISTS idx_installment_entries_status ON installment_entries(status)`,

		// Payment receipts
		`CREATE TABLE IF NOT EXISTS payment_receipts (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
			policy_id VARCHAR(64) NOT NULL,
			customer_name VARCHAR(255) NOT NULL,
			amount DECIMAL(15,2) NOT NULL,
			fee DECIMAL(15,2) NOT NULL DEFAULT 0,
			net_amount DECIMAL(15,2) NOT NULL,
			method VARCHAR(32) NOT NULL,
			reference_id VARCHAR(128) NOT NULL,
			issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			valid_until TIMESTAMPTZ NOT NULL,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Dunning records
		`CREATE TABLE IF NOT EXISTS dunning_records (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			policy_id VARCHAR(64) NOT NULL,
			customer_id VARCHAR(64) NOT NULL,
			amount DECIMAL(15,2) NOT NULL,
			attempt INT NOT NULL DEFAULT 1,
			status VARCHAR(32) NOT NULL DEFAULT 'pending',
			reminder_type VARCHAR(32) NOT NULL DEFAULT 'email',
			sent_at TIMESTAMPTZ,
			next_attempt TIMESTAMPTZ NOT NULL,
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_dunning_policy ON dunning_records(policy_id)`,
		`CREATE INDEX IF NOT EXISTS idx_dunning_status ON dunning_records(status)`,

		// Auto-debit configs
		`CREATE TABLE IF NOT EXISTS auto_debit_configs (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			policy_id VARCHAR(64) NOT NULL,
			customer_id VARCHAR(64) NOT NULL,
			bank_name VARCHAR(128) NOT NULL,
			account_number VARCHAR(10) NOT NULL,
			account_name VARCHAR(255) NOT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'pending',
			next_debit_date DATE,
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_debit_policy ON auto_debit_configs(policy_id)`,

		// Reconciliation records
		`CREATE TABLE IF NOT EXISTS reconciliation_records (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			date DATE NOT NULL,
			total_collected DECIMAL(15,2) NOT NULL DEFAULT 0,
			total_reconciled DECIMAL(15,2) NOT NULL DEFAULT 0,
			total_pending DECIMAL(15,2) NOT NULL DEFAULT 0,
			total_discrepancy DECIMAL(15,2) NOT NULL DEFAULT 0,
			discrepancy_count INT NOT NULL DEFAULT 0,
			channel_breakdown JSONB DEFAULT '[]'::jsonb,
			status VARCHAR(32) NOT NULL DEFAULT 'pending',
			created_at TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE(date)
		)`,
	}

	for _, migration := range migrations {
		if _, err := p.Pool.Exec(ctx, migration); err != nil {
			return fmt.Errorf("execute migration: %w", err)
		}
	}
	return nil
}

// InsertPayment creates a new payment record with idempotency support
func (p *Postgres) InsertPayment(ctx context.Context, payment *PaymentDB) error {
	query := `
		INSERT INTO payments (id, policy_id, customer_id, amount, currency, method, status,
			fee, fee_rate, net_amount, receipt_id, reference_id, settled_at,
			failed_at, failed_reason, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		ON CONFLICT (reference_id) DO NOTHING
	`
	_, err := p.Pool.Exec(ctx, query,
		payment.ID, payment.PolicyID, payment.CustomerID, payment.Amount, payment.Currency,
		payment.Method, payment.Status, payment.Fee, payment.FeeRate, payment.NetAmount,
		payment.ReceiptID, payment.ReferenceID, payment.SettledAt,
		payment.FailedAt, payment.FailedReason, payment.Metadata,
	)
	if err != nil {
		return fmt.Errorf("insert payment: %w", err)
	}
	return nil
}

// GetPaymentByReference retrieves a payment by its external reference ID
func (p *Postgres) GetPaymentByReference(ctx context.Context, referenceID string) (*PaymentDB, error) {
	payment := &PaymentDB{}
	query := `
		SELECT id, policy_id, customer_id, amount, currency, method, status,
			fee, fee_rate, net_amount, receipt_id, reference_id, settled_at,
			failed_at, failed_reason, metadata, created_at, updated_at
		FROM payments
		WHERE reference_id = $1
	`
	err := p.Pool.QueryRow(ctx, query, referenceID).Scan(
		&payment.ID, &payment.PolicyID, &payment.CustomerID, &payment.Amount,
		&payment.Currency, &payment.Method, &payment.Status, &payment.Fee,
		&payment.FeeRate, &payment.NetAmount, &payment.ReceiptID, &payment.ReferenceID,
		&payment.SettledAt, &payment.FailedAt, &payment.FailedReason, &payment.Metadata,
		&payment.CreatedAt, &payment.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get payment by reference: %w", err)
	}
	return payment, nil
}

// UpdatePaymentStatus updates the status of a payment
func (p *Postgres) UpdatePaymentStatus(ctx context.Context, id, newStatus string) error {
	query := `UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2`
	_, err := p.Pool.Exec(ctx, query, newStatus, id)
	if err != nil {
		return fmt.Errorf("update payment status: %w", err)
	}
	return nil
}

// GetPaymentsByPolicy retrieves all payments for a policy with pagination
func (p *Postgres) GetPaymentsByPolicy(ctx context.Context, policyID string, limit, offset int) ([]*PaymentDB, error) {
	query := `
		SELECT id, policy_id, customer_id, amount, currency, method, status,
			fee, fee_rate, net_amount, receipt_id, reference_id, settled_at,
			failed_at, failed_reason, metadata, created_at, updated_at
		FROM payments
		WHERE policy_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`
	rows, err := p.Pool.Query(ctx, query, policyID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("query payments: %w", err)
	}
	defer rows.Close()

	var payments []*PaymentDB
	for rows.Next() {
		payment := &PaymentDB{}
		if err := rows.Scan(
			&payment.ID, &payment.PolicyID, &payment.CustomerID, &payment.Amount,
			&payment.Currency, &payment.Method, &payment.Status, &payment.Fee,
			&payment.FeeRate, &payment.NetAmount, &payment.ReceiptID, &payment.ReferenceID,
			&payment.SettledAt, &payment.FailedAt, &payment.FailedReason, &payment.Metadata,
			&payment.CreatedAt, &payment.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan payment: %w", err)
		}
		payments = append(payments, payment)
	}
	return payments, nil
}

// CreateInstallmentPlan creates an installment plan and generates schedule entries
func (p *Postgres) CreateInstallmentPlan(ctx context.Context, plan *InstallmentPlanDB) error {
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Insert plan
	result, err := tx.Exec(ctx, `
		INSERT INTO installment_plans (id, policy_id, customer_id, total_amount, remaining,
			installments, installment_amount, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, plan.ID, plan.PolicyID, plan.CustomerID, plan.TotalAmount, plan.Remaining,
		plan.Installments, plan.InstallmentAmount, plan.Status)
	if err != nil {
		return fmt.Errorf("insert installment plan: %w", err)
	}
	_ = result

	// Generate schedule entries
	startDate, err := time.Parse("2006-01-02", plan.StartDate)
	if err != nil {
		return fmt.Errorf("invalid plan start date: %w", err)
	}
	for i := 1; i <= plan.Installments; i++ {
		dueDate := startDate.AddDate(0, i-1, 0)
		if _, err := tx.Exec(ctx, `
			INSERT INTO installment_entries (id, plan_id, installment_number, due_date, amount, status)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, plan.Schedule[i-1].ID, plan.ID, i, dueDate, plan.InstallmentAmount, "pending"); err != nil {
			return fmt.Errorf("insert installment entry: %w", err)
		}
	}

	return tx.Commit(ctx)
}

// GetInstallmentPlan retrieves a plan with its schedule entries
func (p *Postgres) GetInstallmentPlan(ctx context.Context, planID string) (*InstallmentPlanDB, error) {
	plan := &InstallmentPlanDB{}
	query := `
		SELECT id, policy_id, customer_id, total_amount, remaining, installments,
			installment_amount, status, start_date, created_at, updated_at
		FROM installment_plans
		WHERE id = $1
	`
	err := p.Pool.QueryRow(ctx, query, planID).Scan(
		&plan.ID, &plan.PolicyID, &plan.CustomerID, &plan.TotalAmount, &plan.Remaining,
		&plan.Installments, &plan.InstallmentAmount, &plan.Status, &plan.StartDate,
		&plan.CreatedAt, &plan.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get installment plan: %w", err)
	}

	// Fetch schedule entries
	entries, err := p.GetInstallmentEntries(ctx, planID)
	if err != nil {
		return nil, err
	}
	plan.Schedule = entries
	return plan, nil
}

// GetInstallmentEntries retrieves schedule entries for a plan
func (p *Postgres) GetInstallmentEntries(ctx context.Context, planID string) ([]*InstallmentEntryDB, error) {
	query := `
		SELECT id, plan_id, installment_number, due_date, amount, status,
			paid_at, payment_id, created_at, updated_at
		FROM installment_entries
		WHERE plan_id = $1
		ORDER BY installment_number ASC
	`
	rows, err := p.Pool.Query(ctx, query, planID)
	if err != nil {
		return nil, fmt.Errorf("query installment entries: %w", err)
	}
	defer rows.Close()

	var entries []*InstallmentEntryDB
	for rows.Next() {
		entry := &InstallmentEntryDB{}
		if err := rows.Scan(
			&entry.ID, &entry.PlanID, &entry.InstallmentNumber, &entry.DueDate,
			&entry.Amount, &entry.Status, &entry.PaidAt, &entry.PaymentID,
			&entry.CreatedAt, &entry.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan entry: %w", err)
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

// CreateDunningRecord creates a dunning reminder record
func (p *Postgres) CreateDunningRecord(ctx context.Context, dunning *DunningDB) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO dunning_records (id, policy_id, customer_id, amount, attempt,
			status, reminder_type, next_attempt, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, dunning.ID, dunning.PolicyID, dunning.CustomerID, dunning.Amount,
		dunning.Attempt, dunning.Status, dunning.ReminderType,
		dunning.NextAttempt, dunning.Metadata)
	return fmt.Errorf("create dunning record: %w", err)
}

// GetPendingDunningRecords retrieves dunning records with pending status
func (p *Postgres) GetPendingDunningRecords(ctx context.Context) ([]*DunningDB, error) {
	query := `
		SELECT id, policy_id, customer_id, amount, attempt, status, reminder_type,
			sent_at, next_attempt, metadata, created_at, updated_at
		FROM dunning_records
		WHERE status = 'pending'
		ORDER BY next_attempt ASC
	`
	rows, err := p.Pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query pending dunning: %w", err)
	}
	defer rows.Close()

	var records []*DunningDB
	for rows.Next() {
		rec := &DunningDB{}
		if err := rows.Scan(
			&rec.ID, &rec.PolicyID, &rec.CustomerID, &rec.Amount, &rec.Attempt,
			&rec.Status, &rec.ReminderType, &rec.SentAt, &rec.NextAttempt,
			&rec.Metadata, &rec.CreatedAt, &rec.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan dunning record: %w", err)
		}
		records = append(records, rec)
	}
	return records, nil
}

// CreateAutoDebitConfig creates or updates auto-debit configuration
func (p *Postgres) CreateAutoDebitConfig(ctx context.Context, cfg *AutoDebitDB) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO auto_debit_configs (id, policy_id, customer_id, bank_name,
			account_number, account_name, status, next_debit_date, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (policy_id) DO UPDATE SET
			account_number = EXCLUDED.account_number,
			account_name = EXCLUDED.account_name,
			status = EXCLUDED.status,
			next_debit_date = EXCLUDED.next_debit_date,
			metadata = EXCLUDED.metadata,
			updated_at = NOW()
	`, cfg.ID, cfg.PolicyID, cfg.CustomerID, cfg.BankName,
		cfg.AccountNumber, cfg.AccountName, cfg.Status, cfg.NextDebitDate, cfg.Metadata)
	return fmt.Errorf("create auto-debit config: %w", err)
}

// GetAutoDebitConfig retrieves auto-debit config by policy
func (p *Postgres) GetAutoDebitConfig(ctx context.Context, policyID string) (*AutoDebitDB, error) {
	cfg := &AutoDebitDB{}
	query := `
		SELECT id, policy_id, customer_id, bank_name, account_number, account_name,
			status, next_debit_date, metadata, created_at, updated_at
		FROM auto_debit_configs
		WHERE policy_id = $1
	`
	err := p.Pool.QueryRow(ctx, query, policyID).Scan(
		&cfg.ID, &cfg.PolicyID, &cfg.CustomerID, &cfg.BankName, &cfg.AccountNumber,
		&cfg.AccountName, &cfg.Status, &cfg.NextDebitDate, &cfg.Metadata,
		&cfg.CreatedAt, &cfg.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get auto-debit config: %w", err)
	}
	return cfg, nil
}

// UpsertReconciliationRecord creates or updates a daily reconciliation
func (p *Postgres) UpsertReconciliationRecord(ctx context.Context, rec *ReconciliationDB) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO reconciliation_records (date, total_collected, total_reconciled,
			total_pending, total_discrepancy, discrepancy_count, channel_breakdown, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (date) DO UPDATE SET
			total_collected = EXCLUDED.total_collected,
			total_reconciled = EXCLUDED.total_reconciled,
			total_pending = EXCLUDED.total_pending,
			total_discrepancy = EXCLUDED.total_discrepancy,
			discrepancy_count = EXCLUDED.discrepancy_count,
			channel_breakdown = EXCLUDED.channel_breakdown,
			status = EXCLUDED.status,
			updated_at = NOW()
	`, rec.Date, rec.TotalCollected, rec.TotalReconciled, rec.TotalPending,
		rec.TotalDiscrepancy, rec.DiscrepancyCount, rec.ChannelBreakdown, rec.Status)
	return fmt.Errorf("upsert reconciliation record: %w", err)
}

// GetReconciliationByDate retrieves a daily reconciliation record
func (p *Postgres) GetReconciliationByDate(ctx context.Context, date string) (*ReconciliationDB, error) {
	rec := &ReconciliationDB{}
	query := `
		SELECT id, date, total_collected, total_reconciled, total_pending,
			total_discrepancy, discrepancy_count, channel_breakdown, status, created_at
		FROM reconciliation_records
		WHERE date = $1
	`
	err := p.Pool.QueryRow(ctx, query, date).Scan(
		&rec.ID, &rec.Date, &rec.TotalCollected, &rec.TotalReconciled,
		&rec.TotalPending, &rec.TotalDiscrepancy, &rec.DiscrepancyCount,
		&rec.ChannelBreakdown, &rec.Status, &rec.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get reconciliation: %w", err)
	}
	return rec, nil
}

// PaymentCollectionStats holds aggregate payment statistics
type PaymentCollectionStats struct {
	TotalCollected float64           `json:"total_collected"`
	TotalFees      float64           `json:"total_fees"`
	TotalNet       float64           `json:"total_net"`
	PaymentCount   int64             `json:"payment_count"`
	ByMethod       []MethodBreakdown `json:"by_method"`
	ByStatus       []StatusBreakdown `json:"by_status"`
}

// MethodBreakdown shows collection stats per payment method
type MethodBreakdown struct {
	Method      string  `json:"method"`
	Count       int64   `json:"count"`
	TotalAmount float64 `json:"total_amount"`
	TotalFees   float64 `json:"total_fees"`
}

// StatusBreakdown shows payment counts per status
type StatusBreakdown struct {
	Status string `json:"status"`
	Count  int64  `json:"count"`
}

// GetCollectionStats returns aggregated collection statistics
func (p *Postgres) GetCollectionStats(ctx context.Context, startDate, endDate string) (*PaymentCollectionStats, error) {
	stats := &PaymentCollectionStats{}

	var row pgx.Row
	row = p.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0), COALESCE(SUM(fee), 0), COALESCE(SUM(net_amount), 0),
			COUNT(*)
		FROM payments
		WHERE created_at BETWEEN $1 AND $2 AND status = 'confirmed'
	`, startDate, endDate)
	if err := row.Scan(&stats.TotalCollected, &stats.TotalFees, &stats.TotalNet, &stats.PaymentCount); err != nil {
		return nil, fmt.Errorf("get collection totals: %w", err)
	}

	// By method
	methodRows, err := p.Pool.Query(ctx, `
		SELECT method, COUNT(*), COALESCE(SUM(amount), 0), COALESCE(SUM(fee), 0)
		FROM payments
		WHERE created_at BETWEEN $1 AND $2 AND status = 'confirmed'
		GROUP BY method
		ORDER BY COUNT(*) DESC
	`, startDate, endDate)
	if err != nil {
		return nil, fmt.Errorf("get method breakdown: %w", err)
	}
	defer methodRows.Close()

	for methodRows.Next() {
		var mb MethodBreakdown
		if err := methodRows.Scan(&mb.Method, &mb.Count, &mb.TotalAmount, &mb.TotalFees); err != nil {
			return nil, fmt.Errorf("scan method breakdown: %w", err)
		}
		stats.ByMethod = append(stats.ByMethod, mb)
	}

	// By status
	statusRows, err := p.Pool.Query(ctx, `
		SELECT status, COUNT(*)
		FROM payments
		WHERE created_at BETWEEN $1 AND $2
		GROUP BY status
		ORDER BY COUNT(*) DESC
	`, startDate, endDate)
	if err != nil {
		return nil, fmt.Errorf("get status breakdown: %w", err)
	}
	defer statusRows.Close()

	for statusRows.Next() {
		var sb StatusBreakdown
		if err := statusRows.Scan(&sb.Status, &sb.Count); err != nil {
			return nil, fmt.Errorf("scan status breakdown: %w", err)
		}
		stats.ByStatus = append(stats.ByStatus, sb)
	}

	return stats, nil
}

// PaymentDB is the database model for payments
type PaymentDB struct {
	ID           string  `db:"id"`
	PolicyID     string  `db:"policy_id"`
	CustomerID   string  `db:"customer_id"`
	Amount       float64 `db:"amount"`
	Currency     string  `db:"currency"`
	Method       string  `db:"method"`
	Status       string  `db:"status"`
	Fee          float64 `db:"fee"`
	FeeRate      float64 `db:"fee_rate"`
	NetAmount    float64 `db:"net_amount"`
	ReceiptID    string  `db:"receipt_id"`
	ReferenceID  string  `db:"reference_id"`
	SettledAt    *string `db:"settled_at"`
	FailedAt     *string `db:"failed_at"`
	FailedReason string  `db:"failed_reason"`
	Metadata     string  `db:"metadata"`
	CreatedAt    string  `db:"created_at"`
	UpdatedAt    string  `db:"updated_at"`
}

// Payment and installment status constants (mirror models package values)
const (
	PaymentStatusPending   = "pending"
	PaymentStatusConfirmed = "confirmed"
	PaymentStatusRefunded  = "refunded"
	PaymentStatusFailed    = "failed"

	InstallmentPending = "pending"
	InstallmentDue     = "due"
	InstallmentPaid    = "paid"
	InstallmentOverdue = "overdue"

	DunningPending   = "pending"
	DunningSent      = "sent"
	DunningEscalated = "escalated"

	DunningEmail    = "email"
	DunningSMS      = "sms"
	DunningWhatsApp = "whatsapp"

	AutoDebitPending = "pending"
	AutoDebitActive  = "active"
)

// InstallmentPlanDB is the database model for installment plans
type InstallmentPlanDB struct {
	ID                string                `db:"id"`
	PolicyID          string                `db:"policy_id"`
	CustomerID        string                `db:"customer_id"`
	TotalAmount       float64               `db:"total_amount"`
	Remaining         float64               `db:"remaining"`
	Installments      int                   `db:"installments"`
	InstallmentAmount float64               `db:"installment_amount"`
	Status            string                `db:"status"`
	StartDate         string                `db:"start_date"`
	Schedule          []*InstallmentEntryDB `db:"-"`
	CreatedAt         string                `db:"created_at"`
	UpdatedAt         string                `db:"updated_at"`
}

// InstallmentEntryDB is the database model for installment schedule entries
type InstallmentEntryDB struct {
	ID                string  `db:"id"`
	PlanID            string  `db:"plan_id"`
	InstallmentNumber int     `db:"installment_number"`
	DueDate           string  `db:"due_date"`
	Amount            float64 `db:"amount"`
	Status            string  `db:"status"`
	PaidAt            *string `db:"paid_at"`
	PaymentID         *string `db:"payment_id"`
	CreatedAt         string  `db:"created_at"`
	UpdatedAt         string  `db:"updated_at"`
}

// DunningDB is the database model for dunning records
type DunningDB struct {
	ID           string  `db:"id"`
	PolicyID     string  `db:"policy_id"`
	CustomerID   string  `db:"customer_id"`
	Amount       float64 `db:"amount"`
	Attempt      int     `db:"attempt"`
	Status       string  `db:"status"`
	ReminderType string  `db:"reminder_type"`
	SentAt       *string `db:"sent_at"`
	NextAttempt  string  `db:"next_attempt"`
	Metadata     string  `db:"metadata"`
	CreatedAt    string  `db:"created_at"`
	UpdatedAt    string  `db:"updated_at"`
}

// AutoDebitDB is the database model for auto-debit configurations
type AutoDebitDB struct {
	ID            string  `db:"id"`
	PolicyID      string  `db:"policy_id"`
	CustomerID    string  `db:"customer_id"`
	BankName      string  `db:"bank_name"`
	AccountNumber string  `db:"account_number"`
	AccountName   string  `db:"account_name"`
	Status        string  `db:"status"`
	NextDebitDate *string `db:"next_debit_date"`
	Metadata      string  `db:"metadata"`
	CreatedAt     string  `db:"created_at"`
	UpdatedAt     string  `db:"updated_at"`
}

// ReconciliationDB is the database model for reconciliation records
type ReconciliationDB struct {
	ID               string  `db:"id"`
	Date             string  `db:"date"`
	TotalCollected   float64 `db:"total_collected"`
	TotalReconciled  float64 `db:"total_reconciled"`
	TotalPending     float64 `db:"total_pending"`
	TotalDiscrepancy float64 `db:"total_discrepancy"`
	DiscrepancyCount int     `db:"discrepancy_count"`
	ChannelBreakdown string  `db:"channel_breakdown"`
	Status           string  `db:"status"`
	CreatedAt        string  `db:"created_at"`
}
