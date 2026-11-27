// Command server is the actuary pricing microservice (Leg B, design
// Appendix D/G). Boot sequence per the frozen contract:
//
//  1. connect PG (lib/pq, matching reinsurance-management)
//  2. load approved rate versions + rating tables into immutable
//     in-memory snapshots
//  3. warm Redis accumulation keys from the PG snapshot
//  4. smoke-test cgo (ak_version + one golden premium)
//  5. serve
//
// Degraded modes are fail-closed: a managed line without an approved
// version rates 503, never a guess; a down accumulation store refers
// (ACCUM_UNAVAILABLE), never silently accepts; a failed kernel smoke test
// is fatal.
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"

	"github.com/unified-insurance/actuary-engine/pricing/internal/accumulation"
	"github.com/unified-insurance/actuary-engine/pricing/internal/exposure"
	"github.com/unified-insurance/actuary-engine/pricing/internal/handlers"
	"github.com/unified-insurance/actuary-engine/pricing/internal/kernels"
	"github.com/unified-insurance/actuary-engine/pricing/internal/observability"
	"github.com/unified-insurance/actuary-engine/pricing/internal/rating"
	"github.com/unified-insurance/actuary-engine/pricing/internal/referral"
	"github.com/unified-insurance/actuary-engine/pricing/internal/repository"
	"github.com/unified-insurance/actuary-engine/pricing/internal/service"
	"github.com/unified-insurance/actuary-engine/pricing/internal/shadow"
)

func main() {
	// ── Step 1: connect PG ────────────────────────────────────────────────
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("FATAL: DATABASE_URL environment variable is required")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("FATAL: open database: %v", err)
	}
	defer func() { _ = db.Close() }()
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)

	// ── Stores and engines ────────────────────────────────────────────────
	repo := repository.NewPG(db)
	ratingStore := rating.NewStore()
	limitsStore := exposure.NewStore()
	rulesEngine := referral.NewEngine()
	metrics := observability.NewRegistry()

	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	accumStore := accumulation.NewStore(redis.NewClient(&redis.Options{
		Addr: redisAddr,
		// Quote-hot-path budgets: accumulation lookups must not eat the 5 ms
		// p99 envelope (design §9.3).
		ReadTimeout:  200 * time.Millisecond,
		WriteTimeout: 200 * time.Millisecond,
		DialTimeout:  500 * time.Millisecond,
	}))
	defer func() { _ = accumStore }()

	svc := service.New(repo, ratingStore, limitsStore, accumStore, rulesEngine, metrics,
		shadow.NewClient(os.Getenv("TB_SIDECAR_URL")))

	// ── Steps 2–3: load snapshots + warm accumulation (retry until PG is
	// up; readiness gates serving traffic in the meantime) ────────────────
	loadOnce := func(ctx context.Context) error {
		if err := db.PingContext(ctx); err != nil {
			return fmt.Errorf("pg ping: %w", err)
		}
		return svc.LoadBoot(ctx)
	}
	bootErr := loadOnce(context.Background())
	if bootErr != nil {
		log.Printf("WARN: initial boot load failed (%v); retrying in background, readiness stays down", bootErr)
		go func() {
			for {
				time.Sleep(5 * time.Second)
				if err := loadOnce(context.Background()); err == nil {
					log.Printf("boot load succeeded after retry")
					return
				}
			}
		}()
	} else {
		log.Printf("boot: rating snapshot loaded (%d lines)", len(ratingStore.Current().Lines))
	}

	// ── Step 4: cgo smoke test (ak_version + one golden premium) ─────────
	if err := smokeTestKernels(); err != nil {
		log.Fatalf("FATAL: kernel smoke test failed: %v", err)
	}
	log.Printf("boot: kernel smoke test passed (ak_version=%08x)", kernels.Version())

	// ── Step 5: serve ─────────────────────────────────────────────────────
	h := handlers.New(svc, metrics, os.Getenv("PRICING_HMAC_SECRET"),
		func() (bool, map[string]string) { return readiness(db, ratingStore, accumStore) })
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	port := os.Getenv("PORT")
	if port == "" {
		port = "7080" // Appendix G: actuary-pricing port
	}
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		log.Println("Shutting down gracefully...")
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("Forced shutdown: %v", err)
		}
	}()

	log.Printf("actuary-pricing starting on :%s", port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server failed: %v", err)
	}
}

// smokeTestKernels verifies the cgo boundary against the kernel's own
// documented golden decomposition (premium.rs compose_decomposition_holds):
// base 9,250,000 × rel 1.18, loadings 20%/10%/5%, VAT 7.5% →
// pure 1,091,500,000 / loadings 587,730,769 / total 1,805,173,077 kobo.
// A mismatch means the linked library is not the frozen-contract kernels —
// refuse to serve.
func smokeTestKernels() error {
	if kernels.Version() == 0 {
		return fmt.Errorf("ak_version returned 0")
	}
	q, err := kernels.ComposePremium(9_250_000.0, []float64{1.18}, 0.20, 0.10, 0.05, []float64{0.075}, 0, 1<<62)
	if err != nil {
		return fmt.Errorf("golden premium compose: %w", err)
	}
	if q.PureKobo != 1_091_500_000 || q.LoadingsKobo != 587_730_769 || q.TotalKobo != 1_805_173_077 {
		return fmt.Errorf("golden premium mismatch: got %+v", q)
	}
	return nil
}

// readiness composes the readyz checks (Appendix D): PG reachable, rating
// snapshot loaded, accumulation store reachable, cdylib linked.
func readiness(db *sql.DB, ratingStore *rating.Store, accum *accumulation.Store) (bool, map[string]string) {
	checks := map[string]string{}
	ready := true
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		checks["pg"] = "down: " + err.Error()
		ready = false
	} else {
		checks["pg"] = "ok"
	}
	if ratingStore.Loaded() {
		checks["rating"] = "loaded"
	} else {
		checks["rating"] = "not_loaded"
		ready = false
	}
	if err := accum.Ping(ctx); err != nil {
		checks["accumulation"] = "down: " + err.Error()
		ready = false
	} else {
		checks["accumulation"] = "ok"
	}
	if kernels.Version() == 0 {
		checks["kernels"] = "unlinked"
		ready = false
	} else {
		checks["kernels"] = "linked"
	}
	return ready, checks
}
