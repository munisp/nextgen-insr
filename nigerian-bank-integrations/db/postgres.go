package db

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/insureportal/nigerian-bank-integrations/config"
)

// Postgres wraps a connection pool
type Postgres struct {
	Pool *pgxpool.Pool
}

func NewPostgres(ctx context.Context, cfg *config.PostgresConfig) (*Postgres, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("parse postgres config: %w", err)
	}
	poolCfg.MaxConns = int32(cfg.MaxOpenConns)
	poolCfg.MinConns = 3
	poolCfg.MaxConnLifetime = cfg.ConnMaxLifetime
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
	if p != nil && p.Pool != nil { p.Pool.Close() }
}

func (p *Postgres) RunMigrations(ctx context.Context) error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS account_verifications (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			account_number VARCHAR(10) NOT NULL,
			bank_code VARCHAR(5) NOT NULL,
			bank_name VARCHAR(128) NOT NULL,
			account_name VARCHAR(255) NOT NULL,
			status VARCHAR(32) NOT NULL,
			account_type VARCHAR(32),
			branch VARCHAR(128),
			verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			expiry_at TIMESTAMPTZ NOT NULL,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_verifications_account ON account_verifications(account_number)`,

		`CREATE TABLE IF NOT EXISTS transfers (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			reference VARCHAR(128) UNIQUE NOT NULL,
			source_account VARCHAR(10) NOT NULL,
			source_bank_code VARCHAR(5) NOT NULL,
			destination_account VARCHAR(10) NOT NULL,
			destination_bank_code VARCHAR(5) NOT NULL,
			destination_bank VARCHAR(128) NOT NULL,
			destination_name VARCHAR(255) NOT NULL,
			amount DECIMAL(15,2) NOT NULL,
			currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
			fee DECIMAL(15,2) NOT NULL DEFAULT 0,
			description TEXT,
			channel VARCHAR(32) NOT NULL DEFAULT 'NIP',
			status VARCHAR(32) NOT NULL DEFAULT 'pending',
			approved_by VARCHAR(128),
			txn_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			settlement_date TIMESTAMPTZ,
			failed_reason TEXT,
			callback_url TEXT,
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_transfers_reference ON transfers(reference)`,
		`CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfers(status)`,
		`CREATE INDEX IF NOT EXISTS idx_transfers_created ON transfers(created_at DESC)`,

		`CREATE TABLE IF NOT EXISTS settlement_reports (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			date DATE NOT NULL UNIQUE,
			total_txn_count BIGINT NOT NULL DEFAULT 0,
			total_txn_value DECIMAL(15,2) NOT NULL DEFAULT 0,
			success_count BIGINT NOT NULL DEFAULT 0,
			failed_count BIGINT NOT NULL DEFAULT 0,
			total_fees DECIMAL(15,2) NOT NULL DEFAULT 0,
			net_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
			channel_breakdown JSONB DEFAULT '[]'::jsonb,
			status VARCHAR(32) NOT NULL DEFAULT 'pending',
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		`CREATE TABLE IF NOT EXISTS callback_events (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			event_type VARCHAR(64) NOT NULL,
			reference VARCHAR(128),
			txn_id VARCHAR(128),
			amount DECIMAL(15,2),
			status VARCHAR(32),
			bank_code VARCHAR(5),
			bank_reference VARCHAR(128),
			timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			payload BYTEA,
			processed BOOLEAN NOT NULL DEFAULT false,
			processed_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_callbacks_reference ON callback_events(reference)`,
		`CREATE INDEX IF NOT EXISTS idx_callbacks_processed ON callback_events(processed)`,

		`CREATE TABLE IF NOT EXISTS webhook_subscriptions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			endpoint_url VARCHAR(512) NOT NULL,
			events JSONB NOT NULL DEFAULT '[]'::jsonb,
			secret VARCHAR(256) NOT NULL,
			active BOOLEAN NOT NULL DEFAULT true,
			retries INT NOT NULL DEFAULT 3,
			last_triggered TIMESTAMPTZ,
			last_error TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
	}
	for _, migration := range migrations {
		if _, err := p.Pool.Exec(ctx, migration); err != nil {
			return fmt.Errorf("execute migration: %w", err)
		}
	}
	return nil
}

// InsertTransfer creates a transfer record
func (p *Postgres) InsertTransfer(ctx context.Context, t *TransferDB) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO transfers (id, reference, source_account, source_bank_code,
			destination_account, destination_bank_code, destination_bank, destination_name,
			amount, currency, fee, description, channel, status, approved_by, txn_date,
			failed_reason, callback_url, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
		ON CONFLICT (reference) DO UPDATE SET updated_at = NOW()
	`, t.ID, t.Reference, t.SourceAccount, t.SourceBankCode,
		t.DestinationAccount, t.DestinationBankCode, t.DestinationBank, t.DestinationName,
		t.Amount, t.Currency, t.Fee, t.Description, t.Channel, t.Status, t.ApprovedBy,
		t.TxnDate, t.FailedReason, t.CallbackURL, t.Metadata)
	return fmt.Errorf("insert transfer: %w", err)
}

// GetTransfer retrieves a transfer by reference
func (p *Postgres) GetTransfer(ctx context.Context, reference string) (*TransferDB, error) {
	t := &TransferDB{}
	query := `
		SELECT id, reference, source_account, source_bank_code, destination_account,
			destination_bank_code, destination_bank, destination_name, amount, currency,
			fee, description, channel, status, approved_by, txn_date, settlement_date,
			failed_reason, callback_url, metadata, created_at, updated_at
		FROM transfers WHERE reference = $1
	`
	err := p.Pool.QueryRow(ctx, query, reference).Scan(
		&t.ID, &t.Reference, &t.SourceAccount, &t.SourceBankCode,
		&t.DestinationAccount, &t.DestinationBankCode, &t.DestinationBank, &t.DestinationName,
		&t.Amount, &t.Currency, &t.Fee, &t.Description, &t.Channel, &t.Status,
		&t.ApprovedBy, &t.TxnDate, &t.SettlementDate, &t.FailedReason,
		&t.CallbackURL, &t.Metadata, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get transfer: %w", err)
	}
	return t, nil
}

// UpdateTransferStatus updates a transfer's status
func (p *Postgres) UpdateTransferStatus(ctx context.Context, reference, status string) error {
	query := `UPDATE transfers SET status = $1, updated_at = NOW() WHERE reference = $2`
	_, err := p.Pool.Exec(ctx, query, status, reference)
	return fmt.Errorf("update transfer status: %w", err)
}

// ListTransfers retrieves transfers with filtering
func (p *Postgres) ListTransfers(ctx context.Context, status string, limit, offset int) ([]*TransferDB, error) {
	query := `
		SELECT id, reference, source_account, source_bank_code, destination_account,
			destination_bank_code, destination_bank, destination_name, amount, currency,
			fee, description, channel, status, approved_by, txn_date, settlement_date,
			failed_reason, callback_url, metadata, created_at, updated_at
		FROM transfers
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
		return nil, fmt.Errorf("list transfers: %w", err)
	}
	defer rows.Close()

	var transfers []*TransferDB
	for rows.Next() {
		t := &TransferDB{}
		if err := rows.Scan(
			&t.ID, &t.Reference, &t.SourceAccount, &t.SourceBankCode,
			&t.DestinationAccount, &t.DestinationBankCode, &t.DestinationBank, &t.DestinationName,
			&t.Amount, &t.Currency, &t.Fee, &t.Description, &t.Channel, &t.Status,
			&t.ApprovedBy, &t.TxnDate, &t.SettlementDate, &t.FailedReason,
			&t.CallbackURL, &t.Metadata, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan transfer: %w", err)
		}
		transfers = append(transfers, t)
	}
	return transfers, nil
}

// UpsertAccountVerification creates or updates a verification record
func (p *Postgres) UpsertAccountVerification(ctx context.Context, v *VerificationDB) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO account_verifications (id, account_number, bank_code, bank_name,
			account_name, status, account_type, branch, verified_at, expiry_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (account_number, bank_code) DO UPDATE SET
			account_name = EXCLUDED.account_name,
			status = EXCLUDED.status,
			verified_at = EXCLUDED.verified_at,
			expiry_at = EXCLUDED.expiry_at,
			updated_at = NOW()
	`, v.ID, v.AccountNumber, v.BankCode, v.BankName, v.AccountName,
		v.Status, v.AccountType, v.Branch, v.VerifiedAt, v.ExpiryAt)
	return fmt.Errorf("upsert verification: %w", err)
}

// InsertCallbackEvent stores a callback event
func (p *Postgres) InsertCallbackEvent(ctx context.Context, event *CallbackEventDB) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO callback_events (id, event_type, reference, txn_id, amount,
			status, bank_code, bank_reference, timestamp, payload, processed)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
	`, event.ID, event.EventType, event.Reference, event.TxnID, event.Amount,
		event.Status, event.BankCode, event.BankRef, event.Timestamp, event.Payload, event.Processed)
	return fmt.Errorf("insert callback: %w", err)
}

// GetUnprocessedCallbacks retrieves unprocessed callback events
func (p *Postgres) GetUnprocessedCallbacks(ctx context.Context, limit int) ([]*CallbackEventDB, error) {
	query := `
		SELECT id, event_type, reference, txn_id, amount, status, bank_code,
			bank_reference, timestamp, payload, processed, processed_at, created_at
		FROM callback_events
		WHERE processed = false
		ORDER BY created_at ASC
		LIMIT $1
	`
	rows, err := p.Pool.Query(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("query callbacks: %w", err)
	}
	defer rows.Close()

	var events []*CallbackEventDB
	for rows.Next() {
		e := &CallbackEventDB{}
		if err := rows.Scan(
			&e.ID, &e.EventType, &e.Reference, &e.TxnID, &e.Amount, &e.Status,
			&e.BankCode, &e.BankRef, &e.Timestamp, &e.Payload, &e.Processed,
			&e.ProcessedAt, &e.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan callback: %w", err)
		}
		events = append(events, e)
	}
	return events, nil
}

// MarkCallbackProcessed marks a callback as processed
func (p *Postgres) MarkCallbackProcessed(ctx context.Context, id string, processedAt string) error {
	_, err := p.Pool.Exec(ctx, `UPDATE callback_events SET processed = true, processed_at = $1 WHERE id = $2`, processedAt, id)
	return fmt.Errorf("mark callback processed: %w", err)
}

// UpsertSettlementReport creates or updates a settlement report
func (p *Postgres) UpsertSettlementReport(ctx context.Context, r *SettlementDB) error {
	channels, _ := json.Marshal(r.ChannelBreakdown)
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO settlement_reports (date, total_txn_count, total_txn_value,
			success_count, failed_count, total_fees, net_amount, channel_breakdown, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (date) DO UPDATE SET
			total_txn_count = EXCLUDED.total_txn_count,
			total_txn_value = EXCLUDED.total_txn_value,
			success_count = EXCLUDED.success_count,
			failed_count = EXCLUDED.failed_count,
			total_fees = EXCLUDED.total_fees,
			net_amount = EXCLUDED.net_amount,
			channel_breakdown = EXCLUDED.channel_breakdown,
			status = EXCLUDED.status
	`, r.Date, r.TotalTxnCount, r.TotalTxnValue, r.SuccessCount, r.FailedCount,
		r.TotalFees, r.NetAmount, string(channels), r.Status)
	return fmt.Errorf("upsert settlement: %w", err)
}

// GetSettlementByDate retrieves a settlement report
func (p *Postgres) GetSettlementByDate(ctx context.Context, date string) (*SettlementDB, error) {
	r := &SettlementDB{}
	query := `
		SELECT id, date, total_txn_count, total_txn_value, success_count, failed_count,
			total_fees, net_amount, channel_breakdown, status, created_at
		FROM settlement_reports WHERE date = $1
	`
	err := p.Pool.QueryRow(ctx, query, date).Scan(
		&r.ID, &r.Date, &r.TotalTxnCount, &r.TotalTxnValue, &r.SuccessCount,
		&r.FailedCount, &r.TotalFees, &r.NetAmount, &r.ChannelBreakdown,
		&r.Status, &r.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get settlement: %w", err)
	}
	return r, nil
}

// InsertVerification creates a verification record
func (p *Postgres) InsertVerification(ctx context.Context, v *VerificationDB) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO account_verifications (id, account_number, bank_code, bank_name,
			account_name, status, account_type, branch, verified_at, expiry_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
	`, v.ID, v.AccountNumber, v.BankCode, v.BankName, v.AccountName,
		v.Status, v.AccountType, v.Branch, v.VerifiedAt, v.ExpiryAt)
	return fmt.Errorf("insert verification: %w", err)
}

// GetVerification retrieves a recent verification
func (p *Postgres) GetVerification(ctx context.Context, accountNumber, bankCode string) (*VerificationDB, error) {
	v := &VerificationDB{}
	query := `
		SELECT id, account_number, bank_code, bank_name, account_name, status,
			account_type, branch, verified_at, expiry_at, created_at
		FROM account_verifications
		WHERE account_number = $1 AND bank_code = $2
		ORDER BY verified_at DESC LIMIT 1
	`
	err := p.Pool.QueryRow(ctx, query, accountNumber, bankCode).Scan(
		&v.ID, &v.AccountNumber, &v.BankCode, &v.BankName, &v.AccountName,
		&v.Status, &v.AccountType, &v.Branch, &v.VerifiedAt, &v.ExpiryAt, &v.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get verification: %w", err)
	}
	return v, nil
}

// BankDB represents a supported bank in the database
type BankDB struct {
	Code       string `json:"code"`
	Name       string `json:"name"`
	NIPEnabled bool   `json:"nip_enabled"`
}

// TransferDB is the database model for transfers
type TransferDB struct {
	ID                string         `db:"id"`
	Reference         string         `db:"reference"`
	SourceAccount     string         `db:"source_account"`
	SourceBankCode    string         `db:"source_bank_code"`
	DestinationAccount string         `db:"destination_account"`
	DestinationBankCode string        `db:"destination_bank_code"`
	DestinationBank   string         `db:"destination_bank"`
	DestinationName   string         `db:"destination_name"`
	Amount            float64        `db:"amount"`
	Currency          string         `db:"currency"`
	Fee               float64        `db:"fee"`
	Description       string         `db:"description"`
	Channel           string         `db:"channel"`
	Status            string         `db:"status"`
	ApprovedBy        string         `db:"approved_by"`
	TxnDate           string         `db:"txn_date"`
	SettlementDate    *string        `db:"settlement_date"`
	FailedReason      string         `db:"failed_reason"`
	CallbackURL       string         `db:"callback_url"`
	Metadata          string         `db:"metadata"`
	CreatedAt         string         `db:"created_at"`
	UpdatedAt         string         `db:"updated_at"`
}

// VerificationDB is the database model for account verifications
type VerificationDB struct {
	ID            string    `db:"id"`
	AccountNumber string    `db:"account_number"`
	BankCode      string    `db:"bank_code"`
	BankName      string    `db:"bank_name"`
	AccountName   string    `db:"account_name"`
	Status        string    `db:"status"`
	AccountType   string    `db:"account_type"`
	Branch        string    `db:"branch"`
	VerifiedAt    string    `db:"verified_at"`
	ExpiryAt      string    `db:"expiry_at"`
	CreatedAt     string    `db:"created_at"`
}

// CallbackEventDB is the database model for callback events
type CallbackEventDB struct {
	ID        string    `db:"id"`
	EventType string    `db:"event_type"`
	Reference string    `db:"reference"`
	TxnID     string    `db:"txn_id"`
	Amount    float64   `db:"amount"`
	Status    string    `db:"status"`
	BankCode  string    `db:"bank_code"`
	BankRef   string    `db:"bank_reference"`
	Timestamp string    `db:"timestamp"`
	Payload   []byte    `db:"payload"`
	Processed bool      `db:"processed"`
	ProcessedAt *string `db:"processed_at"`
	CreatedAt string    `db:"created_at"`
}

// SettlementDB is the database model for settlement reports
type SettlementDB struct {
	ID               string    `db:"id"`
	Date             string    `db:"date"`
	TotalTxnCount    int64     `db:"total_txn_count"`
	TotalTxnValue    float64   `db:"total_txn_value"`
	SuccessCount     int64     `db:"success_count"`
	FailedCount      int64     `db:"failed_count"`
	TotalFees        float64   `db:"total_fees"`
	NetAmount        float64   `db:"net_amount"`
	ChannelBreakdown string    `db:"channel_breakdown"`
	Status           string    `db:"status"`
	CreatedAt        string    `db:"created_at"`
}
