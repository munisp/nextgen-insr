package db

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/insureportal/ussd_gateway/models"

	_ "github.com/lib/pq"
)

// PostgresStore handles all PostgreSQL operations for the USSD gateway.
type PostgresStore struct {
	db *sql.DB
}

// NewPostgresStore opens a connection to PostgreSQL, configures the connection
// pool, creates the required tables, and returns a ready-to-use PostgresStore.
func NewPostgresStore(dsn string) (*PostgresStore, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("postgres: failed to connect: %w", err)
	}

	store := &PostgresStore{db: db}

	// Validate the connection is actually alive.
	if err := db.PingContext(context.Background()); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("postgres: ping failed: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(10 * time.Minute)

	if err := store.runMigrations(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("postgres: migration failed: %w", err)
	}

	return store, nil
}

// Close shuts down the database connection pool.
func (ps *PostgresStore) Close() error {
	return ps.db.Close()
}

// Ping checks if the database connection is alive.
func (ps *PostgresStore) Ping() error {
	return ps.db.Ping()
}

// runMigrations creates all required tables and indexes.
func (ps *PostgresStore) runMigrations() error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS agent_accounts (
			id            TEXT PRIMARY KEY,
			phone_number  TEXT NOT NULL UNIQUE,
			name          TEXT NOT NULL,
			state         TEXT NOT NULL,
			lga           TEXT NOT NULL DEFAULT '',
			bank_account  TEXT,
			bank_name     TEXT,
			status        TEXT NOT NULL DEFAULT 'pending',
			float_balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
			total_policies INTEGER NOT NULL DEFAULT 0,
			created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,

		`CREATE INDEX IF NOT EXISTS idx_agent_phone ON agent_accounts(phone_number)`,
		`CREATE INDEX IF NOT EXISTS idx_agent_status ON agent_accounts(status)`,

		`CREATE TABLE IF NOT EXISTS transactions (
			id            TEXT PRIMARY KEY,
			session_id    TEXT NOT NULL,
			phone_number  TEXT NOT NULL,
			type          TEXT NOT NULL,
			product_id    TEXT,
			amount        DECIMAL(15,2) NOT NULL DEFAULT 0.00,
			status        TEXT NOT NULL DEFAULT 'pending',
			reference     TEXT,
			created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,

		`CREATE INDEX IF NOT EXISTS idx_txn_phone ON transactions(phone_number)`,
		`CREATE INDEX IF NOT EXISTS idx_txn_session ON transactions(session_id)`,
		`CREATE INDEX IF NOT EXISTS idx_txn_created ON transactions(created_at DESC)`,

		`CREATE TABLE IF NOT EXISTS session_states (
			session_id   TEXT PRIMARY KEY,
			phone_number TEXT NOT NULL,
			state        TEXT NOT NULL DEFAULT '',
			data         JSONB NOT NULL DEFAULT '{}',
			expires_at   TIMESTAMPTZ NOT NULL
		)`,

		`CREATE INDEX IF NOT EXISTS idx_session_expires ON session_states(expires_at)`,
	}

	for _, migration := range migrations {
		if _, err := ps.db.Exec(migration); err != nil {
			return fmt.Errorf("migration failed [%s]: %w", migration[:50], err)
		}
	}

	log.Println("postgres: all migrations applied successfully")
	return nil
}

// generateID creates a 32-character hex identifier.
func generateID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// --- AgentAccount operations ---

// CreateAgentAccount inserts a new agent into the database.
// Returns the agent's ID and a copy of the account with populated timestamps.
func (ps *PostgresStore) CreateAgentAccount(ctx context.Context, account *models.AgentAccount) (*models.AgentAccount, error) {
	if account.ID == "" {
		account.ID = generateID()
	}
	now := time.Now().UTC()
	account.CreatedAt = now
	account.UpdatedAt = now
	if account.Status == "" {
		account.Status = models.AgentStatusPending
	}

	query := `INSERT INTO agent_accounts
		(id, phone_number, name, state, lga, bank_account, bank_name, status, float_balance, total_policies, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`

	_, err := ps.db.ExecContext(ctx, query,
		account.ID,
		account.PhoneNumber,
		account.Name,
		account.State,
		account.LGA,
		account.BankAccount,
		account.BankName,
		account.Status,
		account.FloatBalance,
		account.TotalPolicies,
		account.CreatedAt,
		account.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: create agent account: %w", err)
	}
	return account, nil
}

// GetAgentByPhone looks up an agent by phone number.
func (ps *PostgresStore) GetAgentByPhone(ctx context.Context, phone string) (*models.AgentAccount, error) {
	account := &models.AgentAccount{}
	query := `SELECT id, phone_number, name, state, lga, bank_account, bank_name,
		          status, float_balance, total_policies, created_at, updated_at
		          FROM agent_accounts WHERE phone_number = $1`

	row := ps.db.QueryRowContext(ctx, query, phone)
	err := row.Scan(
		&account.ID, &account.PhoneNumber, &account.Name, &account.State,
		&account.LGA, &account.BankAccount, &account.BankName,
		&account.Status, &account.FloatBalance, &account.TotalPolicies,
		&account.CreatedAt, &account.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: get agent by phone: %w", err)
	}
	return account, nil
}

// GetAgentByID looks up an agent by ID.
func (ps *PostgresStore) GetAgentByID(ctx context.Context, id string) (*models.AgentAccount, error) {
	account := &models.AgentAccount{}
	query := `SELECT id, phone_number, name, state, lga, bank_account, bank_name,
		          status, float_balance, total_policies, created_at, updated_at
		          FROM agent_accounts WHERE id = $1`

	row := ps.db.QueryRowContext(ctx, query, id)
	err := row.Scan(
		&account.ID, &account.PhoneNumber, &account.Name, &account.State,
		&account.LGA, &account.BankAccount, &account.BankName,
		&account.Status, &account.FloatBalance, &account.TotalPolicies,
		&account.CreatedAt, &account.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: get agent by id: %w", err)
	}
	return account, nil
}

// UpdateAgentStatus sets the onboarding / operational status for an agent.
func (ps *PostgresStore) UpdateAgentStatus(ctx context.Context, id, status string) error {
	query := `UPDATE agent_accounts SET status = $1, updated_at = NOW() WHERE id = $2`
	_, err := ps.db.ExecContext(ctx, query, status, id)
	if err != nil {
		return fmt.Errorf("postgres: update agent status: %w", err)
	}
	return nil
}

// IncrementPolicies increments the total_policies counter for an agent.
func (ps *PostgresStore) IncrementPolicies(ctx context.Context, id string) error {
	query := `UPDATE agent_accounts SET total_policies = total_policies + 1, updated_at = NOW() WHERE id = $1`
	_, err := ps.db.ExecContext(ctx, query, id)
	return err
}

// --- Transaction operations ---

// CreateTransaction records a USSD-initiated transaction and returns it with
// a generated reference.
func (ps *PostgresStore) CreateTransaction(ctx context.Context, txn *models.TransactionRecord) (*models.TransactionRecord, error) {
	if txn.ID == "" {
		txn.ID = generateID()
	}
	if txn.Reference == "" {
		txn.Reference = "TXN-" + generateID()[:12]
	}
	if txn.Status == "" {
		txn.Status = "pending"
	}
	txn.CreatedAt = time.Now().UTC()

	query := `INSERT INTO transactions
		(id, session_id, phone_number, type, product_id, amount, status, reference, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

	_, err := ps.db.ExecContext(ctx, query,
		txn.ID, txn.SessionID, txn.PhoneNumber, txn.Type,
		txn.ProductID, txn.Amount, txn.Status, txn.Reference, txn.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: create transaction: %w", err)
	}
	return txn, nil
}

// GetAgentBalance returns the float balance for a given agent.
func (ps *PostgresStore) GetAgentBalance(ctx context.Context, id string) (float64, error) {
	var balance float64
	query := `SELECT COALESCE(float_balance, 0) FROM agent_accounts WHERE id = $1`
	err := ps.db.QueryRowContext(ctx, query, id).Scan(&balance)
	if err != nil {
		if err == sql.ErrNoRows {
			return 0, nil
		}
		return 0, fmt.Errorf("postgres: get agent balance: %w", err)
	}
	return balance, nil
}

// UpdateAgentBalance sets the float balance for an agent.
func (ps *PostgresStore) UpdateAgentBalance(ctx context.Context, id string, balance float64) error {
	query := `UPDATE agent_accounts SET float_balance = $1, updated_at = NOW() WHERE id = $2`
	_, err := ps.db.ExecContext(ctx, query, balance, id)
	return err
}

// GetTransactionHistory returns the last *limit transactions for a phone number,
// newest first.
func (ps *PostgresStore) GetTransactionHistory(ctx context.Context, phone string, limit int) ([]models.TransactionRecord, error) {
	if limit <= 0 {
		limit = 20
	}

	query := `SELECT id, session_id, phone_number, type, product_id,
		          amount, status, reference, created_at
		          FROM transactions WHERE phone_number = $1
		          ORDER BY created_at DESC LIMIT $2`

	rows, err := ps.db.QueryContext(ctx, query, phone, limit)
	if err != nil {
		return nil, fmt.Errorf("postgres: get transaction history: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var txns []models.TransactionRecord
	for rows.Next() {
		var t models.TransactionRecord
		var amountStr string
		err := rows.Scan(&t.ID, &t.SessionID, &t.PhoneNumber, &t.Type,
			&t.ProductID, &amountStr, &t.Status, &t.Reference, &t.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("postgres: scan transaction: %w", err)
		}
		t.Amount, _ = strconv.ParseFloat(amountStr, 64)
		txns = append(txns, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("postgres: transaction history iteration: %w", err)
	}
	return txns, nil
}

// GetTransactionByReference looks up a transaction by its reference code.
func (ps *PostgresStore) GetTransactionByReference(ctx context.Context, ref string) (*models.TransactionRecord, error) {
	txn := &models.TransactionRecord{}
	query := `SELECT id, session_id, phone_number, type, product_id,
		          amount, status, reference, created_at
		          FROM transactions WHERE reference = $1`

	row := ps.db.QueryRowContext(ctx, query, ref)
	var amountStr string
	err := row.Scan(&txn.ID, &txn.SessionID, &txn.PhoneNumber, &txn.Type,
		&txn.ProductID, &amountStr, &txn.Status, &txn.Reference, &txn.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: get transaction by reference: %w", err)
	}
	txn.Amount, _ = strconv.ParseFloat(amountStr, 64)
	return txn, nil
}

// --- Session state (stored in Postgres for persistence) ---

// SaveSessionState persists a USSD session state to the database.
func (ps *PostgresStore) SaveSessionState(ctx context.Context, sessionID, phone, state string, data map[string]interface{}, ttl time.Duration) error {
	expiresAt := time.Now().UTC().Add(ttl)

	// Marshal data map to JSON for storage.
	jsonData := make(map[string]interface{})
	if data != nil {
		for k, v := range data {
			jsonData[k] = v
		}
	}

	query := `INSERT INTO session_states (session_id, phone_number, state, data, expires_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (session_id) DO UPDATE
			SET phone_number = $2, state = $3, data = $4, expires_at = $5`

	_, err := ps.db.ExecContext(ctx, query, sessionID, phone, state, jsonData, expiresAt)
	if err != nil {
		return fmt.Errorf("postgres: save session state: %w", err)
	}
	return nil
}

// GetSessionState retrieves a session state from the database.
func (ps *PostgresStore) GetSessionState(ctx context.Context, sessionID string) (*models.SessionData, error) {
	var session models.SessionData
	var dataMap map[string]interface{}

	query := `SELECT session_id, phone_number, state, data, expires_at
		FROM session_states WHERE session_id = $1`

	row := ps.db.QueryRowContext(ctx, query, sessionID)
	err := row.Scan(&session.SessionID, &session.PhoneNumber, &session.State, &dataMap, &session.ExpiresAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: get session state: %w", err)
	}
	session.Data = dataMap
	return &session, nil
}

// DeleteSessionState removes a session from the database.
func (ps *PostgresStore) DeleteSessionState(ctx context.Context, sessionID string) error {
	query := `DELETE FROM session_states WHERE session_id = $1`
	_, err := ps.db.ExecContext(ctx, query, sessionID)
	return err
}

// CleanupExpiredSessions removes all sessions that have passed their expiration time.
func (ps *PostgresStore) CleanupExpiredSessions(ctx context.Context) (int, error) {
	query := `DELETE FROM session_states WHERE expires_at < NOW()`
	result, err := ps.db.ExecContext(ctx, query)
	if err != nil {
		return 0, fmt.Errorf("postgres: cleanup expired sessions: %w", err)
	}
	affected, _ := result.RowsAffected()
	return int(affected), nil
}
