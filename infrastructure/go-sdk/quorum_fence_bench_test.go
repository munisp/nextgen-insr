// Package infra — Quorum Fence Performance Benchmarks
//
// Benchmarks targeting 10,000 QPS across all quorum fence operations.
// Uses miniredis (in-process Redis) to isolate Go-side latency from network.
//
// Run with:
//   go test -bench=. -benchtime=10s -benchmem -count=3 ./...
//
// Benchmarks:
//   BenchmarkAcquireRelease_*        — full acquire+release cycle at various latencies
//   BenchmarkRenewLease_*            — lease renewal throughput
//   BenchmarkHasQuorum_*             — pure CPU quorum check (no Redis)
//   BenchmarkConcurrent_*            — concurrent acquire throughput
//   BenchmarkLuaScript_*             — individual Lua script execution
//   BenchmarkGetFenceStatus_*        — status query throughput
//   BenchmarkHighFrequency_10kQPS    — sustained 10,000 QPS simulation

package infra_test

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	miniredis "github.com/alicebob/miniredis/v2"
	"go.uber.org/zap"

	infra "github.com/munisp/NGApp/infrastructure/go-sdk"
)

// ─── Benchmark helpers ────────────────────────────────────────────────────────

func newBenchEnv(b *testing.B) (*infra.RedisClient, *infra.QuorumFencer) {
	b.Helper()
	mr := miniredis.RunT(b)
	log, _ := zap.NewProduction()
	client := infra.NewRedisClient(log, mr.Addr())
	return client, infra.NewQuorumFencer(client)
}

func benchAllRegions() []string { return []string{"ng-lagos", "gb-london", "sg-singapore"} }

// ─── BenchmarkAcquireRelease: full acquire+release cycle ─────────────────────

func BenchmarkAcquireRelease_Lagos_0ms(b *testing.B) {
	_, fencer := newBenchEnv(b)
	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		resource := fmt.Sprintf("bench-ar-%d", i)
		guard, err := fencer.AcquireLease(ctx, resource, "ng-lagos", benchAllRegions(), 30*time.Second)
		if err != nil {
			b.Fatalf("AcquireLease: %v", err)
		}
		if err := guard.ReleaseLease(ctx); err != nil {
			b.Fatalf("ReleaseLease: %v", err)
		}
	}
}

func BenchmarkAcquireRelease_London_120ms(b *testing.B) {
	mr := miniredis.RunT(b)
	proxy, _ := newLatencyProxy(mr.Addr(), 55*time.Millisecond, 65*time.Millisecond, 0)
	defer proxy.Close()
	log, _ := zap.NewProduction()
	client := infra.NewRedisClient(log, proxy.Addr())
	fencer := infra.NewQuorumFencer(client)
	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		resource := fmt.Sprintf("bench-london-%d", i)
		guard, err := fencer.AcquireLease(ctx, resource, "ng-lagos", benchAllRegions(), 30*time.Second)
		if err != nil {
			b.Fatalf("AcquireLease: %v", err)
		}
		if err := guard.ReleaseLease(ctx); err != nil {
			b.Fatalf("ReleaseLease: %v", err)
		}
	}
}

func BenchmarkAcquireRelease_Singapore_250ms(b *testing.B) {
	mr := miniredis.RunT(b)
	proxy, _ := newLatencyProxy(mr.Addr(), 120*time.Millisecond, 130*time.Millisecond, 0)
	defer proxy.Close()
	log, _ := zap.NewProduction()
	client := infra.NewRedisClient(log, proxy.Addr())
	fencer := infra.NewQuorumFencer(client)
	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		resource := fmt.Sprintf("bench-sg-%d", i)
		guard, err := fencer.AcquireLease(ctx, resource, "ng-lagos", benchAllRegions(), 30*time.Second)
		if err != nil {
			b.Fatalf("AcquireLease: %v", err)
		}
		if err := guard.ReleaseLease(ctx); err != nil {
			b.Fatalf("ReleaseLease: %v", err)
		}
	}
}

// ─── BenchmarkRenewLease: renewal throughput ─────────────────────────────────

func BenchmarkRenewLease_Lagos_0ms(b *testing.B) {
	_, fencer := newBenchEnv(b)
	ctx := context.Background()
	guard, err := fencer.AcquireLease(ctx, "bench-renew", "ng-lagos", benchAllRegions(), 300*time.Second)
	if err != nil {
		b.Fatalf("AcquireLease: %v", err)
	}
	defer guard.ReleaseLease(ctx)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if err := guard.RenewLease(ctx); err != nil {
			b.Fatalf("RenewLease[%d]: %v", i, err)
		}
	}
}

// ─── BenchmarkHasQuorum: pure CPU quorum check ────────────────────────────────

func BenchmarkHasQuorum_AllRegions(b *testing.B) {
	regions := benchAllRegions()
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		infra.HasQuorum(regions)
	}
}

func BenchmarkHasQuorum_PartialQuorum(b *testing.B) {
	regions := []string{"ng-lagos", "sg-singapore"} // 4 votes = exact majority
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		infra.HasQuorum(regions)
	}
}

func BenchmarkHasQuorum_NoQuorum(b *testing.B) {
	regions := []string{"gb-london", "sg-singapore"} // 3 votes < 4
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		infra.HasQuorum(regions)
	}
}

// ─── BenchmarkConcurrent: concurrent acquire throughput ──────────────────────

func BenchmarkConcurrent_10Goroutines(b *testing.B) {
	_, fencer := newBenchEnv(b)
	ctx := context.Background()
	var counter int64
	b.ResetTimer()
	b.ReportAllocs()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			n := atomic.AddInt64(&counter, 1)
			resource := fmt.Sprintf("bench-conc-%d", n)
			guard, err := fencer.AcquireLease(ctx, resource, "ng-lagos", benchAllRegions(), 30*time.Second)
			if err != nil {
				continue // ErrFenceConflict is expected under contention
			}
			guard.ReleaseLease(ctx)
		}
	})
}

// ─── BenchmarkGetFenceStatus: status query throughput ─────────────────────────

func BenchmarkGetFenceStatus_Held(b *testing.B) {
	_, fencer := newBenchEnv(b)
	ctx := context.Background()
	guard, err := fencer.AcquireLease(ctx, "bench-status", "ng-lagos", benchAllRegions(), 300*time.Second)
	if err != nil {
		b.Fatalf("AcquireLease: %v", err)
	}
	defer guard.ReleaseLease(ctx)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, err := fencer.GetFenceStatus(ctx, "bench-status", benchAllRegions())
		if err != nil {
			b.Fatalf("GetFenceStatus: %v", err)
		}
	}
}

func BenchmarkGetFenceStatus_NotHeld(b *testing.B) {
	_, fencer := newBenchEnv(b)
	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, err := fencer.GetFenceStatus(ctx, "bench-status-empty", benchAllRegions())
		if err != nil {
			b.Fatalf("GetFenceStatus: %v", err)
		}
	}
}

// ─── BenchmarkHighFrequency_10kQPS: sustained 10,000 QPS simulation ──────────
//
// This benchmark simulates 10,000 QPS by running acquire+release operations
// across 100 goroutines for 1 second and measuring actual throughput.

func BenchmarkHighFrequency_10kQPS(b *testing.B) {
	_, fencer := newBenchEnv(b)
	ctx := context.Background()

	const (
		goroutines = 100
		duration   = 1 * time.Second
	)

	b.ResetTimer()
	b.ReportAllocs()

	for iter := 0; iter < b.N; iter++ {
		var (
			ops     int64
			errors  int64
			wg      sync.WaitGroup
			stop    = make(chan struct{})
		)

		wg.Add(goroutines)
		for g := 0; g < goroutines; g++ {
			go func(g int) {
				defer wg.Done()
				localOps := int64(0)
				for {
					select {
					case <-stop:
						atomic.AddInt64(&ops, localOps)
						return
					default:
					}
					resource := fmt.Sprintf("bench-10k-%d-%d", g, localOps)
					guard, err := fencer.AcquireLease(ctx, resource, "ng-lagos", benchAllRegions(), 30*time.Second)
					if err != nil {
						atomic.AddInt64(&errors, 1)
						continue
					}
					guard.ReleaseLease(ctx)
					localOps++
				}
			}(g)
		}

		time.Sleep(duration)
		close(stop)
		wg.Wait()

		qps := float64(ops) / duration.Seconds()
		b.ReportMetric(qps, "ops/sec")
		b.ReportMetric(float64(errors), "errors")
	}
}

// ─── BenchmarkLuaScript: individual Lua script execution ─────────────────────
//
// Measures the raw throughput of each Lua script in isolation.

func BenchmarkLuaScript_Acquire(b *testing.B) {
	_, fencer := newBenchEnv(b)
	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		resource := fmt.Sprintf("lua-acquire-%d", i)
		guard, err := fencer.AcquireLease(ctx, resource, "ng-lagos", benchAllRegions(), 30*time.Second)
		if err != nil {
			b.Fatalf("acquire: %v", err)
		}
		// Don't release — measure acquire only
		_ = guard
	}
}

func BenchmarkLuaScript_Renew(b *testing.B) {
	_, fencer := newBenchEnv(b)
	ctx := context.Background()
	guard, err := fencer.AcquireLease(ctx, "lua-renew", "ng-lagos", benchAllRegions(), 3600*time.Second)
	if err != nil {
		b.Fatalf("acquire: %v", err)
	}
	defer guard.ReleaseLease(ctx)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if err := guard.RenewLease(ctx); err != nil {
			b.Fatalf("renew[%d]: %v", i, err)
		}
	}
}

func BenchmarkLuaScript_Release(b *testing.B) {
	_, fencer := newBenchEnv(b)
	ctx := context.Background()
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		resource := fmt.Sprintf("lua-release-%d", i)
		guard, err := fencer.AcquireLease(ctx, resource, "ng-lagos", benchAllRegions(), 30*time.Second)
		if err != nil {
			b.Fatalf("acquire: %v", err)
		}
		b.StartTimer()
		if err := guard.ReleaseLease(ctx); err != nil {
			b.Fatalf("release: %v", err)
		}
	}
}

// ─── BenchmarkRenewLock: backward-compat lock renewal ────────────────────────

func BenchmarkRenewLock_Legacy(b *testing.B) {
	client, _ := newBenchEnv(b)
	ctx := context.Background()
	guard, err := client.AcquireLock(ctx, "bench-legacy-lock", 300*time.Second)
	if err != nil {
		b.Fatalf("AcquireLock: %v", err)
	}
	defer client.ReleaseLock(ctx, guard)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if err := client.RenewLock(ctx, guard, 300*time.Second); err != nil {
			b.Fatalf("RenewLock[%d]: %v", i, err)
		}
	}
}
