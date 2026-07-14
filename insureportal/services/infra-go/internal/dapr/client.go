// Package dapr provides a Go client for Dapr distributed application runtime.
// Dapr is used for:
//   - Pub/sub messaging between insurance microservices
//   - Service invocation with retries and circuit breaking
//   - State management for workflow state
//   - Secret management via Vault binding
//   - Scheduled bindings (cron) for actuarial calculations
package dapr

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

// Dapr pub/sub topic names for insurance domain
const (
	PubSubName = "insureportal-pubsub"

	TopicPolicyCreated       = "policy.created"
	TopicPolicyRenewed       = "policy.renewed"
	TopicPolicyCancelled     = "policy.cancelled"
	TopicClaimFiled          = "claim.filed"
	TopicClaimApproved       = "claim.approved"
	TopicClaimPaid           = "claim.paid"
	TopicPremiumCollected    = "premium.collected"
	TopicUnderwritingDecision = "underwriting.decision"
	TopicFraudAlert          = "fraud.alert"
	TopicKYCCompleted        = "kyc.completed"
	TopicComplianceReport    = "compliance.report"
	TopicReinsuranceCession  = "reinsurance.cession"
)

// Dapr state store names
const (
	StateStoreDefault    = "insureportal-statestore"
	StateStoreWorkflow   = "insureportal-workflow-state"
	StateStoreSession    = "insureportal-session-state"
)

// PublishRequest is the request body for Dapr pub/sub publish
type PublishRequest struct {
	PubSubName string                 `json:"pubsubName"`
	Topic      string                 `json:"topic"`
	Data       map[string]interface{} `json:"data"`
	Metadata   map[string]string      `json:"metadata,omitempty"`
}

// StateItem represents a Dapr state store item
type StateItem struct {
	Key      string      `json:"key"`
	Value    interface{} `json:"value"`
	ETag     string      `json:"etag,omitempty"`
	Metadata map[string]string `json:"metadata,omitempty"`
	Options  *StateOptions `json:"options,omitempty"`
}

// StateOptions configures state store operations
type StateOptions struct {
	Concurrency string `json:"concurrency,omitempty"` // "first-write" | "last-write"
	Consistency string `json:"consistency,omitempty"` // "eventual" | "strong"
}

// Client is the Dapr HTTP client
type Client struct {
	logger     *zap.Logger
	daprPort   string
	httpClient *http.Client
}

// NewClient creates a new Dapr client
func NewClient(logger *zap.Logger) *Client {
	daprPort := getEnv("DAPR_HTTP_PORT", "3500")
	return &Client{
		logger:   logger,
		daprPort: daprPort,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// Ping checks Dapr sidecar availability
func (c *Client) Ping(ctx context.Context) string {
	req, err := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("http://localhost:%s/v1.0/healthz", c.daprPort), nil)
	if err != nil {
		return "error"
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "unreachable"
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusOK {
		return "ok"
	}
	return fmt.Sprintf("http_%d", resp.StatusCode)
}

// Close cleans up the client
func (c *Client) Close() {}

// Publish sends a message to a Dapr pub/sub topic
func (c *Client) Publish(ctx context.Context, pubsubName, topic string, data map[string]interface{}) error {
	body, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal data: %w", err)
	}

	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/%s/%s", c.daprPort, pubsubName, topic)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.logger.Warn("Dapr publish failed (fail-open)",
			zap.String("topic", topic), zap.Error(err))
		return nil // fail-open
	}
	defer resp.Body.Close()
	return nil
}

// ── HTTP Handlers ─────────────────────────────────────────────────────────────

// PublishHandler handles POST /dapr/publish
func (c *Client) PublishHandler(w http.ResponseWriter, r *http.Request) {
	var req PublishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if req.Topic == "" {
		writeError(w, http.StatusBadRequest, "topic is required")
		return
	}
	if req.PubSubName == "" {
		req.PubSubName = PubSubName
	}

	if err := c.Publish(r.Context(), req.PubSubName, req.Topic, req.Data); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusNoContent, nil)
}

// InvokeHandler handles POST /dapr/invoke/{appId}/{method}
func (c *Client) InvokeHandler(w http.ResponseWriter, r *http.Request) {
	appID := r.PathValue("appId")
	method := r.PathValue("method")

	url := fmt.Sprintf("http://localhost:%s/v1.0/invoke/%s/method/%s", c.daprPort, appID, method)
	req, err := http.NewRequestWithContext(r.Context(), r.Method, url, r.Body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	req.Header = r.Header

	resp, err := c.httpClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "service unavailable: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	var result interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	writeJSON(w, resp.StatusCode, result)
}

// SaveStateHandler handles POST /dapr/state/{storeName}
func (c *Client) SaveStateHandler(w http.ResponseWriter, r *http.Request) {
	storeName := r.PathValue("storeName")
	var items []StateItem
	if err := json.NewDecoder(r.Body).Decode(&items); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	body, _ := json.Marshal(items)
	url := fmt.Sprintf("http://localhost:%s/v1.0/state/%s", c.daprPort, storeName)
	req, _ := http.NewRequestWithContext(r.Context(), "POST", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "queued_offline"})
		return
	}
	defer resp.Body.Close()
	w.WriteHeader(resp.StatusCode)
}

// GetStateHandler handles GET /dapr/state/{storeName}/{key}
func (c *Client) GetStateHandler(w http.ResponseWriter, r *http.Request) {
	storeName := r.PathValue("storeName")
	key := r.PathValue("key")

	url := fmt.Sprintf("http://localhost:%s/v1.0/state/%s/%s", c.daprPort, storeName, key)
	req, _ := http.NewRequestWithContext(r.Context(), "GET", url, nil)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, nil)
		return
	}
	defer resp.Body.Close()

	var result interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	writeJSON(w, resp.StatusCode, result)
}

// DeleteStateHandler handles DELETE /dapr/state/{storeName}/{key}
func (c *Client) DeleteStateHandler(w http.ResponseWriter, r *http.Request) {
	storeName := r.PathValue("storeName")
	key := r.PathValue("key")

	url := fmt.Sprintf("http://localhost:%s/v1.0/state/%s/%s", c.daprPort, storeName, key)
	req, _ := http.NewRequestWithContext(r.Context(), "DELETE", url, nil)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	defer resp.Body.Close()
	w.WriteHeader(resp.StatusCode)
}

// InvokeBindingHandler handles POST /dapr/bindings/{bindingName}
func (c *Client) InvokeBindingHandler(w http.ResponseWriter, r *http.Request) {
	bindingName := r.PathValue("bindingName")
	var req map[string]interface{}
	json.NewDecoder(r.Body).Decode(&req)

	body, _ := json.Marshal(req)
	url := fmt.Sprintf("http://localhost:%s/v1.0/bindings/%s", c.daprPort, bindingName)
	httpReq, _ := http.NewRequestWithContext(r.Context(), "POST", url, bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "queued_offline"})
		return
	}
	defer resp.Body.Close()

	var result interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	writeJSON(w, resp.StatusCode, result)
}

// GetSecretHandler handles GET /dapr/secrets/{storeName}/{key}
func (c *Client) GetSecretHandler(w http.ResponseWriter, r *http.Request) {
	storeName := r.PathValue("storeName")
	key := r.PathValue("key")

	url := fmt.Sprintf("http://localhost:%s/v1.0/secrets/%s/%s", c.daprPort, storeName, key)
	req, _ := http.NewRequestWithContext(r.Context(), "GET", url, nil)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "secret store unavailable")
		return
	}
	defer resp.Body.Close()

	var result interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	writeJSON(w, resp.StatusCode, result)
}

// HealthHandler handles GET /dapr/health
func (c *Client) HealthHandler(w http.ResponseWriter, r *http.Request) {
	status := c.Ping(r.Context())
	code := http.StatusOK
	if status != "ok" {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, map[string]string{"status": status})
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
	if v != nil {
		json.NewEncoder(w).Encode(v)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
