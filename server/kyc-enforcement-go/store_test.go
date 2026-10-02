// Persistence tests for the Postgres-backed KYC enforcement store.
//
// 2026-10-02 (C2-a7, audit item A7): NO MOCKS on production paths — these
// tests run against a REAL Postgres (DATABASE_URL, defaulting to the local
// embedded PG on :55432), following the repo's integration-test convention
// (e.g. server/fido2-service/store_test.go): the suite skips cleanly when no
// PG is reachable.

package main

import (
	"context"
	"database/sql"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	_ "github.com/lib/pq"
)

// getTestStore connects to a real PG and installs the store schema. Skips the
// test when no database is reachable (repo convention for integration tests).
func getTestStore(t *testing.T) *kycStore {
	t.Helper()
	dbURL := testDatabaseURL()
	testDB, err := sql.Open("postgres", dbURL)
	if err != nil {
		t.Skipf("Skipping persistence test: %v", err)
	}
	if err = testDB.Ping(); err != nil {
		t.Skipf("Skipping persistence test (DB unreachable): %v", err)
	}
	t.Cleanup(func() { _ = testDB.Close() })

	prevDB, prevStore := db, store
	db = testDB
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := initStore(ctx); err != nil {
		t.Fatalf("initStore: %v", err)
	}
	t.Cleanup(func() { db, store = prevDB, prevStore })
	return store
}

func testDatabaseURL() string {
	if u := envOr("DATABASE_URL", ""); u != "" {
		return u
	}
	return "postgres://postgres:postgres@localhost:55432/postgres?sslmode=disable"
}

// cleanupTestRows removes all rows created by a test prefix.
func cleanupTestRows(t *testing.T, s *kycStore, prefix string) {
	t.Helper()
	like := prefix + "%"
	_, _ = s.db.Exec(`DELETE FROM kyc_applications WHERE id LIKE $1 OR customer_id LIKE $1`, like)
	_, _ = s.db.Exec(`DELETE FROM bureau_verification_results WHERE verification_id LIKE $1 OR customer_id LIKE $1`, like)
	_, _ = s.db.Exec(`DELETE FROM kyc_status_cache WHERE customer_id LIKE $1`, like)
}

// TestPersistence_ApplicationRoundTrip_RestartSimulation verifies the core
// A7 fix: an application written via one store instance survives into a
// brand-new store instance (simulated service restart).
func TestPersistence_ApplicationRoundTrip_RestartSimulation(t *testing.T) {
	s := getTestStore(t)
	ctx := context.Background()
	defer cleanupTestRows(t, s, "test-a7-")

	app := &ApplicationRecord{
		ID:         "test-a7-app-1",
		CustomerID: "test-a7-cust-1",
		Type:       "loan",
		Status:     "pending_kyc",
		KYCLevel:   KYCLevelEnhanced,
		CreatedAt:  time.Now().Truncate(time.Millisecond),
	}
	if err := s.saveApplication(ctx, app); err != nil {
		t.Fatalf("saveApplication: %v", err)
	}

	// Restart simulation: a new store instance over the same DB.
	s2 := &kycStore{db: s.db}
	got, err := s2.getApplication(ctx, app.ID)
	if err != nil {
		t.Fatalf("getApplication after restart: %v", err)
	}
	if got == nil {
		t.Fatal("application lost across restart")
	}
	if got.CustomerID != app.CustomerID || got.Type != app.Type || got.Status != app.Status ||
		got.KYCVerified != app.KYCVerified || got.KYCLevel != app.KYCLevel {
		t.Fatalf("round trip mismatch: got %+v want %+v", got, app)
	}

	// Missing ID returns (nil, nil), not an error.
	missing, err := s2.getApplication(ctx, "test-a7-does-not-exist")
	if err != nil || missing != nil {
		t.Fatalf("missing application: got %+v, err %v", missing, err)
	}
}

// TestPersistence_ApprovePendingApplications verifies the verify-callback
// semantics in SQL: only pending_kyc applications whose required level is
// satisfied by the verified level are approved, and the update is durable.
func TestPersistence_ApprovePendingApplications(t *testing.T) {
	s := getTestStore(t)
	ctx := context.Background()
	defer cleanupTestRows(t, s, "test-a7-")

	apps := []*ApplicationRecord{
		{ID: "test-a7-ap-1", CustomerID: "test-a7-cu", Type: "account", Status: "pending_kyc", KYCLevel: KYCLevelStandard, CreatedAt: time.Now()},
		{ID: "test-a7-ap-2", CustomerID: "test-a7-cu", Type: "loan", Status: "pending_kyc", KYCLevel: KYCLevelEnhanced, CreatedAt: time.Now()},
		{ID: "test-a7-ap-3", CustomerID: "test-a7-cu", Type: "loan", Status: "pending_kyc", KYCLevel: KYCLevelFullEDD, CreatedAt: time.Now()},
		{ID: "test-a7-ap-4", CustomerID: "test-a7-other", Type: "account", Status: "pending_kyc", KYCLevel: KYCLevelBasic, CreatedAt: time.Now()},
	}
	for _, a := range apps {
		if err := s.saveApplication(ctx, a); err != nil {
			t.Fatalf("saveApplication %s: %v", a.ID, err)
		}
	}

	n, err := s.approvePendingApplications(ctx, "test-a7-cu", KYCLevelEnhanced)
	if err != nil {
		t.Fatalf("approvePendingApplications: %v", err)
	}
	if n != 2 {
		t.Fatalf("approved %d applications, want 2 (standard + enhanced satisfied; full_edd not)", n)
	}

	// Durable check via a fresh store instance.
	s2 := &kycStore{db: s.db}
	for id, want := range map[string]string{
		"test-a7-ap-1": "approved",
		"test-a7-ap-2": "approved",
		"test-a7-ap-3": "pending_kyc",
		"test-a7-ap-4": "pending_kyc",
	} {
		got, err := s2.getApplication(ctx, id)
		if err != nil || got == nil {
			t.Fatalf("getApplication %s: %+v, %v", id, got, err)
		}
		if got.Status != want {
			t.Fatalf("application %s status %q, want %q", id, got.Status, want)
		}
		if want == "approved" && !got.KYCVerified {
			t.Fatalf("application %s approved but kyc_verified flag not set", id)
		}
	}
}

// TestPersistence_BureauResultRoundTrip_RestartSimulation verifies bureau
// verification results (including the per-bureau breakdown) survive restart.
func TestPersistence_BureauResultRoundTrip_RestartSimulation(t *testing.T) {
	s := getTestStore(t)
	ctx := context.Background()
	defer cleanupTestRows(t, s, "test-a7-")

	res := &BureauVerificationResult{
		VerificationID: "test-a7-ver-1",
		CustomerID:     "test-a7-cust-2",
		OverallStatus:  "partial",
		Consensus:      66.67,
		CreditScore:    612,
		BureauResults: []BureauResult{
			{Bureau: "firstcentral", Status: "verified", Confidence: 0.98, CreditScore: 700, MatchedFields: []string{"bvn", "dob"}, ResponseTimeMs: 120},
			{Bureau: "crc", Status: "mismatch", Confidence: 0.40, Discrepancies: []string{"phone"}, ResponseTimeMs: 250},
		},
		Timestamp: time.Now().Truncate(time.Millisecond),
	}
	if err := s.saveBureauResult(ctx, res); err != nil {
		t.Fatalf("saveBureauResult: %v", err)
	}

	s2 := &kycStore{db: s.db}
	got, err := s2.getBureauResult(ctx, res.VerificationID)
	if err != nil {
		t.Fatalf("getBureauResult after restart: %v", err)
	}
	if got == nil {
		t.Fatal("bureau result lost across restart")
	}
	if got.CustomerID != res.CustomerID || got.OverallStatus != res.OverallStatus ||
		got.CreditScore != res.CreditScore || got.Consensus != res.Consensus {
		t.Fatalf("round trip mismatch: got %+v want %+v", got, res)
	}
	if len(got.BureauResults) != 2 {
		t.Fatalf("bureau breakdown lost: got %d entries, want 2", len(got.BureauResults))
	}
	if got.BureauResults[0].Bureau != "firstcentral" || got.BureauResults[0].CreditScore != 700 ||
		len(got.BureauResults[0].MatchedFields) != 2 || got.BureauResults[1].Status != "mismatch" {
		t.Fatalf("bureau breakdown mismatch: %+v", got.BureauResults)
	}
}

// TestPersistence_KYCLevelCache verifies the PG-backed TTL cache: set, read
// back across a restart, expiry enforcement, and the cleanup sweep.
func TestPersistence_KYCLevelCache(t *testing.T) {
	s := getTestStore(t)
	ctx := context.Background()
	defer cleanupTestRows(t, s, "test-a7-")

	if err := s.setCachedLevel(ctx, "test-a7-cust-3", KYCLevelEnhanced); err != nil {
		t.Fatalf("setCachedLevel: %v", err)
	}

	s2 := &kycStore{db: s.db}
	level, ok, err := s2.getCachedLevel(ctx, "test-a7-cust-3")
	if err != nil || !ok || level != KYCLevelEnhanced {
		t.Fatalf("getCachedLevel after restart: level=%q ok=%v err=%v", level, ok, err)
	}

	// Unknown customer is a clean miss.
	if _, ok, err := s2.getCachedLevel(ctx, "test-a7-unknown"); err != nil || ok {
		t.Fatalf("unknown customer: ok=%v err=%v", ok, err)
	}

	// Force expiry and confirm the row is rejected at read time.
	if _, err := s.db.Exec(`UPDATE kyc_status_cache SET expires_at = now() - interval '1 minute' WHERE customer_id = $1`, "test-a7-cust-3"); err != nil {
		t.Fatalf("force expiry: %v", err)
	}
	if _, ok, err := s2.getCachedLevel(ctx, "test-a7-cust-3"); err != nil || ok {
		t.Fatalf("expired entry served: ok=%v err=%v", ok, err)
	}
	deleted, err := s2.cleanupExpiredLevels(ctx)
	if err != nil {
		t.Fatalf("cleanupExpiredLevels: %v", err)
	}
	if deleted < 1 {
		t.Fatalf("cleanup removed %d rows, want >= 1", deleted)
	}
}

// TestFailClosed_StoreErrorsWhenDBDown verifies that every store method
// surfaces an error (never reports success) when the database is gone.
func TestFailClosed_StoreErrorsWhenDBDown(t *testing.T) {
	deadDB, err := sql.Open("postgres", testDatabaseURL())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	_ = deadDB.Close() // closed pool: every operation fails

	s := &kycStore{db: deadDB}
	ctx := context.Background()

	if err := s.saveApplication(ctx, &ApplicationRecord{ID: "x", CustomerID: "x"}); err == nil {
		t.Fatal("saveApplication succeeded against a dead DB")
	}
	if _, err := s.getApplication(ctx, "x"); err == nil {
		t.Fatal("getApplication succeeded against a dead DB")
	}
	if _, err := s.approvePendingApplications(ctx, "x", KYCLevelBasic); err == nil {
		t.Fatal("approvePendingApplications succeeded against a dead DB")
	}
	if err := s.saveBureauResult(ctx, &BureauVerificationResult{VerificationID: "x"}); err == nil {
		t.Fatal("saveBureauResult succeeded against a dead DB")
	}
	if _, err := s.getBureauResult(ctx, "x"); err == nil {
		t.Fatal("getBureauResult succeeded against a dead DB")
	}
	if err := s.setCachedLevel(ctx, "x", KYCLevelBasic); err == nil {
		t.Fatal("setCachedLevel succeeded against a dead DB")
	}
	if _, _, err := s.getCachedLevel(ctx, "x"); err == nil {
		t.Fatal("getCachedLevel succeeded against a dead DB")
	}
}

// TestFailClosed_HandlersReturn5xxWhenDBDown verifies the HTTP contract:
// handlers that depend on durable state answer 503, never a fake success,
// when PG is down.
func TestFailClosed_HandlersReturn5xxWhenDBDown(t *testing.T) {
	deadDB, err := sql.Open("postgres", testDatabaseURL())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	_ = deadDB.Close()

	cfg := Config{PermifyURL: "", DaprURL: ""}
	state := &AppState{config: cfg, store: &kycStore{db: deadDB}, startTime: time.Now()}

	// approve-gate: lookup fails -> 503 (not 404, not success)
	req := httptest.NewRequest("POST", "/api/v1/enforce/approve-gate", strings.NewReader(`{"application_id":"x"}`))
	rec := httptest.NewRecorder()
	state.handleApproveGate(rec, req)
	if rec.Code != 503 {
		t.Fatalf("handleApproveGate with dead DB: got %d, want 503", rec.Code)
	}

	// verify-callback: durable level write fails -> 503 (not "verified")
	req = httptest.NewRequest("POST", "/api/v1/enforce/verify-callback", strings.NewReader(`{"customer_id":"c","level":"enhanced"}`))
	rec = httptest.NewRecorder()
	state.handleVerifyCallback(rec, req)
	if rec.Code != 503 {
		t.Fatalf("handleVerifyCallback with dead DB: got %d, want 503", rec.Code)
	}

	// bureau status: lookup fails -> 503
	req = httptest.NewRequest("GET", "/api/v1/bureau/status/abc", nil)
	rec = httptest.NewRecorder()
	state.handleBureauStatus(rec, req)
	if rec.Code != 503 {
		t.Fatalf("handleBureauStatus with dead DB: got %d, want 503", rec.Code)
	}
}

// TestHandlers_ApproveGateHappyPath verifies approve-gate against real PG:
// 404 for unknown applications, 403 while KYC is unverified, 200 once the
// verify-callback has durably approved the application.
func TestHandlers_ApproveGateHappyPath(t *testing.T) {
	s := getTestStore(t)
	ctx := context.Background()
	defer cleanupTestRows(t, s, "test-a7-")

	cfg := Config{PermifyURL: "", DaprURL: ""}
	state := &AppState{config: cfg, store: s, startTime: time.Now()}

	if err := s.saveApplication(ctx, &ApplicationRecord{
		ID: "test-a7-gate", CustomerID: "test-a7-cust-4", Type: "account",
		Status: "pending_kyc", KYCLevel: KYCLevelStandard, CreatedAt: time.Now(),
	}); err != nil {
		t.Fatalf("seed application: %v", err)
	}

	post := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", "/api/v1/enforce/approve-gate", strings.NewReader(body))
		rec := httptest.NewRecorder()
		state.handleApproveGate(rec, req)
		return rec
	}

	if rec := post(`{"application_id":"test-a7-missing"}`); rec.Code != 404 {
		t.Fatalf("unknown application: got %d, want 404", rec.Code)
	}
	if rec := post(`{"application_id":"test-a7-gate"}`); rec.Code != 403 {
		t.Fatalf("unverified application: got %d, want 403 (no override path)", rec.Code)
	}

	// Simulate the verification callback: durable approval.
	req := httptest.NewRequest("POST", "/api/v1/enforce/verify-callback",
		strings.NewReader(`{"customer_id":"test-a7-cust-4","level":"standard"}`))
	rec := httptest.NewRecorder()
	state.handleVerifyCallback(rec, req)
	if rec.Code != 200 {
		t.Fatalf("verify-callback: got %d, want 200: %s", rec.Code, rec.Body.String())
	}

	if rec := post(`{"application_id":"test-a7-gate"}`); rec.Code != 200 {
		t.Fatalf("approved application: got %d, want 200", rec.Code)
	}
}
