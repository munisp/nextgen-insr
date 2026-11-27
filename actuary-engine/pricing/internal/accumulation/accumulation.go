// Package accumulation is the geo/per-line exposure-accumulation control
// (design §4.g, Appendix I step 5). Running aggregates live in Redis keyed
// accum:{line}:{geo_cell} plus a per-line total accum:{line}:__total__,
// warmed from PG at boot and incremented only on accepted quotes — a
// breached check leaves every aggregate unchanged (the acceptance test
// "accumulation_breach_referral" asserts exactly that).
//
// The check-and-apply at accept time is a single Lua script so concurrent
// quotes cannot both pass a stale check and over-commit a cell (no TOCTOU).
//
// Fail-closed: any store error → error → the service refers with
// ACCUM_UNAVAILABLE. The control never silently accepts.
package accumulation

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/redis/go-redis/v9"
)

// totalCell is the reserved geo-cell key holding the per-line aggregate.
const totalCell = "__total__"

// Store wraps the Redis client. All amounts are integer kobo.
type Store struct {
	rdb redis.Cmdable
}

// NewStore builds a Store over an existing go-redis client.
func NewStore(rdb redis.Cmdable) *Store {
	return &Store{rdb: rdb}
}

// Ping verifies the store is reachable (readyz).
func (s *Store) Ping(ctx context.Context) error {
	if s == nil || s.rdb == nil {
		return errors.New("accumulation store not configured")
	}
	return s.rdb.Ping(ctx).Err()
}

// Key is the aggregate key for (line, geoCell).
func Key(line, geoCell string) string { return "accum:" + line + ":" + geoCell }

// TotalKey is the per-line aggregate key.
func TotalKey(line string) string { return Key(line, totalCell) }

// Current reads one aggregate (0 when unset).
func (s *Store) Current(ctx context.Context, line, geoCell string) (int64, error) {
	if s == nil || s.rdb == nil {
		return 0, errors.New("accumulation store not configured")
	}
	raw, err := s.rdb.Get(ctx, Key(line, geoCell)).Result()
	if errors.Is(err, redis.Nil) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("accumulation read failed: %w", err)
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("accumulation value corrupt for %s:%s: %w", line, geoCell, err)
	}
	return v, nil
}

// Check is the read-only advisory check used at Appendix I step 5 (early
// breach detection with machine reason codes) and by the
// POST /v1/exposure/check endpoint. It never mutates state. The
// authoritative gate at accept time is ApplyIfWithin.
func (s *Store) Check(ctx context.Context, line, geoCell string, deltaKobo, geoLimitKobo, lineLimitKobo int64) (geoBreach, lineBreach bool, err error) {
	if geoCell != "" && geoLimitKobo > 0 {
		cur, err := s.Current(ctx, line, geoCell)
		if err != nil {
			return false, false, err
		}
		if cur+deltaKobo > geoLimitKobo {
			geoBreach = true
		}
	}
	if lineLimitKobo > 0 {
		cur, err := s.Current(ctx, line, totalCell)
		if err != nil {
			return false, false, err
		}
		if cur+deltaKobo > lineLimitKobo {
			lineBreach = true
		}
	}
	return geoBreach, lineBreach, nil
}

// checkApplyScript atomically checks both ceilings and, only when neither
// is breached, applies the delta. Returns 0 = applied, 1 = geo breach,
// 2 = per-line breach. On any breach NOTHING is incremented (aggregate
// unchanged — the pinned acceptance-test property).
var checkApplyScript = redis.NewScript(`
local geoKey   = KEYS[1]
local totalKey = KEYS[2]
local delta    = tonumber(ARGV[1])
local geoLimit = tonumber(ARGV[2])
local lineLimit = tonumber(ARGV[3])
local useGeo   = ARGV[4] == "1"

if useGeo == true and geoLimit > 0 then
  local cur = tonumber(redis.call("GET", geoKey) or "0")
  if cur + delta > geoLimit then
    return 1
  end
end
if lineLimit > 0 then
  local cur = tonumber(redis.call("GET", totalKey) or "0")
  if cur + delta > lineLimit then
    return 2
  end
end
if useGeo == true then
  redis.call("INCRBY", geoKey, delta)
end
redis.call("INCRBY", totalKey, delta)
return 0
`)

// ApplyOutcome is the result of the atomic check-and-apply.
type ApplyOutcome int

const (
	Applied    ApplyOutcome = 0
	GeoBreach  ApplyOutcome = 1
	LineBreach ApplyOutcome = 2
)

// ApplyIfWithin is the authoritative accumulation gate executed when a
// quote is about to be accepted: within ceilings → the delta is recorded
// atomically; breach → nothing is recorded and the outcome names the
// breached ceiling.
func (s *Store) ApplyIfWithin(ctx context.Context, line, geoCell string, deltaKobo, geoLimitKobo, lineLimitKobo int64) (ApplyOutcome, error) {
	if s == nil || s.rdb == nil {
		return Applied, errors.New("accumulation store not configured")
	}
	useGeo := "0"
	if geoCell != "" {
		useGeo = "1"
	}
	res, err := checkApplyScript.Run(ctx, s.rdb,
		[]string{Key(line, geoCell), TotalKey(line)},
		deltaKobo, geoLimitKobo, lineLimitKobo, useGeo,
	).Int()
	if err != nil {
		return Applied, fmt.Errorf("accumulation apply failed: %w", err)
	}
	return ApplyOutcome(res), nil
}

// Warm seeds aggregates from PG snapshots (boot sequence: "warm Redis
// accumulation keys from policies aggregates"). Existing keys win — a warm
// never overwrites a live counter (SETNX semantics per key).
func (s *Store) Warm(ctx context.Context, seeds map[string]int64) error {
	if s == nil || s.rdb == nil {
		return errors.New("accumulation store not configured")
	}
	for key, kobo := range seeds {
		if err := s.rdb.SetNX(ctx, key, kobo, 0).Err(); err != nil {
			return fmt.Errorf("accumulation warm failed for %s: %w", key, err)
		}
	}
	return nil
}
