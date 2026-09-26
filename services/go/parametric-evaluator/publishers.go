// publishers.go — Q-wave Q5 (2026-09-25)
//
// Downstream fan-out for parametric events. The Postgres parametric_events
// row is the SOURCE OF TRUTH (the TS engine settles from it); publishing to
// Kafka / Fluvio / OpenSearch is best-effort notification — failures are
// logged + counted in /metrics and never fabricate or block settlement.
// Every integration is config-gated and fail-closed (disabled when its
// endpoint env is unset), disclosed 2026-09-25.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/segmentio/kafka-go"
)

// EventEnvelope is the canonical published shape for a parametric event.
type EventEnvelope struct {
	EventKey       string          `json:"eventKey"`
	EventID        int             `json:"eventId"`
	TriggerID      int             `json:"triggerId"`
	TriggerName    string          `json:"triggerName"`
	Status         string          `json:"status"` // fired | not_fired | data_unavailable
	MeasuredValue  *float64        `json:"measuredValue,omitempty"`
	PayloadHash    *string         `json:"payloadHash,omitempty"`
	DatasourceType string          `json:"datasourceType"`
	FraudScore     *float64        `json:"fraudScore,omitempty"` // Dapr fraud-detection-go (config-gated)
	Source         string          `json:"source"`               // parametric-evaluator-go
	EvaluatedAt    time.Time       `json:"evaluatedAt"`
	Payload        json.RawMessage `json:"payload,omitempty"`
}

// Publisher is the common fan-out contract (honest interface — tests assert
// the evaluator calls publishers only for real inserted events).
type Publisher interface {
	Name() string
	Publish(ctx context.Context, env EventEnvelope) error
}

// ── Kafka (segmentio/kafka-go — same client as instant-payout-service and
// the repo's shared/messaging/kafka.go pattern) ─────────────────────────────
type KafkaPublisher struct {
	writer *kafka.Writer
}

func NewKafkaPublisher(brokers string, topic string) *KafkaPublisher {
	return &KafkaPublisher{writer: &kafka.Writer{
		Addr:         kafka.TCP(brokers),
		Topic:        topic,
		Balancer:     &kafka.LeastBytes{},
		BatchTimeout: 10 * time.Millisecond,
		RequiredAcks: kafka.RequireOne,
	}}
}

func (k *KafkaPublisher) Name() string { return "kafka" }

func (k *KafkaPublisher) Publish(ctx context.Context, env EventEnvelope) error {
	data, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	return k.writer.WriteMessages(ctx, kafka.Message{
		Key:   []byte(env.EventKey),
		Value: data,
		Time:  time.Now(),
	})
}

func (k *KafkaPublisher) Close() error { return k.writer.Close() }

// ── Fluvio via the repo's HTTP bridge convention (shared/messaging/fluvio.go,
// server/lib/fluvioClient.ts: POST {endpoint}/topics/{topic}/produce) ───────
type FluvioPublisher struct {
	baseURL string
	apiKey  string
	topic   string
	client  *http.Client
}

func NewFluvioPublisher(addr, apiKey, topic string) *FluvioPublisher {
	return &FluvioPublisher{
		baseURL: "http://" + addr,
		apiKey:  apiKey,
		topic:   topic,
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

func (f *FluvioPublisher) Name() string { return "fluvio" }

func (f *FluvioPublisher) Publish(ctx context.Context, env EventEnvelope) error {
	data, err := json.Marshal(env)
	if err != nil {
		return err
	}
	payload, _ := json.Marshal(map[string]string{
		"topic": f.topic,
		"key":   env.EventKey,
		"value": string(data),
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/topics/%s/produce", f.baseURL, f.topic), bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if f.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+f.apiKey)
	}
	resp, err := f.client.Do(req)
	if err != nil {
		return fmt.Errorf("fluvio produce: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("fluvio produce failed (%d): %s", resp.StatusCode, string(b))
	}
	return nil
}

// ── OpenSearch bulk indexing (config-gated; mapping in
// infrastructure/opensearch/parametric-events-template.json) ────────────────
type OpenSearchPublisher struct {
	baseURL string
	index   string
	client  *http.Client
}

func NewOpenSearchPublisher(addr, index string) *OpenSearchPublisher {
	return &OpenSearchPublisher{baseURL: addr, index: index, client: &http.Client{Timeout: 10 * time.Second}}
}

func (o *OpenSearchPublisher) Name() string { return "opensearch" }

// Publish indexes one document via the bulk API (single-doc bulk keeps the
// code path identical to batched indexing; the event id is the document _id
// so re-indexing is idempotent).
func (o *OpenSearchPublisher) Publish(ctx context.Context, env EventEnvelope) error {
	doc, err := json.Marshal(env)
	if err != nil {
		return err
	}
	meta, _ := json.Marshal(map[string]any{
		"index": map[string]any{"_index": o.index, "_id": fmt.Sprintf("%d", env.EventID)},
	})
	body := append(append(meta, '\n'), append(doc, '\n')...)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		o.baseURL+"/_bulk", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-ndjson")
	resp, err := o.client.Do(req)
	if err != nil {
		return fmt.Errorf("opensearch bulk: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("opensearch bulk failed (%d): %s", resp.StatusCode, string(b))
	}
	return nil
}
