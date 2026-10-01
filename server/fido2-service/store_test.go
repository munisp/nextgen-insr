// Persistence tests for the Postgres-backed FIDO2 store.
//
// 2026-10-01 (C2-fido2, audit item A8): NO MOCKS on production paths — these
// tests run against a REAL Postgres (DATABASE_URL, defaulting to the repo's
// standard local DSN), following the repo's integration-test convention
// (e.g. audit-trail-system/integration_test.go): the suite skips cleanly when
// no PG is reachable. There is no testcontainers/PGlite harness for Go in
// this repo, so a live database is the only honest harness.

package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	_ "github.com/lib/pq"
)

// getTestStore connects to a real PG and installs the store schema. Skips the
// test when no database is reachable (repo convention for integration tests).
func getTestStore(t *testing.T) *fido2Store {
	t.Helper()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
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

// cleanupTestRows removes all rows created by a test user ID prefix.
func cleanupTestRows(t *testing.T, s *fido2Store, userID string) {
	t.Helper()
	_, _ = s.db.Exec(`DELETE FROM fido2_sessions WHERE id LIKE 'test-%'`)
	_, _ = s.db.Exec(`DELETE FROM fido2_credentials WHERE user_id = $1`, userID)
	_, _ = s.db.Exec(`DELETE FROM fido2_users WHERE id = $1`, userID)
}

func testCredential(id byte, userHandle string) *webauthn.Credential {
	return &webauthn.Credential{
		ID:              []byte{id, 0xAA, 0xBB, 0xCC},
		PublicKey:       []byte{0x04, 0x01, 0x02, 0x03},
		AttestationType: "packed",
		Transport:       []protocol.AuthenticatorTransport{protocol.USB, protocol.Internal},
		Flags: webauthn.CredentialFlags{
			UserPresent: true, UserVerified: true, BackupEligible: false, BackupState: false,
		},
		Authenticator: webauthn.Authenticator{
			AAGUID:    []byte{1, 2, 3, 4},
			SignCount: 7,
		},
	}
}

// TestPersistence_UserAndCredentialRoundTrip verifies the core A8 fix: a
// credential written via saveCredential survives into a brand-new store
// instance against the same database (i.e. it is durable, not process-local).
func TestPersistence_UserAndCredentialRoundTrip(t *testing.T) {
	s := getTestStore(t)
	ctx := context.Background()
	userID := "test-a8-user-" + base64.URLEncoding.EncodeToString([]byte{byte(time.Now().UnixNano())})
	cleanupTestRows(t, s, userID)
	t.Cleanup(func() { cleanupTestRows(t, s, userID) })

	u, err := s.ensureUser(ctx, userID, "a8.test", "A8 Test")
	if err != nil {
		t.Fatalf("ensureUser: %v", err)
	}
	if u.Name != "a8.test" || len(u.Credentials) != 0 {
		t.Fatalf("unexpected user: %+v", u)
	}

	cred := testCredential(0x01, userID)
	if err := s.saveCredential(ctx, userID, cred, "platform", time.Now()); err != nil {
		t.Fatalf("saveCredential: %v", err)
	}

	// Simulate restart: a fresh store instance over the same DB must see the
	// credential (PG is authoritative; nothing lives in process memory).
	restarted := &fido2Store{db: s.db}
	u2, err := restarted.getUser(ctx, userID)
	if err != nil || u2 == nil {
		t.Fatalf("getUser after restart: %v, nil=%v", err, u2 == nil)
	}
	if len(u2.Credentials) != 1 {
		t.Fatalf("expected 1 credential after restart, got %d", len(u2.Credentials))
	}
	got := u2.Credentials[0]
	if string(got.ID) != string(cred.ID) || string(got.PublicKey) != string(cred.PublicKey) {
		t.Fatalf("credential mismatch: %+v", got)
	}
	if got.Authenticator.SignCount != 7 {
		t.Fatalf("sign_count not persisted: %d", got.Authenticator.SignCount)
	}
	if got.AttestationType != "packed" || len(got.Transport) != 2 {
		t.Fatalf("attestation/transports not persisted: %+v", got)
	}
	if !got.Flags.UserPresent || !got.Flags.UserVerified || got.Flags.BackupEligible {
		t.Fatalf("flags not persisted: %+v", got.Flags)
	}

	// Counter update after an assertion must be durable too.
	if _, err := restarted.touchCredential(ctx, cred.ID, 8, false, time.Now()); err != nil {
		t.Fatalf("touchCredential: %v", err)
	}
	u3, _ := restarted.getUser(ctx, userID)
	if u3.Credentials[0].Authenticator.SignCount != 8 {
		t.Fatalf("sign_count update not durable: %d", u3.Credentials[0].Authenticator.SignCount)
	}

	// Discoverable-flow lookup by raw credential ID.
	owner, err := restarted.getUserByCredentialID(ctx, cred.ID)
	if err != nil || owner == nil || owner.Name != "a8.test" {
		t.Fatalf("getUserByCredentialID: %v, %+v", err, owner)
	}

	// List + delete.
	list, err := restarted.listCredentials(ctx, userID)
	if err != nil || len(list) != 1 {
		t.Fatalf("listCredentials: %v, len=%d", err, len(list))
	}
	if list[0].Counter != 8 || list[0].LastUsedAt == nil {
		t.Fatalf("listCredentials stale: %+v", list[0])
	}
	credB64 := base64.URLEncoding.EncodeToString(cred.ID)
	ownerID, found, err := restarted.deleteCredential(ctx, credB64)
	if err != nil || !found || ownerID != userID {
		t.Fatalf("deleteCredential: %v found=%v owner=%q", err, found, ownerID)
	}
	u4, _ := restarted.getUser(ctx, userID)
	if len(u4.Credentials) != 0 {
		t.Fatalf("credential not deleted: %d remain", len(u4.Credentials))
	}
}

// TestPersistence_SessionRoundTrip verifies ceremony sessions are PG-backed
// with enforced expiry, not process memory.
func TestPersistence_SessionRoundTrip(t *testing.T) {
	s := getTestStore(t)
	ctx := context.Background()
	sid := "test-session-" + base64.URLEncoding.EncodeToString([]byte{byte(time.Now().UnixNano())})
	t.Cleanup(func() { _, _ = s.db.Exec(`DELETE FROM fido2_sessions WHERE id = $1`, sid) })

	sd := &webauthn.SessionData{
		Challenge:  "dGVzdC1jaGFsbGVuZ2U",
		UserID:     []byte("test-a8-user"),
		Expires:    time.Now().Add(2 * time.Minute),
		CredParams: []protocol.CredentialParameter{{Type: protocol.PublicKeyCredentialType, Algorithm: -7}},
	}
	if err := s.saveSession(ctx, sid, sd); err != nil {
		t.Fatalf("saveSession: %v", err)
	}
	// Fresh store instance = restart; challenge must survive.
	restarted := &fido2Store{db: s.db}
	got, err := restarted.getSession(ctx, sid)
	if err != nil || got == nil {
		t.Fatalf("getSession after restart: %v, nil=%v", err, got == nil)
	}
	if got.Challenge != sd.Challenge || string(got.UserID) != "test-a8-user" {
		t.Fatalf("session mismatch: %+v", got)
	}
	// Single-use: consumed on read.
	again, err := restarted.getSession(ctx, sid)
	if err != nil || again != nil {
		t.Fatalf("session must be consumed after first read: %v, %+v", err, again)
	}

	// Expired sessions are rejected.
	exp := &webauthn.SessionData{Challenge: "x", Expires: time.Now().Add(-time.Minute)}
	if err := restarted.saveSession(ctx, sid, exp); err != nil {
		t.Fatalf("saveSession(expired): %v", err)
	}
	got, err = restarted.getSession(ctx, sid)
	if err != nil || got != nil {
		t.Fatalf("expired session must be rejected: %v, %+v", err, got)
	}
}

// TestFailClosed_NoDatabase proves the service refuses to operate without PG:
// initStore must return an error against a dead connection.
func TestFailClosed_NoDatabase(t *testing.T) {
	dead, err := sql.Open("postgres", "postgres://127.0.0.1:1/nope?sslmode=disable&connect_timeout=1")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer func() { _ = dead.Close() }()
	prevDB := db
	db = dead
	t.Cleanup(func() { db = prevDB })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := initStore(ctx); err == nil {
		t.Fatal("initStore must fail when PG is unavailable (fail-closed)")
	}
}

// TestFailClosed_TouchMissingCredential (2026-10-02, C2-fido2-fix): a counter
// update for a vanished credential row must ERROR, not silently succeed.
func TestFailClosed_TouchMissingCredential(t *testing.T) {
	s := getTestStore(t)
	if _, err := s.touchCredential(context.Background(), []byte{0xDE, 0xAD}, 1, false, time.Now()); err == nil {
		t.Fatal("touchCredential on missing row must fail (fail-closed)")
	}
}

// TestAdminGate_FailClosed (2026-10-02, C2-fido2-fix): with FIDO2_ADMIN_KEY
// unset, every admin-gated endpoint denies all requests (no fail-open).
func TestAdminGate_FailClosed(t *testing.T) {
	t.Setenv("FIDO2_ADMIN_KEY", "")
	router := newRouter()
	for _, tc := range []struct{ method, path string }{
		{"GET", "/stats"},
		{"GET", "/api/v1/fido2_credentials"},
		{"GET", "/api/v1/fido2_credential?id=1"},
		{"POST", "/api/v1/fido2_credentials/create"},
		{"DELETE", "/api/v1/fido2_credentials/delete?id=1"},
		{"DELETE", "/api/v1/fido2/credentials/somecred"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		req.Header.Set("X-Admin-Key", "anything")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s: expected 401 with unset admin key, got %d", tc.method, tc.path, rec.Code)
		}
	}
}

// TestAdminGate_WithKey (2026-10-02, C2-fido2-fix): with a configured key,
// wrong key → 401; correct key → allowed (exercises a real PG-backed admin
// delete end to end).
func TestAdminGate_WithKey(t *testing.T) {
	s := getTestStore(t)
	t.Setenv("FIDO2_ADMIN_KEY", "test-admin-secret")
	router := newRouter()
	ctx := context.Background()
	userID := "test-admin-gate-user"
	cleanupTestRows(t, s, userID)
	t.Cleanup(func() { cleanupTestRows(t, s, userID) })
	if _, err := s.ensureUser(ctx, userID, "gate.test", "Gate Test"); err != nil {
		t.Fatalf("ensureUser: %v", err)
	}
	cred := testCredential(0x09, userID)
	if err := s.saveCredential(ctx, userID, cred, "platform", time.Now()); err != nil {
		t.Fatalf("saveCredential: %v", err)
	}
	credB64 := base64.URLEncoding.EncodeToString(cred.ID)

	// Wrong key → 401.
	req := httptest.NewRequest("DELETE", "/api/v1/fido2/credentials/"+credB64, nil)
	req.Header.Set("X-Admin-Key", "wrong")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong key: expected 401, got %d", rec.Code)
	}

	// Correct key → 200 and the row is really gone from PG.
	req = httptest.NewRequest("DELETE", "/api/v1/fido2/credentials/"+credB64, nil)
	req.Header.Set("X-Admin-Key", "test-admin-secret")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("correct key: expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	creds, _ := s.listCredentials(ctx, userID)
	if len(creds) != 0 {
		t.Fatalf("credential still present after admin delete: %d", len(creds))
	}

	// Legacy generic-CRUD endpoints are gated too (wrong key → 401).
	req = httptest.NewRequest("GET", "/api/v1/fido2_credentials", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("legacy list without key: expected 401, got %d", rec.Code)
	}
}

// Compile-time assertions: the store satisfies the operations the HTTP// handlers require, and User satisfies the webauthn library interface.
var _ interface {
	ensureUser(context.Context, string, string, string) (*User, error)
	getUser(context.Context, string) (*User, error)
	getUserByCredentialID(context.Context, []byte) (*User, error)
	saveCredential(context.Context, string, *webauthn.Credential, string, time.Time) error
	touchCredential(context.Context, []byte, uint32, bool, time.Time) (string, error)
	listCredentials(context.Context, string) ([]*StoredCredential, error)
	deleteCredential(context.Context, string) (string, bool, error)
	saveSession(context.Context, string, *webauthn.SessionData) error
	getSession(context.Context, string) (*webauthn.SessionData, error)
	cleanupExpiredSessions(context.Context) (int64, error)
} = (*fido2Store)(nil)

var _ webauthn.User = (*User)(nil)
