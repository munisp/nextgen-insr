package main

// H-wave 2026-02 (F4 residual): concurrency test for the USSD double-float
// race fix. Runs against a REAL PostgreSQL (no mocks) when USSD_TEST_PG_DSN
// is set; skips honestly otherwise — the production path must never be
// tested against a fake database.

import (
	"context"
	"database/sql"
	"os"
	"sync"
	"testing"

	_ "github.com/lib/pq"

	"github.com/insureportal/ussd_gateway/db"
	"github.com/insureportal/ussd_gateway/models"
)

func setupRaceDB(t *testing.T) *sql.DB {
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
		`DROP TABLE IF EXISTS h_race_transactions`,
		`DROP TABLE IF EXISTS h_race_agent_accounts`,
		`DROP TABLE IF EXISTS h_race_transactions_view`,
		`CREATE TABLE h_race_agent_accounts (
			id varchar(64) PRIMARY KEY,
			float_balance double precision NOT NULL,
			updated_at timestamptz DEFAULT now()
		)`,
		`CREATE TABLE h_race_transactions (
			id varchar(64) PRIMARY KEY,
			session_id varchar(128),
			phone_number varchar(32),
			type varchar(32),
			product_id varchar(64),
			amount double precision,
			status varchar(32),
			reference varchar(64),
			created_at timestamptz,
			idempotency_key varchar(255) UNIQUE
		)`,
		// Point the store at the race tables via search_path-free aliasing.
		`DROP TABLE IF EXISTS transactions`,
		`DROP TABLE IF EXISTS agent_accounts`,
		`CREATE TABLE transactions AS SELECT * FROM h_race_transactions WITH NO DATA`,
		`ALTER TABLE transactions ADD PRIMARY KEY (id)`,
		`ALTER TABLE transactions ADD CONSTRAINT transactions_idem_uk UNIQUE (idempotency_key)`,
		`CREATE TABLE agent_accounts AS SELECT * FROM h_race_agent_accounts WITH NO DATA`,
		`ALTER TABLE agent_accounts ADD PRIMARY KEY (id)`,
	}
	for _, s := range stmts {
		if _, err := sqlDB.Exec(s); err != nil {
			t.Fatalf("setup %q: %v", s, err)
		}
	}
	t.Cleanup(func() {
		_, _ = sqlDB.Exec(`DROP TABLE IF EXISTS transactions, agent_accounts, h_race_transactions, h_race_agent_accounts`)
		_ = sqlDB.Close()
	})
	return sqlDB
}

func TestClaimFloatWithTransactionDoubleConfirmRace(t *testing.T) {
	sqlDB := setupRaceDB(t)
	store := db.NewPostgresStoreFromDB(sqlDB)
	ctx := context.Background()

	if _, err := sqlDB.Exec(`INSERT INTO agent_accounts (id, float_balance) VALUES ('A1', 1000)`); err != nil {
		t.Fatalf("seed agent: %v", err)
	}

	// Two duplicate confirms racing with the SAME idempotency key.
	const amount = 600.0
	const idemKey = "float:sess-1:A1:600.00"
	var wg sync.WaitGroup
	results := make([]struct {
		dup     bool
		balance float64
		err     error
	}, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			txn := &models.TransactionRecord{
				SessionID:   "sess-1",
				PhoneNumber: "+2348000000001",
				Type:        models.TransactionTypeFloatClaim,
				ProductID:   "float_claim",
				Amount:      amount,
				Status:      "completed",
			}
			_, dup, bal, err := store.ClaimFloatWithTransaction(ctx, txn, idemKey, "A1", amount)
			results[idx].dup = dup
			results[idx].balance = bal
			results[idx].err = err
		}(i)
	}
	wg.Wait()

	for i, r := range results {
		if r.err != nil {
			t.Fatalf("claim %d errored: %v", i, r.err)
		}
	}
	dups := 0
	for _, r := range results {
		if r.dup {
			dups++
		}
	}
	if dups != 1 {
		t.Fatalf("expected exactly one duplicate claim, got %d", dups)
	}

	// The critical invariant: exactly ONE deduction happened.
	var balance float64
	if err := sqlDB.QueryRow(`SELECT float_balance FROM agent_accounts WHERE id = 'A1'`).Scan(&balance); err != nil {
		t.Fatalf("balance: %v", err)
	}
	if balance != 400 {
		t.Fatalf("double-float race: expected balance 400 after one deduction, got %v", balance)
	}

	// And exactly one transaction row exists for the idempotency key.
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM transactions WHERE idempotency_key = $1`, idemKey).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected 1 transaction row, got %d", n)
	}
}

func TestClaimFloatInsufficientFloatRollsBackClaim(t *testing.T) {
	sqlDB := setupRaceDB(t)
	store := db.NewPostgresStoreFromDB(sqlDB)
	ctx := context.Background()

	if _, err := sqlDB.Exec(`INSERT INTO agent_accounts (id, float_balance) VALUES ('A2', 100)`); err != nil {
		t.Fatalf("seed agent: %v", err)
	}
	txn := &models.TransactionRecord{SessionID: "s", PhoneNumber: "+2348000000002", Type: models.TransactionTypeFloatClaim, ProductID: "float_claim", Amount: 600, Status: "completed"}
	if _, _, _, err := store.ClaimFloatWithTransaction(ctx, txn, "float:s:A2:600.00", "A2", 600); err != db.ErrInsufficientFloat {
		t.Fatalf("expected ErrInsufficientFloat, got %v", err)
	}
	// The failed claim must have ROLLED BACK the idempotency insert — the key
	// is free for a later retry with sufficient funds.
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM transactions WHERE idempotency_key = 'float:s:A2:600.00'`).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("failed claim leaked an idempotency row (%d rows)", n)
	}
}
