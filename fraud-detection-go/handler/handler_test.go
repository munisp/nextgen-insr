package handler

// handler_test.go — I-wave (AB-21, 2026-09): proves the multi-dimension
// velocity evaluation closes the account-switching bypass. The in-memory
// store is a REAL implementation of the VelocityStorer contract (sliding
// window, per-dimension keys) — not a mock of the scorer.

import (
	"context"
	"testing"
	"time"

	"github.com/insureportal/fraud-detection-go/models"
	"go.uber.org/zap"
)

// memVelocityStore implements VelocityStorer with real sliding-window
// semantics (timestamps per dimension key).
type memVelocityStore struct {
	entries map[string][]time.Time
}

func newMemVelocityStore() *memVelocityStore {
	return &memVelocityStore{entries: map[string][]time.Time{}}
}

func (m *memVelocityStore) TrackVelocityDimension(_ context.Context, dimension, id string) error {
	key := dimension + ":" + id
	m.entries[key] = append(m.entries[key], time.Now())
	return nil
}

func (m *memVelocityStore) CheckVelocityDimension(_ context.Context, dimension, id string, window time.Duration) (int, error) {
	key := dimension + ":" + id
	cutoff := time.Now().Add(-window)
	n := 0
	for _, t := range m.entries[key] {
		if t.After(cutoff) {
			n++
		}
	}
	return n, nil
}

func testLogger() *zap.Logger { return zap.NewNop() }

func TestVelocityAccountSwitchingSameIPTrips(t *testing.T) {
	ctx := context.Background()
	store := newMemVelocityStore()
	window := time.Hour
	threshold := 5

	// Attacker runs 4 transactions on 4 DIFFERENT accounts, all from one
	// IP and one device (the account-switching bypass shape).
	for _, acct := range []string{"acct-1", "acct-2", "acct-3", "acct-4"} {
		input := models.TransactionInput{AccountID: acct, IP: "203.0.113.9", DeviceID: "dev-xyz"}
		if err := TrackVelocityDimensions(ctx, store, input, testLogger()); err != nil {
			t.Fatalf("track: %v", err)
		}
	}

	// The 5th transaction uses a FRESH account — the old account-only
	// window would have seen count=1; the IP/device dimensions must trip.
	fresh := models.TransactionInput{AccountID: "acct-5", IP: "203.0.113.9", DeviceID: "dev-xyz"}
	res := EvaluateVelocity(ctx, store, fresh, window, threshold, testLogger())

	if res.Dimensions["account"] != 0 {
		t.Fatalf("fresh account count = %d, want 0", res.Dimensions["account"])
	}
	if res.Dimensions["ip"] != 4 || res.Dimensions["device"] != 4 {
		t.Fatalf("ip/device counts = %d/%d, want 4/4", res.Dimensions["ip"], res.Dimensions["device"])
	}
	if res.MaxCount+1 < threshold {
		t.Fatalf("velocity count incl. this txn = %d, want >= threshold %d", res.MaxCount+1, threshold)
	}
	if len(res.Breached) == 0 {
		t.Fatal("expected at least one breached dimension for account-switching")
	}
	// The account dimension alone must NOT be the breached one.
	for _, d := range res.Breached {
		if d == "account" {
			t.Fatal("account dimension should not have breached for a fresh account")
		}
	}
}

func TestVelocityAccountDimensionPreserved(t *testing.T) {
	ctx := context.Background()
	store := newMemVelocityStore()
	window := time.Hour
	threshold := 3

	input := models.TransactionInput{AccountID: "acct-solo"}
	for i := 0; i < 2; i++ {
		_ = TrackVelocityDimensions(ctx, store, input, testLogger())
	}
	res := EvaluateVelocity(ctx, store, input, window, threshold, testLogger())
	if res.Dimensions["account"] != 2 {
		t.Fatalf("account count = %d, want 2", res.Dimensions["account"])
	}
	if res.MaxCount+1 < threshold {
		t.Fatalf("same-account velocity not detected: %d", res.MaxCount+1)
	}
}

func TestVelocityEmptyDimensionsNeverKeyed(t *testing.T) {
	ctx := context.Background()
	store := newMemVelocityStore()

	input := models.TransactionInput{AccountID: "acct-noctx"}
	if err := TrackVelocityDimensions(ctx, store, input, testLogger()); err != nil {
		t.Fatalf("track: %v", err)
	}
	if len(store.entries) != 1 {
		t.Fatalf("dimensions tracked = %d, want exactly 1 (account only)", len(store.entries))
	}
	res := EvaluateVelocity(ctx, store, input, time.Hour, 10, testLogger())
	if _, ok := res.Dimensions["ip"]; ok {
		t.Fatal("empty IP must not be evaluated as a dimension")
	}
	if _, ok := res.Dimensions["device"]; ok {
		t.Fatal("empty device must not be evaluated as a dimension")
	}
}

func TestVelocityDistinctIPsDoNotShareWindow(t *testing.T) {
	ctx := context.Background()
	store := newMemVelocityStore()
	window := time.Hour
	threshold := 3

	// Same account from two different IPs: the account dimension still
	// aggregates, but the IP windows stay separate.
	_ = TrackVelocityDimensions(ctx, store, models.TransactionInput{AccountID: "acct-roam", IP: "198.51.100.1"}, testLogger())
	_ = TrackVelocityDimensions(ctx, store, models.TransactionInput{AccountID: "acct-roam", IP: "198.51.100.2"}, testLogger())
	res := EvaluateVelocity(ctx, store, models.TransactionInput{AccountID: "acct-roam", IP: "198.51.100.2"}, window, threshold, testLogger())
	if res.Dimensions["ip"] != 1 {
		t.Fatalf("ip count = %d, want 1 (per-IP window)", res.Dimensions["ip"])
	}
	if res.Dimensions["account"] != 2 {
		t.Fatalf("account count = %d, want 2 (cross-IP aggregation)", res.Dimensions["account"])
	}
}
