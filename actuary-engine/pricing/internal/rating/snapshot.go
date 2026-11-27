package rating

import (
	"fmt"
	"sync/atomic"
	"time"
)

// Version is one approved rate version with its rating tables resolved into
// scoring-ready form. Built once at boot (or at activation reload) and
// treated as immutable thereafter — the rating path never locks (Appendix D:
// "Reload of a newly activated rate version is an atomic snapshot swap (no
// lock on the rating path)").
type Version struct {
	ID            int64
	Line          string
	Version       string
	Status        string
	EffectiveFrom *time.Time
	EffectiveTo   *time.Time

	Artefact Artefact
	Loadings Loadings
	Taxes    []TaxRate
}

// Snapshot is an immutable view of all approved rate versions plus the
// product-line registry. A line present in Lines but absent from Versions
// is a *managed* line with no approved version — rating it must fail closed
// (503), never guess (Appendix D boot-sequence contract).
type Snapshot struct {
	// Lines is the set of actuarially-managed product line codes.
	Lines map[string]bool
	// Versions holds the single approved rate version per line.
	Versions map[string]*Version
	// All carries every rate version (any status) for the versions
	// endpoint, in stable id order.
	All []*Version
}

// ActiveVersion returns the approved version for a line.
//   - (v, true, true)  — line is managed and has an approved version
//   - (nil, true, false) — managed line, no approved version (fail-closed)
//   - (nil, false, false) — unknown line (not actuarially managed)
func (s *Snapshot) ActiveVersion(line string) (v *Version, managed bool, found bool) {
	ver, ok := s.Versions[line]
	if ok {
		return ver, true, true
	}
	return nil, s.Lines[line], false
}

// VersionByID looks up a version row by primary key.
func (s *Snapshot) VersionByID(id int64) *Version {
	for _, v := range s.All {
		if v.ID == id {
			return v
		}
	}
	return nil
}

// Store is the atomic snapshot holder. Readers load the pointer once per
// request; activations swap in a fully-built successor snapshot.
type Store struct {
	cur atomic.Pointer[Snapshot]
}

// NewStore returns an empty store (boot state: everything fails closed).
func NewStore() *Store { return &Store{} }

// Current returns the live snapshot, or nil if none has been loaded yet
// (pre-boot; readyz reports not-ready and rating fails closed).
func (s *Store) Current() *Snapshot { return s.cur.Load() }

// Swap atomically publishes a successor snapshot.
func (s *Store) Swap(snap *Snapshot) { s.cur.Store(snap) }

// Loaded reports whether any snapshot has been published.
func (s *Store) Loaded() bool { return s.cur.Load() != nil }

// Validate checks the snapshot for structural sanity: approved versions
// must carry a valid artefact, valid loadings and non-negative taxes. Called
// at boot/reload so a bad row can never reach the hot path.
func (s *Snapshot) Validate() error {
	for line, v := range s.Versions {
		if v.Status != "approved" {
			return fmt.Errorf("line %s: non-approved version %q in active map", line, v.Version)
		}
		if err := v.Artefact.Validate(); err != nil {
			return fmt.Errorf("line %s version %s: artefact invalid: %w", line, v.Version, err)
		}
		if v.Artefact.ProductLine != line {
			return fmt.Errorf("line %s version %s: artefact productLine %q mismatch", line, v.Version, v.Artefact.ProductLine)
		}
		if err := v.Loadings.Validate(); err != nil {
			return fmt.Errorf("line %s version %s: %w", line, v.Version, err)
		}
		for _, t := range v.Taxes {
			if t.Rate <= -1.0 {
				return fmt.Errorf("line %s version %s: tax %s rate must be > -1", line, v.Version, t.Code)
			}
		}
	}
	return nil
}
