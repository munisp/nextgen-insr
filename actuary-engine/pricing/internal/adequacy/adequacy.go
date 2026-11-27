// Package adequacy is the priced-LR vs live-LR evaluator (design §4.f):
// alert thresholds from the assumption-set convention (amber ±5 pts, red
// ±10 pts vs priced loss ratio), with automatic band widening for
// low-credibility lines (Appendix J: lines under ₦50m earned premium run
// widened bands). The evaluator is pure — persistence of breaches to
// act_adequacy_alerts happens at the service layer.
package adequacy

import (
	"fmt"
	"math"
)

// Severity of an adequacy breach.
const (
	SeverityNone  = ""
	SeverityAmber = "amber"
	SeverityRed   = "red"
)

// Default alert bands in loss-ratio points (design §4.f).
const (
	DefaultAmberBand = 0.05
	DefaultRedBand   = 0.10
)

// credibilityFloorKobo is the Appendix J credibility floor: lines below ₦50m
// earned premium get widened bands (₦50m = 5e9 kobo).
const credibilityFloorKobo int64 = 5_000_000_000

// Verdict is the evaluation result.
type Verdict struct {
	Severity  string
	Delta     float64 // actualLR − pricedLR (points)
	BandAmber float64 // band applied (after credibility widening)
	BandRed   float64
}

// Evaluate compares actual vs priced loss ratio and classifies the breach.
// Bands widen by (1 + max(0, 1 − earnedPremium/₦50m)) — at zero earned
// premium the bands double, at ≥₦50m they are the defaults.
func Evaluate(pricedLR, actualLR float64, earnedPremiumKobo int64) (Verdict, error) {
	if math.IsNaN(pricedLR) || math.IsNaN(actualLR) || math.IsInf(pricedLR, 0) || math.IsInf(actualLR, 0) {
		return Verdict{}, fmt.Errorf("loss ratios must be finite")
	}
	if pricedLR < 0 || actualLR < 0 {
		return Verdict{}, fmt.Errorf("loss ratios must be >= 0")
	}
	if earnedPremiumKobo < 0 {
		return Verdict{}, fmt.Errorf("earned premium must be >= 0")
	}
	widen := 1.0
	if earnedPremiumKobo < credibilityFloorKobo {
		widen += 1.0 - float64(earnedPremiumKobo)/float64(credibilityFloorKobo)
	}
	amber := DefaultAmberBand * widen
	red := DefaultRedBand * widen
	delta := actualLR - pricedLR
	v := Verdict{Severity: SeverityNone, Delta: delta, BandAmber: amber, BandRed: red}
	// Symmetric bands (±): adverse AND favourable deviations are monitored —
	// favourable breaches signal over-pricing (design §4.f alert semantics).
	if math.Abs(delta) >= red {
		v.Severity = SeverityRed
	} else if math.Abs(delta) >= amber {
		v.Severity = SeverityAmber
	}
	return v, nil
}
