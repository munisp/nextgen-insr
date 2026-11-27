package repository

import (
	"context"
	"encoding/json"
	"testing"
)

func TestParseKobo(t *testing.T) {
	cases := []struct {
		raw  string
		want int64
	}{
		{"0", 0},
		{"1", 100},
		{"1.00", 100},
		{"1234.56", 123456},
		{"0.075", 8}, // 7.5 kobo rounds half away from zero → 8
		{"-2.50", -250},
		{"1855000.00", 185500000},
		{".5", 50},
		{"+3.14", 314},
		{"1000000000000.00", 100000000000000},
	}
	for _, tc := range cases {
		got, err := ParseKobo(tc.raw)
		if err != nil {
			t.Errorf("%q: %v", tc.raw, err)
			continue
		}
		if got != tc.want {
			t.Errorf("%q = %d, want %d", tc.raw, got, tc.want)
		}
	}
	for _, bad := range []string{"", "abc", "1.2.3", "--1", "99999999999999999999.99"} {
		if _, err := ParseKobo(bad); err == nil {
			t.Errorf("%q must fail", bad)
		}
	}
}

func TestNairaToKobo(t *testing.T) {
	k, err := NairaToKobo(1855000.00)
	if err != nil || k != 185_500_000 {
		t.Errorf("got %d %v", k, err)
	}
	k, _ = NairaToKobo(0.005)
	if k != 1 { // half-away-from-zero
		t.Errorf("0.005 naira = %d kobo, want 1", k)
	}
	if _, err := NairaToKobo(-1); err != nil {
		t.Errorf("negative amount must convert (validation is upstream): %v", err)
	}
	if _, err := NairaToKobo(1e300); err == nil {
		t.Error("out-of-range amount accepted")
	}
}

func TestBuildVersionMergesTables(t *testing.T) {
	row := VersionRow{
		ID: 1, Line: "motor", Version: "2026.09", Status: "approved",
		Tables: map[string]json.RawMessage{
			"base": json.RawMessage(`{
				"artefactType":"freq_sev_glm","productLine":"motor","version":"2026.09",
				"frequency":{"family":"poisson","link":"log","coefficients":{"intercept":-2.9}},
				"severity":{"family":"gamma","link":"log","coefficients":{"intercept":14.4}},
				"relativities":{"channel":{"online":0.95}},
				"exposureUnit":"vehicle_year"
			}`),
			"relativity": json.RawMessage(`{"payment_plan":{"monthly":1.05}}`),
			"territory":  json.RawMessage(`{"lagos":1.18,"kano":0.94}`),
			"loading":    json.RawMessage(`{"expenseRatio":0.2,"commissionRate":0.1,"profitMargin":0.05}`),
			"tax":        json.RawMessage(`[{"code":"VAT","rate":0.075}]`),
		},
	}
	v, err := BuildVersion(row)
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}
	if len(v.Artefact.Relativities) != 3 {
		t.Fatalf("relativities = %v", v.Artefact.Relativities)
	}
	if v.Artefact.Relativities["territory"]["lagos"] != 1.18 {
		t.Error("territory table not merged under territory dimension")
	}
	if v.Artefact.Relativities["payment_plan"]["monthly"] != 1.05 {
		t.Error("relativity table not merged")
	}
	if v.Taxes[0].Code != "VAT" || v.Loadings.ExpenseRatio != 0.2 {
		t.Error("loading/tax not decoded")
	}

	// Duplicate dimension between artefact and relativity table → reject.
	row2 := row
	row2.Tables["relativity"] = json.RawMessage(`{"channel":{"branch":1.0}}`)
	if _, err := BuildVersion(row2); err == nil {
		t.Error("duplicate dimension accepted")
	}
	// Missing base table → reject.
	row3 := row
	delete(row3.Tables, "base")
	if _, err := BuildVersion(row3); err == nil {
		t.Error("missing base table accepted")
	}
	// Malformed artefact → reject (fail-closed at import).
	row4 := row
	row4.Tables["base"] = json.RawMessage(`{"artefactType":"nope"}`)
	if _, err := BuildVersion(row4); err == nil {
		t.Error("malformed artefact accepted")
	}
	// Loadings >= 1 → reject.
	row5 := row
	row5.Tables["loading"] = json.RawMessage(`{"expenseRatio":0.6,"commissionRate":0.5,"profitMargin":0}`)
	if _, err := BuildVersion(row5); err == nil {
		t.Error("loadings >= 1 accepted")
	}
}

func TestBuildSnapshotSingleActive(t *testing.T) {
	base := json.RawMessage(`{
		"artefactType":"freq_sev_glm","productLine":"motor","version":"v",
		"frequency":{"family":"poisson","link":"log","coefficients":{"intercept":-2.9}},
		"severity":{"family":"gamma","link":"log","coefficients":{"intercept":14.4}},
		"exposureUnit":"vehicle_year"
	}`)
	mk := func(id int64, version, status string) VersionRow {
		return VersionRow{ID: id, Line: "motor", Version: version, Status: status,
			Tables: map[string]json.RawMessage{"base": base}}
	}
	// Two approved versions for one line → hard failure (never pick one).
	_, err := BuildSnapshot([]string{"motor"}, []VersionRow{mk(1, "a", "approved"), mk(2, "b", "approved")})
	if err == nil {
		t.Error("duplicate approved versions accepted")
	}
	// Version for an unregistered line → hard failure.
	rows := []VersionRow{mk(1, "a", "approved")}
	rows[0].Line = "unknown"
	if _, err := BuildSnapshot([]string{"motor"}, rows); err == nil {
		t.Error("version for unregistered line accepted")
	}
	// Happy path: approved maps, draft/filing/retired visible in All only.
	snap, err := BuildSnapshot([]string{"motor"}, []VersionRow{
		mk(1, "2026.09", "approved"), mk(2, "2026.10", "filing"), mk(3, "2026.08", "retired"),
	})
	if err != nil {
		t.Fatal(err)
	}
	v, managed, found := snap.ActiveVersion("motor")
	if !managed || !found || v.Version != "2026.09" {
		t.Errorf("active lookup wrong: %+v %v %v", v, managed, found)
	}
	if len(snap.All) != 3 {
		t.Errorf("All = %d, want 3", len(snap.All))
	}
	if snap.VersionByID(2).Version != "2026.10" {
		t.Error("VersionByID failed")
	}
}

// TestFixtureLifecycle exercises the fixture store contract: boot build,
// referral idempotency, decide flow, activation swap.
func TestFixtureLifecycle(t *testing.T) {
	ctx := context.Background()
	fix, err := LoadFixture("../../testdata/seed/rating_fixtures.json")
	if err != nil {
		t.Fatal(err)
	}
	boot, err := fix.LoadBoot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(boot.Lines) != 6 {
		t.Errorf("lines = %v", boot.Lines)
	}

	id1, err := fix.InsertReferral(ctx, "q_x", "motor", []string{"ACCUM_GEO"})
	if err != nil {
		t.Fatal(err)
	}
	id2, err := fix.InsertReferral(ctx, "q_x", "motor", []string{"ACCUM_GEO"})
	if err != nil {
		t.Fatal(err)
	}
	if id1 != id2 {
		t.Errorf("duplicate quoteRef not idempotent: %d vs %d", id1, id2)
	}
	open, err := fix.ListReferrals(ctx, "open")
	if err != nil || len(open) != 1 {
		t.Fatalf("list open: %v %v", open, err)
	}
	if open[0].ReasonCodes[0] != "ACCUM_GEO" {
		t.Errorf("reason codes = %v", open[0].ReasonCodes)
	}
	if err := fix.DecideReferral(ctx, id1, "accepted", nil); err != nil {
		t.Fatal(err)
	}
	if err := fix.DecideReferral(ctx, id1, "declined", nil); err != ErrConflict {
		t.Errorf("double decide = %v, want ErrConflict", err)
	}
	if err := fix.DecideReferral(ctx, 999, "accepted", nil); err != ErrNotFound {
		t.Errorf("unknown decide = %v, want ErrNotFound", err)
	}

	// Activation: id 7 is motor 2026.10 in filing; activating retires 2026.09.
	if err := fix.ActivateRateVersion(ctx, 7); err != nil {
		t.Fatal(err)
	}
	boot, err = fix.LoadBoot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var active string
	for _, v := range boot.Versions {
		if v.Line == "motor" && v.Status == "approved" {
			active = v.Version
		}
	}
	if active != "2026.10" {
		t.Errorf("post-activation active = %q, want 2026.10", active)
	}
	// Re-activation of the same row is now a conflict (already approved).
	if err := fix.ActivateRateVersion(ctx, 7); err == nil {
		t.Error("re-activation of approved version accepted")
	}
	// Capital summary present in the seed.
	summary, found, err := fix.LatestCapitalSummary(ctx)
	if err != nil || !found {
		t.Fatalf("capital summary: %v %v", summary, err)
	}
	if summary.NaicomRBC.Ratio != 2.0 {
		t.Errorf("rbc ratio = %v, want 2.0", summary.NaicomRBC.Ratio)
	}
	if len(summary.EC.PerLine) != 2 {
		t.Errorf("per-line ec = %v", summary.EC.PerLine)
	}
	// Adequacy alerts recorded.
	if err := fix.InsertAdequacyAlert(ctx, "motor", "2026-09", 0.55, 0.68, "red"); err != nil {
		t.Fatal(err)
	}
	if len(fix.Alerts()) != 1 || fix.Alerts()[0].Severity != "red" {
		t.Errorf("alerts = %v", fix.Alerts())
	}
}
