package accumulation

import (
	"context"
	"sync"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newStore(t *testing.T) (*Store, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	return NewStore(redis.NewClient(&redis.Options{Addr: mr.Addr()})), mr
}

// TestBreachLeavesAggregateUnchanged is the pinned acceptance property:
// seed the aggregate at the limit, attempt an accept-time apply that would
// breach, and prove nothing was incremented.
func TestBreachLeavesAggregateUnchanged(t *testing.T) {
	ctx := context.Background()
	s, mr := newStore(t)
	// Seed at the limit (acceptance test wording: "seed Redis aggregate at
	// limit").
	mr.Set(Key("motor", "kano"), "10000000000")
	const limit = 10_000_000_000

	outcome, err := s.ApplyIfWithin(ctx, "motor", "kano", 100_000_000, limit, 0)
	if err != nil {
		t.Fatal(err)
	}
	if outcome != GeoBreach {
		t.Fatalf("outcome = %v, want GeoBreach", outcome)
	}
	cur, err := s.Current(ctx, "motor", "kano")
	if err != nil {
		t.Fatal(err)
	}
	if cur != limit {
		t.Errorf("aggregate changed on breach: %d, want %d", cur, limit)
	}
}

// TestApplyWithinIncrements covers the accept path: within limits → the
// delta is recorded in both the geo-cell and per-line aggregates.
func TestApplyWithinIncrements(t *testing.T) {
	ctx := context.Background()
	s, _ := newStore(t)
	outcome, err := s.ApplyIfWithin(ctx, "motor", "kano", 1_000_000_000, 10_000_000_000, 50_000_000_000)
	if err != nil || outcome != Applied {
		t.Fatalf("apply failed: outcome=%v err=%v", outcome, err)
	}
	cur, _ := s.Current(ctx, "motor", "kano")
	if cur != 1_000_000_000 {
		t.Errorf("geo aggregate = %d, want 1000000000", cur)
	}
	total, _ := s.Current(ctx, "motor", totalCell)
	if total != 1_000_000_000 {
		t.Errorf("line aggregate = %d, want 1000000000", total)
	}
}

// TestAtomicNoOverCommit races 64 concurrent accept-time applies against a
// ceiling of exactly half their combined deltas: precisely 50 must apply,
// the rest must breach, and the aggregate must land exactly on the limit
// (the Lua script makes check+apply atomic — no TOCTOU over-commit).
func TestAtomicNoOverCommit(t *testing.T) {
	ctx := context.Background()
	s, _ := newStore(t)
	const n = 64
	const each = 1_000_000_000 // ₦10m
	const limit = 50 * each    // exactly half

	var wg sync.WaitGroup
	var mu sync.Mutex
	applied, breached := 0, 0
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			outcome, err := s.ApplyIfWithin(ctx, "motor", "kano", each, limit, 0)
			if err != nil {
				t.Errorf("apply failed: %v", err)
				return
			}
			mu.Lock()
			if outcome == Applied {
				applied++
			} else if outcome == GeoBreach {
				breached++
			}
			mu.Unlock()
		}()
	}
	wg.Wait()
	if applied != 50 || breached != n-50 {
		t.Errorf("applied=%d breached=%d, want 50/14", applied, breached)
	}
	cur, err := s.Current(ctx, "motor", "kano")
	if err != nil {
		t.Fatal(err)
	}
	if cur != limit {
		t.Errorf("aggregate = %d, want exactly %d", cur, limit)
	}
}

// TestLineBreach checks the per-line aggregate ceiling path.
func TestLineBreach(t *testing.T) {
	ctx := context.Background()
	s, mr := newStore(t)
	mr.Set(TotalKey("motor"), "49000000000")
	outcome, err := s.ApplyIfWithin(ctx, "motor", "abuja", 2_000_000_000, 0, 50_000_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if outcome != LineBreach {
		t.Fatalf("outcome = %v, want LineBreach", outcome)
	}
	total, _ := s.Current(ctx, "motor", totalCell)
	if total != 49_000_000_000 {
		t.Errorf("line aggregate changed on breach: %d", total)
	}
}

// TestCheckReadOnly: the advisory check never mutates state.
func TestCheckReadOnly(t *testing.T) {
	ctx := context.Background()
	s, mr := newStore(t)
	mr.Set(Key("motor", "kano"), "10000000000")
	geo, line, err := s.Check(ctx, "motor", "kano", 1, 10_000_000_000, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !geo || line {
		t.Errorf("check = geo:%v line:%v, want geo:true line:false", geo, line)
	}
	cur, _ := s.Current(ctx, "motor", "kano")
	if cur != 10_000_000_000 {
		t.Errorf("advisory check mutated aggregate: %d", cur)
	}
}

// TestWarmSetnx: warming never overwrites a live counter.
func TestWarmSetnx(t *testing.T) {
	ctx := context.Background()
	s, mr := newStore(t)
	mr.Set(Key("motor", "kano"), "123")
	if err := s.Warm(ctx, map[string]int64{Key("motor", "kano"): 999, Key("motor", "abuja"): 7}); err != nil {
		t.Fatal(err)
	}
	cur, _ := s.Current(ctx, "motor", "kano")
	if cur != 123 {
		t.Errorf("warm overwrote live counter: %d, want 123", cur)
	}
	cur, _ = s.Current(ctx, "motor", "abuja")
	if cur != 7 {
		t.Errorf("warm failed to seed new key: %d", cur)
	}
}

// TestFailClosed: a dead store surfaces an error (the service maps it to
// ACCUM_UNAVAILABLE, never accepts).
func TestFailClosed(t *testing.T) {
	ctx := context.Background()
	s := NewStore(redis.NewClient(&redis.Options{Addr: "127.0.0.1:63999"}))
	if _, err := s.Current(ctx, "motor", "kano"); err == nil {
		t.Error("read against dead store succeeded")
	}
	if _, err := s.ApplyIfWithin(ctx, "motor", "kano", 1, 1, 0); err == nil {
		t.Error("apply against dead store succeeded")
	}
	if err := s.Ping(ctx); err == nil {
		t.Error("ping against dead store succeeded")
	}
}
