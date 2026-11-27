package service_test

import (
	"context"
	"errors"
	"sort"
	"testing"
	"time"

	"github.com/unified-insurance/actuary-engine/pricing/internal/accumulation"
	"github.com/unified-insurance/actuary-engine/pricing/internal/kernels"
	"github.com/unified-insurance/actuary-engine/pricing/internal/models"
	"github.com/unified-insurance/actuary-engine/pricing/internal/reinsurance"
	"github.com/unified-insurance/actuary-engine/pricing/internal/service"
)

func baseRequest() models.RateRequest {
	return models.RateRequest{
		ProductLine: "motor",
		Variables: map[string]string{
			"age_band": "2", "ncd": "3", "vehicle_class": "sedan",
			"territory": "lagos_mainland", "fraud_score": "0.20",
		},
		SumInsured: 20_000_000,
		Exposures:  1,
		GeoCell:    "lagos_mainland",
		QuoteRef:   "q_accept_1",
	}
}

// TestAcceptPath: a clean quote accepts with the kernel decomposition and
// the rateVersion stamp; the accumulation delta is recorded.
func TestAcceptPath(t *testing.T) {
	svc, _, accum := newTestService(t)
	resp, err := svc.Rate(context.Background(), baseRequest())
	if err != nil {
		t.Fatal(err)
	}
	if resp.Decision != models.DecisionAccept {
		t.Fatalf("decision = %s (%v)", resp.Decision, resp.ReasonCodes)
	}
	if resp.RateVersion != "2026.09" {
		t.Errorf("rateVersion = %q", resp.RateVersion)
	}
	if resp.TotalPremiumKobo <= 0 || resp.PurePremium <= 0 {
		t.Errorf("non-positive premium: %+v", resp)
	}
	// Identity: pure + loadings + taxes == total (exact kobo).
	sum := resp.PurePremium + resp.Loadings.Expense + resp.Loadings.Commission + resp.Loadings.Profit
	for _, tax := range resp.Taxes {
		sum += tax.AmountKobo
	}
	if sum != resp.TotalPremiumKobo {
		t.Errorf("decomposition identity broken: %d != %d", sum, resp.TotalPremiumKobo)
	}
	if len(resp.Taxes) != 2 {
		t.Errorf("taxes = %v, want VAT + NAICOM_LEVY", resp.Taxes)
	}
	if resp.AccumulationDelta != 2_000_000_000 {
		t.Errorf("accumulation delta = %d, want 2bn kobo (₦20m)", resp.AccumulationDelta)
	}
	// Aggregate actually moved by the delta (seed 19bn + 2bn).
	cur, err := accum.Current(context.Background(), "motor", "lagos_mainland")
	if err != nil {
		t.Fatal(err)
	}
	if cur != 19_000_000_000+2_000_000_000 {
		t.Errorf("aggregate = %d, want 21bn", cur)
	}
}

// TestAccumulationBreachReferral is the pinned acceptance test
// "accumulation_breach_referral": seed the Redis aggregate at the limit,
// rate, assert decision=refer AND the aggregate is unchanged.
func TestAccumulationBreachReferral(t *testing.T) {
	ctx := context.Background()
	svc, fix, accum := newTestService(t)
	// Seed the kano aggregate exactly at its ₦100m limit.
	if err := accum.Warm(ctx, map[string]int64{accumulation.Key("motor", "kano"): 10_000_000_000}); err != nil {
		t.Fatal(err)
	}
	req := baseRequest()
	req.GeoCell = "kano"
	req.QuoteRef = "q_breach_1"
	req.Variables["territory"] = "kano"
	req.SumInsured = 1_000_000 // ₦1m = 100m kobo > headroom 0
	resp, err := svc.Rate(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Decision != models.DecisionRefer {
		t.Fatalf("decision = %s, want refer", resp.Decision)
	}
	if len(resp.ReasonCodes) != 1 || resp.ReasonCodes[0] != models.ReasonAccumGeo {
		t.Errorf("reasonCodes = %v, want [ACCUM_GEO]", resp.ReasonCodes)
	}
	// Aggregate unchanged (the acceptance property).
	cur, err := accum.Current(ctx, "motor", "kano")
	if err != nil {
		t.Fatal(err)
	}
	if cur != 10_000_000_000 {
		t.Errorf("aggregate changed on breach: %d, want 10000000000", cur)
	}
	// The referral case is on the underwriter worklist.
	refs, err := fix.ListReferrals(ctx, "open")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range refs {
		if r.QuoteRef == "q_breach_1" && r.ReasonCodes[0] == "ACCUM_GEO" && r.Status == "open" {
			found = true
		}
	}
	if !found {
		t.Errorf("referral case not persisted: %v", refs)
	}
}

// TestFailClosedNoVersion is the pinned acceptance test
// "fail_closed_no_version": rate a managed line with no approved version →
// ErrNoRateVersion (the handler maps it to 503, never a fabricated number).
func TestFailClosedNoVersion(t *testing.T) {
	svc, _, _ := newTestService(t)
	// "crop" is registered as a managed line in the registry… simulate by
	// loading a snapshot where the line exists without an approved version.
	snap := svc.Rating.Current()
	_ = snap
	// Build the situation directly: add a managed line with no version to
	// the store via a second service (the fixture has none).
	svc2, _, _ := newTestService(t)
	cur := svc2.Rating.Current()
	cur.Lines["crop"] = true // managed, no approved version
	_, err := svc2.Rate(context.Background(), models.RateRequest{
		ProductLine: "crop", Variables: map[string]string{}, SumInsured: 1, Exposures: 1,
	})
	if !errors.Is(err, service.ErrNoRateVersion) {
		t.Fatalf("managed-no-version = %v, want ErrNoRateVersion", err)
	}
	_ = svc
}

// TestAccumulationUnavailableFailsClosed: a dead Redis refers every quote
// (ACCUM_UNAVAILABLE) — accumulation is a de-risking control, never
// silently bypassed.
func TestAccumulationUnavailableFailsClosed(t *testing.T) {
	svc := newTestServiceNoAccum(t)
	resp, err := svc.Rate(context.Background(), baseRequest())
	if err != nil {
		t.Fatal(err)
	}
	if resp.Decision != models.DecisionRefer || resp.ReasonCodes[0] != models.ReasonAccumUnavailable {
		t.Fatalf("decision = %s %v, want refer ACCUM_UNAVAILABLE", resp.Decision, resp.ReasonCodes)
	}
}

// TestExposureDecline: per-risk SI above the ceiling → hard decline.
func TestExposureDecline(t *testing.T) {
	svc, _, _ := newTestService(t)
	req := baseRequest()
	req.SumInsured = 60_000_000 // ₦60m > ₦50m ceiling
	resp, err := svc.Rate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Decision != models.DecisionDecline || resp.ReasonCodes[0] != models.ReasonLimitSumInsured {
		t.Fatalf("decision = %s %v, want decline LIMIT_SUM_INSURED", resp.Decision, resp.ReasonCodes)
	}
}

// TestReferralRuleHit: SI > ₦30m → SI_THRESHOLD referral (rule priority
// below the fraud rule).
func TestReferralRuleHit(t *testing.T) {
	svc, fix, _ := newTestService(t)
	req := baseRequest()
	req.SumInsured = 35_000_000 // ₦35m > ₦30m rule threshold, under ₦50m hard cap
	req.QuoteRef = "q_si_threshold"
	resp, err := svc.Rate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Decision != models.DecisionRefer || resp.ReasonCodes[0] != "SI_THRESHOLD" {
		t.Fatalf("decision = %s %v, want refer SI_THRESHOLD", resp.Decision, resp.ReasonCodes)
	}
	refs, _ := fix.ListReferrals(context.Background(), "open")
	if len(refs) != 1 || refs[0].ReasonCodes[0] != "SI_THRESHOLD" {
		t.Errorf("worklist = %v", refs)
	}
}

// TestFraudScoreReferral: high fraud score → FRAUD_SCORE referral.
func TestFraudScoreReferral(t *testing.T) {
	svc, _, _ := newTestService(t)
	req := baseRequest()
	req.Variables["fraud_score"] = "0.90"
	resp, err := svc.Rate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Decision != models.DecisionRefer || resp.ReasonCodes[0] != "FRAUD_SCORE" {
		t.Fatalf("decision = %s %v, want refer FRAUD_SCORE", resp.Decision, resp.ReasonCodes)
	}
}

// TestModelOutOfDomainReferral: a variable level the model has no
// relativity for → refer MODEL_OUT_OF_DOMAIN (never a guessed relativity).
func TestModelOutOfDomainReferral(t *testing.T) {
	svc, _, _ := newTestService(t)
	req := baseRequest()
	req.Variables["territory"] = "sokoto" // not in the territory table
	resp, err := svc.Rate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Decision != models.DecisionRefer || resp.ReasonCodes[0] != models.ReasonModelDomain {
		t.Fatalf("decision = %s %v, want refer MODEL_OUT_OF_DOMAIN", resp.Decision, resp.ReasonCodes)
	}
}

// TestKernelErrorReferral: a numeric failure in the kernel (overflowing
// pure premium) → refer KERNEL_ERROR, never accept (Appendix I step 7).
func TestKernelErrorReferral(t *testing.T) {
	svc, _, _ := newTestService(t)
	req := baseRequest()
	req.Exposures = 1e300 // finite but base overflows f64 in the product
	resp, err := svc.Rate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Decision != models.DecisionRefer || resp.ReasonCodes[0] != models.ReasonKernelError {
		t.Fatalf("decision = %s %v, want refer KERNEL_ERROR", resp.Decision, resp.ReasonCodes)
	}
}

// TestUnknownLine: an unregistered line is a client error, not fail-closed.
func TestUnknownLine(t *testing.T) {
	svc, _, _ := newTestService(t)
	_, err := svc.Rate(context.Background(), models.RateRequest{
		ProductLine: "crop", Variables: map[string]string{}, SumInsured: 1, Exposures: 1,
	})
	if !errors.Is(err, service.ErrUnknownLine) {
		t.Fatalf("unknown line = %v, want ErrUnknownLine", err)
	}
}

// TestInputValidation: bad requests are 400s at the boundary.
func TestInputValidation(t *testing.T) {
	svc, _, _ := newTestService(t)
	for _, mutate := range []func(*models.RateRequest){
		func(r *models.RateRequest) { r.ProductLine = "" },
		func(r *models.RateRequest) { r.SumInsured = -1 },
		func(r *models.RateRequest) { r.Exposures = 0 },
	} {
		req := baseRequest()
		mutate(&req)
		if _, err := svc.Rate(context.Background(), req); !errors.Is(err, service.ErrInvalidInput) {
			t.Errorf("invalid input accepted: %v", err)
		}
	}
}

// TestActivateSwapsSnapshot: activating the filing version swaps the live
// snapshot atomically and the new rates apply immediately.
func TestActivateSwapsSnapshot(t *testing.T) {
	ctx := context.Background()
	svc, _, _ := newTestService(t)
	before, err := svc.Rate(ctx, baseRequest())
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ActivateRateVersion(ctx, 7); err != nil {
		t.Fatal(err)
	}
	after, err := svc.Rate(ctx, baseRequest())
	if err != nil {
		t.Fatal(err)
	}
	if after.RateVersion != "2026.10" {
		t.Errorf("post-activation rateVersion = %q, want 2026.10", after.RateVersion)
	}
	if after.TotalPremiumKobo == before.TotalPremiumKobo {
		t.Errorf("new version produced identical premium (%d) — swap likely did not happen", after.TotalPremiumKobo)
	}
	// Version listing reflects the single-active invariant.
	versions, err := svc.RateVersions("motor")
	if err != nil {
		t.Fatal(err)
	}
	approved := 0
	for _, v := range versions {
		if v.Status == "approved" {
			approved++
		}
	}
	if approved != 1 {
		t.Errorf("approved count = %d, want 1 (single-active)", approved)
	}
}

// TestExposureCheckEndpointLogic: pre-check reports breaches without
// rating.
func TestExposureCheckEndpointLogic(t *testing.T) {
	svc, _, _ := newTestService(t)
	out, err := svc.ExposureCheck(context.Background(), models.ExposureCheckRequest{
		ProductLine: "motor", SumInsured: 60_000_000, GeoCell: "lagos_mainland",
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.WithinLimits {
		t.Errorf("₦60m SI must breach the ₦50m ceiling")
	}
	out, err = svc.ExposureCheck(context.Background(), models.ExposureCheckRequest{
		ProductLine: "motor", SumInsured: 10_000_000, GeoCell: "lagos_mainland",
	})
	if err != nil || !out.WithinLimits {
		t.Errorf("₦10m SI must be within limits: %+v %v", out, err)
	}
}

// TestAccumulationReadEndpoint: the portal heatmap read reports the live
// aggregate and limit.
func TestAccumulationReadEndpoint(t *testing.T) {
	svc, _, _ := newTestService(t)
	cell, err := svc.Accumulation(context.Background(), "motor", "lagos_mainland")
	if err != nil {
		t.Fatal(err)
	}
	if cell.AggregateExposure != 190_000_000.0 {
		t.Errorf("aggregate = %v naira, want 190m", cell.AggregateExposure)
	}
	if cell.Limit == nil || *cell.Limit != 500_000_000.0 {
		t.Errorf("limit = %v", cell.Limit)
	}
	if cell.Breach {
		t.Error("seed must not breach")
	}
}

// TestCapitalSummary: the approved-run read model round-trips.
func TestCapitalSummary(t *testing.T) {
	svc, _, _ := newTestService(t)
	summary, err := svc.CapitalSummary(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if summary.NaicomRBC.Ratio != 2.0 {
		t.Errorf("ratio = %v", summary.NaicomRBC.Ratio)
	}
	if len(summary.EC.PerLine) != 2 {
		t.Errorf("per-line = %v", summary.EC.PerLine)
	}
}

// TestReinsuranceEvaluateService: the MC-backed evaluate flows through the
// service layer with kernel errors mapped.
func TestReinsuranceEvaluateService(t *testing.T) {
	svc, _, _ := newTestService(t)
	res, err := svc.ReinsuranceEvaluate(context.Background(), reinsurance.Request{
		Lines: []kernels.LineSimSpec{
			{FreqDist: 0, FreqP1: 50, SevDist: 2, SevP1: 1000, SevP2: 0.5},
		},
		Paths:  20_000,
		Seed:   5,
		Treaty: reinsurance.Treaty{Type: "quota_share", CededShare: 0.25},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.RetainedVar995 <= 0 || res.DeltaVar995 <= 0 {
		t.Errorf("implausible evaluation: %+v", res)
	}
	if _, err := svc.ReinsuranceEvaluate(context.Background(), reinsurance.Request{
		Lines: nil, Paths: 1, Treaty: reinsurance.Treaty{Type: "quota_share"},
	}); err == nil {
		t.Error("invalid request accepted")
	}
}

// TestAdequacyEvaluate: breach classification persists alerts; clear pairs
// persist nothing.
func TestAdequacyEvaluate(t *testing.T) {
	svc, fix, _ := newTestService(t)
	out, err := svc.AdequacyEvaluate(context.Background(), service.AdequacyRequest{
		ProductLine: "motor", Period: "2026-09",
		PricedLossRatio: 0.55, ActualLossRatio: 0.61, EarnedPremiumKobo: 10_000_000_000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.Severity != "amber" || !out.Persisted {
		t.Errorf("+6 pts at full credibility must persist amber: %+v", out)
	}
	out, err = svc.AdequacyEvaluate(context.Background(), service.AdequacyRequest{
		ProductLine: "motor", Period: "2026-09",
		PricedLossRatio: 0.55, ActualLossRatio: 0.56, EarnedPremiumKobo: 10_000_000_000,
	})
	if err != nil || out.Severity != "" || out.Persisted {
		t.Errorf("+1 pt must be clear and unpersisted: %+v %v", out, err)
	}
	if len(fix.Alerts()) != 1 {
		t.Errorf("alerts = %v", fix.Alerts())
	}
}

// ─── latency gates (Appendix H: p99 < 1 ms kernel / < 5 ms handler) ──────

// TestLatencyKernelP99 measures the in-process kernel-call p99 over 2000
// real cgo compose calls and asserts the Appendix H budget.
func TestLatencyKernelP99(t *testing.T) {
	svc, _, _ := newTestService(t)
	snap := svc.Rating.Current()
	v, _, _ := snap.ActiveVersion("motor")
	vars := map[string]string{
		"age_band": "2", "ncd": "3", "vehicle_class": "sedan", "territory": "lagos_mainland",
	}
	res, err := v.Resolve(vars, 1)
	if err != nil {
		t.Fatal(err)
	}
	taxRates := []float64{0.075, 0.01}

	const n = 2000
	durations := make([]time.Duration, 0, n)
	for i := 0; i < n; i++ {
		start := time.Now()
		if _, err := kernels.ComposePremium(res.BasePurePremium, res.Rels,
			res.Loadings.ExpenseRatio, res.Loadings.CommissionRate, res.Loadings.ProfitMargin,
			taxRates, res.Loadings.MinPremiumKobo, res.Loadings.MaxKoboOrDefault()); err != nil {
			t.Fatal(err)
		}
		durations = append(durations, time.Since(start))
	}
	p99 := percentile(durations, 99)
	t.Logf("kernel compose p99 = %v over %d calls", p99, n)
	if p99 >= time.Millisecond {
		t.Fatalf("kernel p99 %v exceeds the 1ms budget", p99)
	}
}

// TestLatencyHandlerP99 measures the end-to-end service rating p99
// (resolution + rules + accumulation + kernel) and asserts the Appendix H
// 5 ms handler budget.
func TestLatencyHandlerP99(t *testing.T) {
	svc, _, _ := newTestService(t)
	const n = 1000
	durations := make([]time.Duration, 0, n)
	for i := 0; i < n; i++ {
		req := baseRequest()
		req.QuoteRef = ""
		start := time.Now()
		if _, err := svc.Rate(context.Background(), req); err != nil {
			t.Fatal(err)
		}
		durations = append(durations, time.Since(start))
	}
	p99 := percentile(durations, 99)
	t.Logf("handler p99 = %v over %d calls", p99, n)
	if p99 >= 5*time.Millisecond {
		t.Fatalf("handler p99 %v exceeds the 5ms budget", p99)
	}
}

func percentile(durations []time.Duration, p int) time.Duration {
	sorted := append([]time.Duration{}, durations...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	idx := p * len(sorted) / 100
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

// BenchmarkRateHandler is the go-test-bench evidence for the handler
// budget (pair with TestLatencyHandlerP99's measured p99).
func BenchmarkRateHandler(b *testing.B) {
	svc, _, _ := newTestService(b)
	req := baseRequest()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req.QuoteRef = ""
		if _, err := svc.Rate(context.Background(), req); err != nil {
			b.Fatal(err)
		}
	}
}
