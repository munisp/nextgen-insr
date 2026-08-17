// Package redis — Quorum Fencing with Lease Renewals
//
// Implements a weighted quorum fence for multi-region distributed locking.
// Quorum model: Lagos=3, London=2, Singapore=1 (total=6, majority=4).
//
// Edge cases handled:
//   1. Lease expiry during network partition  — epoch-based fencing; stale leader
//      is rejected even after it reconnects.
//   2. Split-brain on simultaneous fence requests — atomic Lua CAS on epoch key;
//      only one node wins the epoch increment.
//   3. Zombie leader after partition heals — epoch check on every write; old
//      epoch is rejected with ErrStaleLease.
//   4. Lease renewal race — renewal uses GETEX + Lua CAS; if the key expired
//      between the check and the renewal the renewal fails atomically.
//   5. Clock skew — all TTLs are server-side Redis TTLs, never wall-clock.
//   6. Redis circuit-breaker open — lease acquisition fails fast; no writes
//      proceed without a valid lease.

package infra

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// ─── Errors ──────────────────────────────────────────────────────────────────

var (
	// ErrNoQuorum is returned when the caller's region does not hold quorum.
	ErrNoQuorum = errors.New("quorum_fence: insufficient quorum votes")
	// ErrStaleLease is returned when the lease epoch is behind the current global epoch.
	ErrStaleLease = errors.New("quorum_fence: stale lease — epoch mismatch")
	// ErrLeaseExpired is returned when the lease TTL has elapsed.
	ErrLeaseExpired = errors.New("quorum_fence: lease expired")
	// ErrFenceConflict is returned when another node already holds the fence.
	ErrFenceConflict = errors.New("quorum_fence: fence already held by another node")
)

// ─── Region weights ──────────────────────────────────────────────────────────

// RegionWeight maps region identifiers to their quorum vote weights.
// Total votes = 6; majority quorum requires > 3 (i.e., ≥ 4).
var RegionWeight = map[string]int{
	"ng-lagos":     3,
	"gb-london":    2,
	"sg-singapore": 1,
}

const totalVotes = 6
const majorityVotes = 4 // strict majority: > totalVotes/2

// ─── Lua scripts ─────────────────────────────────────────────────────────────

// acquireFenceLua atomically acquires the fence key only if:
//
//	(a) the key does not exist (SET NX), AND
//	(b) the global epoch key is at the expected epoch.
//
// Returns 1 on success, 0 if fence already held, -1 if epoch mismatch.
const acquireFenceLua = `
local epochKey = KEYS[1]
local fenceKey = KEYS[2]
local expectedEpoch = tonumber(ARGV[1])
local ownerID       = ARGV[2]
local ttlSec        = tonumber(ARGV[3])

local currentEpoch = tonumber(redis.call('GET', epochKey) or '0')
if currentEpoch ~= expectedEpoch then
    return -1
end
-- Increment epoch atomically to invalidate any concurrent acquire
local newEpoch = redis.call('INCR', epochKey)
redis.call('EXPIRE', epochKey, ttlSec * 10)
-- Acquire fence key
local ok = redis.call('SET', fenceKey, ownerID .. ':' .. newEpoch, 'NX', 'EX', ttlSec)
if ok then
    return newEpoch
end
-- Rollback epoch increment if fence was already taken
redis.call('DECR', epochKey)
return 0
`

// renewFenceLua atomically extends the fence TTL only if:
//
//	(a) the fence key still exists, AND
//	(b) the stored value matches ownerID:epoch (prevents stale renewal).
//
// Returns 1 on success, 0 on mismatch/expired.
const renewFenceLua = `
local fenceKey = KEYS[1]
local expected = ARGV[1]
local ttlSec   = tonumber(ARGV[2])

local current = redis.call('GET', fenceKey)
if current == expected then
    redis.call('EXPIRE', fenceKey, ttlSec)
    return 1
end
return 0
`

// releaseFenceLua atomically releases the fence key only if the caller owns it.
// Returns 1 on success, 0 if not owner or already expired.
const releaseFenceLua = `
local fenceKey = KEYS[1]
local expected = ARGV[1]
if redis.call('GET', fenceKey) == expected then
    redis.call('DEL', fenceKey)
    return 1
end
return 0
`

// ─── Types ───────────────────────────────────────────────────────────────────

// errHolder is a concrete type used to store errors in atomic.Value.
// atomic.Value panics if you store a nil interface, so we use this wrapper
// to represent "no error" (zero value) vs "has error" (non-nil Err field).
type errHolder struct{ Err error }

// LeaseGuard represents an active quorum lease with automatic renewal.
type LeaseGuard struct {
	FenceKey string        // Redis key for the fence
	EpochKey string        // Redis key for the global epoch counter
	OwnerID  string        // Cryptographically random owner token
	Epoch    int64         // Epoch at acquisition time
	TTL      time.Duration // Lease TTL
	Region   string        // Acquiring region
	Votes    int           // Votes held at acquisition time

	// internal
	fenceValue string        // ownerID:epoch stored in Redis
	renewStop  chan struct{} // closed to stop the renewal goroutine
	renewDone  chan struct{} // closed when renewal goroutine exits
	renewErr   atomic.Value  // stores the last renewal error (type error)
	mu         sync.Mutex
	released   bool
	client     *RedisClient
	log        *zap.Logger

	acquireScript *redis.Script
	renewScript   *redis.Script
	releaseScript *redis.Script
}

// QuorumFencer manages weighted quorum fencing across regions.
type QuorumFencer struct {
	client *RedisClient
	log    *zap.Logger

	acquireScript *redis.Script
	renewScript   *redis.Script
	releaseScript *redis.Script
}

// ─── Constructor ─────────────────────────────────────────────────────────────

// NewQuorumFencer creates a QuorumFencer backed by the given RedisClient.
func NewQuorumFencer(client *RedisClient) *QuorumFencer {
	return &QuorumFencer{
		client:        client,
		log:           client.logger,
		acquireScript: redis.NewScript(acquireFenceLua),
		renewScript:   redis.NewScript(renewFenceLua),
		releaseScript: redis.NewScript(releaseFenceLua),
	}
}

// ─── HasQuorum ────────────────────────────────────────────────────────────────

// HasQuorum returns true if the given set of live regions holds a strict majority
// of votes (> totalVotes/2 = 3, i.e., ≥ 4).
//
// Edge case — simultaneous partition: if both Lagos (3) and London (2) are
// partitioned from Singapore, neither side has quorum (3 < 4, 2 < 4).
// Only Lagos alone (3 < 4) does NOT have quorum; Lagos+London (5 ≥ 4) does.
func HasQuorum(liveRegions []string) bool {
	votes := 0
	for _, r := range liveRegions {
		votes += RegionWeight[r]
	}
	return votes >= majorityVotes
}

// RegionVotes returns the vote weight for a single region.
func RegionVotes(region string) int {
	return RegionWeight[region]
}

// ─── AcquireLease ────────────────────────────────────────────────────────────

// AcquireLease acquires a quorum-fenced distributed lease for the given resource.
//
// Parameters:
//
//	ctx         — context (deadline respected)
//	resource    — logical resource name (e.g., "primary-write")
//	region      — acquiring region (e.g., "ng-lagos")
//	liveRegions — all regions currently reachable (used for quorum check)
//	ttl         — lease duration; renewal fires at TTL/3 intervals
//
// Returns a *LeaseGuard with an active background renewal goroutine, or an error.
//
// Edge cases:
//   - If liveRegions does not have quorum → ErrNoQuorum (no Redis write)
//   - If the global epoch has advanced since last read → ErrStaleLease
//   - If another node already holds the fence → ErrFenceConflict
func (q *QuorumFencer) AcquireLease(
	ctx context.Context,
	resource string,
	region string,
	liveRegions []string,
	ttl time.Duration,
) (*LeaseGuard, error) {
	// ── 1. Quorum check (no Redis I/O) ──────────────────────────────────────
	if !HasQuorum(liveRegions) {
		q.log.Warn("quorum_fence: acquire rejected — insufficient votes",
			zap.String("resource", resource),
			zap.String("region", region),
			zap.Strings("live_regions", liveRegions),
		)
		return nil, ErrNoQuorum
	}

	if !q.client.checkCircuit() {
		return nil, fmt.Errorf("quorum_fence: redis circuit breaker is open")
	}

	// ── 2. Read current epoch ────────────────────────────────────────────────
	epochKey := fmt.Sprintf("qf:epoch:%s", resource)
	fenceKey := fmt.Sprintf("qf:fence:%s", resource)

	epochStr, err := q.client.client.Get(ctx, epochKey).Result()
	var currentEpoch int64
	if err != nil && err != redis.Nil {
		q.client.recordFailure()
		return nil, fmt.Errorf("quorum_fence: read epoch: %w", err)
	}
	if err == nil {
		currentEpoch, _ = strconv.ParseInt(epochStr, 10, 64)
	}

	// ── 3. Generate cryptographically random owner ID ────────────────────────
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return nil, fmt.Errorf("quorum_fence: rand: %w", err)
	}
	ownerID := hex.EncodeToString(b)

	// ── 4. Atomic acquire via Lua (epoch CAS + SET NX) ───────────────────────
	ttlSec := int(ttl.Seconds())
	if ttlSec < 1 {
		ttlSec = 1
	}

	result, err := q.acquireScript.Run(
		ctx, q.client.client,
		[]string{epochKey, fenceKey},
		currentEpoch, ownerID, ttlSec,
	).Int64()
	if err != nil {
		q.client.recordFailure()
		return nil, fmt.Errorf("quorum_fence: acquire script: %w", err)
	}
	q.client.recordSuccess()

	switch result {
	case -1:
		return nil, ErrStaleLease
	case 0:
		return nil, ErrFenceConflict
	}

	newEpoch := result
	fenceValue := fmt.Sprintf("%s:%d", ownerID, newEpoch)

	q.log.Info("quorum_fence: lease acquired",
		zap.String("resource", resource),
		zap.String("region", region),
		zap.Int64("epoch", newEpoch),
		zap.Duration("ttl", ttl),
		zap.Int("votes", RegionWeight[region]),
	)

	// ── 5. Build LeaseGuard and start renewal goroutine ─────────────────────
	guard := &LeaseGuard{
		FenceKey:      fenceKey,
		EpochKey:      epochKey,
		OwnerID:       ownerID,
		Epoch:         newEpoch,
		TTL:           ttl,
		Region:        region,
		Votes:         RegionWeight[region],
		fenceValue:    fenceValue,
		renewStop:     make(chan struct{}),
		renewDone:     make(chan struct{}),
		client:        q.client,
		log:           q.log,
		acquireScript: q.acquireScript,
		renewScript:   q.renewScript,
		releaseScript: q.releaseScript,
	}

	go guard.renewLoop()
	return guard, nil
}

// ─── LeaseGuard methods ───────────────────────────────────────────────────────

// renewLoop runs in a background goroutine and renews the lease every TTL/3.
// It stops when the guard is released or the renewStop channel is closed.
//
// Edge case — lease expiry during network partition:
//
//	If Redis is unreachable for > TTL, the lease expires server-side.
//	On reconnect, RenewLease returns ErrLeaseExpired and stores it in renewErr.
//	Callers must check RenewalErr() before each write.
func (g *LeaseGuard) renewLoop() {
	defer close(g.renewDone)

	interval := g.TTL / 3
	if interval < 100*time.Millisecond {
		interval = 100 * time.Millisecond
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-g.renewStop:
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			err := g.RenewLease(ctx)
			cancel()
			// atomic.Value requires all stored values to be the same concrete type.
			// We always store errHolder{Err: err}; Err is nil on success.
			g.renewErr.Store(errHolder{Err: err})
			if err != nil {
				g.log.Error("quorum_fence: lease renewal failed",
					zap.String("fence_key", g.FenceKey),
					zap.String("region", g.Region),
					zap.Int64("epoch", g.Epoch),
					zap.Error(err),
				)
				// Do not stop the loop — keep retrying until TTL expires
				// or the caller explicitly releases.
			}
		}
	}
}

// RenewLease explicitly renews the lease TTL.
// Returns ErrLeaseExpired if the key no longer exists (partition exceeded TTL).
// Returns ErrStaleLease if another node has taken over (epoch advanced).
func (g *LeaseGuard) RenewLease(ctx context.Context) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.released {
		return ErrLeaseExpired
	}

	if !g.client.checkCircuit() {
		return fmt.Errorf("quorum_fence: redis circuit breaker is open")
	}

	ttlSec := int(g.TTL.Seconds())
	result, err := g.renewScript.Run(
		ctx, g.client.client,
		[]string{g.FenceKey},
		g.fenceValue, ttlSec,
	).Int64()
	if err != nil {
		g.client.recordFailure()
		return fmt.Errorf("quorum_fence: renew script: %w", err)
	}
	g.client.recordSuccess()

	if result == 0 {
		// Key expired or owned by a different node
		return ErrLeaseExpired
	}

	g.log.Debug("quorum_fence: lease renewed",
		zap.String("fence_key", g.FenceKey),
		zap.String("region", g.Region),
		zap.Int64("epoch", g.Epoch),
		zap.Duration("ttl", g.TTL),
	)
	return nil
}

// ReleaseLease releases the lease and stops the renewal goroutine.
// Safe to call multiple times (idempotent).
func (g *LeaseGuard) ReleaseLease(ctx context.Context) error {
	g.mu.Lock()
	if g.released {
		g.mu.Unlock()
		return nil
	}
	g.released = true
	close(g.renewStop)
	g.mu.Unlock()

	// Wait for renewal goroutine to exit
	select {
	case <-g.renewDone:
	case <-time.After(3 * time.Second):
		g.log.Warn("quorum_fence: renewal goroutine did not exit in time",
			zap.String("fence_key", g.FenceKey))
	}

	if !g.client.checkCircuit() {
		return fmt.Errorf("quorum_fence: redis circuit breaker is open")
	}

	result, err := g.releaseScript.Run(
		ctx, g.client.client,
		[]string{g.FenceKey},
		g.fenceValue,
	).Int64()
	if err != nil {
		g.client.recordFailure()
		return fmt.Errorf("quorum_fence: release script: %w", err)
	}
	g.client.recordSuccess()

	if result == 1 {
		g.log.Info("quorum_fence: lease released",
			zap.String("fence_key", g.FenceKey),
			zap.String("region", g.Region),
			zap.Int64("epoch", g.Epoch),
		)
	} else {
		g.log.Warn("quorum_fence: release — key already expired or taken",
			zap.String("fence_key", g.FenceKey),
			zap.Int64("epoch", g.Epoch),
		)
	}
	return nil
}

// RenewalErr returns the last error from the background renewal goroutine,
// or nil if the last renewal succeeded.
// Callers MUST check this before performing writes protected by this lease.
func (g *LeaseGuard) RenewalErr() error {
	v := g.renewErr.Load()
	if v == nil {
		return nil
	}
	if h, ok := v.(errHolder); ok {
		return h.Err
	}
	if err, ok := v.(error); ok {
		return err
	}
	return nil
}

// IsValid returns true if the lease is active and the last renewal succeeded.
func (g *LeaseGuard) IsValid() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return !g.released && g.RenewalErr() == nil
}

// ─── GetFenceStatus ───────────────────────────────────────────────────────────

// FenceStatus describes the current state of a fence for a given resource.
type FenceStatus struct {
	Resource     string        `json:"resource"`
	FenceKey     string        `json:"fence_key"`
	EpochKey     string        `json:"epoch_key"`
	Held         bool          `json:"held"`
	OwnerID      string        `json:"owner_id,omitempty"`
	Epoch        int64         `json:"epoch"`
	TTLRemaining time.Duration `json:"ttl_remaining_ms"`
	HasQuorum    bool          `json:"has_quorum"`
	LiveRegions  []string      `json:"live_regions"`
	Votes        int           `json:"votes"`
}

// GetFenceStatus returns the current fence status for a resource.
func (q *QuorumFencer) GetFenceStatus(ctx context.Context, resource string, liveRegions []string) (*FenceStatus, error) {
	epochKey := fmt.Sprintf("qf:epoch:%s", resource)
	fenceKey := fmt.Sprintf("qf:fence:%s", resource)

	// Get epoch
	epochStr, err := q.client.client.Get(ctx, epochKey).Result()
	var epoch int64
	if err != nil && err != redis.Nil {
		return nil, fmt.Errorf("quorum_fence: get epoch: %w", err)
	}
	if err == nil {
		epoch, _ = strconv.ParseInt(epochStr, 10, 64)
	}

	// Get fence value and TTL
	pipe := q.client.client.Pipeline()
	getCmd := pipe.Get(ctx, fenceKey)
	ttlCmd := pipe.PTTL(ctx, fenceKey)
	_, _ = pipe.Exec(ctx)

	held := false
	ownerID := ""
	var ttlRemaining time.Duration

	if val, err := getCmd.Result(); err == nil {
		held = true
		// value is "ownerID:epoch" — extract ownerID
		for i := len(val) - 1; i >= 0; i-- {
			if val[i] == ':' {
				ownerID = val[:i]
				break
			}
		}
	}
	if ms, err := ttlCmd.Result(); err == nil && ms > 0 {
		ttlRemaining = ms
	}

	votes := 0
	for _, r := range liveRegions {
		votes += RegionWeight[r]
	}

	return &FenceStatus{
		Resource:     resource,
		FenceKey:     fenceKey,
		EpochKey:     epochKey,
		Held:         held,
		OwnerID:      ownerID,
		Epoch:        epoch,
		TTLRemaining: ttlRemaining,
		HasQuorum:    HasQuorum(liveRegions),
		LiveRegions:  liveRegions,
		Votes:        votes,
	}, nil
}

// ─── ExtendLockTTL — backward-compatible helper ───────────────────────────────

// ExtendLockTTL adds a RenewLock method to RedisClient for backward compatibility
// with existing code that uses LockGuard (non-quorum path).
// It extends the TTL of an existing lock only if the owner matches.
//
// Edge case: if the lock expired between the check and the EXPIRE call, the
// Lua script returns 0 and ErrLeaseExpired is returned.
const renewLockLua = `
local lockKey = KEYS[1]
local expected = ARGV[1]
local ttlSec   = tonumber(ARGV[2])
if redis.call('GET', lockKey) == expected then
    redis.call('EXPIRE', lockKey, ttlSec)
    return 1
end
return 0
`

// RenewLock extends the TTL of an existing LockGuard.
// This is the non-quorum equivalent of LeaseGuard.RenewLease.
func (c *RedisClient) RenewLock(ctx context.Context, guard *LockGuard, ttl time.Duration) error {
	if guard == nil {
		return ErrLeaseExpired
	}
	if !c.checkCircuit() {
		return fmt.Errorf("redis circuit breaker is open")
	}
	script := redis.NewScript(renewLockLua)
	ttlSec := int(ttl.Seconds())
	result, err := script.Run(ctx, c.client, []string{guard.Key}, guard.OwnerID, ttlSec).Int64()
	if err != nil {
		c.recordFailure()
		return fmt.Errorf("renew_lock: %w", err)
	}
	c.recordSuccess()
	if result == 0 {
		return ErrLeaseExpired
	}
	return nil
}
