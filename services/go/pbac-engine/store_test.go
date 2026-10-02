// Persistence tests for pbac-engine (2026-10-02, C2-a9, audit item A9).
//
// These tests require a REAL Postgres (no mocks). Set PBAC_TEST_DATABASE_URL
// or DATABASE_URL; when unreachable they SKIP rather than fake success.

package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

// testStore connects to a real Postgres or skips. Uses an isolated schema
// (search_path) so tests never touch production-shaped data, and drops it on
// cleanup.
func testStore(t *testing.T) *policyStore {
	t.Helper()
	dsn := os.Getenv("PBAC_TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no PBAC_TEST_DATABASE_URL/DATABASE_URL set; skipping real-Postgres test")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Skipf("cannot open postgres: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		t.Skipf("postgres unreachable (%v); skipping real-Postgres test", err)
	}
	schema := "pbac_test_" + time.Now().Format("20060102150405") + "_" + randSuffix()
	if _, err := db.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatalf("create test schema: %v", err)
	}
	if _, err := db.Exec(`SET search_path TO ` + schema); err != nil {
		t.Fatalf("set search_path: %v", err)
	}
	// search_path is per-connection; pin the pool to one connection so every
	// statement (DDL included) lands in the test schema.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(policyDDL); err != nil {
		t.Fatalf("apply DDL in test schema: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(`DROP SCHEMA ` + schema + ` CASCADE`)
		db.Close()
	})
	return &policyStore{db: db}
}

func randSuffix() string {
	b := make([]byte, 4)
	f, err := os.Open("/dev/urandom")
	if err == nil {
		_, _ = f.Read(b)
		f.Close()
	}
	out := make([]byte, 8)
	const hex = "0123456789abcdef"
	for i, c := range b {
		out[i*2] = hex[c>>4]
		out[i*2+1] = hex[c&0xf]
	}
	return string(out)
}

func bootCtx(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	return ctx
}

// TestStoreBootSeedsDefaults: empty table → defaults seeded and loaded.
func TestStoreBootSeedsDefaults(t *testing.T) {
	s := testStore(t)
	eval, err := buildEvaluatorAtBoot(bootCtx(t), s)
	if err != nil {
		t.Fatalf("boot build failed: %v", err)
	}
	if len(eval.List()) != len(defaultPolicies()) {
		t.Fatalf("expected %d seeded defaults, got %d", len(defaultPolicies()), len(eval.List()))
	}
	// Seeded rows must be REAL PG rows, not just memory.
	n, err := s.countPolicies(context.Background())
	if err != nil || n != len(defaultPolicies()) {
		t.Fatalf("expected %d persisted rows, got n=%d err=%v", len(defaultPolicies()), n, err)
	}
}

// TestStoreWriteThroughCRUD: HTTP write path persists to PG first.
func TestStoreWriteThroughCRUD(t *testing.T) {
	store := testStore(t)
	eval, err := buildEvaluatorAtBoot(bootCtx(t), store)
	if err != nil {
		t.Fatalf("boot build failed: %v", err)
	}
	s := &server{eval: eval, store: store}

	p := Policy{ID: "test-allow", Name: "t", Effect: "allow", Roles: []string{"user"}, Actions: []string{"read"}}
	body, _ := json.Marshal(p)
	w := httptest.NewRecorder()
	s.handlePolicies(w, httptest.NewRequest(http.MethodPost, "/policies", bytes.NewReader(body)))
	if w.Code != http.StatusOK {
		t.Fatalf("store failed: %d %s", w.Code, w.Body.String())
	}

	// Durable? Read straight from PG, not the evaluator.
	loaded, err := store.loadPolicies(context.Background())
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	found := false
	for _, lp := range loaded {
		if lp.ID == "test-allow" && lp.Effect == "allow" {
			found = true
		}
	}
	if !found {
		t.Fatal("policy not durably persisted to pbac_policies")
	}

	w = httptest.NewRecorder()
	s.handlePolicyByID(w, httptest.NewRequest(http.MethodGet, "/policies/test-allow", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("get failed: %d", w.Code)
	}

	w = httptest.NewRecorder()
	s.handlePolicyByID(w, httptest.NewRequest(http.MethodDelete, "/policies/test-allow", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("delete failed: %d", w.Code)
	}
	if _, ok := s.eval.Get("test-allow"); ok {
		t.Fatal("policy still present after delete")
	}
	loaded, _ = store.loadPolicies(context.Background())
	for _, lp := range loaded {
		if lp.ID == "test-allow" {
			t.Fatal("policy still persisted after delete")
		}
	}

	// Delete of a missing id → 404 (not 500).
	w = httptest.NewRecorder()
	s.handlePolicyByID(w, httptest.NewRequest(http.MethodDelete, "/policies/test-allow", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 re-delete, got %d", w.Code)
	}
}

// TestStoreRestartSimulation: upsert a policy, discard the in-memory
// evaluator entirely, rebuild from PG as at boot ("restart"), and verify the
// policy is still effective in evaluation.
func TestStoreRestartSimulation(t *testing.T) {
	store := testStore(t)
	eval, err := buildEvaluatorAtBoot(bootCtx(t), store)
	if err != nil {
		t.Fatalf("boot build failed: %v", err)
	}
	s := &server{eval: eval, store: store}

	// Runtime-created authorization rule: deny ALL reads on "secret".
	p := Policy{
		ID: "restart-deny-secret", Name: "deny secret reads", Effect: "deny",
		Roles: []string{"*"}, ResourceTypes: []string{"secret"}, Actions: []string{"read"},
		Priority: 200,
	}
	body, _ := json.Marshal(p)
	w := httptest.NewRecorder()
	s.handlePolicies(w, httptest.NewRequest(http.MethodPost, "/policies", bytes.NewReader(body)))
	if w.Code != http.StatusOK {
		t.Fatalf("store failed: %d %s", w.Code, w.Body.String())
	}

	// Simulate restart: throw away the in-memory evaluator, rebuild from PG.
	eval2, err := buildEvaluatorAtBoot(bootCtx(t), store)
	if err != nil {
		t.Fatalf("restart rebuild failed: %v", err)
	}
	if _, ok := eval2.Get("restart-deny-secret"); !ok {
		t.Fatal("policy lost across restart — authorization drift")
	}

	// And it must still be EFFECTIVE, not just present.
	req := baseRequest()
	req.Resource.Type = "secret"
	req.Action = "read"
	req.Subject.Roles = []string{"admin"}
	d := eval2.Evaluate(req)
	if d.Allowed || d.MatchedPolicy != "restart-deny-secret" {
		t.Fatalf("restarted engine failed to enforce persisted deny: %+v", d)
	}

	// Defaults must NOT be re-seeded over runtime state on restart: delete a
	// default, "restart", and it must stay deleted.
	existed, err := store.deletePolicy(context.Background(), "authenticated-read")
	if err != nil || !existed {
		t.Fatalf("delete default: existed=%v err=%v", existed, err)
	}
	eval3, err := buildEvaluatorAtBoot(bootCtx(t), store)
	if err != nil {
		t.Fatalf("second restart rebuild failed: %v", err)
	}
	if _, ok := eval3.Get("authenticated-read"); ok {
		t.Fatal("deleted default policy resurrected on restart")
	}
}

// TestBootFailClosedWithoutDB (2026-10-02, C2-a9): boot against an
// unreachable database must fail closed (error, no silent default fallback).
// initPolicyStore itself log.Fatals when DATABASE_URL is missing; here we
// exercise the buildEvaluatorAtBoot error path, which main() treats as fatal.
func TestBootFailClosedWithoutDB(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://127.0.0.1:1/nope?connect_timeout=1&sslmode=disable")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	dead := &policyStore{db: db}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := buildEvaluatorAtBoot(ctx, dead); err == nil {
		t.Fatal("expected boot failure against unreachable DB, got nil error")
	}
}
