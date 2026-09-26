// main.go — Q-wave Q5 (2026-09-25): parametric-evaluator (Go).
//
// Polyglot companion to the Q2 TS parametric engine: evaluates
// parametric_trigger_definitions on a poll loop against REAL configured
// datasources (fail-closed), writes parametric_events rows (idempotent),
// publishes `parametric.events` to Kafka + Fluvio, bulk-indexes to
// OpenSearch (config-gated) and enriches fired events with a Dapr-invoked
// fraud score from fraud-detection-go (config-gated).
//
// Outbox discipline: claim creation and parametric_payout_settlements are
// owned EXCLUSIVELY by the TS engine (server/lib/parametricEngine.ts) —
// this service never writes to claims or payouts.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

const parametricEventsTopic = "parametric.events"

type server struct {
	cfg       Config
	store     EventStore
	evaluator *Evaluator
	metrics   *Metrics
	started   time.Time
}

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC | log.Lmicroseconds)
	cfg := LoadConfig()

	rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	store, err := NewPGStore(rootCtx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("FATAL: postgres init failed (fail-closed): %v", err)
	}
	defer func() { _ = store.Close() }()

	metrics := NewMetrics()

	// Redis dedupe (optional — degrades to DB uniqueness guard, disclosed).
	var deduper Deduper = nilDeduper{}
	if cfg.RedisURL != "" {
		if rd, err := NewRedisDeduper(rootCtx, cfg.RedisURL); err != nil {
			log.Printf("[redis] unavailable: %v — dedupe via DB UNIQUE(event_key) only (disclosed 2026-09-25)", err)
			metrics.RedisFallbacks.Inc()
		} else {
			deduper = rd
			defer func() { _ = rd.Close() }()
		}
	}

	// Publishers (config-gated).
	var publishers []Publisher
	if cfg.KafkaBrokers != "" {
		kp := NewKafkaPublisher(cfg.KafkaBrokers, parametricEventsTopic)
		publishers = append(publishers, kp)
		defer func() { _ = kp.Close() }()
	}
	if cfg.FluvioAddr != "" {
		publishers = append(publishers, NewFluvioPublisher(cfg.FluvioAddr, cfg.FluvioAPIKey, parametricEventsTopic))
	}
	if cfg.OpenSearchAddr != "" {
		publishers = append(publishers, NewOpenSearchPublisher(cfg.OpenSearchAddr, cfg.OpenSearchIndex))
	}

	// Dapr fraud scoring (config-gated).
	var fraud FraudScorer
	if cfg.FraudDaprAppID != "" {
		fraud = NewDaprFraudScorer(cfg.DaprHTTPPort, cfg.FraudDaprAppID)
	}

	ev := &Evaluator{
		store:      store,
		httpDS:     NewHTTPDatasource(&http.Client{Timeout: cfg.DefaultFetchTimeout}),
		dedupe:     deduper,
		publishers: publishers,
		fraud:      fraud,
		metrics:    metrics,
		now:        time.Now,
	}

	s := &server{cfg: cfg, store: store, evaluator: ev, metrics: metrics, started: time.Now()}

	// Poll loop.
	go func() {
		ticker := time.NewTicker(cfg.PollInterval)
		defer ticker.Stop()
		for {
			select {
			case <-rootCtx.Done():
				return
			case <-ticker.C:
				pollCtx, cancel := context.WithTimeout(rootCtx, 5*time.Minute)
				evaluated, errs := ev.PollDue(pollCtx)
				cancel()
				if evaluated > 0 || errs > 0 {
					log.Printf("[poll] evaluated=%d errors=%d", evaluated, errs)
				}
			}
		}
	}()

	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.Recoverer, middleware.Timeout(30*time.Second))
	r.Get("/healthz", s.handleHealthz)
	r.Get("/metrics", s.metrics.Handler())
	// Manual re-evaluation hook for operators (idempotent by event_key).
	r.Post("/evaluate/{triggerID}", s.handleEvaluate)

	httpServer := &http.Server{Addr: ":" + itoa(cfg.Port), Handler: r}
	go func() {
		<-rootCtx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()
	log.Printf("[parametric-evaluator] listening on :%d (poll=%s, publishers=%d, fraud=%t)",
		cfg.Port, cfg.PollInterval, len(publishers), fraud != nil)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("FATAL: http server: %v", err)
	}
}

func itoa(i int) string { return strconv.Itoa(i) }

func (s *server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	dbOK := s.store.Ping(ctx) == nil
	status := "ok"
	code := http.StatusOK
	if !dbOK {
		status = "degraded" // fail-closed: DB is the source of truth
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, map[string]any{
		"status": status,
		"checks": map[string]any{
			"postgres":        dbOK,
			"kafka_enabled":   s.cfg.KafkaBrokers != "",
			"fluvio_enabled":  s.cfg.FluvioAddr != "",
			"opensearch":      s.cfg.OpenSearchAddr != "",
			"fraud_dapr":      s.cfg.FraudDaprAppID != "",
			"redis_dedupe":    s.cfg.RedisURL != "",
		},
		"uptimeSeconds": int(time.Since(s.started).Seconds()),
		"service":       "parametric-evaluator",
		"version":       "q5-2026-09-25",
	})
}

func (s *server) handleEvaluate(w http.ResponseWriter, r *http.Request) {
	id, err := parsePositiveInt(chi.URLParam(r, "triggerID"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid triggerID"})
		return
	}
	triggers, err := s.store.ActiveTriggers(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "trigger lookup failed"})
		return
	}
	for _, t := range triggers {
		if t.ID == id {
			res, err := s.evaluator.EvaluateOnce(r.Context(), t)
			if err != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, res)
			return
		}
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "active trigger not found"})
}

func parsePositiveInt(s string) (int, error) {
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("invalid positive integer %q", s)
	}
	return n, nil
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
