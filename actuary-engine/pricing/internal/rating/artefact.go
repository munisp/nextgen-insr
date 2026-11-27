// Package rating owns the versioned rating model: GLM model-artefact
// validation (Appendix F), immutable in-memory snapshots of approved rate
// versions + rating tables (Appendix D boot sequence), and the deterministic
// resolution of a quote's variables into kernel inputs (base pure premium +
// flattened multiplicative relativities + loadings + taxes).
//
// The resolution is pure f64 arithmetic with a documented order — the same
// artefact scored through this package must produce byte-identical kernel
// inputs in every language (Appendix F cross-language determinism check).
package rating

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

// ─── GLM model artefact (Appendix F schema) ────────────────────────────────

// Artefact is the freq/sev GLM model artefact exported by the Python
// trainer and stored as the payload of the rate version's "base" rating
// table. The Go loader validates it at import (Appendix F: "Go loader
// validates the artefact against a JSON-Schema at import; kernel receives
// only resolved numbers").
type Artefact struct {
	ArtefactType string `json:"artefactType"`
	ProductLine  string `json:"productLine"`
	Version      string `json:"version"`

	Frequency GLMBlock `json:"frequency"`
	Severity  GLMBlock `json:"severity"`

	// Relativities holds multiplicative relativities for dimensions NOT in
	// the GLM linear predictors (e.g. territory). Outer key = dimension,
	// inner key = level. Looked up exactly; a missing level is an
	// out-of-model-domain failure (fail-closed).
	Relativities map[string]map[string]float64 `json:"relativities"`

	ExposureUnit string `json:"exposureUnit"`
}

// GLMBlock is one linear predictor of the freq/sev GLM. With a log link the
// expected value is exp(intercept + Σ matched coefficients); coefficient
// keys are "variable[level]" one-hot terms ("intercept" is the base level).
type GLMBlock struct {
	Family       string             `json:"family"`
	Link         string             `json:"link"`
	Coefficients map[string]float64 `json:"coefficients"`
	// BaseFrequency / BaseSeverityKobo are documentation/cross-check fields
	// recorded by the trainer: the expected value at base level.
	BaseFrequency    float64 `json:"base_frequency,omitempty"`
	BaseSeverityKobo int64   `json:"base_severity_kobo,omitempty"`
}

var (
	errArtefactType   = errors.New("artefactType must be \"freq_sev_glm\"")
	supportedFamilies = map[string]bool{
		"poisson": true, "gamma": true, "lognormal": true, "tweedie": true,
	}
)

// Validate checks the artefact against the Appendix F structural schema.
// It is deliberately strict: a malformed artefact must never reach the
// scoring path (fail-closed at import, not at quote time).
func (a *Artefact) Validate() error {
	if a.ArtefactType != "freq_sev_glm" {
		return errArtefactType
	}
	if a.ProductLine == "" {
		return errors.New("productLine is required")
	}
	if a.Version == "" {
		return errors.New("version is required")
	}
	if a.ExposureUnit == "" {
		return errors.New("exposureUnit is required")
	}
	if err := a.Frequency.validate("frequency"); err != nil {
		return err
	}
	if err := a.Severity.validate("severity"); err != nil {
		return err
	}
	if a.Frequency.BaseFrequency < 0 {
		return errors.New("frequency.base_frequency must be >= 0")
	}
	if a.Severity.BaseSeverityKobo < 0 {
		return errors.New("severity.base_severity_kobo must be >= 0")
	}
	for dim, table := range a.Relativities {
		if dim == "" {
			return errors.New("relativities: empty dimension name")
		}
		if len(table) == 0 {
			return fmt.Errorf("relativities[%q]: empty table", dim)
		}
		for level, rel := range table {
			if level == "" {
				return fmt.Errorf("relativities[%q]: empty level key", dim)
			}
			if math.IsNaN(rel) || math.IsInf(rel, 0) || rel <= 0 {
				return fmt.Errorf("relativities[%q][%q]: relativity must be finite and > 0", dim, level)
			}
		}
	}
	return nil
}

func (g *GLMBlock) validate(name string) error {
	if !supportedFamilies[g.Family] {
		return fmt.Errorf("%s.family %q unsupported", name, g.Family)
	}
	if g.Link != "log" {
		return fmt.Errorf("%s.link %q unsupported (only log link is scored)", name, g.Link)
	}
	if len(g.Coefficients) == 0 {
		return fmt.Errorf("%s.coefficients is empty", name)
	}
	if _, ok := g.Coefficients["intercept"]; !ok {
		return fmt.Errorf("%s.coefficients lacks intercept", name)
	}
	for key, coef := range g.Coefficients {
		if math.IsNaN(coef) || math.IsInf(coef, 0) {
			return fmt.Errorf("%s.coefficients[%q] must be finite", name, key)
		}
		if key != "intercept" {
			if _, _, ok := ParseCoefKey(key); !ok {
				return fmt.Errorf("%s.coefficients[%q]: want \"variable[level]\" format", name, key)
			}
		}
	}
	return nil
}

// ParseCoefKey splits a one-hot coefficient key "variable[level]" into its
// variable and level. The level may itself contain '[' (only the first '['
// and the trailing ']' are structural).
func ParseCoefKey(key string) (variable, level string, ok bool) {
	open := strings.IndexByte(key, '[')
	if open <= 0 || !strings.HasSuffix(key, "]") {
		return "", "", false
	}
	return key[:open], key[open+1 : len(key)-1], true
}

// ─── Loadings / taxes / limits payloads ────────────────────────────────────

// Loadings is the "loading" rating-table payload: gross-premium fractions
// plus the per-policy premium clamps (kernel signature, Appendix C).
type Loadings struct {
	ExpenseRatio   float64 `json:"expenseRatio"`
	CommissionRate float64 `json:"commissionRate"`
	ProfitMargin   float64 `json:"profitMargin"`
	MinPremiumKobo int64   `json:"minPremiumKobo,omitempty"`
	MaxPremiumKobo int64   `json:"maxPremiumKobo,omitempty"` // 0 = unbounded
}

// Validate enforces the kernel's input contract at import time.
func (l Loadings) Validate() error {
	for name, v := range map[string]float64{
		"expenseRatio": l.ExpenseRatio, "commissionRate": l.CommissionRate, "profitMargin": l.ProfitMargin,
	} {
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
			return fmt.Errorf("loadings.%s must be finite and >= 0", name)
		}
	}
	if l.ExpenseRatio+l.CommissionRate+l.ProfitMargin >= 1.0 {
		return errors.New("loadings fractions must sum to < 1")
	}
	if l.MinPremiumKobo < 0 {
		return errors.New("minPremiumKobo must be >= 0")
	}
	if l.MaxPremiumKobo != 0 && l.MaxPremiumKobo < l.MinPremiumKobo {
		return errors.New("maxPremiumKobo must be >= minPremiumKobo (or 0 = unbounded)")
	}
	return nil
}

// MaxKoboOrDefault resolves the unbounded marker to the kernel's "no clamp"
// convention.
func (l Loadings) MaxKoboOrDefault() int64 {
	if l.MaxPremiumKobo == 0 {
		return math.MaxInt64
	}
	return l.MaxPremiumKobo
}

// TaxRate is one entry of the "tax" rating-table payload: additive
// statutory taxes/levies applied to gross (Nigerian VAT, NAICOM/NIA levies
// per class — design §4.a).
type TaxRate struct {
	Code string  `json:"code"`
	Rate float64 `json:"rate"`
}

// SortedDimensionKeys returns relativity dimensions in deterministic
// (sorted) order — the relativity slice order is part of the cross-language
// determinism contract.
func SortedDimensionKeys(m map[string]map[string]float64) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// SortedCoefficientKeys returns coefficient keys in deterministic order.
func SortedCoefficientKeys(m map[string]float64) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
