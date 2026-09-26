// evaluator.go — Q-wave Q5 (2026-09-25)
//
// Polls parametric_trigger_definitions (status='active'), resolves readings
// via the fail-closed datasource adapters, dedupes via Redis SETNX on the
// event key, inserts parametric_events rows idempotently (UNIQUE event_key),
// and fans out `parametric.events` to Kafka + Fluvio (+ OpenSearch bulk
// indexing + Dapr fraud scoring, both config-gated).
//
// Outbox discipline: this service writes ONLY parametric_events. Claim
// creation and parametric_payout_settlements remain owned by the TS engine
// (server/lib/parametricEngine.ts) — there is exactly one settlement writer.
package main

import (
	"context"
	"encoding/json"
	"log"
	"time"
)

// Deduper abstracts Redis SETNX (honest interface for tests).
// Acquire returns true when this caller won the key for the window.
type Deduper interface {
	Acquire(ctx context.Context, key string, ttl time.Duration) (bool, error)
}

// nilDeduper is used when REDIS_URL is unset: dedupe degrades to the DB
// UNIQUE(event_key) guard (disclosed 2026-09-25).
type nilDeduper struct{}

func (nilDeduper) Acquire(context.Context, string, time.Duration) (bool, error) { return true, nil }

type Evaluator struct {
	store      EventStore
	httpDS     *HTTPDatasource
	dedupe     Deduper
	publishers []Publisher
	fraud      FraudScorer // nil when disabled
	metrics    *Metrics
	now        func() time.Time
}

// EvaluationResult mirrors the TS EvaluationResult shape.
type EvaluationResult struct {
	EventID       int      `json:"eventId"`
	EventKey      string   `json:"eventKey"`
	Status        string   `json:"status"`
	MeasuredValue *float64 `json:"measuredValue"`
	Idempotent    bool     `json:"idempotent"`
}

// EvaluateOnce evaluates a single trigger for the current window. Fail-closed:
// any datasource failure ⇒ parametric_events(status='data_unavailable') and
// NO firing (mirrors the TS engine).
func (e *Evaluator) EvaluateOnce(ctx context.Context, t Trigger) (EvaluationResult, error) {
	now := e.now()
	eventKey := EvaluationWindowKey(t.ID, t.WindowSeconds, now)

	// Redis dedupe (optimisation; DB UNIQUE is the ultimate guard).
	ttl := time.Duration(t.WindowSeconds)*time.Second + 5*time.Minute
	won, err := e.dedupe.Acquire(ctx, "parametric:eval:"+eventKey, ttl)
	if err != nil {
		// Redis down: continue — INSERT ... ON CONFLICT DO NOTHING keeps the
		// evaluation idempotent (disclosed 2026-09-25).
		log.Printf("[dedupe] redis error for %s: %v — falling back to DB uniqueness guard", eventKey, err)
		e.metrics.RedisFallbacks.Inc()
		won = true
	}
	if !won {
		e.metrics.DedupeSkips.Inc()
		return EvaluationResult{EventKey: eventKey, Status: "duplicate_skipped", Idempotent: true}, nil
	}

	cfg, err := parseDatasourceConfig(t.DatasourceConfig)
	if err != nil {
		// Misconfigured datasource ⇒ data_unavailable event (fail-closed),
		// same as TS (misconfigured reason).
		if !IsUnavailable(err) {
			return EvaluationResult{}, err
		}
		return e.recordUnavailable(ctx, t, eventKey, err)
	}

	var (
		reading        Reading
		payloadHash    string
		raw            json.RawMessage
		datasourceType = cfg.Type
	)
	switch cfg.Type {
	case "http":
		reading, payloadHash, raw, err = e.httpDS.Fetch(ctx, cfg, t.Metric, t.WindowSeconds)
	case "manual":
		var attestedBy, confirmedBy int
		reading, attestedBy, confirmedBy, err = e.store.LatestConfirmedManualReading(ctx, t.ID, t.Metric)
		if err == nil {
			err = ValidateManualReading(reading, t.Metric, t.WindowSeconds, attestedBy, confirmedBy, now)
			if err == nil {
				sum := sha256OfReading(reading)
				payloadHash = sum
				raw, _ = json.Marshal(reading)
			}
		}
	default:
		err = &DatasourceUnavailableError{Reason: ReasonMisconfigured,
			Message: "unknown datasource type (fail-closed)"}
	}

	if err != nil {
		if !IsUnavailable(err) {
			return EvaluationResult{}, err
		}
		return e.recordUnavailable(ctx, t, eventKey, err)
	}

	fired := ThresholdBreached(t.Operator, reading.Value, t.Threshold)
	status := "not_fired"
	if fired {
		status = "fired"
	}
	value := reading.Value
	rec, existed, err := e.store.InsertEvent(ctx, EventRecord{
		EventKey:       eventKey,
		TriggerID:      t.ID,
		MeasuredValue:  &value,
		PayloadHash:    &payloadHash,
		Payload:        raw,
		DatasourceType: datasourceType,
		Status:         status,
	})
	if err != nil {
		return EvaluationResult{}, err
	}
	if existed {
		e.metrics.DedupeSkips.Inc()
		return EvaluationResult{EventID: rec.ID, EventKey: eventKey, Status: rec.Status, MeasuredValue: rec.MeasuredValue, Idempotent: true}, nil
	}
	e.metrics.EventsEvaluated.Inc()
	if fired {
		e.metrics.EventsFired.Inc()
	}
	e.fanOut(ctx, EventEnvelope{
		EventKey:       eventKey,
		EventID:        rec.ID,
		TriggerID:      t.ID,
		TriggerName:    t.Name,
		Status:         status,
		MeasuredValue:  &value,
		PayloadHash:    &payloadHash,
		DatasourceType: datasourceType,
		Source:         "parametric-evaluator-go",
		EvaluatedAt:    rec.CreatedAt,
		Payload:        raw,
	})
	return EvaluationResult{EventID: rec.ID, EventKey: eventKey, Status: status, MeasuredValue: &value}, nil
}

// recordUnavailable persists a data_unavailable event (NO firing, NO payout —
// fail-closed, mirroring the TS engine).
func (e *Evaluator) recordUnavailable(ctx context.Context, t Trigger, eventKey string, cause error) (EvaluationResult, error) {
	payload, _ := json.Marshal(map[string]string{
		"error":  cause.Error(),
		"reason": reasonOf(cause),
	})
	rec, existed, err := e.store.InsertEvent(ctx, EventRecord{
		EventKey:       eventKey,
		TriggerID:      t.ID,
		Payload:        payload,
		DatasourceType: "unknown",
		Status:         "data_unavailable",
	})
	if err != nil {
		return EvaluationResult{}, err
	}
	if existed {
		return EvaluationResult{EventID: rec.ID, EventKey: eventKey, Status: rec.Status, Idempotent: true}, nil
	}
	e.metrics.EventsDataUnavailable.Inc()
	e.fanOut(ctx, EventEnvelope{
		EventKey:       eventKey,
		EventID:        rec.ID,
		TriggerID:      t.ID,
		TriggerName:    t.Name,
		Status:         "data_unavailable",
		DatasourceType: "unknown",
		Source:         "parametric-evaluator-go",
		EvaluatedAt:    rec.CreatedAt,
		Payload:        payload,
	})
	return EvaluationResult{EventID: rec.ID, EventKey: eventKey, Status: "data_unavailable"}, nil
}

// fanOut publishes the event envelope to all configured publishers and
// (config-gated) enriches with a Dapr fraud score. Publishing is
// best-effort: the DB row is the record; failures are logged + counted.
func (e *Evaluator) fanOut(ctx context.Context, env EventEnvelope) {
	if e.fraud != nil && env.Status == "fired" {
		score, err := e.fraud.ScoreEvent(ctx, env)
		if err != nil {
			// Fail-closed: score stays null; TS settlement gate applies its
			// own fail-closed fraud check (disclosed 2026-09-25).
			log.Printf("[fraud] scoring unavailable for %s: %v — fraudScore=null (fail-closed)", env.EventKey, err)
			e.metrics.FraudErrors.Inc()
		} else {
			env.FraudScore = score
		}
	}
	for _, p := range e.publishers {
		pubCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		if err := p.Publish(pubCtx, env); err != nil {
			log.Printf("[publish] %s failed for %s: %v (DB row %d remains source of truth)", p.Name(), env.EventKey, err, env.EventID)
			e.metrics.PublishErrors.Inc()
		} else {
			e.metrics.EventsPublished.Inc()
		}
		cancel()
	}
}

// PollDue evaluates every active trigger once. Per-trigger errors are logged
// and do not abort the batch (one bad trigger must not starve the others).
func (e *Evaluator) PollDue(ctx context.Context) (evaluated int, errs int) {
	triggers, err := e.store.ActiveTriggers(ctx)
	if err != nil {
		log.Printf("[poll] failed to list active triggers: %v", err)
		return 0, 1
	}
	for _, t := range triggers {
		tctx, cancel := context.WithTimeout(ctx, 90*time.Second)
		if _, err := e.EvaluateOnce(tctx, t); err != nil {
			log.Printf("[poll] trigger %d (%s) evaluation error: %v", t.ID, t.Name, err)
			e.metrics.EvaluationErrors.Inc()
			errs++
		} else {
			evaluated++
		}
		cancel()
	}
	return evaluated, errs
}

func reasonOf(err error) string {
	var du *DatasourceUnavailableError
	if As(err, &du) {
		return du.Reason
	}
	return "unknown"
}
