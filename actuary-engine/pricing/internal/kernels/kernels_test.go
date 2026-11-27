package kernels

import (
	"errors"
	"math"
	"testing"
)

// TestComposeGoldenDocuments the kernel's own golden decomposition
// (premium.rs compose_decomposition_holds) through the cgo boundary.
func TestComposeGolden(t *testing.T) {
	q, err := ComposePremium(9_250_000.0, []float64{1.18}, 0.20, 0.10, 0.05, []float64{0.075}, 0, math.MaxInt64)
	if err != nil {
		t.Fatalf("compose failed: %v", err)
	}
	if q.PureKobo != 1_091_500_000 {
		t.Errorf("pure = %d, want 1091500000", q.PureKobo)
	}
	if q.LoadingsKobo != 587_730_769 {
		t.Errorf("loadings = %d, want 587730769", q.LoadingsKobo)
	}
	if q.TotalKobo != 1_805_173_077 {
		t.Errorf("total = %d, want 1805173077", q.TotalKobo)
	}
	if q.TaxKobo != q.TotalKobo-q.PureKobo-q.LoadingsKobo {
		t.Errorf("tax identity broken")
	}
	if q.PureKobo+q.LoadingsKobo+q.TaxKobo != q.TotalKobo {
		t.Errorf("decomposition identity broken")
	}
}

// TestComposeErrorMaps AK_ERR_* statuses onto typed errors — the
// fail-closed contract (no partial outputs, no guesses).
func TestComposeError(t *testing.T) {
	cases := []struct {
		name          string
		base          float64
		rels          []float64
		exp, com, pro float64
		taxes         []float64
		min, max      int64
		wantCode      int32
	}{
		{"negative base", -1, nil, 0.1, 0.1, 0.1, nil, 0, math.MaxInt64, ErrInput},
		{"nan base", math.NaN(), nil, 0.1, 0.1, 0.1, nil, 0, math.MaxInt64, ErrInput},
		{"zero rel", 1, []float64{0}, 0.1, 0.1, 0.1, nil, 0, math.MaxInt64, ErrInput},
		{"loadings >= 1", 1, nil, 0.5, 0.4, 0.2, nil, 0, math.MaxInt64, ErrInput},
		{"max < min", 1, nil, 0.1, 0.1, 0.1, nil, 10, 5, ErrInput},
		{"tax <= -1", 1, nil, 0.1, 0.1, 0.1, []float64{-1}, 0, math.MaxInt64, ErrInput},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			q, err := ComposePremium(tc.base, tc.rels, tc.exp, tc.com, tc.pro, tc.taxes, tc.min, tc.max)
			if err == nil {
				t.Fatalf("expected error, got quote %+v", q)
			}
			var ke *KernelError
			if !errors.As(err, &ke) {
				t.Fatalf("error %v is not a KernelError", err)
			}
			if ke.Code != tc.wantCode {
				t.Errorf("code = %d, want %d", ke.Code, tc.wantCode)
			}
			if q != (PremiumQuote{}) {
				t.Errorf("non-zero quote on error: %+v", q)
			}
		})
	}
}

// TestComposeClamps mirrors the kernel clamp tests through cgo.
func TestComposeClamps(t *testing.T) {
	q, err := ComposePremium(10, nil, 0, 0, 0, nil, 50_000, math.MaxInt64)
	if err != nil {
		t.Fatal(err)
	}
	if q.TotalKobo != 50_000 {
		t.Errorf("min clamp: total = %d, want 50000", q.TotalKobo)
	}
	q, err = ComposePremium(1e9, nil, 0, 0, 0, nil, 0, 1_000)
	if err != nil {
		t.Fatal(err)
	}
	if q.TotalKobo != 1_000 {
		t.Errorf("max clamp: total = %d, want 1000", q.TotalKobo)
	}
}

// TestComposeHalfAwayFromZero checks the kernel's rounding policy end to
// end: 0.005 naira = 0.5 kobo rounds up (matches the Rust test).
func TestComposeHalfAwayFromZero(t *testing.T) {
	q, err := ComposePremium(0.005, nil, 0, 0, 0, nil, 0, math.MaxInt64)
	if err != nil {
		t.Fatal(err)
	}
	if q.TotalKobo != 1 {
		t.Errorf("0.5 kobo must round half away from zero to 1, got %d", q.TotalKobo)
	}
}

// TestVersionSmoke: ak_version must be non-zero and match the kernels
// crate's packed semver (1.0.0 → 0x00010000).
func TestVersionSmoke(t *testing.T) {
	v := Version()
	if v == 0 {
		t.Fatal("ak_version returned 0 — wrong library linked?")
	}
	major, minor, patch := v>>16, (v>>8)&0xff, v&0xff
	if major != 1 || minor != 0 || patch != 0 {
		t.Fatalf("unexpected kernel version %d.%d.%d", major, minor, patch)
	}
}

// TestMonteCarloDeterministicAndMonotone runs the MC kernel through cgo:
// deterministic under seed, and TVaR ≥ VaR (the design §9.1 property).
func TestMonteCarloDeterministicAndMonotone(t *testing.T) {
	lines := []LineSimSpec{
		{FreqDist: FreqPoisson, FreqP1: 50, SevDist: SevGamma, SevP1: 1000, SevP2: 0.5},
		{FreqDist: FreqPoisson, FreqP1: 20, SevDist: SevLognormal, SevP1: 7, SevP2: 0.9},
	}
	const paths, seed = 100_000, 42
	res1, err := MonteCarloAggregate(lines, nil, paths, seed)
	if err != nil {
		t.Fatalf("mc failed: %v", err)
	}
	res2, err := MonteCarloAggregate(lines, nil, paths, seed)
	if err != nil {
		t.Fatalf("mc rerun failed: %v", err)
	}
	if res1.Var995 != res2.Var995 || res1.Tvar99 != res2.Tvar99 || res1.Mean != res2.Mean {
		t.Errorf("MC not deterministic under seed: %+v vs %+v", res1, res2)
	}
	if res1.Tvar99 < res1.Var995 {
		t.Errorf("TVaR (%v) < VaR (%v) violates monotonicity", res1.Tvar99, res1.Var995)
	}
	if len(res1.PerLineTvar) != 2 {
		t.Fatalf("per-line TVaR missing: %v", res1.PerLineTvar)
	}
	// Mean sanity: expected ≈ 50×1000 + 20×exp(7+0.405) ≈ 50000+32800.
	if res1.Mean < 70_000 || res1.Mean > 90_000 {
		t.Errorf("mean %v outside plausible band for these specs", res1.Mean)
	}
	// A corrupted spec must return a domain error, never a number.
	bad := []LineSimSpec{{FreqDist: 99, FreqP1: 1, SevDist: SevGamma, SevP1: 1, SevP2: 1}}
	if _, err := MonteCarloAggregate(bad, nil, 1_000, 1); err == nil {
		t.Fatal("invalid dist code accepted — kernel must fail closed")
	}
}

// BenchmarkComposePremium measures the in-process cgo rating call. The
// Appendix H gate is p99 < 1 ms; see TestLatencyKernelP99 in the service
// package for the measured p99 assertion.
func BenchmarkComposePremium(b *testing.B) {
	rels := []float64{1.18, 0.97}
	taxes := []float64{0.075, 0.01}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := ComposePremium(125_256.0, rels, 0.20, 0.10, 0.05, taxes, 2_500_000, math.MaxInt64); err != nil {
			b.Fatal(err)
		}
	}
}

const (
	FreqPoisson  = 0
	SevGamma     = 2
	SevLognormal = 3
)
