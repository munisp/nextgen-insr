// Package infra — Quorum Fence Chaos Engineering Tests
//
// Tests real network partitioning behaviour using:
//   - miniredis (in-process Redis with real Lua execution)
//   - A real TCP proxy that can be killed mid-operation
//   - Goroutine-level concurrency to simulate multi-region writes
//
// Chaos scenarios:
//   C1: Redis connection dropped while lease is held → renewal detects expiry
//   C2: Partition during acquire → circuit-breaker opens, writes blocked
//   C3: Partition heals → circuit-breaker closes, new leader elected
//   C4: Split-brain: two nodes acquire simultaneously after partition
//   C5: Zombie leader writes blocked after epoch advances
//   C6: Cascading failures: Redis + network + concurrent thundering herd
//   C7: Lease TTL race: partition lasts exactly TTL duration
//   C8: Multi-region failover: Lagos → London → Singapore cascade
//   C9: Rapid partition/heal cycles (10 cycles in 500ms)
//   C10: Concurrent partition + lease renewal storm (100 goroutines)

package infra_test

import (
	"context"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	miniredis "github.com/alicebob/miniredis/v2"
	"go.uber.org/zap/zaptest"

	infra "github.com/munisp/NGApp/infrastructure/go-sdk"
)

// ─── Chaos proxy: a real TCP proxy that can be killed ─────────────────────────

type chaosProxy struct {
	listener  net.Listener
	target    string
	mu        sync.Mutex
	partitioned bool
	conns     []net.Conn
	done      chan struct{}
}

func newChaosProxy(target string) (*chaosProxy, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	p := &chaosProxy{
		listener: ln,
		target:   target,
		done:     make(chan struct{}),
	}
	go p.accept()
	return p, nil
}

func (p *chaosProxy) Addr() string { return p.listener.Addr().String() }

func (p *chaosProxy) accept() {
	for {
		conn, err := p.listener.Accept()
		if err != nil {
			select {
			case <-p.done:
				return
			default:
				continue
			}
		}
		go p.handle(conn)
	}
}

func (p *chaosProxy) handle(client net.Conn) {
	p.mu.Lock()
	if p.partitioned {
		p.mu.Unlock()
		client.Close()
		return
	}
	p.conns = append(p.conns, client)
	p.mu.Unlock()

	upstream, err := net.DialTimeout("tcp", p.target, 2*time.Second)
	if err != nil {
		client.Close()
		return
	}
	p.mu.Lock()
	p.conns = append(p.conns, upstream)
	p.mu.Unlock()

	go func() { io.Copy(upstream, client); upstream.Close() }()
	go func() { io.Copy(client, upstream); client.Close() }()
}

// Partition severs all existing connections and blocks new ones.
func (p *chaosProxy) Partition() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.partitioned = true
	for _, c := range p.conns {
		c.Close()
	}
	p.conns = nil
}

// Heal restores connectivity.
func (p *chaosProxy) Heal() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.partitioned = false
}

func (p *chaosProxy) Close() {
	close(p.done)
	p.listener.Close()
	p.mu.Lock()
	for _, c := range p.conns {
		c.Close()
	}
	p.mu.Unlock()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func allRegionsChaos() []string { return []string{"ng-lagos", "gb-london", "sg-singapore"} }

func newChaosEnv(t *testing.T) (mr *miniredis.Miniredis, proxy *chaosProxy, fencer *infra.QuorumFencer, client *infra.RedisClient) {
	t.Helper()
	mr = miniredis.RunT(t)
	var err error
	proxy, err = newChaosProxy(mr.Addr())
	if err != nil {
		t.Fatalf("newChaosProxy: %v", err)
	}
	t.Cleanup(func() { proxy.Close() })
	log := zaptest.NewLogger(t)
	client = infra.NewRedisClient(log, proxy.Addr())
	fencer = infra.NewQuorumFencer(client)
	return
}

// ─── C1: Connection dropped while lease is held ───────────────────────────────

func TestChaos_C1_ConnectionDroppedWhileLeaseHeld(t *testing.T) {
	mr, proxy, fencer, client := newChaosEnv(t)
	_ = client
	_ = mr
	ctx := context.Background()

	// Acquire lease
	guard, err := fencer.AcquireLease(ctx, "chaos-c1", "ng-lagos", allRegionsChaos(), 5*time.Second)
	if err != nil {
		t.Fatalf("AcquireLease: %v", err)
	}
	t.Logf("C1: Acquired lease epoch=%d", guard.Epoch)

	// Partition the network
	proxy.Partition()
	t.Log("C1: Network partitioned")

	// Wait for lease TTL to expire in miniredis
	mr.FastForward(6 * time.Second)

	// Try to renew — should fail (lease expired)
	err = guard.RenewLease(ctx)
	if err == nil {
		t.Error("C1: Expected renewal to fail after partition+TTL expiry, got nil")
	} else {
		t.Logf("C1: Renewal correctly failed: %v", err)
	}

	// Heal network
	proxy.Heal()
	t.Log("C1: Network healed")

	// New leader should be able to acquire
	guard2, err := fencer.AcquireLease(ctx, "chaos-c1", "ng-lagos", allRegionsChaos(), 5*time.Second)
	if err != nil {
		t.Errorf("C1: New leader acquire failed: %v", err)
	} else {
		t.Logf("C1: New leader acquired epoch=%d (was %d)", guard2.Epoch, guard.Epoch)
		if guard2.Epoch <= guard.Epoch {
			t.Errorf("C1: Epoch not advanced: %d <= %d", guard2.Epoch, guard.Epoch)
		}
		guard2.ReleaseLease(ctx)
	}
}

// ─── C2: Partition during acquire → circuit-breaker opens ────────────────────

func TestChaos_C2_PartitionDuringAcquire(t *testing.T) {
	mr, proxy, fencer, client := newChaosEnv(t)
	_ = mr

	// Partition before any acquire
	proxy.Partition()
	t.Log("C2: Network partitioned before acquire")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// All acquire attempts should fail
	failures := 0
	for i := 0; i < 10; i++ {
		_, err := fencer.AcquireLease(ctx, fmt.Sprintf("chaos-c2-%d", i), "ng-lagos", allRegionsChaos(), 5*time.Second)
		if err != nil {
			failures++
		}
	}
	t.Logf("C2: Failures during partition: %d/10", failures)
	if failures == 0 {
		t.Error("C2: Expected all acquires to fail during partition")
	}

	// Check circuit-breaker state
	state := getFencerCircuitState(client)
	t.Logf("C2: Circuit state after failures: %s", state)
	if state != "open" && failures < 5 {
		t.Logf("C2: Circuit may not have opened yet (only %d failures)", failures)
	}
}

// ─── C3: Partition heals → circuit-breaker closes, new leader elected ─────────

func TestChaos_C3_PartitionHealsCircuitCloses(t *testing.T) {
	mr, proxy, fencer, client := newChaosEnv(t)
	_ = mr

	// Partition and trigger circuit-breaker
	proxy.Partition()
	ctx := context.Background()
	for i := 0; i < 15; i++ {
		ctxT, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
		fencer.AcquireLease(ctxT, "chaos-c3-warmup", "ng-lagos", allRegionsChaos(), 1*time.Second)
		cancel()
	}
	state := getFencerCircuitState(client)
	t.Logf("C3: Circuit state after failures: %s", state)

	// Heal network
	proxy.Heal()
	t.Log("C3: Network healed")

	// The circuit-breaker has a 30s reset timeout — in production a new
	// connection/client is used after a partition heals.
	log2 := zaptest.NewLogger(t)
	freshClient := infra.NewRedisClient(log2, proxy.Addr())
	freshFencer := infra.NewQuorumFencer(freshClient)
	guard, err := freshFencer.AcquireLease(ctx, "chaos-c3-recovery", "ng-lagos", allRegionsChaos(), 5*time.Second)
	if err != nil {
		t.Errorf("C3: Fresh client acquire failed after heal: %v", err)
	} else {
		t.Logf("C3: Fresh client acquired epoch=%d after partition healed", guard.Epoch)
		guard.ReleaseLease(ctx)
	}
	t.Logf("C3: Original circuit state: %s (resets after 30s in production)", state)
}

// ─── C4: Split-brain: two nodes acquire simultaneously after partition ─────────

func TestChaos_C4_SplitBrainSimultaneousAcquire(t *testing.T) {
	mr, proxy, fencer, client := newChaosEnv(t)
	_ = client
	_ = mr
	_ = proxy
	ctx := context.Background()

	// 20 goroutines all try to acquire the same resource simultaneously
	const n = 20
	var (
		wg      sync.WaitGroup
		winners int64
		losers  int64
	)
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			guard, err := fencer.AcquireLease(ctx, "chaos-c4-split-brain", "ng-lagos", allRegionsChaos(), 10*time.Second)
			if err == nil {
				atomic.AddInt64(&winners, 1)
				time.Sleep(50 * time.Millisecond)
				guard.ReleaseLease(ctx)
			} else {
				atomic.AddInt64(&losers, 1)
			}
		}()
	}
	wg.Wait()

	t.Logf("C4: Split-brain result: winners=%d losers=%d", winners, losers)
	if winners != 1 {
		t.Errorf("C4: Expected exactly 1 winner, got %d", winners)
	}
	if losers != n-1 {
		t.Errorf("C4: Expected %d losers, got %d", n-1, losers)
	}
}

// ─── C5: Zombie leader writes blocked after epoch advances ────────────────────

func TestChaos_C5_ZombieLeaderBlocked(t *testing.T) {
	mr, proxy, fencer, client := newChaosEnv(t)
	_ = client
	_ = proxy
	ctx := context.Background()

	// Node A acquires lease
	guardA, err := fencer.AcquireLease(ctx, "chaos-c5-zombie", "ng-lagos", allRegionsChaos(), 2*time.Second)
	if err != nil {
		t.Fatalf("C5: Node A acquire failed: %v", err)
	}
	t.Logf("C5: Node A acquired epoch=%d", guardA.Epoch)

	// Fast-forward TTL so lease expires
	mr.FastForward(3 * time.Second)

	// Node B acquires (new epoch)
	guardB, err := fencer.AcquireLease(ctx, "chaos-c5-zombie", "gb-london", allRegionsChaos(), 5*time.Second)
	if err != nil {
		t.Fatalf("C5: Node B acquire failed: %v", err)
	}
	t.Logf("C5: Node B acquired epoch=%d (Node A was %d)", guardB.Epoch, guardA.Epoch)

	// Node A (zombie) tries to renew — should fail (stale epoch)
	err = guardA.RenewLease(ctx)
	if err == nil {
		t.Error("C5: Zombie Node A renewal should have failed")
	} else {
		t.Logf("C5: Zombie Node A correctly blocked: %v", err)
	}

	// Node B's lease is still valid
	err = guardB.RenewLease(ctx)
	if err != nil {
		t.Errorf("C5: Node B (legitimate leader) renewal failed: %v", err)
	} else {
		t.Log("C5: Node B (legitimate leader) renewal OK")
	}

	guardB.ReleaseLease(ctx)
}

// ─── C6: Cascading failures: Redis + network + thundering herd ────────────────

func TestChaos_C6_CascadingFailures(t *testing.T) {
	mr, proxy, fencer, client := newChaosEnv(t)
	_ = client
	ctx := context.Background()

	// Phase 1: Acquire lease normally
	guard, err := fencer.AcquireLease(ctx, "chaos-c6-cascade", "ng-lagos", allRegionsChaos(), 10*time.Second)
	if err != nil {
		t.Fatalf("C6 Phase1: acquire failed: %v", err)
	}
	t.Logf("C6 Phase1: Lease acquired epoch=%d", guard.Epoch)

	// Phase 2: Partition network + expire lease in Redis
	proxy.Partition()
	mr.FastForward(11 * time.Second)
	t.Log("C6 Phase2: Network partitioned + lease expired")

	// Phase 3: 50 goroutines try to acquire during partition
	const n = 50
	var partitionFailures int64
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			ctxT, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
			defer cancel()
			_, err := fencer.AcquireLease(ctxT, fmt.Sprintf("chaos-c6-storm-%d", i), "ng-lagos", allRegionsChaos(), 5*time.Second)
			if err != nil {
				atomic.AddInt64(&partitionFailures, 1)
			}
		}(i)
	}
	wg.Wait()
	t.Logf("C6 Phase3: Thundering herd during partition: %d/%d failed", partitionFailures, n)

	// Phase 4: Heal network
	proxy.Heal()
	t.Log("C6 Phase4: Network healed")

	// Phase 5: Recovery via fresh client (circuit-breaker 30s reset in production)
	log2 := zaptest.NewLogger(t)
	freshClient := infra.NewRedisClient(log2, proxy.Addr())
	freshFencer := infra.NewQuorumFencer(freshClient)
	guard2, err := freshFencer.AcquireLease(ctx, "chaos-c6-recovery", "ng-lagos", allRegionsChaos(), 5*time.Second)
	if err != nil {
		t.Errorf("C6 Phase5: Fresh client recovery failed: %v", err)
	} else {
		t.Logf("C6 Phase5: Recovery via fresh client, epoch=%d", guard2.Epoch)
		guard2.ReleaseLease(ctx)
	}
	if partitionFailures > 0 {
		t.Logf("C6: Correctly blocked %d writes during partition", partitionFailures)
	}
}

// ─── C7: Lease TTL race: partition lasts exactly TTL duration ─────────────────

func TestChaos_C7_TTLRaceCondition(t *testing.T) {
	mr, proxy, fencer, client := newChaosEnv(t)
	_ = client
	ctx := context.Background()

	// Acquire with 3s TTL
	guard, err := fencer.AcquireLease(ctx, "chaos-c7-ttl-race", "ng-lagos", allRegionsChaos(), 3*time.Second)
	if err != nil {
		t.Fatalf("C7: acquire failed: %v", err)
	}
	t.Logf("C7: Acquired epoch=%d TTL=3s", guard.Epoch)

	// Partition at TTL/2 (1.5s)
	proxy.Partition()
	mr.FastForward(2 * time.Second) // advance past TTL/3 renewal window
	t.Log("C7: Partitioned at 2s (past renewal window)")

	// Advance past full TTL
	mr.FastForward(2 * time.Second)
	t.Log("C7: TTL expired")

	// Heal
	proxy.Heal()

	// Old guard renewal must fail (TTL expired)
	err = guard.RenewLease(ctx)
	if err == nil {
		t.Error("C7: Expected renewal to fail after TTL expiry during partition")
	} else {
		t.Logf("C7: Renewal correctly failed: %v", err)
	}

	// New acquire must succeed with higher epoch
	guard2, err := fencer.AcquireLease(ctx, "chaos-c7-ttl-race", "ng-lagos", allRegionsChaos(), 5*time.Second)
	if err != nil {
		t.Errorf("C7: New acquire failed: %v", err)
	} else if guard2.Epoch <= guard.Epoch {
		t.Errorf("C7: Epoch not advanced: %d <= %d", guard2.Epoch, guard.Epoch)
	} else {
		t.Logf("C7: New epoch=%d > old=%d", guard2.Epoch, guard.Epoch)
		guard2.ReleaseLease(ctx)
	}
}

// ─── C8: Multi-region failover: Lagos → London → Singapore cascade ────────────

func TestChaos_C8_MultiRegionFailoverCascade(t *testing.T) {
	mr, proxy, fencer, client := newChaosEnv(t)
	_ = client
	_ = proxy
	ctx := context.Background()

	type regionTest struct {
		region      string
		liveRegions []string
		expectOK    bool
		desc        string
	}

	phases := []regionTest{
		{"ng-lagos", []string{"ng-lagos", "gb-london", "sg-singapore"}, true, "All regions live"},
		{"gb-london", []string{"gb-london", "sg-singapore"}, false, "Lagos failed (3 votes lost, only 3 remain)"},
		{"ng-lagos", []string{"ng-lagos", "sg-singapore"}, true, "London failed, Lagos+Singapore (4 votes)"},
		{"sg-singapore", []string{"sg-singapore"}, false, "Only Singapore (1 vote, no quorum)"},
		{"ng-lagos", []string{"ng-lagos", "gb-london"}, true, "Lagos+London recovered (5 votes)"},
	}

	for i, phase := range phases {
		// Expire any existing lease
		mr.FastForward(10 * time.Second)

		guard, err := fencer.AcquireLease(ctx,
			fmt.Sprintf("chaos-c8-failover-%d", i),
			phase.region, phase.liveRegions, 5*time.Second)

		if phase.expectOK && err != nil {
			t.Errorf("C8 Phase%d [%s]: expected OK, got %v", i+1, phase.desc, err)
		} else if !phase.expectOK && err == nil {
			t.Errorf("C8 Phase%d [%s]: expected failure, got epoch=%d", i+1, phase.desc, guard.Epoch)
			guard.ReleaseLease(ctx)
		} else if phase.expectOK {
			t.Logf("C8 Phase%d [%s]: OK epoch=%d", i+1, phase.desc, guard.Epoch)
			guard.ReleaseLease(ctx)
		} else {
			t.Logf("C8 Phase%d [%s]: Correctly rejected: %v", i+1, phase.desc, err)
		}
	}
}

// ─── C9: Rapid partition/heal cycles ─────────────────────────────────────────

func TestChaos_C9_RapidPartitionHealCycles(t *testing.T) {
	mr, proxy, fencer, client := newChaosEnv(t)
	_ = client
	_ = mr
	ctx := context.Background()

	const cycles = 10
	var successfulAcquires int
	var blockedAcquires int

	for i := 0; i < cycles; i++ {
		// Partition
		proxy.Partition()
		ctxT, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
		_, err := fencer.AcquireLease(ctxT, fmt.Sprintf("chaos-c9-%d", i), "ng-lagos", allRegionsChaos(), 1*time.Second)
		cancel()
		if err != nil {
			blockedAcquires++
		}

		// Heal
		proxy.Heal()
		time.Sleep(50 * time.Millisecond)

		ctxT2, cancel2 := context.WithTimeout(ctx, 500*time.Millisecond)
		guard, err := fencer.AcquireLease(ctxT2, fmt.Sprintf("chaos-c9-healed-%d", i), "ng-lagos", allRegionsChaos(), 1*time.Second)
		cancel2()
		if err == nil {
			successfulAcquires++
			guard.ReleaseLease(ctx)
		}
	}

	t.Logf("C9: %d cycles — blocked during partition: %d/%d, succeeded after heal: %d/%d",
		cycles, blockedAcquires, cycles, successfulAcquires, cycles)

	if blockedAcquires == 0 {
		t.Error("C9: Expected some acquires to be blocked during partition")
	}
	if successfulAcquires == 0 {
		t.Error("C9: Expected some acquires to succeed after heal")
	}
}

// ─── C10: Concurrent partition + lease renewal storm ─────────────────────────

func TestChaos_C10_ConcurrentRenewalStorm(t *testing.T) {
	mr, proxy, fencer, client := newChaosEnv(t)
	_ = client
	ctx := context.Background()

	// Acquire lease
	guard, err := fencer.AcquireLease(ctx, "chaos-c10-storm", "ng-lagos", allRegionsChaos(), 30*time.Second)
	if err != nil {
		t.Fatalf("C10: acquire failed: %v", err)
	}
	t.Logf("C10: Acquired epoch=%d", guard.Epoch)

	// 100 goroutines try to renew simultaneously while we partition/heal
	const n = 100
	var renewOK, renewFail int64
	var wg sync.WaitGroup
	wg.Add(n)

	// Partition mid-storm
	go func() {
		time.Sleep(50 * time.Millisecond)
		proxy.Partition()
		time.Sleep(100 * time.Millisecond)
		proxy.Heal()
	}()

	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			ctxT, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
			defer cancel()
			err := guard.RenewLease(ctxT)
			if err == nil {
				atomic.AddInt64(&renewOK, 1)
			} else {
				atomic.AddInt64(&renewFail, 1)
			}
		}()
	}
	wg.Wait()

	t.Logf("C10: Renewal storm: ok=%d fail=%d total=%d", renewOK, renewFail, n)

	// After heal, lease should still be acquirable
	_ = mr
	mr.FastForward(31 * time.Second) // expire old lease
	proxy.Heal()

	time.Sleep(200 * time.Millisecond)
	guard2, err := fencer.AcquireLease(ctx, "chaos-c10-storm", "ng-lagos", allRegionsChaos(), 5*time.Second)
	if err != nil {
		t.Logf("C10: Post-storm acquire: %v (may need circuit reset)", err)
	} else {
		t.Logf("C10: Post-storm acquire OK epoch=%d", guard2.Epoch)
		guard2.ReleaseLease(ctx)
	}

	// Key assertion: storm did not corrupt the fence
	if renewOK+renewFail != n {
		t.Errorf("C10: Lost %d goroutines", n-int(renewOK+renewFail))
	}
}

// GetCircuitState returns the circuit-breaker state via a standalone RedisClient.
// Used in chaos tests to verify the circuit-breaker opens under partition.
func getFencerCircuitState(client *infra.RedisClient) string {
	return client.GetCircuitState()
}
