// store.go — Q-wave Q5 (2026-09-25)
//
// Postgres access to the Q2 parametric tables (migration 0087). The Go
// service ONLY writes parametric_events rows — it never creates claims or
// parametric_payout_settlements (the TS engine in
// server/lib/parametricEngine.ts remains the single settlement writer —
// outbox discipline: one write path for money).
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

type Trigger struct {
	ID               int
	Name             string
	Metric           string
	Operator         string
	Threshold        float64
	WindowSeconds    int
	DatasourceConfig json.RawMessage
	Status           string
}

type EventRecord struct {
	ID             int
	EventKey       string
	TriggerID      int
	MeasuredValue  *float64
	PayloadHash    *string
	Payload        json.RawMessage
	DatasourceType string
	Status         string // fired | not_fired | data_unavailable
	CreatedAt      time.Time
}

// EventStore abstracts persistence for honest interface tests.
type EventStore interface {
	ActiveTriggers(ctx context.Context) ([]Trigger, error)
	// InsertEvent inserts one event row. It MUST be idempotent on
	// event_key (the SQL impl relies on parametric_events_event_key_key /
	// ON CONFLICT DO NOTHING). Returns (record, alreadyExisted, error).
	InsertEvent(ctx context.Context, e EventRecord) (EventRecord, bool, error)
	LatestConfirmedManualReading(ctx context.Context, triggerID int, metric string) (Reading, int, int, error)
	Ping(ctx context.Context) error
	Close() error
}

type PGStore struct{ db *sql.DB }

func NewPGStore(ctx context.Context, databaseURL string) (*PGStore, error) {
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		return nil, fmt.Errorf("postgres unreachable (fail-closed): %w", err)
	}
	return &PGStore{db: db}, nil
}

func (s *PGStore) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }
func (s *PGStore) Close() error                   { return s.db.Close() }

func (s *PGStore) ActiveTriggers(ctx context.Context) ([]Trigger, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, metric, operator, threshold::float8, window_seconds,
		       datasource_config, status
		FROM parametric_trigger_definitions
		WHERE status = 'active'`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []Trigger
	for rows.Next() {
		var t Trigger
		if err := rows.Scan(&t.ID, &t.Name, &t.Metric, &t.Operator, &t.Threshold,
			&t.WindowSeconds, &t.DatasourceConfig, &t.Status); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// InsertEvent is idempotent via ON CONFLICT (event_key) DO NOTHING — the DB
// UNIQUE constraint on parametric_events.event_key (migration 0087) is the
// ultimate dedupe guard even if Redis is down.
func (s *PGStore) InsertEvent(ctx context.Context, e EventRecord) (EventRecord, bool, error) {
	row := s.db.QueryRowContext(ctx, `
		INSERT INTO parametric_events
		  (event_key, trigger_id, measured_value, payload_hash, payload, datasource_type, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (event_key) DO NOTHING
		RETURNING id, created_at`,
		e.EventKey, e.TriggerID, e.MeasuredValue, e.PayloadHash, e.Payload, e.DatasourceType, e.Status)
	var id int
	var createdAt time.Time
	if err := row.Scan(&id, &createdAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// Conflict: fetch the pre-existing row (idempotent replay).
			var existing EventRecord
			err := s.db.QueryRowContext(ctx, `
				SELECT id, event_key, trigger_id, measured_value::float8, payload_hash,
				       payload, datasource_type, status, created_at
				FROM parametric_events WHERE event_key = $1`, e.EventKey).
				Scan(&existing.ID, &existing.EventKey, &existing.TriggerID, &existing.MeasuredValue,
					&existing.PayloadHash, &existing.Payload, &existing.DatasourceType,
					&existing.Status, &existing.CreatedAt)
			if err != nil {
				return EventRecord{}, false, fmt.Errorf("event_key conflict but existing row unreadable: %w", err)
			}
			return existing, true, nil
		}
		return EventRecord{}, false, err
	}
	e.ID = id
	e.CreatedAt = createdAt
	return e, false, nil
}

func (s *PGStore) LatestConfirmedManualReading(ctx context.Context, triggerID int, metric string) (Reading, int, int, error) {
	var (
		r           Reading
		attestedBy  int
		confirmedBy int
		observedAt  time.Time
	)
	err := s.db.QueryRowContext(ctx, `
		SELECT value::float8, observed_at, attested_by, confirmed_by
		FROM parametric_manual_readings
		WHERE trigger_id = $1 AND metric = $2 AND confirmed_by IS NOT NULL
		ORDER BY observed_at DESC
		LIMIT 1`, triggerID, metric).
		Scan(&r.Value, &observedAt, &attestedBy, &confirmedBy)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Reading{}, 0, 0, &DatasourceUnavailableError{Reason: ReasonUnconfirmed,
				Message: "no confirmed manual reading for trigger (fail-closed)"}
		}
		return Reading{}, 0, 0, err
	}
	r.Metric = metric
	r.ObservedAt = observedAt
	return r, attestedBy, confirmedBy, nil
}
