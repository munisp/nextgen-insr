// PostgreSQL persistence layer for the OTA firmware registry.
//
// 2026-10-02 (C2-a11, persistence audit item A11): the POS terminal firmware
// registry was previously an in-memory map in main.go (comment: "In-memory
// store for demo; replace with PostgreSQL"), so every restart permanently
// lost uploaded firmware releases and terminals were served stale firmware
// from the hardcoded demo seed. Postgres is now the AUTHORITATIVE store;
// there is no in-memory fallback and no cache — reads are served directly
// from PG so rollout changes are immediately visible and there is no cache
// invalidation risk (read volume is low: terminal polling + admin lists).
//
// Fail-closed policy:
//   - boot: main() requires DATABASE_URL and a successful Ping + DDL
//     (initFirmwareStore), otherwise the process exits (log.Fatal);
//   - writes: any store error is propagated to the handler which returns 5xx
//     and never reports success;
//   - reads: store errors map to 5xx; "no rows" maps to 404 as before.
//
// S3 object keys are persisted verbatim from upload/register requests and
// are never fabricated or rewritten by this layer.

package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"time"
)

// firmwareDDL creates the authoritative firmware_packages table. Idempotent;
// run at boot.
const firmwareDDL = `
CREATE TABLE IF NOT EXISTS firmware_packages (
    id              TEXT PRIMARY KEY,
    version         TEXT NOT NULL,
    model           TEXT NOT NULL,
    s3_key          TEXT NOT NULL,
    checksum        TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    rollout_percent INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
    release_notes   TEXT NOT NULL DEFAULT '',
    is_latest       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      TEXT NOT NULL DEFAULT '',
    UNIQUE (model, version)
);
CREATE INDEX IF NOT EXISTS firmware_packages_model_latest_idx
    ON firmware_packages(model) WHERE is_latest;
`

// firmwarePgStore is the Postgres-backed firmware registry. All methods fail
// closed: errors are returned to the caller and never swallowed.
type firmwarePgStore struct {
	db *sql.DB
}

// fwStore is the process-wide registry, installed at boot by
// initFirmwareStore. Handlers must go through it, never a local map.
var fwStore *firmwarePgStore

// initFirmwareStore runs the DDL and installs the global store. Any failure
// is returned so main() can abort boot (fail-closed).
func initFirmwareStore(ctx context.Context) error {
	if db == nil {
		return errors.New("firmware store: db handle is nil")
	}
	if _, err := db.ExecContext(ctx, firmwareDDL); err != nil {
		return fmt.Errorf("firmware store DDL: %w", err)
	}
	fwStore = &firmwarePgStore{db: db}
	return nil
}

// initFirmwareStoreOn is the testable variant operating on an explicit DB
// handle; it fails closed on a nil or unreachable database.
func initFirmwareStoreOn(d *sql.DB) error {
	if d == nil {
		return errors.New("firmware store: db handle is nil")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if _, err := d.ExecContext(ctx, firmwareDDL); err != nil {
		return fmt.Errorf("firmware store DDL: %w", err)
	}
	fwStore = &firmwarePgStore{db: d}
	return nil
}

// storeReady guards handlers: if the store was never installed (boot failed
// closed) the handler responds 503 instead of panicking on a nil store.
func storeReady(w http.ResponseWriter) bool {
	if fwStore == nil {
		writeError(w, http.StatusServiceUnavailable, "firmware store unavailable")
		return false
	}
	return true
}

const firmwareColumns = `id, version, model, s3_key, checksum, size_bytes, rollout_percent, release_notes, is_latest, created_at, created_by`

func scanFirmware(row interface{ Scan(...any) error }) (*FirmwarePackage, error) {
	fw := &FirmwarePackage{}
	err := row.Scan(&fw.ID, &fw.Version, &fw.Model, &fw.S3Key, &fw.Checksum,
		&fw.SizeBytes, &fw.RolloutPercent, &fw.ReleaseNotes, &fw.IsLatest,
		&fw.CreatedAt, &fw.CreatedBy)
	if err != nil {
		return nil, err
	}
	return fw, nil
}

// errFirmwareNotFound is returned (wrapped) when a firmware id does not exist.
var errFirmwareNotFound = errors.New("firmware not found")

// getFirmware loads one package by id. Returns errFirmwareNotFound when absent.
func (s *firmwarePgStore) getFirmware(ctx context.Context, id string) (*FirmwarePackage, error) {
	fw, err := scanFirmware(s.db.QueryRowContext(ctx,
		`SELECT `+firmwareColumns+` FROM firmware_packages WHERE id = $1`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errFirmwareNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get firmware %q: %w", id, err)
	}
	return fw, nil
}

// latestFirmware returns the package flagged latest for a model, or
// errFirmwareNotFound.
func (s *firmwarePgStore) latestFirmware(ctx context.Context, model string) (*FirmwarePackage, error) {
	fw, err := scanFirmware(s.db.QueryRowContext(ctx,
		`SELECT `+firmwareColumns+` FROM firmware_packages WHERE model = $1 AND is_latest ORDER BY created_at DESC LIMIT 1`, model))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errFirmwareNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("latest firmware for model %q: %w", model, err)
	}
	return fw, nil
}

// listFirmware returns packages, optionally filtered by model ("" = all),
// newest first.
func (s *firmwarePgStore) listFirmware(ctx context.Context, model string) ([]*FirmwarePackage, error) {
	var rows *sql.Rows
	var err error
	if model == "" {
		rows, err = s.db.QueryContext(ctx,
			`SELECT `+firmwareColumns+` FROM firmware_packages ORDER BY created_at DESC`)
	} else {
		rows, err = s.db.QueryContext(ctx,
			`SELECT `+firmwareColumns+` FROM firmware_packages WHERE model = $1 ORDER BY created_at DESC`, model)
	}
	if err != nil {
		return nil, fmt.Errorf("list firmware: %w", err)
	}
	defer func() { _ = rows.Close() }()

	packages := []*FirmwarePackage{}
	for rows.Next() {
		fw, err := scanFirmware(rows)
		if err != nil {
			return nil, fmt.Errorf("scan firmware row: %w", err)
		}
		packages = append(packages, fw)
	}
	return packages, rows.Err()
}

// createFirmware inserts a new package and atomically clears is_latest on all
// previous packages of the same model when the new package is flagged latest.
func (s *firmwarePgStore) createFirmware(ctx context.Context, fw *FirmwarePackage) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := func(tx *sql.Tx) error {
		if fw.IsLatest {
			if _, err := tx.ExecContext(ctx,
				`UPDATE firmware_packages SET is_latest = FALSE WHERE model = $1 AND is_latest`, fw.Model); err != nil {
				return fmt.Errorf("clear previous latest for model %q: %w", fw.Model, err)
			}
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO firmware_packages (`+firmwareColumns+`)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			fw.ID, fw.Version, fw.Model, fw.S3Key, fw.Checksum, fw.SizeBytes,
			fw.RolloutPercent, fw.ReleaseNotes, fw.IsLatest, fw.CreatedAt, fw.CreatedBy); err != nil {
			return fmt.Errorf("insert firmware %q: %w", fw.ID, err)
		}
		return nil
	}(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// setRollout updates the rollout percentage. Returns errFirmwareNotFound when
// the id does not exist.
func (s *firmwarePgStore) setRollout(ctx context.Context, id string, percent int) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE firmware_packages SET rollout_percent = $2 WHERE id = $1`, id, percent)
	if err != nil {
		return fmt.Errorf("set rollout for %q: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("set rollout for %q: rows affected: %w", id, err)
	}
	if n == 0 {
		return errFirmwareNotFound
	}
	return nil
}
