// Package lakehouse provides a Go SDK for microservices to emit events
// into the NGApp Lakehouse Feature Store pipeline.
//
// Usage:
//
//	client := lakehouse.NewClient(lakehouse.Config{
//	    APIEndpoint: "http://localhost:8200",
//	    ServiceName: "claims-engine",
//	    APIKey:      os.Getenv("LAKEHOUSE_API_KEY"),
//	})
//	defer client.Close()
//
//	client.EmitClaimEvent(ctx, ClaimEvent{
//	    ClaimID:     "CLM-001",
//	    Amount:      150000.0,
//	    PolicyLimit: 500000.0,
//	})
package lakehouse

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// Config holds configuration for the Lakehouse client.
type Config struct {
	APIEndpoint    string        // Feature Store API URL (default: http://localhost:8200)
	ServiceName    string        // Name of the calling service
	APIKey         string        // Authentication API key
	BatchSize      int           // Max events per batch (default: 100)
	FlushInterval  time.Duration // Flush interval (default: 5s)
	MaxRetries     int           // Max retries on failure (default: 3)
	RequestTimeout time.Duration // HTTP request timeout (default: 10s)
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig(serviceName string) Config {
	return Config{
		APIEndpoint:    "http://localhost:8200",
		ServiceName:    serviceName,
		BatchSize:      100,
		FlushInterval:  5 * time.Second,
		MaxRetries:     3,
		RequestTimeout: 10 * time.Second,
	}
}

// Event represents a platform event to be ingested into the Lakehouse.
type Event struct {
	Topic   string                 `json:"topic"`
	Key     string                 `json:"key,omitempty"`
	Payload map[string]interface{} `json:"payload"`
}

// ClaimEvent represents a claims submission/adjudication event.
type ClaimEvent struct {
	ClaimID           string  `json:"claim_id"`
	Amount            float64 `json:"amount"`
	PolicyLimit       float64 `json:"policy_limit"`
	DaysSinceIncident int     `json:"days_since_incident"`
	DocsSubmitted     int     `json:"docs_submitted"`
	DocsRequired      int     `json:"docs_required"`
	FraudRiskScore    float64 `json:"fraud_risk_score"`
}

// FraudAlertEvent represents a fraud alert event.
type FraudAlertEvent struct {
	AlertID          string  `json:"alert_id"`
	CustomerID       string  `json:"customer_id"`
	PolicyID         string  `json:"policy_id"`
	RiskScore        float64 `json:"risk_score"`
	AlertType        string  `json:"alert_type"`
	DocOCRConfidence float64 `json:"doc_ocr_confidence"`
	FaceMatchScore   float64 `json:"face_match_score"`
	LivenessScore    float64 `json:"liveness_score"`
	Confirmed        bool    `json:"confirmed"`
}

// PaymentEvent represents a payment processing event.
type PaymentEvent struct {
	TransactionID string  `json:"transaction_id"`
	Amount        float64 `json:"amount"`
	Method        string  `json:"method"`
	CustomerID    string  `json:"customer_id"`
	Flagged       bool    `json:"flagged"`
}

// KYCEvent represents a KYC/KYB completion event.
type KYCEvent struct {
	CustomerID  string  `json:"customer_id"`
	OCRScore    float64 `json:"ocr_score"`
	FaceMatch   float64 `json:"face_match"`
	Liveness    float64 `json:"liveness"`
	DocVerified bool    `json:"doc_verified"`
	Status      string  `json:"status"`
}

// PolicyEvent represents a policy lifecycle event.
type PolicyEvent struct {
	PolicyID    string  `json:"policy_id"`
	CustomerID  string  `json:"customer_id"`
	ProductType string  `json:"product_type"`
	Premium     float64 `json:"premium"`
	EventType   string  `json:"event_type"` // created, renewed, cancelled
}

// Client is the Lakehouse event publisher client.
type Client struct {
	config     Config
	httpClient *http.Client
	buffer     []Event
	mu         sync.Mutex
	done       chan struct{}
	wg         sync.WaitGroup
	stats      Stats
}

// Stats tracks publishing metrics.
type Stats struct {
	Published int64
	Delivered int64
	Failed    int64
	Retried   int64
	mu        sync.Mutex
}

// NewClient creates a new Lakehouse client and starts the flush loop.
func NewClient(config Config) *Client {
	if config.BatchSize == 0 {
		config.BatchSize = 100
	}
	if config.FlushInterval == 0 {
		config.FlushInterval = 5 * time.Second
	}
	if config.MaxRetries == 0 {
		config.MaxRetries = 3
	}
	if config.RequestTimeout == 0 {
		config.RequestTimeout = 10 * time.Second
	}
	if config.APIEndpoint == "" {
		config.APIEndpoint = "http://localhost:8200"
	}

	c := &Client{
		config: config,
		httpClient: &http.Client{
			Timeout: config.RequestTimeout,
		},
		buffer: make([]Event, 0, config.BatchSize),
		done:   make(chan struct{}),
	}

	c.wg.Add(1)
	go c.flushLoop()

	return c
}

// Close stops the flush loop and flushes remaining events.
func (c *Client) Close() error {
	close(c.done)
	c.wg.Wait()
	return c.flush()
}

// Emit publishes a raw event to the Lakehouse pipeline.
func (c *Client) Emit(ctx context.Context, event Event) error {
	c.mu.Lock()
	c.buffer = append(c.buffer, event)
	shouldFlush := len(c.buffer) >= c.config.BatchSize
	c.mu.Unlock()

	c.stats.mu.Lock()
	c.stats.Published++
	c.stats.mu.Unlock()

	if shouldFlush {
		return c.flush()
	}
	return nil
}

// EmitClaimEvent publishes a claims event.
func (c *Client) EmitClaimEvent(ctx context.Context, evt ClaimEvent) error {
	payload := map[string]interface{}{
		"claim_id":            evt.ClaimID,
		"amount":              evt.Amount,
		"policy_limit":        evt.PolicyLimit,
		"days_since_incident": evt.DaysSinceIncident,
		"docs_submitted":      evt.DocsSubmitted,
		"docs_required":       evt.DocsRequired,
		"fraud_risk_score":    evt.FraudRiskScore,
		"timestamp":           time.Now().Unix(),
	}
	return c.Emit(ctx, Event{
		Topic:   "claims.submitted",
		Key:     evt.ClaimID,
		Payload: payload,
	})
}

// EmitFraudAlert publishes a fraud alert event.
func (c *Client) EmitFraudAlert(ctx context.Context, evt FraudAlertEvent) error {
	payload := map[string]interface{}{
		"alert_id":           evt.AlertID,
		"customer_id":        evt.CustomerID,
		"policy_id":          evt.PolicyID,
		"risk_score":         evt.RiskScore,
		"alert_type":         evt.AlertType,
		"doc_ocr_confidence": evt.DocOCRConfidence,
		"face_match_score":   evt.FaceMatchScore,
		"liveness_score":     evt.LivenessScore,
		"confirmed":          evt.Confirmed,
		"timestamp":          time.Now().Unix(),
	}
	return c.Emit(ctx, Event{
		Topic:   "fraud.alerts",
		Key:     evt.AlertID,
		Payload: payload,
	})
}

// EmitPaymentEvent publishes a payment event.
func (c *Client) EmitPaymentEvent(ctx context.Context, evt PaymentEvent) error {
	now := time.Now()
	payload := map[string]interface{}{
		"transaction_id": evt.TransactionID,
		"amount":         evt.Amount,
		"method":         evt.Method,
		"customer_id":    evt.CustomerID,
		"flagged":        evt.Flagged,
		"hour":           now.Hour(),
		"day_of_week":    int(now.Weekday()),
		"timestamp":      now.Unix(),
	}
	return c.Emit(ctx, Event{
		Topic:   "payments.processed",
		Key:     evt.TransactionID,
		Payload: payload,
	})
}

// EmitKYCEvent publishes a KYC completion event.
func (c *Client) EmitKYCEvent(ctx context.Context, evt KYCEvent) error {
	payload := map[string]interface{}{
		"customer_id":  evt.CustomerID,
		"ocr_score":    evt.OCRScore,
		"face_match":   evt.FaceMatch,
		"liveness":     evt.Liveness,
		"doc_verified":  evt.DocVerified,
		"status":       evt.Status,
		"timestamp":    time.Now().Unix(),
	}
	return c.Emit(ctx, Event{
		Topic:   "kyc.completed",
		Key:     evt.CustomerID,
		Payload: payload,
	})
}

// EmitPolicyEvent publishes a policy lifecycle event.
func (c *Client) EmitPolicyEvent(ctx context.Context, evt PolicyEvent) error {
	topic := "policies." + evt.EventType
	payload := map[string]interface{}{
		"policy_id":    evt.PolicyID,
		"customer_id":  evt.CustomerID,
		"product_type": evt.ProductType,
		"premium":      evt.Premium,
		"timestamp":    time.Now().Unix(),
	}
	return c.Emit(ctx, Event{
		Topic:   topic,
		Key:     evt.PolicyID,
		Payload: payload,
	})
}

// GetStats returns current publishing statistics.
func (c *Client) GetStats() Stats {
	c.stats.mu.Lock()
	defer c.stats.mu.Unlock()
	return Stats{
		Published: c.stats.Published,
		Delivered: c.stats.Delivered,
		Failed:    c.stats.Failed,
		Retried:   c.stats.Retried,
	}
}

func (c *Client) flushLoop() {
	defer c.wg.Done()
	ticker := time.NewTicker(c.config.FlushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if err := c.flush(); err != nil {
				log.Printf("[lakehouse] flush error: %v", err)
			}
		case <-c.done:
			return
		}
	}
}

func (c *Client) flush() error {
	c.mu.Lock()
	if len(c.buffer) == 0 {
		c.mu.Unlock()
		return nil
	}
	batch := c.buffer
	c.buffer = make([]Event, 0, c.config.BatchSize)
	c.mu.Unlock()

	return c.sendBatch(batch)
}

func (c *Client) sendBatch(batch []Event) error {
	// Convert to API format
	type ingestReq struct {
		Topic   string                 `json:"topic"`
		Key     *string                `json:"key"`
		Payload map[string]interface{} `json:"payload"`
	}

	requests := make([]ingestReq, len(batch))
	for i, evt := range batch {
		var key *string
		if evt.Key != "" {
			k := evt.Key
			key = &k
		}
		requests[i] = ingestReq{
			Topic:   evt.Topic,
			Key:     key,
			Payload: evt.Payload,
		}
	}

	body, err := json.Marshal(requests)
	if err != nil {
		return fmt.Errorf("marshal batch: %w", err)
	}

	var lastErr error
	for attempt := 0; attempt <= c.config.MaxRetries; attempt++ {
		if attempt > 0 {
			c.stats.mu.Lock()
			c.stats.Retried++
			c.stats.mu.Unlock()
			time.Sleep(time.Duration(attempt) * time.Second)
		}

		req, err := http.NewRequest("POST", c.config.APIEndpoint+"/ingest/batch", bytes.NewReader(body))
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("Content-Type", "application/json")
		if c.config.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
		}
		req.Header.Set("X-Service-Name", c.config.ServiceName)

		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			c.stats.mu.Lock()
			c.stats.Delivered += int64(len(batch))
			c.stats.mu.Unlock()
			return nil
		}

		lastErr = fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	c.stats.mu.Lock()
	c.stats.Failed += int64(len(batch))
	c.stats.mu.Unlock()

	return fmt.Errorf("batch delivery failed after %d attempts: %w", c.config.MaxRetries+1, lastErr)
}
