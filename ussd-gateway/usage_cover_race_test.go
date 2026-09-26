package main

// Q-wave Q3 (2026-09-25): concurrency/idempotency test for the USSD per-day
// usage-cover activation. Runs against a REAL PostgreSQL (no mocks) when
// USSD_TEST_PG_DSN is set; skips honestly otherwise — the same opt-in
// pattern as float_race_test.go.
//
// Proves:
//   1. N concurrent confirms with the SAME idempotency key produce exactly
//      ONE activation row (the losers get the existing row with dup=true).
//   2. ExpireDueUsageCoverActivations flips only due rows, idempotently.

import (
	"context"
	"database/sql"
	"os"
	"sync"
	"testing"
	"time"

	_ "github.com/lib/pq"

	"github.com/insureportal/ussd_gateway/db"
	"github.com/insureportal/ussd_gateway/models"
)

func setupUsageCoverRaceDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("USSD_TEST_PG_DSN")
	if dsn == "" {
		t.Skip("USSD_TEST_PG_DSN not set — real-Postgres race test skipped (opt-in)")
	}
	sqlDB, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := sqlDB.Ping(); err != nil {
		t.Fatalf("ping: %v", err)
	}
	// Single connection keeps the test valid against PGlite (one serialized
	// backend); against a full PostgreSQL CI service the DSN can raise this.
	sqlDB.SetMaxOpenConns(1)
	stmts := []string{
		`DROP TABLE IF EXISTS ussd_usage_cover_activations`,
		`CREATE TABLE ussd_usage_cover_activations (
			id              TEXT PRIMARY KEY,
			session_id      TEXT NOT NULL,
			phone_number    TEXT NOT NULL,
			product_id      TEXT NOT NULL,
			days            INTEGER NOT NULL,
			status          TEXT NOT NULL DEFAULT 'active',
			reference       TEXT,
			activated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			expires_at      TIMESTAMPTZ NOT NULL,
			idempotency_key TEXT
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_ussd_usage_cover_idempotency ON ussd_usage_cover_activations(idempotency_key) WHERE idempotency_key IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_ussd_usage_cover_expiry ON ussd_usage_cover_activations(status, expires_at)`,
	}
	for _, s := range stmts {
		if _, err := sqlDB.Exec(s); err != nil {
			t.Fatalf("setup %q: %v", s, err)
		}
	}
	t.Cleanup(func() {
		_, _ = sqlDB.Exec(`DROP TABLE IF EXISTS ussd_usage_cover_activations`)
		_ = sqlDB.Close()
	})
	return sqlDB
}

func TestUsageCoverActivationIdempotentRace(t *testing.T) {
	sqlDB := setupUsageCoverRaceDB(t)
	store := db.NewPostgresStoreFromDB(sqlDB)
	ctx := context.Background()

	// Two duplicate confirms racing with the SAME idempotency key (telco
	// callback redelivery of the confirm step).
	const idemKey = "usagecover:sess-uc-1:7"
	var wg sync.WaitGroup
	type res struct {
		dup bool
		err error
	}
	results := make([]res, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			act := &models.UsageCoverActivation{
				SessionID:   "sess-uc-1",
				PhoneNumber: "+2348000000002",
				ProductID:   "motor",
				Days:        7,
				Status:      models.UsageCoverStatusActive,
				ExpiresAt:   time.Now().UTC().Add(7 * 24 * time.Hour),
			}
			_, dup, err := store.CreateUsageCoverActivationIdempotent(ctx, act, idemKey)
			results[idx].dup = dup
			results[idx].err = err
		}(i)
	}
	wg.Wait()

	for i, r := range results {
		if r.err != nil {
			t.Fatalf("activation %d errored: %v", i, r.err)
		}
	}
	dups := 0
	for _, r := range results {
		if r.dup {
			dups++
		}
	}
	if dups != 1 {
		t.Fatalf("expected exactly one duplicate activation, got %d", dups)
	}

	// The critical invariant: exactly ONE activation row exists for the key.
	var count int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM ussd_usage_cover_activations WHERE idempotency_key = $1`, idemKey).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("usage-cover double-activation race: expected 1 row, got %d", count)
	}
}

func TestExpireDueUsageCoverActivations(t *testing.T) {
	sqlDB := setupUsageCoverRaceDB(t)
	store := db.NewPostgresStoreFromDB(sqlDB)
	ctx := context.Background()

	// One due row, one future row.
	if _, err := sqlDB.Exec(
		`INSERT INTO ussd_usage_cover_activations (id, session_id, phone_number, product_id, days, status, reference, expires_at, idempotency_key)
		 VALUES
		 ('UC-DUE', 's1', '+2348000000003', 'motor', 1, 'active', 'UCD-due000001', NOW() - INTERVAL '1 hour', 'usagecover:s1:1'),
		 ('UC-LIVE', 's2', '+2348000000003', 'motor', 5, 'active', 'UCD-live00001', NOW() + INTERVAL '5 days', 'usagecover:s2:5')`); err != nil {
		t.Fatalf("seed: %v", err)
	}

	expired, err := store.ExpireDueUsageCoverActivations(ctx)
	if err != nil {
		t.Fatalf("expire: %v", err)
	}
	if expired != 1 {
		t.Fatalf("expected 1 expired activation, got %d", expired)
	}
	// Idempotent re-run: nothing left to expire.
	again, err := store.ExpireDueUsageCoverActivations(ctx)
	if err != nil {
		t.Fatalf("re-expire: %v", err)
	}
	if again != 0 {
		t.Fatalf("expiry sweep not idempotent: second run expired %d", again)
	}
	var dueStatus, liveStatus string
	if err := sqlDB.QueryRow(`SELECT status FROM ussd_usage_cover_activations WHERE id = 'UC-DUE'`).Scan(&dueStatus); err != nil {
		t.Fatalf("due status: %v", err)
	}
	if err := sqlDB.QueryRow(`SELECT status FROM ussd_usage_cover_activations WHERE id = 'UC-LIVE'`).Scan(&liveStatus); err != nil {
		t.Fatalf("live status: %v", err)
	}
	if dueStatus != models.UsageCoverStatusExpired {
		t.Fatalf("due activation status = %q, want expired", dueStatus)
	}
	if liveStatus != models.UsageCoverStatusActive {
		t.Fatalf("live activation status = %q, want active", liveStatus)
	}
}
