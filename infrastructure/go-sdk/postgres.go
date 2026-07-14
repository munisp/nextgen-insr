package infra

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
	"go.uber.org/zap"
)

type PostgresClient struct {
	db     *sql.DB
	logger *zap.Logger
	url    string
}

func NewPostgresClient(logger *zap.Logger, connStr string) *PostgresClient {
	c := &PostgresClient{logger: logger, url: connStr}
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		logger.Warn("postgres_open_failed", zap.Error(err))
		return c
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)
	c.db = db

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		logger.Warn("postgres_ping_failed", zap.Error(err))
	} else {
		logger.Info("postgres_connected", zap.String("url", connStr))
	}
	return c
}

func (c *PostgresClient) Ping(ctx context.Context) error {
	if c.db == nil {
		return fmt.Errorf("postgres not initialized")
	}
	return c.db.PingContext(ctx)
}

func (c *PostgresClient) DB() *sql.DB { return c.db }

func (c *PostgresClient) Migrate(ctx context.Context, statements []string) error {
	if c.db == nil {
		return fmt.Errorf("postgres not available")
	}
	for _, stmt := range statements {
		if _, err := c.db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}
	return nil
}

func (c *PostgresClient) Close() {
	if c.db != nil {
		c.db.Close()
	}
}

// PlatformMigrations returns DDL for all platform domain tables.
func PlatformMigrations() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS policies (
			id TEXT PRIMARY KEY,
			customer_id TEXT NOT NULL,
			product_type TEXT NOT NULL,
			status TEXT DEFAULT 'draft',
			premium_amount NUMERIC(15,2),
			sum_insured NUMERIC(15,2),
			currency TEXT DEFAULT 'NGN',
			start_date DATE,
			end_date DATE,
			kyc_level INTEGER DEFAULT 0,
			kyc_session_id TEXT,
			metadata JSONB DEFAULT '{}',
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS claims (
			id TEXT PRIMARY KEY,
			policy_id TEXT NOT NULL,
			customer_id TEXT NOT NULL,
			claim_type TEXT NOT NULL,
			status TEXT DEFAULT 'submitted',
			claimed_amount NUMERIC(15,2),
			approved_amount NUMERIC(15,2),
			rejection_reason TEXT,
			fraud_score REAL DEFAULT 0,
			kyc_verified BOOLEAN DEFAULT FALSE,
			documents JSONB DEFAULT '[]',
			metadata JSONB DEFAULT '{}',
			filed_at TIMESTAMPTZ DEFAULT NOW(),
			settled_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS payments (
			id TEXT PRIMARY KEY,
			policy_id TEXT,
			claim_id TEXT,
			customer_id TEXT NOT NULL,
			payment_type TEXT NOT NULL,
			amount NUMERIC(15,2) NOT NULL,
			currency TEXT DEFAULT 'NGN',
			status TEXT DEFAULT 'pending',
			method TEXT,
			reference TEXT,
			tigerbeetle_transfer_id TEXT,
			mojaloop_transfer_id TEXT,
			kyc_level INTEGER DEFAULT 0,
			metadata JSONB DEFAULT '{}',
			processed_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS customers (
			id TEXT PRIMARY KEY,
			first_name TEXT NOT NULL,
			last_name TEXT NOT NULL,
			email TEXT,
			phone TEXT,
			nin TEXT,
			bvn TEXT,
			kyc_level INTEGER DEFAULT 0,
			kyc_session_id TEXT,
			kyc_status TEXT DEFAULT 'pending',
			risk_score REAL DEFAULT 0,
			metadata JSONB DEFAULT '{}',
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS agents (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			agent_code TEXT UNIQUE NOT NULL,
			region TEXT,
			kyb_session_id TEXT,
			kyb_status TEXT DEFAULT 'pending',
			commission_rate REAL DEFAULT 0.05,
			total_policies_sold INTEGER DEFAULT 0,
			metadata JSONB DEFAULT '{}',
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS premium_collections (
			id TEXT PRIMARY KEY,
			policy_id TEXT NOT NULL,
			customer_id TEXT NOT NULL,
			amount NUMERIC(15,2) NOT NULL,
			currency TEXT DEFAULT 'NGN',
			payment_method TEXT,
			mobile_money_ref TEXT,
			tigerbeetle_id TEXT,
			status TEXT DEFAULT 'pending',
			collected_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS audit_events (
			id SERIAL PRIMARY KEY,
			service_name TEXT NOT NULL,
			event_type TEXT NOT NULL,
			entity_type TEXT,
			entity_id TEXT,
			actor TEXT,
			ip_address TEXT,
			details JSONB DEFAULT '{}',
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_policies_customer ON policies(customer_id)`,
		`CREATE INDEX IF NOT EXISTS idx_policies_status ON policies(status)`,
		`CREATE INDEX IF NOT EXISTS idx_claims_policy ON claims(policy_id)`,
		`CREATE INDEX IF NOT EXISTS idx_claims_customer ON claims(customer_id)`,
		`CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id)`,
		`CREATE INDEX IF NOT EXISTS idx_payments_policy ON payments(policy_id)`,
		`CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)`,
		`CREATE INDEX IF NOT EXISTS idx_customers_nin ON customers(nin)`,
		`CREATE INDEX IF NOT EXISTS idx_agents_code ON agents(agent_code)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_service ON audit_events(service_name)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id)`,
	}
}
