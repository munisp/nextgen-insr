// 2026-10-02 (C2-a10): persistence tests for the agent-gamification PG
// store. These tests run against a REAL Postgres only (no mocks); they are
// skipped when no PG is reachable. Set AGENT_GAM_TEST_DSN or DATABASE_URL to
// point at a test database; a dedicated schema is created per run and dropped
// afterwards.

package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func testDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("AGENT_GAM_TEST_DSN")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		dsn = "postgres://postgres:postgres@127.0.0.1:5432/postgres?sslmode=disable"
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Skipf("no real PG available: %v", err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		t.Skipf("skipping: real PG unreachable at test DSN: %v", err)
	}
	return dsn
}

// withTestSchema creates an isolated schema, returns a DSN pinned to it via
// lib/pq's search_path runtime parameter, and drops the schema on cleanup.
func withTestSchema(t *testing.T, dsn string) string {
	t.Helper()
	schema := "agam_t_" + strings.ReplaceAll(time.Now().Format("150405.000000"), ".", "")
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if _, err := db.Exec(`CREATE SCHEMA ` + schema); err != nil {
		db.Close()
		t.Fatalf("create schema: %v", err)
	}
	db.Close()
	sep := "&"
	if !strings.Contains(dsn, "?") {
		sep = "?"
	}
	scoped := dsn + sep + "search_path=" + schema
	t.Cleanup(func() {
		db, err := sql.Open("postgres", dsn)
		if err == nil {
			defer db.Close()
			db.Exec(`DROP SCHEMA IF EXISTS ` + schema + ` CASCADE`)
		}
	})
	return scoped
}

func openTestStore(t *testing.T) *profileStore {
	t.Helper()
	dsn := withTestSchema(t, testDSN(t))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	s, err := openProfileStore(ctx, dsn)
	if err != nil {
		t.Fatalf("openProfileStore: %v", err)
	}
	t.Cleanup(s.Close)
	return s
}

func TestOpenProfileStore_FailClosedWithoutDSN(t *testing.T) {
	if _, err := openProfileStore(context.Background(), ""); err == nil {
		t.Fatal("expected error when DATABASE_URL/DSN is empty")
	}
}

func TestOpenProfileStore_FailClosedBadDSN(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := openProfileStore(ctx, "postgres://127.0.0.1:1/nope?sslmode=disable&connect_timeout=2"); err == nil {
		t.Fatal("expected error for unreachable PG")
	}
}

// TestAwardXP_PersistsAcrossRestart awards XP, then simulates a service
// restart by opening a brand-new store + cache from the same PG and verifies
// the awarded XP/level/rank survived.
func TestAwardXP_PersistsAcrossRestart(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	orig := seedAgents()
	var first *AgentProfile
	for _, p := range orig {
		first = p
		break
	}
	for _, p := range orig {
		if err := s.upsertProfile(ctx, p); err != nil {
			t.Fatalf("seed upsert: %v", err)
		}
	}

	updated, err := s.awardXP(ctx, first.AgentID, 700)
	if err != nil {
		t.Fatalf("awardXP: %v", err)
	}
	if updated.XP != first.XP+700 {
		t.Fatalf("xp = %d, want %d", updated.XP, first.XP+700)
	}

	// --- simulated restart: new store, cold cache ---
	loaded, err := s.loadProfiles(ctx)
	if err != nil {
		t.Fatalf("loadProfiles after restart: %v", err)
	}
	got := loaded[first.AgentID]
	if got == nil {
		t.Fatal("profile missing after restart")
	}
	if got.XP != first.XP+700 || got.Level != updated.Level || got.Rank != updated.Rank {
		t.Fatalf("restart lost progress: got xp=%d level=%d rank=%q", got.XP, got.Level, got.Rank)
	}
	if len(got.Badges) != 2 || got.Streak != first.Streak {
		t.Fatalf("badges/streak not persisted: badges=%v streak=%d", got.Badges, got.Streak)
	}
}

func TestAwardXP_UnknownAgent(t *testing.T) {
	s := openTestStore(t)
	p, err := s.awardXP(context.Background(), "AGT-NOPE", 100)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p != nil {
		t.Fatalf("expected nil profile for unknown agent, got %+v", p)
	}
}

// TestBootstrapProfiles_SeedsOnlyWhenEmpty verifies the seed-once behaviour:
// second bootstrap (restart) must NOT reseed/overwrite mutated rows.
func TestBootstrapProfiles_SeedsOnlyWhenEmpty(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	if err := bootstrapProfiles(ctx, s); err != nil {
		t.Fatalf("first bootstrap: %v", err)
	}
	if len(agents) != 5 {
		t.Fatalf("expected 5 seeded agents, got %d", len(agents))
	}

	// mutate one profile, then bootstrap again (restart)
	p, err := s.awardXP(ctx, "AGT-A001", 12345)
	if err != nil {
		t.Fatalf("awardXP: %v", err)
	}
	if err := bootstrapProfiles(ctx, s); err != nil {
		t.Fatalf("second bootstrap: %v", err)
	}
	if agents["AGT-A001"].XP != p.XP {
		t.Fatalf("reseed overwrote progress: xp=%d, want %d", agents["AGT-A001"].XP, p.XP)
	}
}

// TestAwardHandler_FailClosed verifies the HTTP handler returns 503 (not a
// success) when PG is down mid-request, and the cache is untouched.
func TestAwardHandler_FailClosed(t *testing.T) {
	dsn := withTestSchema(t, testDSN(t))
	ctx := context.Background()
	s, err := openProfileStore(ctx, dsn)
	if err != nil {
		t.Fatalf("openProfileStore: %v", err)
	}
	p := &AgentProfile{AgentID: "AGT-Z001", Name: "Test Agent", Region: "Lagos",
		Badges: []string{"onboarded"}, XP: 100}
	if err := s.upsertProfile(ctx, p); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	oldStore, oldAgents := store, agents
	t.Cleanup(func() { store, agents = oldStore, oldAgents })
	store = s
	agents = map[string]*AgentProfile{p.AgentID: {AgentID: p.AgentID, XP: 100}}

	s.Close() // simulate DB down

	mux := http.NewServeMux()
	registerRoutes(mux)
	req := httptest.NewRequest("POST", "/api/v1/gamification/xp/award",
		strings.NewReader(`{"agent_id":"AGT-Z001","xp":50,"reason":"sale"}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != 503 {
		t.Fatalf("expected 503 when PG down, got %d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]interface{}
	if json.Unmarshal(rec.Body.Bytes(), &body) == nil {
		if ok, _ := body["success"].(bool); ok {
			t.Fatal("handler reported success while PG was down")
		}
	}
	if agents["AGT-Z001"].XP != 100 {
		t.Fatalf("cache mutated despite failed persistence: xp=%d", agents["AGT-Z001"].XP)
	}
}

// TestAwardHandler_SuccessPath verifies write-through: after a 200 the row
// in PG already reflects the award.
func TestAwardHandler_SuccessPath(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	p := &AgentProfile{AgentID: "AGT-Y001", Name: "Ok Agent", Region: "Kano",
		Badges: []string{"onboarded"}, XP: 0}
	if err := s.upsertProfile(ctx, p); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	oldStore, oldAgents := store, agents
	t.Cleanup(func() { store, agents = oldStore, oldAgents })
	store = s
	agents = map[string]*AgentProfile{}

	mux := http.NewServeMux()
	registerRoutes(mux)
	req := httptest.NewRequest("POST", "/api/v1/gamification/xp/award",
		strings.NewReader(`{"agent_id":"AGT-Y001","xp":2500,"reason":"sale"}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	loaded, err := s.loadProfiles(ctx)
	if err != nil {
		t.Fatalf("loadProfiles: %v", err)
	}
	if loaded["AGT-Y001"].XP != 2500 || loaded["AGT-Y001"].Level != 2 {
		t.Fatalf("write-through failed: %+v", loaded["AGT-Y001"])
	}
}
