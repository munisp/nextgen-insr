package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/insureportal/fraud-detection-go/models"

	_ "github.com/lib/pq"
	"go.uber.org/zap"
)

// PostgresStore wraps a *sql.DB with helper methods for fraud-domain tables.
type PostgresStore struct {
	db   *sql.DB
	logger *zap.Logger
}

// NewPostgresStore opens a PostgreSQL connection pool and runs schema migrations.
func NewPostgresStore(ctx context.Context, dsn string, maxOpen, maxIdle int, connMaxLife time.Duration, logger *zap.Logger) (*PostgresStore, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open postgres connection: %w", err)
	}

	db.SetMaxOpenConns(maxOpen)
	db.SetMaxIdleConns(maxIdle)
	db.SetConnMaxLifetime(connMaxLife)

	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}

	store := &PostgresStore{db: db, logger: logger}

	if err := store.migrate(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("run migrations: %w", err)
	}

	logger.Info("postgres connected", zap.String("dsn", redactDSN(dsn)))
	return store, nil
}

// redactDSN masks the password in a PostgreSQL DSN for logging.
func redactDSN(dsn string) string {
	// pq format: key=value ... password=SECRET ...
	if dsn == "" {
		return ""
	}
	parts := strings.Split(dsn, " ")
	for i, p := range parts {
		if strings.HasPrefix(p, "password=") {
			parts[i] = "password=****"
		}
	}
	return strings.Join(parts, " ")
}

// migrate creates the required tables if they do not exist.
func (s *PostgresStore) migrate(ctx context.Context) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS fraud_scores (
			id            BIGSERIAL PRIMARY KEY,
			transaction_id VARCHAR(64) NOT NULL UNIQUE,
			account_id     VARCHAR(64) NOT NULL,
			amount         NUMERIC(18,2) NOT NULL,
			merchant       VARCHAR(255),
			location       VARCHAR(255),
			device_id      VARCHAR(255),
			hour_of_day    INT,
			fraud_score    NUMERIC(5,2) NOT NULL,
			decision       VARCHAR(16) NOT NULL,
			rules_triggered JSONB,
			created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_fraud_scores_account ON fraud_scores(account_id)`,
		`CREATE INDEX IF NOT EXISTS idx_fraud_scores_created ON fraud_scores(created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_fraud_scores_txn ON fraud_scores(transaction_id)`,
		`CREATE TABLE IF NOT EXISTS fraud_cases (
			id             BIGSERIAL PRIMARY KEY,
			case_id        VARCHAR(64) NOT NULL UNIQUE,
			transaction_id VARCHAR(64) NOT NULL,
			account_id     VARCHAR(64) NOT NULL,
			score          NUMERIC(5,2) NOT NULL,
			decision       VARCHAR(16) NOT NULL,
			status         VARCHAR(32) NOT NULL DEFAULT 'open',
			evidence       TEXT,
			assigned_to    VARCHAR(255),
			created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_fraud_cases_account ON fraud_cases(account_id)`,
		`CREATE INDEX IF NOT EXISTS idx_fraud_cases_status ON fraud_cases(status)`,
	}

	for _, stmt := range stmts {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("exec migration: %w", err)
		}
	}
	return nil
}

// Close releases the database connection pool.
func (s *PostgresStore) Close() error {
	return s.db.Close()
}

// Ping checks DB connectivity.
func (s *PostgresStore) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

// StoreScore persists a fraud scoring result into fraud_scores.
func (s *PostgresStore) StoreScore(ctx context.Context, score models.FraudScore) error {
	rulesJSON, err := json.Marshal(score.Rules)
	if err != nil {
		return fmt.Errorf("marshal rules: %w", err)
	}

	_, err = s.db.ExecContext(ctx,
		`INSERT INTO fraud_scores
			(transaction_id, account_id, amount, merchant, location, device_id, hour_of_day,
			 fraud_score, decision, rules_triggered)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (transaction_id) DO NOTHING`,
		score.TransactionID,
		score.AccountID,
		score.Amount,
		"", // merchant
		"", // location
		"", // device_id
		0,  // hour_of_day
		score.Score,
		score.Decision,
		rulesJSON,
	)
	if err != nil {
		return fmt.Errorf("store score: %w", err)
	}
	return nil
}

// GetTransactionHistory returns the last n transactions for an account,
// ordered newest first.
func (s *PostgresStore) GetTransactionHistory(ctx context.Context, accountID string, limit int) ([]models.TransactionRecord, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := s.db.QueryContext(ctx,
		`SELECT id, transaction_id, account_id, amount, merchant, location,
		        device_id, hour_of_day, fraud_score, decision, rules_triggered, created_at
		 FROM fraud_scores
		 WHERE account_id = $1
		 ORDER BY created_at DESC
		 LIMIT $2`,
		accountID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("query transaction history: %w", err)
	}
	defer rows.Close()

	var records []models.TransactionRecord
	for rows.Next() {
		var r models.TransactionRecord
		var rulesJSON []byte
		if err := rows.Scan(
			&r.ID, &r.TransactionID, &r.AccountID, &r.Amount, &r.Merchant,
			&r.Location, &r.DeviceID, &r.HourOfDay, &r.FraudScore, &r.Decision,
			&rulesJSON, &r.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan row: %w", err)
		}
		records = append(records, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rows: %w", err)
	}
	return records, nil
}

// CreateFraudCase inserts a new fraud case for investigation.
func (s *PostgresStore) CreateFraudCase(ctx context.Context, cs models.FraudCase) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO fraud_cases
			(case_id, transaction_id, account_id, score, decision, status, evidence, assigned_to)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (case_id) DO NOTHING`,
		cs.CaseID,
		cs.TransactionID,
		cs.AccountID,
		cs.Score,
		cs.Decision,
		cs.Status,
		cs.Evidence,
		cs.AssignedTo,
	)
	if err != nil {
		return fmt.Errorf("create fraud case: %w", err)
	}
	return nil
}

// GetFraudCases returns fraud cases filtered by status and/or accountID.
// If status is "" all statuses are returned; if accountID is "" all accounts.
func (s *PostgresStore) GetFraudCases(ctx context.Context, status, accountID string, limit int) ([]models.FraudCase, error) {
	if limit <= 0 {
		limit = 50
	}

	whereClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	if status != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, status)
		argIdx++
	}
	if accountID != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("account_id = $%d", argIdx))
		args = append(args, accountID)
		argIdx++
	}

	whereSQL := ""
	if len(whereClauses) > 0 {
		whereSQL = "WHERE " + strings.Join(whereClauses, " AND ")
	}

	query := fmt.Sprintf(`
		SELECT case_id, transaction_id, account_id, score, decision,
		       status, evidence, assigned_to, created_at, updated_at
		FROM fraud_cases
		%s
		ORDER BY created_at DESC
		LIMIT $%d`, whereSQL, argIdx)
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query fraud cases: %w", err)
	}
	defer rows.Close()

	var cases []models.FraudCase
	for rows.Next() {
		var c models.FraudCase
		if err := rows.Scan(
			&c.CaseID, &c.TransactionID, &c.AccountID,
			&c.Score, &c.Decision, &c.Status, &c.Evidence,
			&c.AssignedTo, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan fraud case row: %w", err)
		}
		cases = append(cases, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate fraud cases: %w", err)
	}
	return cases, nil
}

// GetStats reads real-time metrics from the database.
func (s *PostgresStore) GetStats(ctx context.Context) (models.FraudStats, error) {
	var stats models.FraudStats
	now := time.Now()
	twentyFourAgo := now.Add(-24 * time.Hour)

	// Total scored in last 24h
	var total int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM fraud_scores WHERE created_at >= $1`, twentyFourAgo).Scan(&total)
	if err != nil {
		return stats, fmt.Errorf("count scored: %w", err)
	}
	stats.TransactionsScored24H = total

	// Broken down by decision
	var blocked, reviewed, allowed int
	err = s.db.QueryRowContext(ctx,
		`SELECT
			COUNT(CASE WHEN decision = 'block' THEN 1 END),
			COUNT(CASE WHEN decision = 'review' THEN 1 END),
			COUNT(CASE WHEN decision = 'allow' THEN 1 END)
		 FROM fraud_scores WHERE created_at >= $1`, twentyFourAgo).
		Scan(&blocked, &reviewed, &allowed)
	if err != nil {
		return stats, fmt.Errorf("count decisions: %w", err)
	}
	stats.Blocked = blocked
	stats.Reviewed = reviewed
	stats.Allowed = allowed

	// Average score in last 24h
	var avgScore float64
	err = s.db.QueryRowContext(ctx,
		`SELECT COALESCE(AVG(fraud_score), 0) FROM fraud_scores WHERE created_at >= $1`, twentyFourAgo).
		Scan(&avgScore)
	if err != nil {
		return stats, fmt.Errorf("avg score: %w", err)
	}
	stats.AvgScore = avgScore

	// STR filed: transactions exceeding STR threshold (we assume a config value
	// is stored as a constant or we approximate by counting high-score entries)
	err = s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM fraud_scores WHERE created_at >= $1 AND decision = 'block'`, twentyFourAgo).
		Scan(&stats.STRFiled)
	if err != nil {
		return stats, fmt.Errorf("count STR: %w", err)
	}

	// Estimated false positive rate (placeholder heuristic:
	// blocked but low score entries / total blocked)
	var blockedLow float64
	err = s.db.QueryRowContext(ctx,
		`SELECT COUNT(*)::FLOAT FROM fraud_scores
		 WHERE created_at >= $1 AND decision = 'block' AND fraud_score < 80`, twentyFourAgo).
		Scan(&blockedLow)
	if err != nil {
		stats.FalsePositiveRate = 0.02
	} else if total > 0 {
		stats.FalsePositiveRate = roundTo(blockedLow / float64(total), 4)
	} else {
		stats.FalsePositiveRate = 0.0
	}

	return stats, nil
}

// roundTo rounds a float to the given number of decimal places.
func roundTo(val float64, places int) float64 {
	pow := 1.0
	for i := 0; i < places; i++ {
		pow *= 10
	}
	return float64(int(val*pow+0.5)) / pow
}
