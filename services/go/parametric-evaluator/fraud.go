// fraud.go — Q-wave Q5 (2026-09-25)
//
// Dapr service invocation → fraud-detection-go for linked-claims scoring of
// fired parametric events (repo convention: shared/messaging/dapr.go —
// HTTP sidecar at http://localhost:$DAPR_HTTP_PORT/v1.0/invoke/<app-id>/method/<m>).
//
// Config-gated + fail-closed: when FRAUD_DAPR_APP_ID is unset, scoring is
// disabled and events carry fraudScore=null. When enabled but the call
// fails, the score is null and the envelope carries fraud_score_unavailable
// — the Go service NEVER settles payouts, so an unavailable score cannot
// cause an unpaid legitimate claim here; the TS engine applies its own
// fail-closed fraud gate at settlement time.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type FraudScorer interface {
	ScoreEvent(ctx context.Context, env EventEnvelope) (*float64, error)
}

type DaprFraudScorer struct {
	invokeURL string
	client    *http.Client
}

// NewDaprFraudScorer builds a scorer for the given Dapr app-id
// (fraud-detection-go), method POST /v1.0/invoke/<app>/method/score.
func NewDaprFraudScorer(daprHTTPPort, appID string) *DaprFraudScorer {
	return &DaprFraudScorer{
		invokeURL: fmt.Sprintf("http://localhost:%s/v1.0/invoke/%s/method/score", daprHTTPPort, appID),
		client:    &http.Client{Timeout: 15 * time.Second},
	}
}

type fraudScoreResponse struct {
	Score *float64 `json:"score"`
}

func (d *DaprFraudScorer) ScoreEvent(ctx context.Context, env EventEnvelope) (*float64, error) {
	body, err := json.Marshal(map[string]any{
		"eventKey":  env.EventKey,
		"triggerId": env.TriggerID,
		"status":    env.Status,
		"payload":   env.Payload,
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.invokeURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := d.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("dapr invoke fraud scoring: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("fraud scoring failed (%d): %s", resp.StatusCode, string(b))
	}
	var out fraudScoreResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("fraud scoring response unparseable: %w", err)
	}
	return out.Score, nil
}
