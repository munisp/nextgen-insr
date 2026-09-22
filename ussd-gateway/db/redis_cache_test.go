package db

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// newTestCache spins up an in-memory Redis and returns a RedisCache bound to
// it plus the miniredis handle for assertions/time control.
func newTestCache(t *testing.T) (*RedisCache, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	rc := &RedisCache{client: redis.NewClient(&redis.Options{Addr: mr.Addr()})}
	t.Cleanup(func() { _ = rc.Close() })
	return rc, mr
}

// 2026-09-22: regression test for the TTL-less-key hazard in the rate
// limiter. IsRateLimited must set a TTL atomically with every increment so a
// phone number can never be throttled permanently.
func TestIsRateLimitedAlwaysSetsTTL(t *testing.T) {
	rc, mr := newTestCache(t)
	ctx := context.Background()
	phone := "+2348012345678"
	key := rateLimitPrefix + phone

	for i := 1; i <= 3; i++ {
		if rc.IsRateLimited(ctx, phone) {
			t.Fatalf("call %d unexpectedly throttled", i)
		}
		ttl := mr.TTL(key)
		if ttl <= 0 || ttl > rateLimitTTL {
			t.Fatalf("after call %d: TTL = %v, want (0, %v]", i, ttl, rateLimitTTL)
		}
	}

	// Simulate a key that somehow lost its TTL (e.g. restored from an old
	// RDB snapshot): the next increment must re-arm the TTL.
	mr.Set(key, "5") // SET clears any existing TTL
	if rc.IsRateLimited(ctx, phone) {
		t.Fatal("count 6 unexpectedly throttled")
	}
	if ttl := mr.TTL(key); ttl <= 0 {
		t.Fatalf("TTL not re-armed on TTL-less key, got %v", ttl)
	}

	// The window must still expire so throttling self-heals.
	mr.FastForward(rateLimitTTL + time.Second)
	if mr.Exists(key) {
		t.Fatal("rate-limit key did not expire after the window elapsed")
	}
	if rc.IsRateLimited(ctx, phone) {
		t.Fatal("still throttled after the window expired")
	}
}

// TestIsRateLimitedThrottleLimitUnchanged proves the Lua rewrite keeps the
// exact throttle semantics: maxMessagesPerMinute messages per window pass,
// the next one is throttled.
func TestIsRateLimitedThrottleLimitUnchanged(t *testing.T) {
	rc, _ := newTestCache(t)
	ctx := context.Background()
	phone := "+2348098765432"

	for i := 1; i <= maxMessagesPerMinute; i++ {
		if rc.IsRateLimited(ctx, phone) {
			t.Fatalf("message %d of %d throttled; limit changed", i, maxMessagesPerMinute)
		}
	}
	for i := maxMessagesPerMinute + 1; i <= maxMessagesPerMinute+3; i++ {
		if !rc.IsRateLimited(ctx, phone) {
			t.Fatalf("message %d not throttled; limit changed", i)
		}
	}
}
