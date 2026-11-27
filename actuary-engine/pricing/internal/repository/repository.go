// Package repository is the PostgreSQL boundary of the pricing service
// (lib/pq, matching reinsurance-management per Appendix D). It owns every
// read/write of the act_* tables (Leg D schema) and builds the immutable
// boot payloads (rating snapshot, exposure limits, referral rules,
// accumulation seeds). Two implementations share the build logic:
//   - PG      — production, database/sql over lib/pq;
//   - Fixture — the same boot payloads loaded from a checked-in JSON seed
//     (used by tests and the dev seed utility).
package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/unified-insurance/actuary-engine/pricing/internal/exposure"
	"github.com/unified-insurance/actuary-engine/pricing/internal/models"
	"github.com/unified-insurance/actuary-engine/pricing/internal/rating"
	"github.com/unified-insurance/actuary-engine/pricing/internal/referral"
)

// ErrNotFound is returned when a referral case or version id is unknown.
var ErrNotFound = errors.New("not found")

// ErrConflict is returned when a state transition is not allowed from the
// current state (e.g. deciding an already-decided referral).
var ErrConflict = errors.New("conflicting state")

// Boot is everything the service loads once at start (and re-loads on
// rate-version activation).
type Boot struct {
	Lines      []string
	Versions   []*rating.Version
	Limits     map[string]*exposure.Limits
	Rules      []referral.Rule
	AccumSeeds map[string]int64 // redis key → kobo
}

// Store is the persistence contract used by the service.
type Store interface {
	// Ping verifies connectivity (readyz).
	Ping(ctx context.Context) error
	// LoadBoot loads the full boot payload.
	LoadBoot(ctx context.Context) (*Boot, error)

	// ListReferrals returns the referral worklist filtered by status
	// ("" = all statuses).
	ListReferrals(ctx context.Context, status string) ([]models.ReferralCase, error)
	// InsertReferral records a referral case; a duplicate quoteRef is
	// idempotent (returns the existing row's id).
	InsertReferral(ctx context.Context, quoteRef, line string, reasonCodes []string) (int64, error)
	// DecideReferral flips an open referral to accepted|declined.
	// ErrNotFound when unknown, ErrConflict when already decided.
	DecideReferral(ctx context.Context, id int64, decision string, underwriterID *int64) error

	// LatestCapitalSummary reads the latest approved capital runs
	// (naicom_rbc + internal_ec). found=false when no approved run exists.
	LatestCapitalSummary(ctx context.Context) (summary *models.CapitalSummary, found bool, err error)

	// InsertAdequacyAlert persists an amber/red adequacy breach.
	InsertAdequacyAlert(ctx context.Context, line, period string, pricedLR, actualLR float64, severity string) error

	// ActivateRateVersion atomically approves one version and retires its
	// line's previously approved versions (single-active invariant,
	// Appendix D). The target must be in filing status (the Leg D
	// naicomFilingRef gate happens at the filing transition).
	ActivateRateVersion(ctx context.Context, id int64) error
}

// ─── shared boot-payload construction ──────────────────────────────────────

// VersionRow is one act_rate_versions row with its rating tables.
type VersionRow struct {
	ID            int64
	Line          string
	Version       string
	Status        string
	EffectiveFrom *time.Time
	EffectiveTo   *time.Time
	// Tables maps tableType (base|relativity|territory|loading|tax) to the
	// raw jsonb payload.
	Tables map[string]json.RawMessage
}

// BuildVersion assembles a rating.Version from a row: the base payload is
// the Appendix F GLM artefact (validated); relativity/territory payloads
// merge extra relativity dimensions; loading/tax payloads decode into
// kernel inputs. Structural problems are errors — a malformed version is
// rejected at load, never partially scored (fail-closed at import).
func BuildVersion(row VersionRow) (*rating.Version, error) {
	base, ok := row.Tables["base"]
	if !ok {
		return nil, fmt.Errorf("version %s/%s: missing base rating table", row.Line, row.Version)
	}
	var art rating.Artefact
	if err := json.Unmarshal(base, &art); err != nil {
		return nil, fmt.Errorf("version %s/%s: base payload is not a GLM artefact: %w", row.Line, row.Version, err)
	}
	if err := art.Validate(); err != nil {
		return nil, fmt.Errorf("version %s/%s: artefact invalid: %w", row.Line, row.Version, err)
	}
	if art.Relativities == nil {
		art.Relativities = map[string]map[string]float64{}
	}

	// Additional relativity dimensions: nested {dim: {level: mult}}.
	if raw, ok := row.Tables["relativity"]; ok {
		var extra map[string]map[string]float64
		if err := json.Unmarshal(raw, &extra); err != nil {
			return nil, fmt.Errorf("version %s/%s: relativity payload malformed: %w", row.Line, row.Version, err)
		}
		for dim, table := range extra {
			if _, exists := art.Relativities[dim]; exists {
				return nil, fmt.Errorf("version %s/%s: duplicate relativity dimension %q", row.Line, row.Version, dim)
			}
			art.Relativities[dim] = table
		}
	}
	// Territory table: flat {level: mult} merged under the "territory"
	// dimension (portal authoring convention for geo relativities).
	if raw, ok := row.Tables["territory"]; ok {
		var flat map[string]float64
		if err := json.Unmarshal(raw, &flat); err != nil {
			return nil, fmt.Errorf("version %s/%s: territory payload malformed: %w", row.Line, row.Version, err)
		}
		if _, exists := art.Relativities["territory"]; exists {
			return nil, fmt.Errorf("version %s/%s: territory table duplicates artefact territory block", row.Line, row.Version)
		}
		art.Relativities["territory"] = flat
	}
	if err := art.Validate(); err != nil {
		return nil, fmt.Errorf("version %s/%s: merged artefact invalid: %w", row.Line, row.Version, err)
	}

	var loadings rating.Loadings
	if raw, ok := row.Tables["loading"]; ok {
		if err := json.Unmarshal(raw, &loadings); err != nil {
			return nil, fmt.Errorf("version %s/%s: loading payload malformed: %w", row.Line, row.Version, err)
		}
	}
	if err := loadings.Validate(); err != nil {
		return nil, fmt.Errorf("version %s/%s: %w", row.Line, row.Version, err)
	}

	var taxes []rating.TaxRate
	if raw, ok := row.Tables["tax"]; ok {
		if err := json.Unmarshal(raw, &taxes); err != nil {
			return nil, fmt.Errorf("version %s/%s: tax payload malformed: %w", row.Line, row.Version, err)
		}
		for _, t := range taxes {
			if t.Code == "" || math.IsNaN(t.Rate) || math.IsInf(t.Rate, 0) || t.Rate <= -1 {
				return nil, fmt.Errorf("version %s/%s: tax entry invalid", row.Line, row.Version)
			}
		}
	}

	return &rating.Version{
		ID:            row.ID,
		Line:          row.Line,
		Version:       row.Version,
		Status:        row.Status,
		EffectiveFrom: row.EffectiveFrom,
		EffectiveTo:   row.EffectiveTo,
		Artefact:      art,
		Loadings:      loadings,
		Taxes:         taxes,
	}, nil
}

// BuildSnapshot assembles the immutable rating snapshot, enforcing the
// single-active invariant: two approved versions for one line is a load
// failure (boot fails closed, never picks one arbitrarily).
func BuildSnapshot(lines []string, rows []VersionRow) (*rating.Snapshot, error) {
	snap := &rating.Snapshot{
		Lines:    map[string]bool{},
		Versions: map[string]*rating.Version{},
	}
	for _, code := range lines {
		snap.Lines[code] = true
	}
	for _, row := range rows {
		v, err := BuildVersion(row)
		if err != nil {
			return nil, err
		}
		if !snap.Lines[v.Line] {
			return nil, fmt.Errorf("rate version %d references unregistered line %q", row.ID, v.Line)
		}
		snap.All = append(snap.All, v)
		if v.Status == "approved" {
			if _, dup := snap.Versions[v.Line]; dup {
				return nil, fmt.Errorf("line %s has multiple approved rate versions", v.Line)
			}
			snap.Versions[v.Line] = v
		}
	}
	if err := snap.Validate(); err != nil {
		return nil, err
	}
	return snap, nil
}

// ─── money helpers ─────────────────────────────────────────────────────────

// ParseKobo converts a PG numeric(18,2) textual value to integer kobo,
// rounding half-away-from-zero at sub-kobo precision (matches the kernel
// rounding policy; DB values are 2dp so this is exact in practice).
func ParseKobo(raw string) (int64, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return 0, errors.New("empty numeric")
	}
	neg := false
	if strings.HasPrefix(s, "-") {
		neg = true
		s = s[1:]
	} else if strings.HasPrefix(s, "+") {
		s = s[1:]
	}
	if strings.ContainsAny(s, "-+") {
		return 0, fmt.Errorf("numeric %q: misplaced sign", raw)
	}
	intPart, fracPart, _ := strings.Cut(s, ".")
	if intPart == "" {
		intPart = "0"
	}
	intVal, err := strconv.ParseInt(intPart, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("numeric %q: bad integer part: %w", raw, err)
	}
	if intVal > math.MaxInt64/100-1 {
		return 0, fmt.Errorf("numeric %q overflows int64 kobo", raw)
	}
	kobo := intVal * 100
	if fracPart != "" {
		if len(fracPart) > 8 {
			fracPart = fracPart[:8]
		}
		for len(fracPart) < 2 {
			fracPart += "0"
		}
		frac, err := strconv.ParseInt(fracPart, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("numeric %q: bad fraction: %w", raw, err)
		}
		// Scale frac (10^len digits) to kobo (10^2), rounding half away.
		scale := int64(1)
		for i := 2; i < len(fracPart); i++ {
			scale *= 10
		}
		rem := frac % scale
		whole := frac / scale
		kobo += whole
		if rem*2 >= scale {
			kobo++
		}
	}
	if neg {
		kobo = -kobo
	}
	return kobo, nil
}

// KoboToNaira converts integer kobo to NGN major units for response
// payloads that use majors (Leg D accumulation cell).
func KoboToNaira(kobo int64) float64 { return float64(kobo) / 100.0 }

// NairaToKobo converts a NGN major-unit amount to kobo, rounding
// half-away-from-zero (same policy as the kernel; used at the request
// boundary where adapters send majors).
func NairaToKobo(naira float64) (int64, error) {
	if math.IsNaN(naira) || math.IsInf(naira, 0) {
		return 0, fmt.Errorf("amount must be finite")
	}
	if math.Abs(naira) > float64(math.MaxInt64)/100.0/2 {
		return 0, fmt.Errorf("amount out of range")
	}
	return int64(math.Round(naira * 100.0)), nil
}
