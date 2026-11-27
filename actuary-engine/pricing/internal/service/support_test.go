// support_test.go holds the shared test wiring for the service package:
// the fixture repository (real boot-payload build path) plus a real
// Redis-protocol accumulation store (miniredis) — the same client code the
// production service runs against a live Redis.
package service_test

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/unified-insurance/actuary-engine/pricing/internal/accumulation"
	"github.com/unified-insurance/actuary-engine/pricing/internal/exposure"
	"github.com/unified-insurance/actuary-engine/pricing/internal/observability"
	"github.com/unified-insurance/actuary-engine/pricing/internal/rating"
	"github.com/unified-insurance/actuary-engine/pricing/internal/referral"
	"github.com/unified-insurance/actuary-engine/pricing/internal/repository"
	"github.com/unified-insurance/actuary-engine/pricing/internal/service"
)

// newTestService builds the full service on the fixture seed and a fresh
// miniredis instance, loading the boot payload exactly as production does
// (rating snapshot swap + limits swap + rules swap + accumulation warm).
func newTestService(t testing.TB) (*service.Service, *repository.Fixture, *accumulation.Store) {
	t.Helper()
	fix, err := repository.LoadFixture("../../testdata/seed/rating_fixtures.json")
	if err != nil {
		t.Fatalf("load fixture: %v", err)
	}
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	accumStore := accumulation.NewStore(rdb)

	svc := service.New(fix, rating.NewStore(), exposure.NewStore(), accumStore,
		referral.NewEngine(), observability.NewRegistry(), nil)
	if err := svc.LoadBoot(context.Background()); err != nil {
		t.Fatalf("boot load: %v", err)
	}
	return svc, fix, accumStore
}

// newTestServiceNoAccum builds the service with an accumulation store
// pointing at a dead address — every check must fail closed
// (ACCUM_UNAVAILABLE).
func newTestServiceNoAccum(t *testing.T) *service.Service {
	t.Helper()
	fix, err := repository.LoadFixture("../../testdata/seed/rating_fixtures.json")
	if err != nil {
		t.Fatalf("load fixture: %v", err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: "127.0.0.1:63999"})
	accumStore := accumulation.NewStore(rdb)
	svc := service.New(fix, rating.NewStore(), exposure.NewStore(), accumStore,
		referral.NewEngine(), observability.NewRegistry(), nil)
	if err := svc.LoadBoot(context.Background()); err != nil {
		// Accumulation warm tolerates dead store (logged, not fatal) — the
		// authoritative checks still fail closed.
		t.Logf("boot load with dead accum: %v (expected tolerance)", err)
	}
	return svc
}
