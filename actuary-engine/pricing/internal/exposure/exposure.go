// Package exposure enforces the per-product de-risking ceilings (design
// §4.g, Appendix I step 4): max sum insured per risk, max per-policy
// premium, max aggregate live exposure per line, and per-geo-cell
// accumulation ceilings. Limits are data (act_exposure_limits), never
// hardcoded; a line without a limits row is unbounded by construction.
package exposure

import (
	"sync/atomic"

	"github.com/unified-insurance/actuary-engine/pricing/internal/models"
)

// Limits is one line's exposure-limit row (act_exposure_limits). Money is
// integer kobo. Zero means "no limit set" for each field.
type Limits struct {
	MaxSumInsuredKobo   int64
	MaxPremiumKobo      int64
	MaxAggregateKobo    int64
	GeoAccumulationKobo map[string]int64 // geoCell → ceiling
}

// GeoLimit returns the geo-cell ceiling for a cell (0 = unbounded / no
// ceiling configured).
func (l *Limits) GeoLimit(geoCell string) int64 {
	if l == nil || l.GeoAccumulationKobo == nil {
		return 0
	}
	return l.GeoAccumulationKobo[geoCell]
}

// Set is the immutable per-line limits map, swapped atomically like the
// rating snapshot.
type Set struct {
	byLine map[string]*Limits
}

// NewSet builds an immutable Set.
func NewSet(byLine map[string]*Limits) *Set { return &Set{byLine: byLine} }

// ForLine returns the limits for a line, or nil when none are configured.
func (s *Set) ForLine(line string) *Limits {
	if s == nil {
		return nil
	}
	return s.byLine[line]
}

// Store is the atomic holder for the live limits Set.
type Store struct{ cur atomic.Pointer[Set] }

// NewStore returns an empty store.
func NewStore() *Store { return &Store{} }

// Current returns the live set (may be nil before boot load).
func (s *Store) Current() *Set { return s.cur.Load() }

// Swap atomically publishes a successor set.
func (s *Store) Swap(set *Set) { s.cur.Store(set) }

// Check evaluates the pre-rating per-risk ceiling (Appendix I step 4) and
// the per-policy ceiling against a quoted premium. Returns the breached
// reason codes (empty = within limits). Breaches are hard ceilings:
// decision=decline at the service layer, never silent accept.
func Check(l *Limits, sumInsuredKobo, premiumKobo int64) []string {
	var breaches []string
	if l == nil {
		return breaches
	}
	if l.MaxSumInsuredKobo > 0 && sumInsuredKobo > l.MaxSumInsuredKobo {
		breaches = append(breaches, models.ReasonLimitSumInsured)
	}
	if l.MaxPremiumKobo > 0 && premiumKobo > 0 && premiumKobo > l.MaxPremiumKobo {
		breaches = append(breaches, models.ReasonLimitMaxPremium)
	}
	return breaches
}

// CheckPreRates evaluates only the inputs available before rating
// (sum insured). Used by POST /v1/exposure/check and by the rate flow at
// step 4.
func CheckPreRates(l *Limits, sumInsuredKobo int64) []string {
	return Check(l, sumInsuredKobo, 0)
}
