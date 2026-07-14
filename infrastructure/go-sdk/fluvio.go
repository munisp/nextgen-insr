package infra

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.uber.org/zap"
)

type FluvioClient struct {
	endpoint   string
	httpClient *http.Client
	logger     *zap.Logger
}

// Platform-wide Fluvio topics for real-time streaming
var FluvioTopics = []string{
	"kyc-verification-events",
	"kyc-gate-events",
	"kyc-risk-alerts",
	"kyc-compliance-events",
	"kyb-verification-events",
	"kyc-audit-stream",
	"policy-events-stream",
	"claims-events-stream",
	"payment-events-stream",
	"fraud-alerts-stream",
	"notification-stream",
	"mobile-money-stream",
}

type FluvioEvent struct {
	ID        string                 `json:"id"`
	Topic     string                 `json:"topic"`
	EventType string                 `json:"event_type"`
	Source    string                 `json:"source"`
	Key       string                 `json:"key,omitempty"`
	Data      map[string]interface{} `json:"data"`
	Timestamp string                 `json:"timestamp"`
	Version   string                 `json:"version"`
}

func NewFluvioClient(logger *zap.Logger, endpoint string) *FluvioClient {
	return &FluvioClient{
		endpoint:   endpoint,
		httpClient: &http.Client{Timeout: 5 * time.Second},
		logger:     logger,
	}
}

func (c *FluvioClient) Ping(ctx context.Context) error {
	url := fmt.Sprintf("http://%s/api/v1/health", c.endpoint)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("fluvio ping: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

func (c *FluvioClient) CreateTopic(ctx context.Context, name string, partitions, replicas int) error {
	payload := map[string]interface{}{
		"name":               name,
		"partitions":         partitions,
		"replication_factor": replicas,
	}
	data, _ := json.Marshal(payload)
	url := fmt.Sprintf("http://%s/api/v1/topics", c.endpoint)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("create topic: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

func (c *FluvioClient) Produce(ctx context.Context, topic string, event FluvioEvent) error {
	if event.Timestamp == "" {
		event.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	if event.Version == "" {
		event.Version = "1.0"
	}
	event.Topic = topic
	data, _ := json.Marshal(event)
	url := fmt.Sprintf("http://%s/api/v1/produce/%s", c.endpoint, topic)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("produce to %s: %w", topic, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("produce failed (%d): %s", resp.StatusCode, string(body))
	}
	return nil
}

func (c *FluvioClient) Consume(ctx context.Context, topic string, offset, limit int) ([]FluvioEvent, error) {
	url := fmt.Sprintf("http://%s/api/v1/consume/%s?offset=%d&limit=%d", c.endpoint, topic, offset, limit)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("consume from %s: %w", topic, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var events []FluvioEvent
	json.Unmarshal(body, &events)
	return events, nil
}

// SetupPlatformTopics creates all platform-wide Fluvio topics.
func (c *FluvioClient) SetupPlatformTopics(ctx context.Context) error {
	for _, topic := range FluvioTopics {
		if err := c.CreateTopic(ctx, topic, 3, 1); err != nil {
			c.logger.Warn("topic_creation_failed", zap.String("topic", topic), zap.Error(err))
		}
	}
	return nil
}

// ProduceKYCEvent produces a KYC-related event to the appropriate topic.
func (c *FluvioClient) ProduceKYCEvent(ctx context.Context, eventType, sessionID, userID string, data map[string]interface{}) error {
	topic := "kyc-verification-events"
	if eventType == "gate.checked" || eventType == "gate.denied" {
		topic = "kyc-gate-events"
	} else if eventType == "risk.high" || eventType == "risk.alert" {
		topic = "kyc-risk-alerts"
	}
	return c.Produce(ctx, topic, FluvioEvent{
		ID:        fmt.Sprintf("kyc-%d", time.Now().UnixNano()),
		EventType: eventType,
		Source:    "kyc-orchestrator",
		Key:       sessionID,
		Data: map[string]interface{}{
			"session_id": sessionID,
			"user_id":    userID,
			"details":    data,
		},
	})
}

// ProducePolicyEvent produces a policy lifecycle event.
func (c *FluvioClient) ProducePolicyEvent(ctx context.Context, eventType, policyID string, data map[string]interface{}) error {
	return c.Produce(ctx, "policy-events-stream", FluvioEvent{
		ID:        fmt.Sprintf("pol-%d", time.Now().UnixNano()),
		EventType: eventType,
		Source:    "policy-service",
		Key:       policyID,
		Data:      data,
	})
}

// ProducePaymentEvent produces a payment event.
func (c *FluvioClient) ProducePaymentEvent(ctx context.Context, eventType, paymentID string, data map[string]interface{}) error {
	return c.Produce(ctx, "payment-events-stream", FluvioEvent{
		ID:        fmt.Sprintf("pay-%d", time.Now().UnixNano()),
		EventType: eventType,
		Source:    "payment-service",
		Key:       paymentID,
		Data:      data,
	})
}
