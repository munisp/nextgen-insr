// Package reinsurance computes the retained-risk impact of a proposed
// treaty structure (design §4.e, Appendix D POST /v1/reinsurance/evaluate).
// Every evaluation runs the real Monte Carlo kernel through the cgo
// boundary — quota-share treaties use exact linear scaling of the gross
// simulation quantiles; excess-of-loss treaties transform per-claim
// severity through closed-form limited expected values and re-run the
// kernel on the retained layer (a documented approximation: the family/CV
// shape is preserved while the mean is made exact).
package reinsurance

import (
	"errors"
	"fmt"
	"math"

	"github.com/unified-insurance/actuary-engine/pricing/internal/kernels"
	"github.com/unified-insurance/actuary-engine/pricing/internal/models"
)

// Distribution codes (frozen Appendix C header).
const (
	FreqPoisson  = 0
	FreqNegBin   = 1
	SevGamma     = 2
	SevLognormal = 3
	SevTweedie   = 4
)

// Treaty is the proposed reinsurance structure.
type Treaty struct {
	// Type: "quota_share" | "excess_of_loss".
	Type string `json:"type"`
	// CededShare is the ceded proportion for quota_share (0..1).
	CededShare float64 `json:"cededShare,omitempty"`
	// Attachment / Limit are the per-claim XoL layer bounds in naira.
	Attachment float64 `json:"attachment,omitempty"`
	Limit      float64 `json:"limit,omitempty"`
}

// Request is POST /v1/reinsurance/evaluate body.
type Request struct {
	Lines       []kernels.LineSimSpec `json:"lines"`
	Correlation []float64             `json:"correlation,omitempty"` // row-major n×n, nil = independence
	Paths       uint64                `json:"paths"`
	Seed        uint64                `json:"seed"`
	Treaty      Treaty                `json:"treaty"`
}

// Validate enforces input sanity before any compute (fail-closed like the
// kernel boundary).
func (r *Request) Validate() error {
	if len(r.Lines) == 0 {
		return errors.New("lines must be non-empty")
	}
	if r.Paths == 0 {
		return errors.New("paths must be > 0")
	}
	if len(r.Correlation) != 0 && len(r.Correlation) != len(r.Lines)*len(r.Lines) {
		return fmt.Errorf("correlation has %d entries, want %d", len(r.Correlation), len(r.Lines)*len(r.Lines))
	}
	switch r.Treaty.Type {
	case "quota_share":
		if r.Treaty.CededShare < 0 || r.Treaty.CededShare > 1 || math.IsNaN(r.Treaty.CededShare) {
			return errors.New("quota_share cededShare must be within [0,1]")
		}
	case "excess_of_loss":
		if r.Treaty.Attachment < 0 || math.IsNaN(r.Treaty.Attachment) {
			return errors.New("attachment must be finite and >= 0")
		}
		if r.Treaty.Limit <= 0 || math.IsNaN(r.Treaty.Limit) {
			return errors.New("limit must be finite and > 0")
		}
	default:
		return fmt.Errorf("treaty type %q unsupported", r.Treaty.Type)
	}
	return nil
}

// Evaluate runs the gross simulation, applies the treaty, and returns the
// retained-risk deltas (Leg D ReinsuranceEvaluation shape). Any kernel
// failure propagates as an error — the endpoint never fabricates a number.
func Evaluate(req Request) (models.ReinsuranceEvaluation, error) {
	if err := req.Validate(); err != nil {
		return models.ReinsuranceEvaluation{}, err
	}
	gross, err := kernels.MonteCarloAggregate(req.Lines, req.Correlation, req.Paths, req.Seed)
	if err != nil {
		return models.ReinsuranceEvaluation{}, fmt.Errorf("gross simulation: %w", err)
	}

	var retained models.ReinsuranceEvaluation
	var cededMean float64

	switch req.Treaty.Type {
	case "quota_share":
		// Scaling an aggregate-loss distribution by a constant scales every
		// quantile and the mean by the same constant — exact, no re-sim.
		kept := 1.0 - req.Treaty.CededShare
		retained.RetainedVar995 = kept * gross.Var995
		retained.RetainedTvar99 = kept * gross.Tvar99
		cededMean = req.Treaty.CededShare * gross.Mean

	case "excess_of_loss":
		retainedLines := make([]kernels.LineSimSpec, len(req.Lines))
		degenerate := true
		for i, l := range req.Lines {
			sevMean, sevCV, ok := severityMeanCV(l)
			if !ok {
				return models.ReinsuranceEvaluation{}, fmt.Errorf("line %d: severity mean not derivable for dist %d", i, l.SevDist)
			}
			retMean := retainedSeverityMean(l, sevMean, req.Treaty.Attachment, req.Treaty.Limit)
			cededMean += float64(l.FreqP1) * (sevMean - retMean)
			if retMean >= 1e-9 {
				degenerate = false
			}
			retainedLines[i] = l
			setSeverityMean(&retainedLines[i], retMean, sevCV)
		}
		if degenerate {
			// Retained severity is a point mass at zero (e.g. full cession):
			// every quantile is exactly 0 — analytic, no re-sim needed. The
			// kernel already ran for the gross side.
			retained.RetainedVar995 = 0
			retained.RetainedTvar99 = 0
		} else {
			ret, err := kernels.MonteCarloAggregate(retainedLines, req.Correlation, req.Paths, req.Seed)
			if err != nil {
				return models.ReinsuranceEvaluation{}, fmt.Errorf("retained simulation: %w", err)
			}
			retained.RetainedVar995 = ret.Var995
			retained.RetainedTvar99 = ret.Tvar99
		}
	}

	retained.DeltaVar995 = gross.Var995 - retained.RetainedVar995
	retained.DeltaTvar99 = gross.Tvar99 - retained.RetainedTvar99
	// Expected ceded (risk) premium in integer kobo; documented as net of
	// nothing — reinstatement/coding commissions are treaty-negotiation
	// data, not kernel inputs.
	retained.CededCostKobo = int64(math.Round(cededMean * 100.0))
	return retained, nil
}

// severityMeanCV extracts (mean, cv) from a severity spec for the families
// the LEV transform supports.
func severityMeanCV(l kernels.LineSimSpec) (mean, cv float64, ok bool) {
	switch l.SevDist {
	case SevGamma:
		return l.SevP1, l.SevP2, true
	case SevLognormal:
		// mean = exp(mu + sigma²/2); cv = sqrt(exp(sigma²) − 1)
		s2 := l.SevP2 * l.SevP2
		return math.Exp(l.SevP1 + s2/2), math.Sqrt(math.Exp(s2) - 1), true
	case SevTweedie:
		// Only p=0 (Normal) is transformable in closed form here.
		if l.SevP3 == 0 {
			return l.SevP1, math.Abs(l.SevP2 / l.SevP1), true
		}
		return 0, 0, false
	default:
		return 0, 0, false
	}
}

// setSeverityMean writes an adjusted mean back into a spec, preserving the
// family's dispersion parameters.
func setSeverityMean(l *kernels.LineSimSpec, mean, cv float64) {
	switch l.SevDist {
	case SevGamma:
		l.SevP1 = mean
		l.SevP2 = cv
	case SevLognormal:
		// Recompute (mu, sigma) from (mean, cv): sigma² = ln(1+cv²),
		// mu = ln(mean) − sigma²/2.
		s2 := math.Log(1 + cv*cv)
		l.SevP1 = math.Log(mean) - s2/2
		l.SevP2 = math.Sqrt(s2)
	case SevTweedie: // p == 0 → Normal(mean, sd)
		l.SevP1 = mean
		l.SevP2 = mean * cv
	}
}

// retainedSeverityMean computes E[min(X,a) + max(X−a−l, 0)] — the part of
// each claim the cedant keeps under a per-claim XoL layer [a, a+l).
func retainedSeverityMean(l kernels.LineSimSpec, mean, attachment, limit float64) float64 {
	levA := limitedExpectedValue(l, attachment)
	levAL := limitedExpectedValue(l, attachment+limit)
	// retained = E[X∧a] + (E[X] − E[X∧(a+l)])
	return levA + (mean - levAL)
}

// limitedExpectedValue returns E[min(X, a)] for the supported severity
// families (Gamma, Lognormal, Normal-via-Tweedie-p0). Pure closed-form
// math — no kernel involvement.
func limitedExpectedValue(l kernels.LineSimSpec, a float64) float64 {
	if a <= 0 {
		return 0
	}
	switch l.SevDist {
	case SevGamma:
		mean, cv := l.SevP1, l.SevP2
		if cv <= 0 {
			return math.Min(mean, a)
		}
		k := 1.0 / (cv * cv)
		theta := mean / k
		// E[X∧a] = kθ·P(k+1, a/θ) + a·(1 − P(k, a/θ))
		x := a / theta
		return k*theta*regularizedGammaP(k+1, x) + a*(1-regularizedGammaP(k, x))
	case SevLognormal:
		mu, sigma := l.SevP1, l.SevP2
		if sigma <= 0 {
			return math.Min(math.Exp(mu), a)
		}
		mean := math.Exp(mu + sigma*sigma/2)
		return mean*normalCDF((math.Log(a)-mu-sigma*sigma)/sigma) + a*(1-normalCDF((math.Log(a)-mu)/sigma))
	case SevTweedie: // p == 0 → Normal(mu=SevP1, sd=SevP2)
		mu, sd := l.SevP1, l.SevP2
		if sd <= 0 {
			return math.Min(mu, a)
		}
		z := (a - mu) / sd
		return mu*normalCDF(z) - sd*normalPDF(z) + a*(1-normalCDF(z))
	default:
		return 0
	}
}

// ─── special functions (stdlib-only, documented approximations) ──────────

func normalPDF(x float64) float64 {
	return math.Exp(-0.5*x*x) / math.Sqrt(2*math.Pi)
}

// normalCDF computes Φ(x) via the error function.
func normalCDF(x float64) float64 {
	return 0.5 * (1 + math.Erf(x/math.Sqrt2))
}

// regularizedGammaP computes P(k, x) = γ(k, x)/Γ(k) (lower regularized
// incomplete gamma) using the series expansion for x < k+1 and the
// continued fraction otherwise (Numerical Recipes §6.2).
func regularizedGammaP(k, x float64) float64 {
	if x <= 0 {
		return 0
	}
	if x < k+1 {
		// Series representation.
		sum := 1.0 / k
		term := sum
		for n := 1; n < 1000; n++ {
			term *= x / (k + float64(n))
			sum += term
			if math.Abs(term) < math.Abs(sum)*1e-15 {
				break
			}
		}
		return sum * math.Exp(-x+k*math.Log(x)-lgamma(k))
	}
	// Continued fraction for Q then complement.
	q := regularizedGammaQCF(k, x)
	return 1 - q
}

func regularizedGammaQCF(k, x float64) float64 {
	const tiny = 1e-300
	b := x + 1 - k
	c := 1 / tiny
	d := 1 / b
	h := d
	for i := 1; i < 1000; i++ {
		fi := float64(i)
		an := -fi * (fi - k)
		b += 2
		d = an*d + b
		if math.Abs(d) < tiny {
			d = tiny
		}
		c = b + an/c
		if math.Abs(c) < tiny {
			c = tiny
		}
		d = 1 / d
		delta := d * c
		h *= delta
		if math.Abs(delta-1) < 1e-15 {
			break
		}
	}
	return math.Exp(-x+k*math.Log(x)-lgamma(k)) * h
}

// lgamma wraps math.Lgamma (kept as a seam so the approximation is explicit).
func lgamma(x float64) float64 {
	v, _ := math.Lgamma(x)
	return v
}
