// PostgreSQL persistence layer for the KYC enforcement gateway.
//
// 2026-10-02 (C2-a7, persistence audit item A7): account/loan application
// records, multi-bureau verification results, and verified KYC levels were
// previously held in process memory (AppState.applications /
// AppState.bureauResults / AppState.kycCache maps), so a restart stranded
// applications in "pending_kyc" forever and destroyed bureau verification
// evidence. Postgres is now the AUTHORITATIVE store; there is no in-memory
// fallback. Fail-closed policy: if PG is unavailable at boot the process
// exits (log.Fatal in initDB); if a store operation fails the handler
// returns an explicit 5xx error and never reports success without a durable
// write.
//
// The service's only "Redis client" is a hand-rolled RESP pool
// (redisPool in main.go) used for volatile caching; the verified-KYC-level
// data set by the verification callback is authoritative for gating
// decisions, so it is persisted to kyc_status_cache with an expires_at TTL
// column (same pattern as fido2-service sessions) rather than entrusted to
// Redis or process memory.

package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// kycCacheTTL bounds how long a verified KYC level is honoured before the
// gateway re-checks the KYC engine.
const kycCacheTTL = 24 * time.Hour

// kycStore is the Postgres-backed store for application records, bureau
// verification results and verified KYC levels. All methods fail closed:
// errors are returned to the caller and never swallowed.
type kycStore struct {
	db *sql.DB
}

var store *kycStore

// storeDDL creates the authoritative tables. Idempotent; run at boot.
const storeDDL = `
CREATE TABLE IF NOT EXISTS kyc_applications (
    id           TEXT PRIMARY KEY,
    customer_id  TEXT NOT NULL,
    type         TEXT NOT NULL,
    status       TEXT NOT NULL,
    kyc_verified BOOLEAN NOT NULL DEFAULT FALSE,
    kyc_level    TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyc_applications_customer_id_idx ON kyc_applications(customer_id);
CREATE INDEX IF NOT EXISTS kyc_applications_status_idx ON kyc_applications(status);

CREATE TABLE IF NOT EXISTS bureau_verification_results (
    verification_id TEXT PRIMARY KEY,
    customer_id     TEXT NOT NULL,
    overall_status  TEXT NOT NULL,
    consensus       DOUBLE PRECISION NOT NULL DEFAULT 0,
    credit_score    INTEGER NOT NULL DEFAULT 0,
    bureau_results  JSONB NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bureau_verification_results_customer_id_idx ON bureau_verification_results(customer_id);

CREATE TABLE IF NOT EXISTS kyc_status_cache (
    customer_id TEXT PRIMARY KEY,
    level       TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyc_status_cache_expires_at_idx ON kyc_status_cache(expires_at);
`

// initStore runs the DDL and installs the global store. Any failure is fatal
// at boot (fail-closed): the service must not start without a writable PG.
func initStore(ctx context.Context) error {
	if _, err := db.ExecContext(ctx, storeDDL); err != nil {
		return fmt.Errorf("kyc store DDL: %w", err)
	}
	store = &kycStore{db: db}
	return nil
}

// ─── Applications ───────────────────────────────────────────────────────────

// saveApplication persists an application record (write-through; PG is
// authoritative). Fail-closed: any error is returned to the caller.
func (s *kycStore) saveApplication(ctx context.Context, app *ApplicationRecord) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO kyc_applications (id, customer_id, type, status, kyc_verified, kyc_level, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (id) DO UPDATE SET
			status = EXCLUDED.status, kyc_verified = EXCLUDED.kyc_verified, kyc_level = EXCLUDED.kyc_level`,
		app.ID, app.CustomerID, app.Type, app.Status, app.KYCVerified, string(app.KYCLevel), app.CreatedAt)
	if err != nil {
		return fmt.Errorf("save application %q: %w", app.ID, err)
	}
	return nil
}

// getApplication loads an application record. Returns (nil, nil) when absent.
func (s *kycStore) getApplication(ctx context.Context, id string) (*ApplicationRecord, error) {
	var app ApplicationRecord
	var level string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, customer_id, type, status, kyc_verified, kyc_level, created_at
		 FROM kyc_applications WHERE id = $1`, id).
		Scan(&app.ID, &app.CustomerID, &app.Type, &app.Status, &app.KYCVerified, &level, &app.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get application %q: %w", id, err)
	}
	app.KYCLevel = KYCLevel(level)
	return &app, nil
}

// approvePendingApplications marks every pending_kyc application for the
// customer as approved when the freshly verified level satisfies the level
// the application required. Returns the number of rows approved. Level
// sufficiency is evaluated in SQL via the same rank mapping as
// isLevelSufficient (basic=1, standard=2, enhanced=3, full_edd=4).
func (s *kycStore) approvePendingApplications(ctx context.Context, customerID string, level KYCLevel) (int, error) {
	const rank = `CASE %s
		WHEN 'basic' THEN 1 WHEN 'standard' THEN 2
		WHEN 'enhanced' THEN 3 WHEN 'full_edd' THEN 4 ELSE 0 END`
	res, err := s.db.ExecContext(ctx,
		fmt.Sprintf(`UPDATE kyc_applications SET status = 'approved', kyc_verified = TRUE
		 WHERE customer_id = $1 AND status = 'pending_kyc'
		   AND `+rank+` >= `+rank, "$2", "kyc_level"),
		customerID, string(level))
	if err != nil {
		return 0, fmt.Errorf("approve pending applications for %q: %w", customerID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("approve pending applications row count: %w", err)
	}
	return int(n), nil
}

// ─── Bureau verification results ────────────────────────────────────────────

// saveBureauResult persists a multi-bureau verification result. The parent
// fields are real columns; the per-bureau breakdown is genuinely nested
// array data and is stored in the bureau_results JSONB column. Fail-closed.
func (s *kycStore) saveBureauResult(ctx context.Context, r *BureauVerificationResult) error {
	breakdown, err := json.Marshal(r.BureauResults)
	if err != nil {
		return fmt.Errorf("marshal bureau results: %w", err)
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO bureau_verification_results
			(verification_id, customer_id, overall_status, consensus, credit_score, bureau_results, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (verification_id) DO UPDATE SET
			overall_status = EXCLUDED.overall_status, consensus = EXCLUDED.consensus,
			credit_score = EXCLUDED.credit_score, bureau_results = EXCLUDED.bureau_results`,
		r.VerificationID, r.CustomerID, r.OverallStatus, r.Consensus, r.CreditScore, breakdown, r.Timestamp)
	if err != nil {
		return fmt.Errorf("save bureau result %q: %w", r.VerificationID, err)
	}
	return nil
}

// getBureauResult loads a verification result. Returns (nil, nil) when absent.
func (s *kycStore) getBureauResult(ctx context.Context, id string) (*BureauVerificationResult, error) {
	var r BureauVerificationResult
	var breakdown []byte
	err := s.db.QueryRowContext(ctx,
		`SELECT verification_id, customer_id, overall_status, consensus, credit_score, bureau_results, created_at
		 FROM bureau_verification_results WHERE verification_id = $1`, id).
		Scan(&r.VerificationID, &r.CustomerID, &r.OverallStatus, &r.Consensus, &r.CreditScore, &breakdown, &r.Timestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get bureau result %q: %w", id, err)
	}
	if err := json.Unmarshal(breakdown, &r.BureauResults); err != nil {
		return nil, fmt.Errorf("unmarshal bureau results for %q: %w", id, err)
	}
	return &r, nil
}

// ─── Verified KYC level cache (PG-backed, TTL) ──────────────────────────────

// setCachedLevel durably records a verified KYC level with an expiry.
// Fail-closed: the verification callback treats an error here as fatal to
// the request, because this level is authoritative for gating decisions.
func (s *kycStore) setCachedLevel(ctx context.Context, customerID string, level KYCLevel) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO kyc_status_cache (customer_id, level, expires_at, updated_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (customer_id) DO UPDATE SET
			level = EXCLUDED.level, expires_at = EXCLUDED.expires_at, updated_at = now()`,
		customerID, string(level), time.Now().Add(kycCacheTTL))
	if err != nil {
		return fmt.Errorf("cache KYC level for %q: %w", customerID, err)
	}
	return nil
}

// getCachedLevel returns the cached level and whether it was found and
// unexpired. A read error is returned so the caller can decide (the KYC
// status check degrades to a live engine query; expired rows are rejected
// here so a missed cleanup sweep is never a correctness issue).
func (s *kycStore) getCachedLevel(ctx context.Context, customerID string) (KYCLevel, bool, error) {
	var level string
	err := s.db.QueryRowContext(ctx,
		`SELECT level FROM kyc_status_cache WHERE customer_id = $1 AND expires_at > now()`,
		customerID).Scan(&level)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("read cached KYC level for %q: %w", customerID, err)
	}
	return KYCLevel(level), true, nil
}

// cleanupExpiredLevels removes expired cache rows. Errors are logged by the
// caller; expired rows are also rejected at read time.
func (s *kycStore) cleanupExpiredLevels(ctx context.Context) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM kyc_status_cache WHERE expires_at <= now()`)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
