// Persistence tests for the Postgres-backed firmware registry.
// 2026-10-02 (C2-a11, persistence audit item A11).
//
// These tests require a real PostgreSQL (no mocks). Set
// OTA_TEST_DATABASE_URL (or DATABASE_URL) to run them; they are skipped when
// the database is unreachable.

package main

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// testDB connects to a real PG, skipping the test if unreachable.
func testDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("OTA_TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no OTA_TEST_DATABASE_URL/DATABASE_URL set; skipping PG-backed test")
	}
	d, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Skipf("cannot open PG: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := d.PingContext(ctx); err != nil {
		t.Skipf("PG unreachable at %q: %v", dsn, err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d
}

// withStore installs a fresh global store on the test DB and cleans the table.
func withStore(t *testing.T) *firmwarePgStore {
	t.Helper()
	d := testDB(t)
	prevDB, prevStore := db, fwStore
	db = d
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := initFirmwareStore(ctx); err != nil {
		t.Fatalf("initFirmwareStore: %v", err)
	}
	if _, err := d.Exec(`DELETE FROM firmware_packages`); err != nil {
		t.Fatalf("clean table: %v", err)
	}
	t.Cleanup(func() {
		_, _ = d.Exec(`DELETE FROM firmware_packages`)
		db, fwStore = prevDB, prevStore
	})
	return fwStore
}

func sampleFw(id, version, model string, latest bool) *FirmwarePackage {
	return &FirmwarePackage{
		ID:             id,
		Version:        version,
		Model:          model,
		S3Key:          "firmware/" + model + "/v" + version + "/firmware.bin",
		Checksum:       "sha256:" + strings.Repeat("ab", 32),
		SizeBytes:      1024,
		RolloutPercent: 0,
		ReleaseNotes:   "test release",
		IsLatest:       latest,
		CreatedAt:      time.Now().UTC(),
		CreatedBy:      "test",
	}
}

// TestFirmwareRoundTrip verifies upload/register persists to PG with the S3
// key preserved verbatim.
func TestFirmwareRoundTrip(t *testing.T) {
	s := withStore(t)
	ctx := context.Background()

	fw := sampleFw("fw-t1", "9.9.9", "TEST-MODEL", true)
	if err := s.createFirmware(ctx, fw); err != nil {
		t.Fatalf("createFirmware: %v", err)
	}
	got, err := s.getFirmware(ctx, "fw-t1")
	if err != nil {
		t.Fatalf("getFirmware: %v", err)
	}
	if got.S3Key != fw.S3Key || got.Checksum != fw.Checksum || got.Version != fw.Version || !got.IsLatest {
		t.Fatalf("round trip mismatch: %+v", got)
	}

	// New latest supersedes the old one atomically.
	fw2 := sampleFw("fw-t2", "9.9.10", "TEST-MODEL", true)
	if err := s.createFirmware(ctx, fw2); err != nil {
		t.Fatalf("createFirmware 2: %v", err)
	}
	old, err := s.getFirmware(ctx, "fw-t1")
	if err != nil {
		t.Fatalf("getFirmware old: %v", err)
	}
	if old.IsLatest {
		t.Fatal("previous release still flagged latest after supersede")
	}
	latest, err := s.latestFirmware(ctx, "TEST-MODEL")
	if err != nil {
		t.Fatalf("latestFirmware: %v", err)
	}
	if latest.ID != "fw-t2" {
		t.Fatalf("latest = %s, want fw-t2", latest.ID)
	}

	// Rollout write-through.
	if err := s.setRollout(ctx, "fw-t2", 25); err != nil {
		t.Fatalf("setRollout: %v", err)
	}
	got, _ = s.getFirmware(ctx, "fw-t2")
	if got.RolloutPercent != 25 {
		t.Fatalf("rollout = %d, want 25", got.RolloutPercent)
	}
	if err := s.setRollout(ctx, "fw-missing", 50); !errors.Is(err, errFirmwareNotFound) {
		t.Fatalf("setRollout unknown id err = %v, want errFirmwareNotFound", err)
	}
}

// TestFirmwareRestartSimulation simulates a process restart: a brand-new
// store instance built from the same PG must see previously registered
// firmware (no in-memory state involved).
func TestFirmwareRestartSimulation(t *testing.T) {
	s := withStore(t)
	ctx := context.Background()
	if err := s.createFirmware(ctx, sampleFw("fw-restart", "1.0.0", "RESTART-MODEL", true)); err != nil {
		t.Fatalf("createFirmware: %v", err)
	}
	if err := s.setRollout(ctx, "fw-restart", 75); err != nil {
		t.Fatalf("setRollout: %v", err)
	}

	// "Restart": new store object over the same DB, as after initFirmwareStore.
	restarted := &firmwarePgStore{db: s.db}
	got, err := restarted.getFirmware(ctx, "fw-restart")
	if err != nil {
		t.Fatalf("getFirmware after restart: %v", err)
	}
	if got.RolloutPercent != 75 || got.S3Key != "firmware/RESTART-MODEL/v1.0.0/firmware.bin" {
		t.Fatalf("state lost across restart: %+v", got)
	}
	latest, err := restarted.latestFirmware(ctx, "RESTART-MODEL")
	if err != nil || latest.ID != "fw-restart" {
		t.Fatalf("latest after restart = %+v, %v", latest, err)
	}
	list, err := restarted.listFirmware(ctx, "RESTART-MODEL")
	if err != nil || len(list) != 1 {
		t.Fatalf("list after restart = %d, %v", len(list), err)
	}
}

// TestFailClosed verifies that a broken DB surfaces errors (→ handlers return
// 5xx) rather than silently succeeding.
func TestFailClosed(t *testing.T) {
	d := testDB(t)
	if _, err := d.Exec(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`); err != nil {
		t.Skipf("cannot terminate backends to simulate outage: %v", err)
	}
	broken, err := sql.Open("postgres", "postgres://127.0.0.1:1/invalid?connect_timeout=1&sslmode=disable")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer func() { _ = broken.Close() }()
	s := &firmwarePgStore{db: broken}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.createFirmware(ctx, sampleFw("fw-x", "1.0.0", "M", true)); err == nil {
		t.Fatal("createFirmware succeeded against dead DB — must fail closed")
	}
	if _, err := s.getFirmware(ctx, "fw-x"); err == nil {
		t.Fatal("getFirmware succeeded against dead DB — must fail closed")
	}
	if err := initFirmwareStoreOn(broken); err == nil {
		t.Fatal("initFirmwareStore succeeded against dead DB — boot must fail closed")
	}
}

// TestHandlersFailClosedOnNilStore verifies handlers return 5xx (not panic or
// 2xx) when the store was never installed (boot failed).
func TestHandlersFailClosedOnNilStore(t *testing.T) {
	prev := fwStore
	fwStore = nil
	t.Cleanup(func() { fwStore = prev })

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ota/download/fw-1", nil)
	func() {
		defer func() {
			if r := recover(); r == nil {
				t.Log("no panic, but expect 5xx")
			}
		}()
		handleDownload(rec, req)
	}()
	if rec.Code < 500 {
		t.Fatalf("handleDownload with nil store: status = %d, want 5xx", rec.Code)
	}
}
