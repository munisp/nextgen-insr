package main

import (
	"context"
	"errors"
	"testing"

	cfg "github.com/claims-adjudication-engine/config"
	"github.com/claims-adjudication-engine/models"

	"go.uber.org/zap"
)

type fakeReserver struct {
	err      error
	reserved []float64
}

func (f *fakeReserver) ReserveCoverage(_ context.Context, _ string, amount float64) error {
	if f.err != nil {
		return f.err
	}
	f.reserved = append(f.reserved, amount)
	return nil
}
func (f *fakeReserver) ReleaseCoverage(_ context.Context, _ string, _ float64) error {
	return nil
}

func baseClaim(amount float64) *models.Claim {
	return &models.Claim{
		ID:          "clm-1",
		PolicyID:    "pol-1",
		ClaimantID:  "cust-1",
		InsurerID:   "ins-1",
		Amount:      amount,
		Type:        models.ClaimTypeMotor,
		Description: "a valid description long enough",
		Evidence: []models.EvidenceDoc{
			{ID: "e1"}, {ID: "e2"},
		},
	}
}

func testEngine(cov coverageReserver) *Engine {
	return &Engine{
		config:   cfg.Load(),
		coverage: cov,
		logger:   zap.NewNop(),
	}
}

// Auto-approval reserves coverage against the policy sum insured.
func TestAutoApproveReservesCoverage(t *testing.T) {
	cov := &fakeReserver{}
	e := testEngine(cov)
	res := e.adjudicateClaim(baseClaim(10000)) // <=50k, low risk, 2 evidence -> auto-approve path
	if res.Decision == models.DecisionAutoApproved {
		if len(cov.reserved) != 1 || cov.reserved[0] != 10000 {
			t.Fatalf("expected reservation of 10000, got %v", cov.reserved)
		}
	} else {
		t.Fatalf("expected auto-approval for clean small claim, got %s (%s)", res.Decision, res.Reason)
	}
}

// Exhausted/unknown coverage must NEVER auto-approve (fail-closed).
func TestCoverageFailureEscalates(t *testing.T) {
	for _, err := range []error{errors.New("policy coverage exhausted"), errors.New("no coverage record for policy")} {
		cov := &fakeReserver{err: err}
		e := testEngine(cov)
		res := e.adjudicateClaim(baseClaim(10000))
		if res.Decision == models.DecisionAutoApproved {
			t.Fatalf("auto-approved despite coverage error %v", err)
		}
		if res.Decision != models.DecisionEscalated {
			t.Fatalf("expected escalation on coverage failure, got %s", res.Decision)
		}
	}
}

// Nil coverage backend (tests/dev) keeps prior decision flow.
func TestNilCoverageKeepsFlow(t *testing.T) {
	e := testEngine(nil)
	res := e.adjudicateClaim(baseClaim(10000))
	if res.Decision != models.DecisionAutoApproved {
		t.Fatalf("expected auto-approval without coverage backend, got %s", res.Decision)
	}
}
