package db

import "testing"

// INS-7: the FROM-state guard serializes allowed states as a Postgres array
// literal for `status = ANY($n)` — verify quoting/escaping stays correct.
func TestPqArrayLiteral(t *testing.T) {
	got := pqArray([]string{"submitted", "under_review"})
	want := `{"submitted","under_review"}`
	if got != want {
		t.Errorf("pqArray = %s, want %s", got, want)
	}
	if got := pqArray(nil); got != "{}" {
		t.Errorf("pqArray(nil) = %s, want {}", got)
	}
}

// Fail-closed: an empty allowedFrom must be rejected, never silently allow
// every transition.
func TestUpdateClaimStatusFromRejectsEmptyGuard(t *testing.T) {
	r := &ClaimsRepository{}
	if err := r.UpdateClaimStatusFrom(nil, "claim-1", "approved", "", nil, nil); err == nil {
		t.Fatal("empty allowedFrom must error (fail-closed)")
	}
}
