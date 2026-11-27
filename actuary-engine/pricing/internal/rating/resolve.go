package rating

import (
	"fmt"
	"math"
)

// DomainError is an out-of-model-domain failure during resolution: the
// quote carries a variable level the approved rating model has no
// relativity for (or omits a required dimension). Appendix I step 7 maps
// this to decision=refer — the service must never guess a relativity.
type DomainError struct {
	Detail string
}

func (e *DomainError) Error() string { return "out of model domain: " + e.Detail }

// Resolved carries the kernel-ready inputs for ak_premium_compose. The
// resolution is deterministic: sorted iteration everywhere, documented
// operation order, no rounding (the kernel owns the single rounding policy).
type Resolved struct {
	// BasePurePremium = exposures × E[frequency] × E[severity] in naira.
	BasePurePremium float64
	// Rels are the flattened multiplicative relativities in sorted
	// dimension order.
	Rels []float64

	Loadings Loadings
	Taxes    []TaxRate

	// Scoring detail for auditability (logged on every quote).
	FrequencyMean float64
	SeverityMean  float64
}

// Resolve scores a quote through the version's artefact and tables.
//
//	variables: one-hot scoring variables (e.g. {"age_band": "2", ...})
//	exposures: exposure units (e.g. vehicle-years)
//
// Out-of-domain failures (unknown relativity level, missing dimension) are
// returned as *DomainError; structural problems (bad artefact state) as
// plain errors — both are fail-closed at the service layer.
func (v *Version) Resolve(variables map[string]string, exposures float64) (Resolved, error) {
	if exposures < 0 || math.IsNaN(exposures) || math.IsInf(exposures, 0) {
		return Resolved{}, fmt.Errorf("exposures must be finite and >= 0, got %v", exposures)
	}
	freq := scoreBlock(v.Artefact.Frequency, variables)
	sev := scoreBlock(v.Artefact.Severity, variables)
	base := exposures * freq * sev
	if math.IsNaN(base) || math.IsInf(base, 0) {
		return Resolved{}, fmt.Errorf("pure premium non-finite (exposures=%v freq=%v sev=%v)", exposures, freq, sev)
	}

	dims := SortedDimensionKeys(v.Artefact.Relativities)
	rels := make([]float64, 0, len(dims))
	for _, dim := range dims {
		level, present := variables[dim]
		if !present || level == "" {
			return Resolved{}, &DomainError{
				Detail: fmt.Sprintf("quote is missing relativity dimension %q", dim),
			}
		}
		rel, ok := v.Artefact.Relativities[dim][level]
		if !ok {
			return Resolved{}, &DomainError{
				Detail: fmt.Sprintf("no relativity for %s[%s]", dim, level),
			}
		}
		rels = append(rels, rel)
	}

	return Resolved{
		BasePurePremium: base,
		Rels:            rels,
		Loadings:        v.Loadings,
		Taxes:           v.Taxes,
		FrequencyMean:   freq,
		SeverityMean:    sev,
	}, nil
}

// scoreBlock evaluates one GLM linear predictor with a log link:
//
//	mean = exp(intercept + Σ coef[variable[level]] for matched one-hot terms)
//
// Coefficient keys are iterated in sorted order so the floating-point sum is
// reproducible bit-for-bit across languages and runs (Appendix F
// determinism contract).
func scoreBlock(block GLMBlock, variables map[string]string) float64 {
	eta := 0.0
	for _, key := range SortedCoefficientKeys(block.Coefficients) {
		coef := block.Coefficients[key]
		if key == "intercept" {
			eta += coef
			continue
		}
		variable, level, ok := ParseCoefKey(key)
		if !ok {
			continue // unreachable: Validate() rejects malformed keys
		}
		if variables[variable] == level {
			eta += coef
		}
	}
	return math.Exp(eta)
}
