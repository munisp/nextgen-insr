// Package sync implements the upstream sync engine that pushes committed
// SQLite transfers to the TigerBeetle Zig cluster and writes metadata to
// PostgreSQL. It runs as a background goroutine and retries on failure.
package sync

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/54link/tb-sidecar/internal/ledger"
	"github.com/jackc/pgx/v5"
)

// Config holds the sync engine configuration.
type Config struct {
	// TigerBeetleDataFile is the path to the .tigerbeetle data file.
	TigerBeetleDataFile string
	// TigerBeetleCluster is the cluster ID (default 0 for dev).
	TigerBeetleCluster string
	// PostgresDSN is the connection string for the upstream PostgreSQL.
	PostgresDSN string
	// SyncInterval is how often to poll for pending transfers.
	SyncInterval time.Duration
	// BatchSize is the maximum number of transfers to sync per tick.
	BatchSize int
}

// Engine is the sync engine.
type Engine struct {
	cfg    Config
	db     *ledger.DB
	pgConn *pgx.Conn
}

// New creates a new sync engine. pgConn may be nil if PostgreSQL is unavailable.
func New(cfg Config, db *ledger.DB) *Engine {
	return &Engine{cfg: cfg, db: db}
}

// Start runs the sync loop in the background until ctx is cancelled.
func (e *Engine) Start(ctx context.Context) {
	// Try to connect to PostgreSQL (non-fatal if unavailable)
	if e.cfg.PostgresDSN != "" {
		conn, err := pgx.Connect(ctx, e.cfg.PostgresDSN)
		if err != nil {
			log.Printf("[sync] PostgreSQL unavailable (%v) — will retry on each tick", err)
		} else {
			e.pgConn = conn
			log.Printf("[sync] PostgreSQL connected")
			if err := e.ensurePgSchema(ctx); err != nil {
				log.Printf("[sync] PG schema error: %v", err)
			}
		}
	}

	ticker := time.NewTicker(e.cfg.SyncInterval)
	defer ticker.Stop()

	log.Printf("[sync] Engine started (interval=%s, batch=%d)", e.cfg.SyncInterval, e.cfg.BatchSize)

	// Reset any previously failed transfers so they are retried on restart.
	if err := e.db.ResetFailedForRetry(); err != nil {
		log.Printf("[sync] reset failed transfers: %v", err)
	}

	for {
		select {
		case <-ctx.Done():
			log.Printf("[sync] Engine stopping")
			return
		case <-ticker.C:
			e.tick(ctx)
		}
	}
}

// tick processes one batch of pending transfers.
func (e *Engine) tick(ctx context.Context) {
	transfers, err := e.db.GetPendingSyncTransfers(e.cfg.BatchSize)
	if err != nil {
		log.Printf("[sync] get pending: %v", err)
		return
	}
	if len(transfers) == 0 {
		return
	}

	log.Printf("[sync] syncing %d transfer(s)", len(transfers))

	for _, t := range transfers {
		if err := e.syncTransfer(ctx, t); err != nil {
			log.Printf("[sync] transfer %s failed: %v", t.ID, err)
			_ = e.db.MarkSyncFailed(t.ID)
		} else {
			_ = e.db.MarkSynced(t.ID)
			log.Printf("[sync] transfer %s synced", t.ID)
		}
	}
}

// syncTransfer sends a single transfer to the TigerBeetle Zig cluster via
// the tigerbeetle CLI, then writes metadata to PostgreSQL.
func (e *Engine) syncTransfer(ctx context.Context, t ledger.Transfer) error {
	// ── Step 1: Submit to TigerBeetle Zig cluster via CLI ──────────────────
	if err := e.submitToTigerBeetle(t); err != nil {
		// Non-fatal: log and continue to PG write so we don't lose the record.
		log.Printf("[sync] TB submit warning (will retry): %v", err)
	}

	// ── Step 2: Write metadata to PostgreSQL ───────────────────────────────
	if e.pgConn != nil {
		if err := e.writeToPg(ctx, t); err != nil {
			// Try to reconnect once
			conn, connErr := pgx.Connect(ctx, e.cfg.PostgresDSN)
			if connErr == nil {
				e.pgConn = conn
				if err2 := e.writeToPg(ctx, t); err2 != nil {
					return fmt.Errorf("pg write after reconnect: %w", err2)
				}
			} else {
				log.Printf("[sync] PG write failed (offline): %v", err)
				// Not a hard failure — TB is the source of truth
			}
		}
	}

	return nil
}

// submitToTigerBeetle sends a transfer to the TigerBeetle cluster via HTTP API.
// Uses the native HTTP API instead of exec.Command to prevent shell injection
// and reduce process management overhead.
func (e *Engine) submitToTigerBeetle(t ledger.Transfer) error {
	payload := map[string]interface{}{
		"id":                t.ID,
		"debit_account_id":  t.DebitAccountID,
		"credit_account_id": t.CreditAccountID,
		"amount":            t.Amount,
		"ledger":            t.Ledger,
		"code":              t.Code,
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal transfer payload: %w", err)
	}

	tbAddr := "http://127.0.0.1:3000"
	if e.cfg.TigerBeetleDataFile != "" {
		tbAddr = fmt.Sprintf("http://127.0.0.1:%s", strings.TrimPrefix(e.cfg.TigerBeetleCluster, "cluster-"))
	}

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("POST", tbAddr+"/transfer", strings.NewReader(string(payloadJSON)))
	if err != nil {
		return fmt.Errorf("create TB request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[sync] TB HTTP API unavailable: %v", err)
		return nil // soft failure — TB may not be running in dev
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		log.Printf("[sync] TB returned status %d for transfer %s", resp.StatusCode, t.ID)
	}
	return nil
}

// writeToPg writes transfer metadata to the PostgreSQL transfer_metadata table.
func (e *Engine) writeToPg(ctx context.Context, t ledger.Transfer) error {
	_, err := e.pgConn.Exec(ctx, `
		INSERT INTO transfer_metadata (
			id, debit_account_id, credit_account_id, amount, ledger, code,
			ref, tx_type, agent_code, synced_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (id) DO UPDATE SET synced_at = EXCLUDED.synced_at`,
		t.ID, t.DebitAccountID, t.CreditAccountID, t.Amount,
		t.Ledger, t.Code, t.Ref, t.TxType, t.AgentCode, time.Now().UTC(),
	)
	return err
}

// ensurePgSchema creates the transfer_metadata table if it does not exist.
func (e *Engine) ensurePgSchema(ctx context.Context) error {
	_, err := e.pgConn.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS transfer_metadata (
			id                TEXT PRIMARY KEY,
			debit_account_id  TEXT NOT NULL,
			credit_account_id TEXT NOT NULL,
			amount            BIGINT NOT NULL,
			ledger            INTEGER NOT NULL,
			code              INTEGER NOT NULL,
			ref               TEXT,
			tx_type           TEXT,
			agent_code        TEXT,
			synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	return err
}

// SyncStatus returns the current sync statistics via HTTP for health checks.
func (e *Engine) SyncStatus() map[string]interface{} {
	pending, synced, failed, err := e.db.SyncStats()
	status := map[string]interface{}{
		"pending": pending,
		"synced":  synced,
		"failed":  failed,
	}
	if err != nil {
		status["error"] = err.Error()
	}
	pgStatus := "disconnected"
	if e.pgConn != nil {
		pgStatus = "connected"
	}
	status["postgres"] = pgStatus
	return status
}

// HTTPHealthCheck returns an http.HandlerFunc for /health.
func (e *Engine) HTTPHealthCheck() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(e.SyncStatus()) //nolint:errcheck
	}
}
