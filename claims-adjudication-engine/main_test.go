package main

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/claims-adjudication-engine/db"
)

func newTestEngine() *Engine {
	e := &Engine{startTime: time.Now()}
	e.healthy.Store(true)
	return e
}

func TestHealthEndpoint(t *testing.T) {
	e := newTestEngine()
	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	handleHealth(e)(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("health returned %d, want 200", w.Code)
	}
	body := w.Body.String()
	if body == "" {
		t.Error("health returned empty body")
	}
}

func TestHealthContentType(t *testing.T) {
	e := newTestEngine()
	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	handleHealth(e)(w, req)
	ct := w.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("unexpected content-type: %s", ct)
	}
}

func TestReadyEndpointWithoutDB(t *testing.T) {
	e := newTestEngine() // no database attached
	req := httptest.NewRequest("GET", "/ready", nil)
	w := httptest.NewRecorder()
	handleReady(e)(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("ready without DB returned %d, want 503", w.Code)
	}
}

func TestLiveEndpoint(t *testing.T) {
	req := httptest.NewRequest("GET", "/live", nil)
	w := httptest.NewRecorder()
	handleLive(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("live returned %d, want 200", w.Code)
	}
}

// ─── Wave F2 audit-fix tests (INS-6/7) ──────────────────────────────────────

func mkPolicySnapshot(status string, start, end *time.Time, waitingDays int) *db.PolicySnapshot {
	snap := &db.PolicySnapshot{Status: status, WaitingPeriodDays: waitingDays}
	if start != nil {
		snap.StartDate = sql.NullTime{Time: *start, Valid: true}
	}
	if end != nil {
		snap.EndDate = sql.NullTime{Time: *end, Valid: true}
	}
	return snap
}

func TestPolicyGateDeniesUnknownPolicy(t *testing.T) {
	deny, reason := evaluatePolicyGate(nil, time.Now())
	if !deny {
		t.Fatal("unknown policy must be denied (fail-closed)")
	}
	if reason == "" {
		t.Error("denial must carry a reason")
	}
}

func TestPolicyGateDeniesNonCoveringStatuses(t *testing.T) {
	now := time.Now()
	start := now.Add(-180 * 24 * time.Hour)
	end := now.Add(180 * 24 * time.Hour)
	for _, status := range []string{"lapsed", "cancelled", "expired", "suspended", "draft"} {
		snap := mkPolicySnapshot(status, &start, &end, 0)
		if deny, reason := evaluatePolicyGate(snap, now); !deny || reason == "" {
			t.Errorf("status %q must deny with a reason", status)
		}
	}
}

func TestPolicyGateAllowsActiveInPeriod(t *testing.T) {
	now := time.Now()
	start := now.Add(-180 * 24 * time.Hour)
	end := now.Add(180 * 24 * time.Hour)
	if deny, reason := evaluatePolicyGate(mkPolicySnapshot("active", &start, &end, 0), now); deny {
		t.Errorf("active in-period policy must not be denied, got: %s", reason)
	}
}

func TestPolicyGateDeniesBeforeStartAndAfterGraceEnd(t *testing.T) {
	now := time.Now()
	future := now.Add(10 * 24 * time.Hour)
	if deny, _ := evaluatePolicyGate(mkPolicySnapshot("active", &future, nil, 0), now); !deny {
		t.Error("claim before policy start must be denied")
	}
	longPast := now.Add(-400 * 24 * time.Hour)
	if deny, _ := evaluatePolicyGate(mkPolicySnapshot("active", nil, &longPast, 0), now); !deny {
		t.Error("claim after endDate + grace window must be denied")
	}
	// Inside grace window: still adjudicable (the TS side flags the grace hold).
	recentPast := now.Add(-10 * 24 * time.Hour)
	if deny, reason := evaluatePolicyGate(mkPolicySnapshot("active", nil, &recentPast, 0), now); deny {
		t.Errorf("claim within grace window must not be denied by the engine, got: %s", reason)
	}
}

func TestPolicyGateEnforcesWaitingPeriod(t *testing.T) {
	now := time.Now()
	start := now.Add(-10 * 24 * time.Hour)
	if deny, _ := evaluatePolicyGate(mkPolicySnapshot("active", &start, nil, 30), now); !deny {
		t.Error("claim inside the 30-day waiting period must be denied")
	}
	oldStart := now.Add(-60 * 24 * time.Hour)
	if deny, reason := evaluatePolicyGate(mkPolicySnapshot("active", &oldStart, nil, 30), now); deny {
		t.Errorf("claim past the waiting period must not be denied, got: %s", reason)
	}
}

func TestAdjudicableFromStatesExcludeTerminal(t *testing.T) {
	// INS-7: approve/deny must never be reachable from decided/terminal states.
	terminal := []string{"approved", "denied", "paid", "rejected"}
	for _, s := range terminal {
		for _, allowed := range adjudicableFromStates {
			if allowed == s {
				t.Errorf("terminal status %q must not be an adjudicable FROM state", s)
			}
		}
	}
	for _, required := range []string{"submitted", "under_review", "pending_review", "escalated"} {
		found := false
		for _, allowed := range adjudicableFromStates {
			if allowed == required {
				found = true
			}
		}
		if !found {
			t.Errorf("expected adjudicable FROM state %q to be present", required)
		}
	}
}
