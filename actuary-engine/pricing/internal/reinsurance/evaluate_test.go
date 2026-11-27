package reinsurance

import (
	"math"
	"testing"

	"github.com/unified-insurance/actuary-engine/pricing/internal/kernels"
)

func grossSpec() []kernels.LineSimSpec {
	return []kernels.LineSimSpec{
		{FreqDist: FreqPoisson, FreqP1: 50, SevDist: SevGamma, SevP1: 1000, SevP2: 0.5},
		{FreqDist: FreqPoisson, FreqP1: 20, SevDist: SevLognormal, SevP1: 7, SevP2: 0.9},
	}
}

// TestQuotaShareExactScaling: scaling an aggregate distribution by a
// constant scales every quantile by the same constant — the retained
// outputs must equal share × gross outputs to machine precision.
func TestQuotaShareExactScaling(t *testing.T) {
	req := Request{
		Lines: grossSpec(), Paths: 50_000, Seed: 7,
		Treaty: Treaty{Type: "quota_share", CededShare: 0.30},
	}
	res, err := Evaluate(req)
	if err != nil {
		t.Fatalf("evaluate failed: %v", err)
	}
	gross, err := kernels.MonteCarloAggregate(req.Lines, nil, req.Paths, req.Seed)
	if err != nil {
		t.Fatalf("gross sim failed: %v", err)
	}
	if math.Abs(res.RetainedVar995-0.70*gross.Var995) > 1e-9 {
		t.Errorf("retained VaR %v != 0.7 × gross %v", res.RetainedVar995, gross.Var995)
	}
	if math.Abs(res.RetainedTvar99-0.70*gross.Tvar99) > 1e-9 {
		t.Errorf("retained TVaR %v != 0.7 × gross %v", res.RetainedTvar99, gross.Tvar99)
	}
	if math.Abs(res.DeltaVar995-0.30*gross.Var995) > 1e-9 {
		t.Errorf("delta VaR %v != 0.3 × gross", res.DeltaVar995)
	}
	wantCeded := int64(math.Round(0.30 * gross.Mean * 100))
	if res.CededCostKobo != wantCeded {
		t.Errorf("ceded cost = %d, want %d", res.CededCostKobo, wantCeded)
	}
}

// TestXoLLimitingCases drives the XoL path through the real kernel on a
// Normal severity (closed-form LEV): an attachment at +∞ retains
// everything; an attachment at 0 with infinite limit cedes everything.
func TestXoLLimitingCases(t *testing.T) {
	// Single line, Normal severity via Tweedie p=0.
	line := kernels.LineSimSpec{FreqDist: FreqPoisson, FreqP1: 100, SevDist: SevTweedie, SevP1: 5000, SevP2: 500, SevP3: 0}
	gross, err := kernels.MonteCarloAggregate([]kernels.LineSimSpec{line}, nil, 50_000, 11)
	if err != nil {
		t.Fatalf("gross sim failed: %v", err)
	}

	// Attachment far above any plausible claim → retained ≈ gross.
	res, err := Evaluate(Request{
		Lines: []kernels.LineSimSpec{line}, Paths: 50_000, Seed: 11,
		Treaty: Treaty{Type: "excess_of_loss", Attachment: 1e12, Limit: 1e6},
	})
	if err != nil {
		t.Fatalf("evaluate failed: %v", err)
	}
	if rel := math.Abs(res.RetainedVar995-gross.Var995) / gross.Var995; rel > 0.02 {
		t.Errorf("a→∞ retained VaR %v deviates from gross %v by %v", res.RetainedVar995, gross.Var995, rel)
	}
	if res.CededCostKobo != 0 {
		t.Errorf("a→∞ must cede nothing, got %d kobo", res.CededCostKobo)
	}

	// Attachment 0, limit huge → cede (almost) everything, retain ≈ 0.
	res, err = Evaluate(Request{
		Lines: []kernels.LineSimSpec{line}, Paths: 50_000, Seed: 11,
		Treaty: Treaty{Type: "excess_of_loss", Attachment: 0, Limit: 1e12},
	})
	if err != nil {
		t.Fatalf("evaluate failed: %v", err)
	}
	if res.RetainedVar995 > 0.01*gross.Var995 {
		t.Errorf("a=0,l→∞ retained VaR %v should be ~0 (gross %v)", res.RetainedVar995, gross.Var995)
	}
	// Ceded cost is analytic on the exact params: freq × severity mean in
	// kobo (the kernel's simulated gross mean agrees within MC noise).
	wantCeded := int64(math.Round(100 * 5000 * 100))
	if res.CededCostKobo != wantCeded {
		t.Errorf("full cession: ceded = %d, want analytic %d", res.CededCostKobo, wantCeded)
	}
	// Gross simulated mean within 2 MC standard deviations of analytic.
	// sd ≈ sqrt(100×(5000²+500²)) ≈ 50,125 naira.
	if math.Abs(gross.Mean-500_000) > 2*50_125 {
		t.Errorf("gross mean %v deviates from analytic 500000 beyond MC noise", gross.Mean)
	}
}

// TestXoLMidLayer: a mid-layer attachment reduces retained VaR and TVaR
// strictly, and the ceded expected cost matches the analytic LEV formula.
func TestXoLMidLayer(t *testing.T) {
	line := kernels.LineSimSpec{FreqDist: FreqPoisson, FreqP1: 100, SevDist: SevTweedie, SevP1: 5000, SevP2: 500, SevP3: 0}
	gross, err := kernels.MonteCarloAggregate([]kernels.LineSimSpec{line}, nil, 50_000, 13)
	if err != nil {
		t.Fatalf("gross sim failed: %v", err)
	}
	const a, l = 4000.0, 3000.0
	res, err := Evaluate(Request{
		Lines: []kernels.LineSimSpec{line}, Paths: 50_000, Seed: 13,
		Treaty: Treaty{Type: "excess_of_loss", Attachment: a, Limit: l},
	})
	if err != nil {
		t.Fatalf("evaluate failed: %v", err)
	}
	if res.RetainedVar995 >= gross.Var995 {
		t.Errorf("mid-layer must reduce retained VaR: %v >= %v", res.RetainedVar995, gross.Var995)
	}
	if res.RetainedTvar99 >= gross.Tvar99 {
		t.Errorf("mid-layer must reduce retained TVaR: %v >= %v", res.RetainedTvar99, gross.Tvar99)
	}
	// Analytic ceded per claim: E[X∧(a+l)] − E[X∧a] with X ~ N(5000, 500).
	cededPerClaim := limitedExpectedValue(line, a+l) - limitedExpectedValue(line, a)
	wantCeded := int64(math.Round(line.FreqP1 * cededPerClaim * 100))
	if res.CededCostKobo != wantCeded {
		t.Errorf("ceded cost = %d, want analytic %d", res.CededCostKobo, wantCeded)
	}
}

// TestLEVGamma: the Gamma LEV matches numeric quadrature (Simpson) — the
// closed form must be correct since the kernel sim consumes its output.
func TestLEVGamma(t *testing.T) {
	mean, cv := 1000.0, 0.5
	k := 1.0 / (cv * cv)
	theta := mean / k
	line := kernels.LineSimSpec{SevDist: SevGamma, SevP1: mean, SevP2: cv}
	for _, a := range []float64{1, 250, 800, 1500, 4000, 20000} {
		got := limitedExpectedValue(line, a)
		// Simpson quadrature of E[min(X,a)] = ∫₀ᵃ S(x) dx with the same
		// regularized P for the CDF — cross-check via direct integration of
		// the density instead: ∫₀ᵃ x f(x) dx + a·S(a).
		want := quadGammaLEV(k, theta, a)
		if math.Abs(got-want)/want > 1e-6 {
			t.Errorf("a=%v: closed form %v, quadrature %v", a, got, want)
		}
	}
}

// quadGammaLEV computes E[min(X,a)] by integrating x·f(x) numerically and
// adding a·(1−F(a)) — an independent path from the closed form.
func quadGammaLEV(k, theta, a float64) float64 {
	n := 20_000
	h := a / float64(n)
	density := func(x float64) float64 {
		return math.Exp((k-1)*math.Log(x) - x/theta - lgamma(k) - k*math.Log(theta))
	}
	integ := 0.0
	for i := 0; i <= n; i++ {
		x := float64(i) * h
		w := 4.0
		if i%2 == 0 {
			w = 2.0
		}
		if i == 0 || i == n {
			w = 1.0
		}
		integ += w * x * density(x)
	}
	integ *= h / 3.0
	return integ + a*(1-regularizedGammaP(k, a/theta))
}

func TestEvaluateValidation(t *testing.T) {
	if _, err := Evaluate(Request{Paths: 100}); err == nil {
		t.Error("empty lines accepted")
	}
	if _, err := Evaluate(Request{Lines: grossSpec(), Treaty: Treaty{Type: "quota_share", CededShare: 1.2}, Paths: 100}); err == nil {
		t.Error("ceded share > 1 accepted")
	}
	if _, err := Evaluate(Request{Lines: grossSpec(), Treaty: Treaty{Type: "excess_of_loss", Attachment: -1, Limit: 1}, Paths: 100}); err == nil {
		t.Error("negative attachment accepted")
	}
	if _, err := Evaluate(Request{Lines: grossSpec(), Treaty: Treaty{Type: "surplus"}, Paths: 100}); err == nil {
		t.Error("unsupported treaty type accepted")
	}
}
