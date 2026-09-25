// datasource.go — Q-wave Q5 (2026-09-25)
//
// Datasource adapters mirroring the TS fail-closed semantics of
// server/lib/parametricDatasources.ts EXACTLY (same reasons, same breaker
// thresholds, same staleness rule) so that Go and TS evaluations of the same
// trigger+window reach the same verdict:
//
//   - 'http'   — REAL HTTP GET with hard timeout and a per-URL circuit
//                breaker (3 consecutive failures ⇒ open for 30s, one
//                half-open probe decides recovery). Unreachable, non-2xx,
//                unparseable, schema-invalid, wrong-metric or STALE readings
//                all return a *DatasourceUnavailableError — the caller records
//                parametric_events(status='data_unavailable') and NEVER fires.
//   - 'manual' — staff-attested reading with DUAL CONTROL (attester ≠
//                confirmer) read from parametric_manual_readings; only the
//                latest CONFIRMED reading inside the staleness window counts.
//
// No adapter ever invents a value.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Unavailability reasons — identical vocabulary to the TS adapter.
const (
	ReasonUnreachable   = "unreachable"
	ReasonHTTPError     = "http_error"
	ReasonUnparseable   = "unparseable"
	ReasonSchemaInvalid = "schema_invalid"
	ReasonStale         = "stale"
	ReasonCircuitOpen   = "circuit_open"
	ReasonUnconfirmed   = "unconfirmed"
	ReasonMisconfigured = "misconfigured"
)

type DatasourceUnavailableError struct {
	Reason  string
	Message string
}

func (e *DatasourceUnavailableError) Error() string { return e.Message }

// Reading is what every adapter must produce (mirrors datasourceReadingSchema).
type Reading struct {
	Metric     string    `json:"metric"`
	Value      float64   `json:"value"`
	ObservedAt time.Time `json:"observedAt"`
}

// readingWire is the on-the-wire shape {metric, value, observedAt: ISO-8601}.
type readingWire struct {
	Metric     string  `json:"metric"`
	Value      float64 `json:"value"`
	ObservedAt string  `json:"observedAt"`
}

// DatasourceConfig mirrors datasource_config jsonb: {type:'http',url,...} | {type:'manual'}.
type DatasourceConfig struct {
	Type         string `json:"type"`
	URL          string `json:"url"`
	AuthTokenEnv string `json:"authTokenEnv"`
	TimeoutMs    int    `json:"timeoutMs"`
}

func parseDatasourceConfig(raw []byte) (DatasourceConfig, error) {
	var cfg DatasourceConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg, fmt.Errorf("datasource_config is not valid JSON: %w", err)
	}
	switch cfg.Type {
	case "http":
		if cfg.URL == "" || !(strings.HasPrefix(cfg.URL, "http://") || strings.HasPrefix(cfg.URL, "https://")) {
			return cfg, &DatasourceUnavailableError{Reason: ReasonMisconfigured,
				Message: "http datasource requires a valid url (fail-closed)"}
		}
		if cfg.TimeoutMs <= 0 {
			cfg.TimeoutMs = 10_000
		}
		if cfg.TimeoutMs > 60_000 {
			cfg.TimeoutMs = 60_000
		}
	case "manual":
		// no extra config
	default:
		return cfg, &DatasourceUnavailableError{Reason: ReasonMisconfigured,
			Message: fmt.Sprintf("unknown datasource type %q (fail-closed)", cfg.Type)}
	}
	return cfg, nil
}

// ── Per-URL circuit breaker (mirrors TS: FAILURE_THRESHOLD=3, RESET=30s) ───
const (
	breakerFailureThreshold = 3
	breakerResetMs          = 30_000
)

type breakerState struct {
	failures int
	openedAt time.Time
	open     bool
}

type circuitBreakers struct {
	mu sync.Mutex
	m  map[string]*breakerState
	// now is injectable for tests.
	now func() time.Time
}

func newCircuitBreakers() *circuitBreakers {
	return &circuitBreakers{m: map[string]*breakerState{}, now: time.Now}
}

func (c *circuitBreakers) allow(url string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	b := c.m[url]
	if b == nil || !b.open {
		return nil
	}
	if c.now().Sub(b.openedAt) < breakerResetMs*time.Millisecond {
		return &DatasourceUnavailableError{Reason: ReasonCircuitOpen,
			Message: fmt.Sprintf("datasource circuit OPEN for %s — refusing to call (fail-closed)", url)}
	}
	// half-open probe
	b.open = false
	b.failures = breakerFailureThreshold - 1
	return nil
}

func (c *circuitBreakers) recordFailure(url string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	b := c.m[url]
	if b == nil {
		b = &breakerState{}
		c.m[url] = b
	}
	b.failures++
	if b.failures >= breakerFailureThreshold {
		b.open = true
		b.openedAt = c.now()
	}
}

func (c *circuitBreakers) recordSuccess(url string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	b := c.m[url]
	if b == nil {
		return
	}
	b.failures = 0
	b.open = false
}

// ── HTTP adapter ────────────────────────────────────────────────────────────

// HTTPDoer abstracts *http.Client for honest interface tests.
type HTTPDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

type HTTPDatasource struct {
	client   HTTPDoer
	breakers *circuitBreakers
	// getenv is injectable for tests.
	getenv func(string) string
	now    func() time.Time
}

func NewHTTPDatasource(client HTTPDoer) *HTTPDatasource {
	return &HTTPDatasource{
		client:   client,
		breakers: newCircuitBreakers(),
		getenv:   os.Getenv,
		now:      time.Now,
	}
}

// Fetch retrieves and validates one reading. Any failure returns
// *DatasourceUnavailableError (fail-closed: the caller records
// data_unavailable, never a fabricated value).
func (h *HTTPDatasource) Fetch(ctx context.Context, cfg DatasourceConfig, metric string, windowSeconds int) (Reading, string, json.RawMessage, error) {
	if err := h.breakers.allow(cfg.URL); err != nil {
		return Reading{}, "", nil, err
	}
	fail := func(reason, msg string) (Reading, string, json.RawMessage, error) {
		h.breakers.recordFailure(cfg.URL)
		return Reading{}, "", nil, &DatasourceUnavailableError{Reason: reason, Message: msg}
	}

	token := ""
	if cfg.AuthTokenEnv != "" {
		token = h.getenv(cfg.AuthTokenEnv)
		if token == "" {
			return Reading{}, "", nil, &DatasourceUnavailableError{Reason: ReasonMisconfigured,
				Message: fmt.Sprintf("datasource auth token env %s is not configured (fail-closed)", cfg.AuthTokenEnv)}
		}
	}

	ctx, cancel := context.WithTimeout(ctx, time.Duration(cfg.TimeoutMs)*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.URL, nil)
	if err != nil {
		return Reading{}, "", nil, &DatasourceUnavailableError{Reason: ReasonMisconfigured, Message: err.Error()}
	}
	req.Header.Set("Accept", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	res, err := h.client.Do(req)
	if err != nil {
		return fail(ReasonUnreachable, fmt.Sprintf("datasource unreachable: %s (%v)", cfg.URL, err))
	}
	defer func() { _ = res.Body.Close() }()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fail(ReasonHTTPError, fmt.Sprintf("datasource returned HTTP %d for %s", res.StatusCode, cfg.URL))
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return fail(ReasonUnreachable, fmt.Sprintf("datasource read error: %v", err))
	}
	var wire readingWire
	if err := json.Unmarshal(body, &wire); err != nil {
		return fail(ReasonUnparseable, fmt.Sprintf("datasource response is not valid JSON (%s)", cfg.URL))
	}
	// Schema validation (mirrors zod datasourceReadingSchema).
	if wire.Metric == "" || math.IsNaN(wire.Value) || math.IsInf(wire.Value, 0) || wire.ObservedAt == "" {
		return fail(ReasonSchemaInvalid, "datasource payload failed schema validation (metric/value/observedAt)")
	}
	if wire.Metric != metric {
		return fail(ReasonSchemaInvalid,
			fmt.Sprintf("datasource returned metric '%s', expected '%s'", wire.Metric, metric))
	}
	observed, err := time.Parse(time.RFC3339, wire.ObservedAt)
	if err != nil {
		return fail(ReasonSchemaInvalid, fmt.Sprintf("observedAt is not ISO-8601: %q", wire.ObservedAt))
	}
	// Staleness: a reading older than the trigger window is NOT evidence.
	if h.now().Sub(observed) > time.Duration(windowSeconds)*time.Second {
		return fail(ReasonStale,
			fmt.Sprintf("datasource reading is stale (observedAt=%s, window=%ds)", wire.ObservedAt, windowSeconds))
	}
	h.breakers.recordSuccess(cfg.URL)
	sum := sha256.Sum256(body)
	return Reading{Metric: wire.Metric, Value: wire.Value, ObservedAt: observed},
		hex.EncodeToString(sum[:]), json.RawMessage(body), nil
}

// ── Manual adapter (dual-control attestation from parametric_manual_readings) ─

// ManualReadingStore fetches the latest confirmed manual reading (SQL impl in
// store.go; interface kept for honest tests).
type ManualReadingStore interface {
	LatestConfirmedManualReading(ctx context.Context, triggerID int, metric string) (Reading, int, int, error)
}

// ValidateManualReading mirrors validateManualReading (TS): schema, metric
// match, dual control (attester ≠ confirmer), staleness. Pure function.
func ValidateManualReading(r Reading, metric string, windowSeconds int, attestedBy, confirmedBy int, now time.Time) error {
	if r.Metric == "" || math.IsNaN(r.Value) || math.IsInf(r.Value, 0) || r.ObservedAt.IsZero() {
		return &DatasourceUnavailableError{Reason: ReasonSchemaInvalid,
			Message: "manual reading failed schema validation"}
	}
	if r.Metric != metric {
		return &DatasourceUnavailableError{Reason: ReasonSchemaInvalid,
			Message: fmt.Sprintf("manual reading metric '%s' does not match trigger metric '%s'", r.Metric, metric)}
	}
	if confirmedBy == 0 || attestedBy == 0 || confirmedBy == attestedBy {
		return &DatasourceUnavailableError{Reason: ReasonUnconfirmed,
			Message: "manual reading lacks dual-control confirmation (attester ≠ confirmer required)"}
	}
	if now.Sub(r.ObservedAt) > time.Duration(windowSeconds)*time.Second {
		return &DatasourceUnavailableError{Reason: ReasonStale,
			Message: fmt.Sprintf("manual reading is stale (window=%ds)", windowSeconds)}
	}
	return nil
}

// IsUnavailable reports whether err is a fail-closed datasource error.
func IsUnavailable(err error) bool {
	var du *DatasourceUnavailableError
	return errors.As(err, &du)
}

// ── Threshold comparison (pure; mirrors TS thresholdBreached) ───────────────
func ThresholdBreached(operator string, measured, threshold float64) bool {
	switch operator {
	case "gt":
		return measured > threshold
	case "gte":
		return measured >= threshold
	case "lt":
		return measured < threshold
	case "lte":
		return measured <= threshold
	case "eq":
		return measured == threshold
	default:
		return false // unknown operator ⇒ never fires (fail-closed)
	}
}

// EvaluationWindowKey mirrors evaluationWindowKey (TS):
// `trigger-<id>:window-<floor(nowMs/(windowSeconds*1000))*windowSeconds>`.
// Identical keys ⇒ the Go service and TS engine dedupe against the SAME
// parametric_events.event_key row.
func EvaluationWindowKey(triggerID int, windowSeconds int, now time.Time) string {
	start := now.UnixMilli() / (int64(windowSeconds) * 1000) * int64(windowSeconds)
	return fmt.Sprintf("trigger-%d:window-%d", triggerID, start)
}
