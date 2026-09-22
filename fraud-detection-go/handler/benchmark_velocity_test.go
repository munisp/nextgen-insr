package handler

// benchmark_velocity_test.go — 2026-09-22 (perf wave P): demonstrates the
// before/after shape of the fraud-score velocity path. Both benchmarks use
// a VelocityStorer with a simulated 2 ms network RTT per Redis op.
//
//	BenchmarkEvaluateVelocitySequential — the OLD shape: up to 3 serialized
//	  RTTs (kept here as a reference implementation of the pre-fix loop).
//	BenchmarkEvaluateVelocityParallel — the NEW shape: dimensions checked
//	  concurrently via production EvaluateVelocity.
//
// Expected: parallel ≈ 1 RTT (~2 ms) vs sequential ≈ 3 RTTs (~6 ms).

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/insureportal/fraud-detection-go/models"
	"go.uber.org/zap"
)

const benchSimulatedRTT = 2 * time.Millisecond

// latencyStore is a VelocityStorer that sleeps one simulated RTT per call.
type latencyStore struct {
	mu      sync.Mutex
	entries map[string]int
}

func newLatencyStore() *latencyStore { return &latencyStore{entries: map[string]int{}} }

func (l *latencyStore) CheckVelocityDimension(_ context.Context, dimension, id string, _ time.Duration) (int, error) {
	time.Sleep(benchSimulatedRTT)
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.entries[dimension+":"+id], nil
}

func (l *latencyStore) TrackVelocityDimension(_ context.Context, dimension, id string) error {
	time.Sleep(benchSimulatedRTT)
	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries[dimension+":"+id]++
	return nil
}

// evaluateVelocitySequential is a verbatim copy of the pre-2026-09-22
// sequential loop, retained ONLY as the "before" benchmark reference.
func evaluateVelocitySequential(ctx context.Context, store VelocityStorer, input models.TransactionInput, window time.Duration, threshold int, log *zap.Logger) VelocityResult {
	res := VelocityResult{Dimensions: map[string]int{}}
	for dim, id := range velocityDimensions(input) {
		count, err := store.CheckVelocityDimension(ctx, dim, id, window)
		if err != nil {
			continue
		}
		res.Dimensions[dim] = count
		if count > res.MaxCount {
			res.MaxCount = count
		}
		if count+1 >= threshold {
			res.Breached = append(res.Breached, dim)
		}
	}
	return res
}

var benchInput = models.TransactionInput{
	AccountID: "acct-bench",
	IP:        "203.0.113.9",
	DeviceID:  "dev-bench",
}

func BenchmarkEvaluateVelocitySequential(b *testing.B) {
	store := newLatencyStore()
	log := zap.NewNop()
	ctx := context.Background()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		evaluateVelocitySequential(ctx, store, benchInput, time.Hour, 5, log)
	}
}

func BenchmarkEvaluateVelocityParallel(b *testing.B) {
	store := newLatencyStore()
	log := zap.NewNop()
	ctx := context.Background()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		EvaluateVelocity(ctx, store, benchInput, time.Hour, 5, log)
	}
}

func BenchmarkTrackVelocityDimensionsParallel(b *testing.B) {
	store := newLatencyStore()
	log := zap.NewNop()
	ctx := context.Background()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = TrackVelocityDimensions(ctx, store, benchInput, log)
	}
}
