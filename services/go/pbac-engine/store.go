// PostgreSQL persistence layer for pbac-engine authorization policies.
//
// 2026-10-02 (C2-a9, persistence audit item A9): policies mutated via
// POST/DELETE /policies previously lived only in the Evaluator's in-memory
// map, so every restart silently reverted to defaultPolicies() — runtime
// authorization changes (new deny rules, raised limits) vanished, causing
// authorization drift with fail-open/fail-closed risk on an AUTHORIZATION
// engine. Postgres is now the AUTHORITATIVE store.
//
// Architecture (documented per audit requirement):
//   - BOOT: the Evaluator's in-memory copy is REBUILT from Postgres.
//     PG rows override defaults; defaultPolicies() are only seeded when the
//     pbac_policies table is completely empty (first boot against a fresh
//     database). Without DATABASE_URL or a reachable PG, the process exits
//     (log.Fatal) — an authorization engine that cannot see its policy
//     store fails CLOSED, never silently defaults.
//   - WRITES (POST/DELETE /policies): write-through. The Postgres write
//     happens FIRST; the in-memory evaluator is updated only after durable
//     success. If the DB write fails the handler returns 5xx and the policy
//     set is left unchanged — we never pretend a policy was stored.
//   - READS (/authorize evaluation): served from the in-memory copy for
//     per-request latency; that copy is an exact write-through mirror of
//     Postgres (rebuilt at boot, updated only after durable writes), so
//     divergence is limited to direct out-of-band table edits.

package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	_ "github.com/lib/pq"
)

// policyStore is the Postgres-backed authoritative store for PBAC policies.
// All methods fail closed: errors are returned, never swallowed.
type policyStore struct {
	db *sql.DB
}

// policyDDL creates the authoritative policy table. Idempotent; run at boot.
// The full Policy is stored as JSONB (data) so the evaluator's in-memory
// rebuild round-trips every field; scalar columns exist for inspection.
const policyDDL = `
CREATE TABLE IF NOT EXISTS pbac_policies (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT '',
    effect     TEXT NOT NULL DEFAULT '',
    data       JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`

// initPolicyStore opens Postgres, verifies connectivity, and creates the
// schema. Any failure is fatal: fail-closed boot (2026-10-02, C2-a9).
func initPolicyStore() *policyStore {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("pbac-engine: DATABASE_URL is required; failing closed (authorization policies must not revert to in-memory defaults)")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("pbac-engine: open database: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("pbac-engine: database unreachable, failing closed: %v", err)
	}
	if _, err := db.ExecContext(ctx, policyDDL); err != nil {
		log.Fatalf("pbac-engine: schema init failed, failing closed: %v", err)
	}
	return &policyStore{db: db}
}

// loadPolicies returns every persisted policy in insertion order (oldest
// first), matching the Evaluator's deterministic evaluation order contract.
func (s *policyStore) loadPolicies(ctx context.Context) ([]Policy, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT data FROM pbac_policies ORDER BY created_at ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Policy
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var p Policy
		if err := json.Unmarshal(raw, &p); err != nil {
			return nil, fmt.Errorf("pbac_policies row undecodable: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// countPolicies reports how many rows exist; used for the empty-table seed
// decision at boot.
func (s *policyStore) countPolicies(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM pbac_policies`).Scan(&n)
	return n, err
}

// upsertPolicy durably writes a policy (insert or replace). Callers must
// only touch the in-memory evaluator AFTER this returns nil (write-through).
func (s *policyStore) upsertPolicy(ctx context.Context, p Policy) error {
	raw, err := json.Marshal(p)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO pbac_policies (id, name, effect, data, updated_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (id) DO UPDATE
		SET name = EXCLUDED.name, effect = EXCLUDED.effect,
		    data = EXCLUDED.data, updated_at = now()`,
		p.ID, p.Name, p.Effect, raw)
	return err
}

// deletePolicy durably removes a policy. Returns (false, nil) when the id
// did not exist so the handler can answer 404 instead of 500.
func (s *policyStore) deletePolicy(ctx context.Context, id string) (bool, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM pbac_policies WHERE id = $1`, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// errStoreUnavailable marks the no-store path in tests/handlers; never
// returned after a successful initPolicyStore.
var errStoreUnavailable = errors.New("policy store unavailable")

// buildEvaluatorAtBoot loads the authoritative policy set from Postgres:
// PG rows override defaults; defaults are seeded ONLY when the table is
// completely empty (2026-10-02, C2-a9). Fail-closed: any DB error aborts
// boot rather than silently falling back to defaults.
func buildEvaluatorAtBoot(ctx context.Context, s *policyStore) (*Evaluator, error) {
	count, err := s.countPolicies(ctx)
	if err != nil {
		return nil, fmt.Errorf("count policies: %w", err)
	}
	if count == 0 {
		// First boot against a fresh database: seed the shipped guardrails so
		// the engine is useful out of the box. Seeded rows are real PG rows,
		// so subsequent admin edits/restarts behave like any other policy.
		for _, p := range defaultPolicies() {
			if err := s.upsertPolicy(ctx, p); err != nil {
				return nil, fmt.Errorf("seed default policy %s: %w", p.ID, err)
			}
		}
		log.Printf("pbac-engine: pbac_policies was empty; seeded %d default policies", len(defaultPolicies()))
	}
	policies, err := s.loadPolicies(ctx)
	if err != nil {
		return nil, fmt.Errorf("load policies: %w", err)
	}
	if len(policies) == 0 {
		// Table empty and seeding produced nothing: refuse to start an
		// authorization engine with zero policies.
		return nil, errors.New("no policies available after boot load")
	}
	return NewEvaluator(policies), nil
}
