package rating

import (
	"errors"
	"math"
	"testing"
)

func motorArtefact() Artefact {
	return Artefact{
		ArtefactType: "freq_sev_glm",
		ProductLine:  "motor",
		Version:      "2026.09",
		Frequency: GLMBlock{
			Family: "poisson",
			Link:   "log",
			Coefficients: map[string]float64{
				"intercept":          -2.92,
				"age_band[2]":        0.31,
				"ncd[3]":             -0.25,
				"vehicle_class[suv]": 0.12,
			},
			BaseFrequency: 0.054,
		},
		Severity: GLMBlock{
			Family: "gamma",
			Link:   "log",
			Coefficients: map[string]float64{
				"intercept":            14.4326,
				"vehicle_class[truck]": 0.25,
			},
			BaseSeverityKobo: 185500000,
		},
		Relativities: map[string]map[string]float64{
			"territory": {"lagos_mainland": 1.18, "kano": 0.94},
		},
		ExposureUnit: "vehicle_year",
	}
}

func TestArtefactValidate(t *testing.T) {
	art := motorArtefact()
	if err := art.Validate(); err != nil {
		t.Fatalf("valid artefact rejected: %v", err)
	}

	bad := motorArtefact()
	bad.ArtefactType = "something_else"
	if err := bad.Validate(); err == nil {
		t.Error("wrong artefactType accepted")
	}

	bad = motorArtefact()
	bad.Frequency.Link = "identity"
	if err := bad.Validate(); err == nil {
		t.Error("non-log link accepted")
	}

	bad = motorArtefact()
	delete(bad.Frequency.Coefficients, "intercept")
	if err := bad.Validate(); err == nil {
		t.Error("missing intercept accepted")
	}

	bad = motorArtefact()
	bad.Frequency.Coefficients["badkey"] = 1
	if err := bad.Validate(); err == nil {
		t.Error("malformed coefficient key accepted")
	}

	bad = motorArtefact()
	bad.Relativities["territory"]["lagos_mainland"] = 0
	if err := bad.Validate(); err == nil {
		t.Error("zero relativity accepted")
	}

	bad = motorArtefact()
	bad.Severity.Coefficients["vehicle_class[truck]"] = math.NaN()
	if err := bad.Validate(); err == nil {
		t.Error("NaN coefficient accepted")
	}
}

func TestParseCoefKey(t *testing.T) {
	v, l, ok := ParseCoefKey("age_band[2]")
	if !ok || v != "age_band" || l != "2" {
		t.Errorf("got %q %q %v", v, l, ok)
	}
	if _, _, ok = ParseCoefKey("noinner"); ok {
		t.Error("key without brackets accepted")
	}
	if _, _, ok = ParseCoefKey("[level]"); ok {
		t.Error("empty variable accepted")
	}
	// Level may itself contain '[' — only the trailing ']' is structural.
	v, l, ok = ParseCoefKey("dim[a[b]")
	if !ok || v != "dim" || l != "a[b" {
		t.Errorf("nested bracket: got %q %q %v", v, l, ok)
	}
}

func TestResolveScoresOneHot(t *testing.T) {
	art := motorArtefact()
	v := &Version{Line: "motor", Version: "2026.09", Status: "approved", Artefact: art}

	vars := map[string]string{
		"age_band": "2", "ncd": "3", "vehicle_class": "suv", "territory": "lagos_mainland",
	}
	res, err := v.Resolve(vars, 1)
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	// freq = exp(-2.92 + 0.31 - 0.25 + 0.12), sev = exp(14.4326) — truck
	// term does NOT fire for suv.
	wantFreq := math.Exp(-2.92 + 0.31 - 0.25 + 0.12)
	wantSev := math.Exp(14.4326)
	if math.Abs(res.FrequencyMean-wantFreq) > 1e-12 {
		t.Errorf("freq = %v, want %v", res.FrequencyMean, wantFreq)
	}
	if math.Abs(res.SeverityMean-wantSev) > 1e-6 {
		t.Errorf("sev = %v, want %v", res.SeverityMean, wantSev)
	}
	wantBase := wantFreq * wantSev
	if math.Abs(res.BasePurePremium-wantBase) > 1e-6 {
		t.Errorf("base = %v, want %v", res.BasePurePremium, wantBase)
	}
	if len(res.Rels) != 1 || res.Rels[0] != 1.18 {
		t.Errorf("rels = %v, want [1.18]", res.Rels)
	}
}

func TestResolveDomainErrors(t *testing.T) {
	art := motorArtefact()
	v := &Version{Line: "motor", Version: "2026.09", Status: "approved", Artefact: art}

	// Unknown territory level → out of model domain.
	_, err := v.Resolve(map[string]string{"territory": "sokoto"}, 1)
	var de *DomainError
	if !errors.As(err, &de) {
		t.Errorf("unknown level: got %v, want DomainError", err)
	}

	// Missing required dimension → out of model domain.
	_, err = v.Resolve(map[string]string{"age_band": "2"}, 1)
	if !errors.As(err, &de) {
		t.Errorf("missing dimension: got %v, want DomainError", err)
	}

	// No relativity dimensions at all → fine for empty-rels lines.
	empty := art
	empty.Relativities = nil
	v2 := &Version{Line: "health", Version: "x", Status: "approved", Artefact: empty}
	res, err := v2.Resolve(map[string]string{}, 2)
	if err != nil {
		t.Fatalf("empty rels resolve failed: %v", err)
	}
	if len(res.Rels) != 0 {
		t.Errorf("rels = %v, want empty", res.Rels)
	}
}

func TestResolveDeterministicAcrossCalls(t *testing.T) {
	art := motorArtefact()
	v := &Version{Line: "motor", Version: "2026.09", Status: "approved", Artefact: art}
	vars := map[string]string{"age_band": "2", "ncd": "3", "vehicle_class": "suv", "territory": "kano"}
	r1, err1 := v.Resolve(vars, 1.5)
	r2, err2 := v.Resolve(vars, 1.5)
	if err1 != nil || err2 != nil {
		t.Fatal(err1)
	}
	if r1.BasePurePremium != r2.BasePurePremium {
		t.Errorf("resolve not bit-deterministic: %v vs %v", r1.BasePurePremium, r2.BasePurePremium)
	}
}

func TestSnapshotSingleActiveInvariant(t *testing.T) {
	snap := &Snapshot{
		Lines:    map[string]bool{"motor": true},
		Versions: map[string]*Version{},
	}
	v, managed, found := snap.ActiveVersion("motor")
	if v != nil || !managed || found {
		t.Errorf("managed-no-version lookup wrong: %v %v %v", v, managed, found)
	}
	if _, managed, _ := snap.ActiveVersion("unknown_line"); managed {
		t.Errorf("unknown line reported managed")
	}
	art := motorArtefact()
	snap.Versions["motor"] = &Version{Line: "motor", Version: "2026.09", Status: "approved", Artefact: art}
	if err := snap.Validate(); err != nil {
		t.Fatalf("snapshot validate failed: %v", err)
	}
	snap.Versions["motor"] = &Version{Line: "motor", Version: "2026.10", Status: "draft", Artefact: art}
	if err := snap.Validate(); err == nil {
		t.Error("non-approved version in active map accepted")
	}
}

func TestLoadingsValidate(t *testing.T) {
	l := Loadings{ExpenseRatio: 0.2, CommissionRate: 0.1, ProfitMargin: 0.05}
	if err := l.Validate(); err != nil {
		t.Fatalf("valid loadings rejected: %v", err)
	}
	if l.MaxKoboOrDefault() != math.MaxInt64 {
		t.Error("unbounded max not defaulted")
	}
	l2 := Loadings{ExpenseRatio: 0.6, CommissionRate: 0.3, ProfitMargin: 0.15}
	if err := l2.Validate(); err == nil {
		t.Error("loadings >= 1 accepted")
	}
	l3 := Loadings{ExpenseRatio: 0.1, MinPremiumKobo: 100, MaxPremiumKobo: 50}
	if err := l3.Validate(); err == nil {
		t.Error("max < min accepted")
	}
}
