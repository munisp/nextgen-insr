package adequacy

import (
	"math"
	"testing"
)

func TestBands(t *testing.T) {
	// High-credibility line (≥ ₦50m earned): default bands.
	v, err := Evaluate(0.55, 0.58, credibilityFloorKobo)
	if err != nil || v.Severity != SeverityNone {
		t.Errorf("+3 pts must be clear: %+v %v", v, err)
	}
	v, _ = Evaluate(0.55, 0.61, credibilityFloorKobo)
	if v.Severity != SeverityAmber {
		t.Errorf("+6 pts must be amber: %+v", v)
	}
	v, _ = Evaluate(0.55, 0.66, credibilityFloorKobo)
	if v.Severity != SeverityRed {
		t.Errorf("+11 pts must be red: %+v", v)
	}
	// Symmetric: favourable deviations alert too (over-pricing signal).
	v, _ = Evaluate(0.55, 0.44, credibilityFloorKobo)
	if v.Severity != SeverityRed {
		t.Errorf("-11 pts must be red: %+v", v)
	}
	v, _ = Evaluate(0.55, 0.495, credibilityFloorKobo)
	if v.Severity != SeverityAmber {
		t.Errorf("-5.5 pts must be amber: %+v", v)
	}
}

func TestCredibilityWidening(t *testing.T) {
	// At zero earned premium the bands double (widen = 1 + 1): amber 0.10,
	// red 0.20.
	v, err := Evaluate(0.55, 0.55+0.099, 0)
	if err != nil {
		t.Fatal(err)
	}
	if v.Severity != SeverityNone {
		t.Errorf("+9.9 pts must be inside a doubled amber band: %+v", v)
	}
	if math.Abs(v.BandRed-0.20) > 1e-12 || math.Abs(v.BandAmber-0.10) > 1e-12 {
		t.Errorf("widened bands wrong: %+v", v)
	}
	v, _ = Evaluate(0.55, 0.55+0.15, 0)
	if v.Severity != SeverityAmber {
		t.Errorf("+15 pts at zero credibility must be amber (red band 0.20): %+v", v)
	}
	v, _ = Evaluate(0.55, 0.55+0.201, 0)
	if v.Severity != SeverityRed {
		t.Errorf("+20.1 pts must breach the doubled red band: %+v", v)
	}
	// Half the floor → widen = 1.5 → red band 0.15.
	v, _ = Evaluate(0.55, 0.55+0.14, credibilityFloorKobo/2)
	if v.Severity != SeverityAmber {
		t.Errorf("+14 pts at half-credibility must be amber (red band 0.15): %+v", v)
	}
}

func TestInputValidation(t *testing.T) {
	if _, err := Evaluate(math.NaN(), 0.5, 0); err == nil {
		t.Error("NaN priced LR accepted")
	}
	if _, err := Evaluate(-0.1, 0.5, 0); err == nil {
		t.Error("negative priced LR accepted")
	}
	if _, err := Evaluate(0.5, 0.5, -1); err == nil {
		t.Error("negative earned premium accepted")
	}
}
