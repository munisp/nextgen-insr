package exposure

import (
	"testing"

	"github.com/unified-insurance/actuary-engine/pricing/internal/models"
)

func TestCheckBreaches(t *testing.T) {
	l := &Limits{MaxSumInsuredKobo: 5_000_000_000, MaxPremiumKobo: 500_000_000}
	if got := Check(l, 4_000_000_000, 400_000_000); len(got) != 0 {
		t.Errorf("within limits: got %v", got)
	}
	got := Check(l, 5_000_000_001, 0)
	if len(got) != 1 || got[0] != models.ReasonLimitSumInsured {
		t.Errorf("SI breach: got %v", got)
	}
	got = Check(l, 0, 500_000_001)
	if len(got) != 1 || got[0] != models.ReasonLimitMaxPremium {
		t.Errorf("premium breach: got %v", got)
	}
	got = Check(l, 5_000_000_001, 500_000_001)
	if len(got) != 2 {
		t.Errorf("double breach: got %v", got)
	}
	// Exactly at the limit is within (strict >).
	if got := Check(l, 5_000_000_000, 500_000_000); len(got) != 0 {
		t.Errorf("at-limit must pass: %v", got)
	}
}

func TestNilLimitsUnbounded(t *testing.T) {
	if got := Check(nil, 1<<62, 1<<62); len(got) != 0 {
		t.Errorf("nil limits must be unbounded: %v", got)
	}
	var l *Limits
	if l.GeoLimit("anywhere") != 0 {
		t.Error("nil limits must have no geo ceiling")
	}
}

func TestGeoLimitLookup(t *testing.T) {
	l := &Limits{GeoAccumulationKobo: map[string]int64{"lagos": 100}}
	if l.GeoLimit("lagos") != 100 {
		t.Error("lagos geo limit lookup failed")
	}
	if l.GeoLimit("kano") != 0 {
		t.Error("unknown cell must be unbounded")
	}
}

func TestSetSwap(t *testing.T) {
	s := NewStore()
	if s.Current() != nil {
		t.Error("fresh store must be empty")
	}
	set := NewSet(map[string]*Limits{"motor": {MaxSumInsuredKobo: 5}})
	s.Swap(set)
	if s.Current().ForLine("motor").MaxSumInsuredKobo != 5 {
		t.Error("swap did not publish")
	}
	if s.Current().ForLine("health") != nil {
		t.Error("unknown line must have nil limits")
	}
}
