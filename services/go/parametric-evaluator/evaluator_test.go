// evaluator_test.go — Q5 (2026-09-25). Evaluator orchestration tests with
// honest in-memory implementations of the EventStore/Deduper/Publisher
// interfaces (interfaces are the production seams; production wiring uses
// Postgres + Redis + Kafka/Fluvio/OpenSearch). Verifies: fail-closed
// data_unavailable recording, fired/not_fired insertion, idempotent replay,
// Redis dedupe skip, fan-out only for newly inserted events.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// ── Honest in-memory test doubles for the production interfaces ────────────

type memStore struct {
	mu       sync.Mutex
	events   map[string]*EventRecord
	nextID   int
	readings map[int]Reading // triggerID → latest confirmed manual reading
	attested map[int][2]int  // triggerID → [attestedBy, confirmedBy]
}

func newMemStore() *memStore {
	return &memStore{events: map[string]*EventRecord{}, nextID: 1,
		readings: map[int]Reading{}, attested: map[int][2]int{}}
}

func (m *memStore) ActiveTriggers(context.Context) ([]Trigger, error) { return nil, nil }
func (m *memStore) Ping(context.Context) error                        { return nil }
func (m *memStore) Close() error                                      { return nil }

func (m *memStore) InsertEvent(_ context.Context, e EventRecord) (EventRecord, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.events[e.EventKey]; ok {
		return *existing, true, nil
	}
	e.ID = m.nextID
	m.nextID++
	e.CreatedAt = time.Now()
	m.events[e.EventKey] = &e
	return e, false, nil
}

func (m *memStore) LatestConfirmedManualReading(_ context.Context, triggerID int, metric string) (Reading, int, int, error) {
	r, ok := m.readings[triggerID]
	if !ok {
		return Reading{}, 0, 0, &DatasourceUnavailableError{Reason: ReasonUnconfirmed,
			Message: "no confirmed manual reading (fail-closed)"}
	}
	pair := m.attested[triggerID]
	return r, pair[0], pair[1], nil
}

type memDeduper struct {
	mu   sync.Mutex
	held map[string]bool
	err  error
}

func (d *memDeduper) Acquire(_ context.Context, key string, _ time.Duration) (bool, error) {
	if d.err != nil {
		return false, d.err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.held == nil {
		d.held = map[string]bool{}
	}
	if d.held[key] {
		return false, nil
	}
	d.held[key] = true
	return true, nil
}

type memPublisher struct {
	mu   sync.Mutex
	name string
	envs []EventEnvelope
	err  error
}

func (p *memPublisher) Name() string { return p.name }
func (p *memPublisher) Publish(_ context.Context, env EventEnvelope) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.envs = append(p.envs, env)
	return p.err
}
func (p *memPublisher) count() int { p.mu.Lock(); defer p.mu.Unlock(); return len(p.envs) }

type memFraud struct {
	score *float64
	err   error
	calls int
}

func (f *memFraud) ScoreEvent(context.Context, EventEnvelope) (*float64, error) {
	f.calls++
	return f.score, f.err
}

// ── helpers ────────────────────────────────────────────────────────────────

func httpTrigger(id int, url string) Trigger {
	cfg, _ := json.Marshal(map[string]any{"type": "http", "url": url, "timeoutMs": 5000})
	return Trigger{
		ID: id, Name: fmt.Sprintf("t-%d", id), Metric: "rainfall_mm", Operator: "gte",
		Threshold: 50, WindowSeconds: 3600, DatasourceConfig: cfg, Status: "active",
	}
}

func newTestEvaluator(store *memStore, deduper Deduper, pubs ...Publisher) *Evaluator {
	return &Evaluator{
		store:      store,
		httpDS:     NewHTTPDatasource(&http.Client{Timeout: 5 * time.Second}),
		dedupe:     deduper,
		publishers: pubs,
		metrics:    NewMetrics(),
		now:        time.Now,
	}
}

// ── tests ──────────────────────────────────────────────────────────────────

func TestEvaluateFiredInsertsEventAndPublishes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, freshReading("rainfall_mm", 75, time.Now()))
	}))
	defer srv.Close()
	store := newMemStore()
	pub := &memPublisher{name: "kafka"}
	ev := newTestEvaluator(store, &memDeduper{}, pub)
	fraudScore := 0.12
	ev.fraud = &memFraud{score: &fraudScore}

	res, err := ev.EvaluateOnce(context.Background(), httpTrigger(1, srv.URL))
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if res.Status != "fired" || res.Idempotent {
		t.Fatalf("want fired non-idempotent, got %+v", res)
	}
	if pub.count() != 1 {
		t.Fatalf("publisher not called; count=%d", pub.count())
	}
	env := pub.envs[0]
	if env.FraudScore == nil || *env.FraudScore != 0.12 {
		t.Fatalf("fraud score not attached: %+v", env)
	}
	if store.events[res.EventKey].Status != "fired" {
		t.Fatal("event row not persisted as fired")
	}
}

func TestEvaluateNotFired(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, freshReading("rainfall_mm", 10, time.Now()))
	}))
	defer srv.Close()
	store := newMemStore()
	ev := newTestEvaluator(store, &memDeduper{})
	res, err := ev.EvaluateOnce(context.Background(), httpTrigger(2, srv.URL))
	if err != nil || res.Status != "not_fired" {
		t.Fatalf("want not_fired, got %+v err=%v", res, err)
	}
}

func TestDatasourceDownRecordsDataUnavailableNeverFires(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	store := newMemStore()
	pub := &memPublisher{name: "kafka"}
	ev := newTestEvaluator(store, &memDeduper{}, pub)
	res, err := ev.EvaluateOnce(context.Background(), httpTrigger(3, srv.URL))
	if err != nil {
		t.Fatalf("data_unavailable must not be an evaluation error: %v", err)
	}
	if res.Status != "data_unavailable" {
		t.Fatalf("want data_unavailable, got %+v", res)
	}
	row := store.events[res.EventKey]
	if row.Status != "data_unavailable" || row.MeasuredValue != nil {
		t.Fatalf("row must be data_unavailable with null value: %+v", row)
	}
	if pub.count() != 1 {
		t.Fatal("data_unavailable event should still be published (manual-review signal)")
	}
	if ev.metrics.EventsDataUnavailable.Value() != 1 {
		t.Fatal("metric not counted")
	}
}

func TestIdempotentReplaySameWindow(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, freshReading("rainfall_mm", 75, time.Now()))
	}))
	defer srv.Close()
	store := newMemStore()
	deduper := &memDeduper{}
	pub := &memPublisher{name: "kafka"}
	ev := newTestEvaluator(store, deduper, pub)
	tr := httpTrigger(4, srv.URL)

	first, err := ev.EvaluateOnce(context.Background(), tr)
	if err != nil || first.Idempotent {
		t.Fatalf("first eval: %+v err=%v", first, err)
	}
	// Second evaluation in the same window: redis dedupe skips it entirely.
	second, err := ev.EvaluateOnce(context.Background(), tr)
	if err != nil {
		t.Fatalf("second eval: %v", err)
	}
	if second.Status != "duplicate_skipped" || !second.Idempotent {
		t.Fatalf("want duplicate_skipped, got %+v", second)
	}
	if pub.count() != 1 {
		t.Fatalf("duplicate evaluation must not republish; count=%d", pub.count())
	}
}

func TestDBConflictIsIdempotentWhenRedisDown(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, freshReading("rainfall_mm", 75, time.Now()))
	}))
	defer srv.Close()
	store := newMemStore()
	// Redis unavailable: Acquire errors ⇒ fall through to DB guard.
	deduper := &memDeduper{err: errors.New("connection refused")}
	pub := &memPublisher{name: "kafka"}
	ev := newTestEvaluator(store, deduper, pub)
	tr := httpTrigger(5, srv.URL)

	first, _ := ev.EvaluateOnce(context.Background(), tr)
	second, err := ev.EvaluateOnce(context.Background(), tr)
	if err != nil {
		t.Fatalf("second eval: %v", err)
	}
	if !second.Idempotent || second.EventID != first.EventID || second.Status != "fired" {
		t.Fatalf("DB conflict should yield idempotent replay of the same row: %+v vs %+v", first, second)
	}
	if pub.count() != 1 {
		t.Fatalf("conflict replay must not republish; count=%d", pub.count())
	}
	if ev.metrics.RedisFallbacks.Value() == 0 {
		t.Fatal("redis fallback not counted")
	}
}

func TestManualDatasourceDualControl(t *testing.T) {
	store := newMemStore()
	store.readings[9] = Reading{Metric: "rainfall_mm", Value: 80, ObservedAt: time.Now().Add(-time.Minute)}
	store.attested[9] = [2]int{101, 202}
	ev := newTestEvaluator(store, &memDeduper{})
	cfg, _ := json.Marshal(map[string]any{"type": "manual"})
	tr := Trigger{ID: 9, Name: "manual-rain", Metric: "rainfall_mm", Operator: "gte",
		Threshold: 50, WindowSeconds: 3600, DatasourceConfig: cfg, Status: "active"}
	res, err := ev.EvaluateOnce(context.Background(), tr)
	if err != nil || res.Status != "fired" {
		t.Fatalf("confirmed manual reading should fire: %+v err=%v", res, err)
	}

	// Unconfirmed (missing confirmer) ⇒ data_unavailable, never fires.
	store2 := newMemStore()
	store2.readings[10] = Reading{Metric: "rainfall_mm", Value: 80, ObservedAt: time.Now()}
	store2.attested[10] = [2]int{101, 0}
	ev2 := newTestEvaluator(store2, &memDeduper{})
	tr.ID = 10
	res, err = ev2.EvaluateOnce(context.Background(), tr)
	if err != nil || res.Status != "data_unavailable" {
		t.Fatalf("unconfirmed reading must fail closed: %+v err=%v", res, err)
	}
}

func TestFraudFailureKeepsScoreNull(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, freshReading("rainfall_mm", 75, time.Now()))
	}))
	defer srv.Close()
	store := newMemStore()
	pub := &memPublisher{name: "kafka"}
	ev := newTestEvaluator(store, &memDeduper{}, pub)
	ev.fraud = &memFraud{err: errors.New("dapr unreachable")}
	res, err := ev.EvaluateOnce(context.Background(), httpTrigger(11, srv.URL))
	if err != nil || res.Status != "fired" {
		t.Fatalf("fraud outage must not block evaluation: %+v err=%v", res, err)
	}
	if pub.envs[0].FraudScore != nil {
		t.Fatal("score must be null on fraud failure (fail-closed)")
	}
	if ev.metrics.FraudErrors.Value() != 1 {
		t.Fatal("fraud error not counted")
	}
}

func TestMisconfiguredDatasourceRecordedUnavailable(t *testing.T) {
	store := newMemStore()
	ev := newTestEvaluator(store, &memDeduper{})
	tr := Trigger{ID: 12, Name: "bad", Metric: "m", Operator: "gt", Threshold: 1,
		WindowSeconds: 60, DatasourceConfig: json.RawMessage(`{"type":"http"}`), Status: "active"}
	res, err := ev.EvaluateOnce(context.Background(), tr)
	if err != nil || res.Status != "data_unavailable" {
		t.Fatalf("misconfigured datasource must fail closed: %+v err=%v", res, err)
	}
}
