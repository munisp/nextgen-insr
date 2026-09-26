// Q-wave Q5 (2026-09-25) — polyglot parametric evaluator.
//
// config.go — environment-driven configuration. Every external integration
// is CONFIG-GATED and FAIL-CLOSED: an unset endpoint disables the
// integration (logged + surfaced on /healthz), never silently defaulted to
// a fabricated value.
package main

import (
	"log"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port int

	// Required: shared Postgres (source of truth — the Q2 TS engine's
	// parametric_* tables, migration 0087).
	DatabaseURL string

	// Redis dedupe (optional-but-recommended). When unset the service still
	// runs: the parametric_events.event_key UNIQUE constraint is the ultimate
	// idempotency guard (disclosed 2026-09-25); Redis SETNX is only an
	// optimisation to short-circuit duplicates before the INSERT.
	RedisURL string

	// Kafka publish of `parametric.events` (config-gated).
	KafkaBrokers string

	// Fluvio HTTP bridge (repo convention: shared/messaging/fluvio.go and
	// server/lib/fluvioClient.ts — produce via HTTP POST to the bridge).
	// Config-gated: unset ⇒ Fluvio publish disabled (fail-closed, disclosed).
	FluvioAddr   string
	FluvioAPIKey string

	// OpenSearch bulk indexing of parametric_events (config-gated).
	OpenSearchAddr  string
	OpenSearchIndex string

	// Dapr service invocation → fraud-detection-go for linked-claims scoring
	// (config-gated: FRAUD_DAPR_APP_ID unset ⇒ scoring skipped; the TS engine
	// remains the settlement writer and applies its own fail-closed fraud
	// gate — Go never settles).
	DaprHTTPPort    string
	FraudDaprAppID  string

	// Poll cadence for due trigger evaluations.
	PollInterval time.Duration

	// Datasource fetch defaults (per-trigger timeoutMs in datasource_config
	// overrides, capped at 60s — mirrors server/lib/parametricDatasources.ts).
	DefaultFetchTimeout time.Duration
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func LoadConfig() Config {
	port, err := strconv.Atoi(envOr("PORT", "8095"))
	if err != nil {
		log.Fatalf("FATAL: invalid PORT: %v", err)
	}
	pollMs, err := strconv.Atoi(envOr("POLL_INTERVAL_MS", "30000"))
	if err != nil || pollMs < 1000 {
		log.Fatalf("FATAL: POLL_INTERVAL_MS must be an integer >= 1000")
	}
	cfg := Config{
		Port:                port,
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		RedisURL:            os.Getenv("REDIS_URL"),
		KafkaBrokers:        os.Getenv("KAFKA_BROKERS"),
		FluvioAddr:          os.Getenv("FLUVIO_ADDR"),
		FluvioAPIKey:        os.Getenv("FLUVIO_API_KEY"),
		OpenSearchAddr:      os.Getenv("OPENSEARCH_ADDR"),
		OpenSearchIndex:     envOr("OPENSEARCH_PARAMETRIC_INDEX", "insureportal-parametric-events"),
		DaprHTTPPort:        envOr("DAPR_HTTP_PORT", "3500"),
		FraudDaprAppID:      os.Getenv("FRAUD_DAPR_APP_ID"),
		PollInterval:        time.Duration(pollMs) * time.Millisecond,
		DefaultFetchTimeout: 10 * time.Second,
	}
	if cfg.DatabaseURL == "" {
		log.Fatal("FATAL: DATABASE_URL environment variable is required (fail-closed: no source of truth, no evaluation)")
	}
	if cfg.RedisURL == "" {
		log.Printf("[config] REDIS_URL unset — dedupe degrades to DB UNIQUE(event_key) guard only (disclosed 2026-09-25)")
	}
	if cfg.KafkaBrokers == "" {
		log.Printf("[config] KAFKA_BROKERS unset — Kafka publish of parametric.events DISABLED (fail-closed, disclosed 2026-09-25)")
	}
	if cfg.FluvioAddr == "" {
		log.Printf("[config] FLUVIO_ADDR unset — Fluvio publish DISABLED (fail-closed, disclosed 2026-09-25)")
	}
	if cfg.OpenSearchAddr == "" {
		log.Printf("[config] OPENSEARCH_ADDR unset — OpenSearch indexing DISABLED (fail-closed, disclosed 2026-09-25)")
	}
	if cfg.FraudDaprAppID == "" {
		log.Printf("[config] FRAUD_DAPR_APP_ID unset — Dapr fraud scoring DISABLED (fail-closed, disclosed 2026-09-25)")
	}
	return cfg
}
