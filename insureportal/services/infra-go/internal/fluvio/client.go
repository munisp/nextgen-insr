// Package fluvio provides a Go HTTP bridge to the Fluvio streaming platform.
// Fluvio is used for real-time event streaming across all InsurePortal services:
//   - policy-events: policy lifecycle events (issued, renewed, cancelled, lapsed)
//   - claim-events: claim lifecycle events (filed, assessed, approved, paid, rejected)
//   - premium-events: premium payment events (invoiced, collected, overdue, refunded)
//   - underwriting-events: underwriting decisions and risk assessments
//   - fraud-events: fraud detection alerts and risk scores
//   - agent-events: agent activity, float changes, KYC status
//   - compliance-events: regulatory reporting triggers
//   - reinsurance-events: cession and recovery events
package fluvio

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"go.uber.org/zap"
)

// InsurePortal Fluvio topic definitions
const (
	TopicPolicyEvents       = "policy-events"
	TopicClaimEvents        = "claim-events"
	TopicPremiumEvents      = "premium-events"
	TopicUnderwritingEvents = "underwriting-events"
	TopicFraudEvents        = "fraud-events"
	TopicAgentEvents        = "agent-events"
	TopicComplianceEvents   = "compliance-events"
	TopicReinsuranceEvents  = "reinsurance-events"
	TopicKYCEvents          = "kyc-events"
	TopicAuditEvents        = "audit-events"
)

// Event represents a Fluvio event message
type Event struct {
	Topic     string                 `json:"topic"`
	Key       string                 `json:"key,omitempty"`
	Payload   map[string]interface{} `json:"payload"`
	Timestamp string                 `json:"timestamp,omitempty"`
	TenantID  string                 `json:"tenantId,omitempty"`
	Source    string                 `json:"source,omitempty"`
}

// ProduceRequest is the HTTP request body for producing events
type ProduceRequest struct {
	Topic   string                 `json:"topic"`
	Key     string                 `json:"key,omitempty"`
	Payload map[string]interface{} `json:"payload"`
}

// BatchProduceRequest is for producing multiple events
type BatchProduceRequest struct {
	Events []ProduceRequest `json:"events"`
}

// TopicStats represents statistics for a Fluvio topic
type TopicStats struct {
	Topic             string  `json:"topic"`
	MessagesPerSecond float64 `json:"messagesPerSecond"`
	TotalMessages     int64   `json:"totalMessages"`
	ConsumerLag       int64   `json:"consumerLag"`
	Partitions        int     `json:"partitions"`
}

// Client is the Fluvio HTTP bridge client
type Client struct {
	logger      *zap.Logger
	endpoint    string
	apiKey      string
	httpClient  *http.Client
	eventBuffer []Event
	bufferMu    chan struct{}
}

// NewClient creates a new Fluvio client
func NewClient(logger *zap.Logger) *Client {
	endpoint := getEnv("FLUVIO_ENDPOINT", "http://fluvio:9003")
	apiKey := getEnv("FLUVIO_API_KEY", "insureportal-fluvio-dev-key")

	c := &Client{
		logger:     logger,
		endpoint:   endpoint,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		bufferMu:   make(chan struct{}, 1),
	}

	// Start background buffer flush goroutine
	go c.flushBufferLoop()

	return c
}

// Ping checks Fluvio availability
func (c *Client) Ping(ctx context.Context) string {
	req, err := http.NewRequestWithContext(ctx, "GET", c.endpoint+"/health", nil)
	if err != nil {
		return "error"
	}
	c.setHeaders(req)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "unreachable"
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusOK {
		return "ok"
	}
	return fmt.Sprintf("http_%d", resp.StatusCode)
}

// Close stops the client
func (c *Client) Close() {
	// Flush remaining buffered events
	c.flushBuffer()
}

// Produce sends a single event to Fluvio
func (c *Client) Produce(ctx context.Context, topic, key string, payload map[string]interface{}) error {
	event := ProduceRequest{
		Topic:   topic,
		Key:     key,
		Payload: payload,
	}

	body, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.endpoint+"/produce", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		// Buffer the event for retry
		c.bufferEvent(Event{Topic: topic, Key: key, Payload: payload})
		c.logger.Warn("Fluvio produce failed, buffered event",
			zap.String("topic", topic),
			zap.Error(err))
		return nil // fail-open
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("fluvio produce error: %d", resp.StatusCode)
	}
	return nil
}

// ── HTTP Handlers ─────────────────────────────────────────────────────────────

// ProduceHandler handles POST /fluvio/produce
func (c *Client) ProduceHandler(w http.ResponseWriter, r *http.Request) {
	var req ProduceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if req.Topic == "" {
		writeError(w, http.StatusBadRequest, "topic is required")
		return
	}

	if err := c.Produce(r.Context(), req.Topic, req.Key, req.Payload); err != nil {
		c.logger.Error("Fluvio produce failed", zap.String("topic", req.Topic), zap.Error(err))
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

// ProduceBatchHandler handles POST /fluvio/produce/batch
func (c *Client) ProduceBatchHandler(w http.ResponseWriter, r *http.Request) {
	var req BatchProduceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	var errors []string
	for _, event := range req.Events {
		if err := c.Produce(r.Context(), event.Topic, event.Key, event.Payload); err != nil {
			errors = append(errors, fmt.Sprintf("%s: %s", event.Topic, err.Error()))
		}
	}

	if len(errors) > 0 {
		writeJSON(w, http.StatusMultiStatus, map[string]interface{}{
			"status": "partial",
			"errors": errors,
		})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"status": "accepted",
		"count":  len(req.Events),
	})
}

// ListTopicsHandler handles GET /fluvio/topics
func (c *Client) ListTopicsHandler(w http.ResponseWriter, r *http.Request) {
	topics := []string{
		TopicPolicyEvents, TopicClaimEvents, TopicPremiumEvents,
		TopicUnderwritingEvents, TopicFraudEvents, TopicAgentEvents,
		TopicComplianceEvents, TopicReinsuranceEvents, TopicKYCEvents, TopicAuditEvents,
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"topics": topics})
}

// TopicStatsHandler handles GET /fluvio/topics/{topic}/stats
func (c *Client) TopicStatsHandler(w http.ResponseWriter, r *http.Request) {
	topic := r.PathValue("topic")
	req, err := http.NewRequestWithContext(r.Context(), "GET",
		fmt.Sprintf("%s/topics/%s/stats", c.endpoint, topic), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		// Return mock stats when Fluvio is unavailable
		writeJSON(w, http.StatusOK, TopicStats{
			Topic:             topic,
			MessagesPerSecond: 0,
			TotalMessages:     0,
			ConsumerLag:       0,
			Partitions:        3,
		})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	var stats TopicStats
	_ = json.NewDecoder(resp.Body).Decode(&stats)
	writeJSON(w, http.StatusOK, stats)
}

// CreateTopicHandler handles POST /fluvio/topics
func (c *Client) CreateTopicHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name       string `json:"name"`
		Partitions int    `json:"partitions"`
		Replicas   int    `json:"replicas"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	body, _ := json.Marshal(req)
	httpReq, _ := http.NewRequestWithContext(r.Context(), "POST",
		c.endpoint+"/topics", bytes.NewReader(body))
	c.setHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		writeJSON(w, http.StatusCreated, map[string]string{
			"status": "mock",
			"name":   req.Name,
		})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	var result interface{}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	writeJSON(w, resp.StatusCode, result)
}

// ListConsumerGroupsHandler handles GET /fluvio/consumer-groups
func (c *Client) ListConsumerGroupsHandler(w http.ResponseWriter, r *http.Request) {
	groups := []string{
		"insureportal-fraud-engine",
		"insureportal-analytics",
		"insureportal-settlement",
		"insureportal-notification",
		"insureportal-compliance",
		"insureportal-audit",
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"consumerGroups": groups})
}

// HealthHandler handles GET /fluvio/health
func (c *Client) HealthHandler(w http.ResponseWriter, r *http.Request) {
	status := c.Ping(r.Context())
	code := http.StatusOK
	if status != "ok" {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, map[string]string{"status": status})
}

// ── Internal helpers ──────────────────────────────────────────────────────────

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
}

func (c *Client) bufferEvent(event Event) {
	select {
	case c.bufferMu <- struct{}{}:
		c.eventBuffer = append(c.eventBuffer, event)
		<-c.bufferMu
	default:
		// Buffer is locked, drop event (circuit breaker)
	}
}

func (c *Client) flushBuffer() {
	select {
	case c.bufferMu <- struct{}{}:
		events := c.eventBuffer
		c.eventBuffer = nil
		<-c.bufferMu

		for _, event := range events {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			c.Produce(ctx, event.Topic, event.Key, event.Payload) //nolint:errcheck
			cancel()
		}
	default:
	}
}

func (c *Client) flushBufferLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		c.flushBuffer()
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
