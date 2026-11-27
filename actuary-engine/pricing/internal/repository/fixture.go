package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"sync"
	"time"

	"github.com/unified-insurance/actuary-engine/pricing/internal/exposure"
	"github.com/unified-insurance/actuary-engine/pricing/internal/models"
	"github.com/unified-insurance/actuary-engine/pricing/internal/referral"
)

// FixtureSeed is the checked-in JSON seed format (testdata/seed). It feeds
// the same boot payload the PG store reads from act_* tables — the rating
// snapshot build path is shared, so tests exercise the real loader logic.
type FixtureSeed struct {
	Lines []struct {
		Code string `json:"code"`
	} `json:"lines"`
	RateVersions []struct {
		ID            int64                      `json:"id"`
		Line          string                     `json:"line"`
		Version       string                     `json:"version"`
		Status        string                     `json:"status"`
		EffectiveFrom *string                    `json:"effectiveFrom,omitempty"`
		EffectiveTo   *string                    `json:"effectiveTo,omitempty"`
		Tables        map[string]json.RawMessage `json:"tables"`
	} `json:"rateVersions"`
	ExposureLimits []struct {
		Line                string           `json:"line"`
		MaxSumInsuredKobo   int64            `json:"maxSumInsuredKobo,omitempty"`
		MaxPremiumKobo      int64            `json:"maxPremiumKobo,omitempty"`
		MaxAggregateKobo    int64            `json:"maxAggregateKobo,omitempty"`
		GeoAccumulationKobo map[string]int64 `json:"geoAccumulationKobo,omitempty"`
	} `json:"exposureLimits"`
	ReferralRules []struct {
		ID         int64           `json:"id"`
		Line       string          `json:"line"`
		Predicate  json.RawMessage `json:"predicate"`
		Action     string          `json:"action"`
		ReasonCode string          `json:"reasonCode"`
		Priority   int             `json:"priority"`
		IsActive   bool            `json:"isActive"`
	} `json:"referralRules"`
	AccumulationSeeds map[string]int64 `json:"accumulationSeeds"`
	CapitalSummary    *struct {
		Required  float64 `json:"required"`
		Available float64 `json:"available"`
		Var995    float64 `json:"var995"`
		Tvar99    float64 `json:"tvar99"`
		PerLine   []struct {
			Line   string  `json:"line"`
			Tvar99 float64 `json:"tvar99"`
		} `json:"perLine"`
		AsOf string `json:"asOf"`
	} `json:"capitalSummary,omitempty"`
}

// Fixture is a Store backed by a FixtureSeed plus in-memory
// referrals/alerts. It is the test/dev implementation of the same contract
// PG satisfies in production.
type Fixture struct {
	seed FixtureSeed

	mu        sync.Mutex
	nextRefID int64
	referrals []models.ReferralCase
	alerts    []AdequacyAlertRecord
}

// AdequacyAlertRecord is one recorded adequacy breach (test assertions).
type AdequacyAlertRecord struct {
	Line     string
	Period   string
	PricedLR float64
	ActualLR float64
	Severity string
}

// LoadFixture parses and validates a seed file.
func LoadFixture(path string) (*Fixture, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var seed FixtureSeed
	if err := json.Unmarshal(raw, &seed); err != nil {
		return nil, fmt.Errorf("seed %s malformed: %w", path, err)
	}
	f := &Fixture{seed: seed}
	// Validate eagerly: the boot payload must build cleanly (fail-closed at
	// load, same contract as PG.LoadBoot).
	if _, err := f.LoadBoot(context.Background()); err != nil {
		return nil, fmt.Errorf("seed %s: %w", path, err)
	}
	return f, nil
}

// Ping implements Store.
func (f *Fixture) Ping(_ context.Context) error { return nil }

// LoadBoot implements Store.
func (f *Fixture) LoadBoot(_ context.Context) (*Boot, error) {
	boot := &Boot{AccumSeeds: map[string]int64{}}
	seen := map[string]bool{}
	for _, l := range f.seed.Lines {
		if seen[l.Code] {
			return nil, fmt.Errorf("duplicate line %q", l.Code)
		}
		seen[l.Code] = true
		boot.Lines = append(boot.Lines, l.Code)
	}

	var rows []VersionRow
	for _, v := range f.seed.RateVersions {
		row := VersionRow{
			ID: v.ID, Line: v.Line, Version: v.Version, Status: v.Status, Tables: v.Tables,
		}
		if v.EffectiveFrom != nil {
			if t, err := time.Parse(time.RFC3339, *v.EffectiveFrom); err == nil {
				row.EffectiveFrom = &t
			}
		}
		if v.EffectiveTo != nil {
			if t, err := time.Parse(time.RFC3339, *v.EffectiveTo); err == nil {
				row.EffectiveTo = &t
			}
		}
		rows = append(rows, row)
	}
	snap, err := BuildSnapshot(boot.Lines, rows)
	if err != nil {
		return nil, err
	}
	boot.Versions = snap.All

	boot.Limits = map[string]*exposure.Limits{}
	for _, l := range f.seed.ExposureLimits {
		boot.Limits[l.Line] = &exposure.Limits{
			MaxSumInsuredKobo:   l.MaxSumInsuredKobo,
			MaxPremiumKobo:      l.MaxPremiumKobo,
			MaxAggregateKobo:    l.MaxAggregateKobo,
			GeoAccumulationKobo: l.GeoAccumulationKobo,
		}
	}
	for _, r := range f.seed.ReferralRules {
		boot.Rules = append(boot.Rules, referral.Rule{
			ID: r.ID, Line: r.Line, Predicate: r.Predicate, Action: r.Action,
			ReasonCode: r.ReasonCode, Priority: r.Priority, IsActive: r.IsActive,
		})
	}
	for k, v := range f.seed.AccumulationSeeds {
		boot.AccumSeeds[k] = v
	}
	return boot, nil
}

// ListReferrals implements Store.
func (f *Fixture) ListReferrals(_ context.Context, status string) ([]models.ReferralCase, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []models.ReferralCase
	for i := len(f.referrals) - 1; i >= 0; i-- {
		c := f.referrals[i]
		if status == "" || c.Status == status {
			out = append(out, c)
		}
	}
	return out, nil
}

// InsertReferral implements Store (idempotent on quoteRef).
func (f *Fixture) InsertReferral(_ context.Context, quoteRef, line string, reasonCodes []string) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.referrals {
		if c.QuoteRef == quoteRef {
			return c.ID, nil
		}
	}
	f.nextRefID++
	codes := append([]string{}, reasonCodes...)
	sort.Strings(codes)
	f.referrals = append(f.referrals, models.ReferralCase{
		ID:          f.nextRefID,
		QuoteRef:    quoteRef,
		ProductLine: line,
		ReasonCodes: codes,
		Status:      "open",
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	})
	return f.nextRefID, nil
}

// DecideReferral implements Store.
func (f *Fixture) DecideReferral(_ context.Context, id int64, decision string, underwriterID *int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	_ = underwriterID
	for i, c := range f.referrals {
		if c.ID == id {
			if c.Status != "open" {
				return ErrConflict
			}
			f.referrals[i].Status = decision
			return nil
		}
	}
	return ErrNotFound
}

// LatestCapitalSummary implements Store.
func (f *Fixture) LatestCapitalSummary(_ context.Context) (*models.CapitalSummary, bool, error) {
	if f.seed.CapitalSummary == nil {
		return nil, false, nil
	}
	cs := f.seed.CapitalSummary
	summary := &models.CapitalSummary{AsOf: cs.AsOf, Status: "approved"}
	summary.NaicomRBC.Required = cs.Required
	summary.NaicomRBC.Available = cs.Available
	if cs.Required != 0 {
		summary.NaicomRBC.Ratio = cs.Available / cs.Required
	}
	summary.EC.Var995 = cs.Var995
	summary.EC.Tvar99 = cs.Tvar99
	for _, pl := range cs.PerLine {
		var entry struct {
			Line   string  `json:"line"`
			Tvar99 float64 `json:"tvar99"`
		}
		entry.Line = pl.Line
		entry.Tvar99 = pl.Tvar99
		summary.EC.PerLine = append(summary.EC.PerLine, entry)
	}
	return summary, true, nil
}

// InsertAdequacyAlert implements Store.
func (f *Fixture) InsertAdequacyAlert(_ context.Context, line, period string, pricedLR, actualLR float64, severity string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.alerts = append(f.alerts, AdequacyAlertRecord{
		Line: line, Period: period, PricedLR: pricedLR, ActualLR: actualLR, Severity: severity,
	})
	return nil
}

// Alerts returns the recorded adequacy alerts (test assertions).
func (f *Fixture) Alerts() []AdequacyAlertRecord {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]AdequacyAlertRecord{}, f.alerts...)
}

// ActivateRateVersion implements Store (in-memory single-active).
func (f *Fixture) ActivateRateVersion(_ context.Context, id int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	idx := -1
	var line string
	for i, v := range f.seed.RateVersions {
		if v.ID == id {
			idx = i
			line = v.Line
		}
	}
	if idx < 0 {
		return ErrNotFound
	}
	if f.seed.RateVersions[idx].Status != "filing" {
		return fmt.Errorf("%w: version %d is %q, only filing → approved activation is allowed",
			ErrConflict, id, f.seed.RateVersions[idx].Status)
	}
	for i, v := range f.seed.RateVersions {
		if v.Line == line && v.Status == "approved" {
			f.seed.RateVersions[i].Status = "retired"
		}
	}
	f.seed.RateVersions[idx].Status = "approved"
	return nil
}
