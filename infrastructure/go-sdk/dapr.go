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

type DaprClient struct {
	httpPort   int
	grpcPort   int
	httpClient *http.Client
	logger     *zap.Logger
}

const (
	DaprStateStore   = "statestore"
	DaprPubSub       = "pubsub"
	DaprSecretStore  = "secretstore"
)

func NewDaprClient(logger *zap.Logger, httpPort int) *DaprClient {
	if httpPort == 0 {
		httpPort = 3500
	}
	return &DaprClient{
		httpPort:   httpPort,
		grpcPort:   50001,
		httpClient: &http.Client{Timeout: 5 * time.Second},
		logger:     logger,
	}
}

func (c *DaprClient) baseURL() string {
	return fmt.Sprintf("http://localhost:%d", c.httpPort)
}

func (c *DaprClient) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL()+"/v1.0/healthz", nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("dapr ping: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 204 && resp.StatusCode != 200 {
		return fmt.Errorf("dapr unhealthy: %d", resp.StatusCode)
	}
	return nil
}

// SaveState saves key-value state with optional ETag for optimistic concurrency.
func (c *DaprClient) SaveState(ctx context.Context, storeName, key string, value interface{}, etag string) error {
	item := map[string]interface{}{
		"key":   key,
		"value": value,
	}
	if etag != "" {
		item["etag"] = etag
		item["options"] = map[string]string{"concurrency": "first-write"}
	}
	data, _ := json.Marshal([]interface{}{item})
	req, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/v1.0/state/%s", c.baseURL(), storeName), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("save state: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("save state failed (%d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// GetState retrieves state by key, returning the value and ETag.
func (c *DaprClient) GetState(ctx context.Context, storeName, key string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/v1.0/state/%s/%s", c.baseURL(), storeName, key), nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("get state: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == 204 || resp.StatusCode == 404 {
		return nil, "", nil
	}
	body, _ := io.ReadAll(resp.Body)
	etag := resp.Header.Get("ETag")
	return body, etag, nil
}

// DeleteState deletes a key from the state store.
func (c *DaprClient) DeleteState(ctx context.Context, storeName, key string) error {
	req, err := http.NewRequestWithContext(ctx, "DELETE", fmt.Sprintf("%s/v1.0/state/%s/%s", c.baseURL(), storeName, key), nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("delete state: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

// PublishEvent publishes an event to a pub/sub topic.
func (c *DaprClient) PublishEvent(ctx context.Context, pubsubName, topic string, event interface{}) error {
	data, _ := json.Marshal(event)
	req, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/v1.0/publish/%s/%s", c.baseURL(), pubsubName, topic), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("publish event: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("publish failed (%d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// InvokeService invokes another service via Dapr service invocation.
func (c *DaprClient) InvokeService(ctx context.Context, appID, method string, payload interface{}) ([]byte, error) {
	var bodyReader io.Reader
	if payload != nil {
		data, _ := json.Marshal(payload)
		bodyReader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/v1.0/invoke/%s/method/%s", c.baseURL(), appID, method), bodyReader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("invoke %s/%s: %w", appID, method, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("invoke failed (%d): %s", resp.StatusCode, string(body))
	}
	return body, nil
}

// GetSecret retrieves a secret from a secret store.
func (c *DaprClient) GetSecret(ctx context.Context, storeName, key string) (map[string]string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/v1.0/secrets/%s/%s", c.baseURL(), storeName, key), nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("get secret: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var secrets map[string]string
	json.Unmarshal(body, &secrets)
	return secrets, nil
}

// SaveKYCSession stores a KYC session in Dapr state.
func (c *DaprClient) SaveKYCSession(ctx context.Context, sessionID string, session interface{}) error {
	return c.SaveState(ctx, DaprStateStore, "kyc:session:"+sessionID, session, "")
}

// GetKYCSession retrieves a KYC session from Dapr state.
func (c *DaprClient) GetKYCSession(ctx context.Context, sessionID string) ([]byte, error) {
	data, _, err := c.GetState(ctx, DaprStateStore, "kyc:session:"+sessionID)
	return data, err
}

// PublishKYCEvent publishes a KYC event via Dapr pub/sub.
func (c *DaprClient) PublishKYCEvent(ctx context.Context, eventType string, payload interface{}) error {
	event := map[string]interface{}{
		"event_type": eventType,
		"data":       payload,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
		"source":     "kyc-orchestrator",
	}
	return c.PublishEvent(ctx, DaprPubSub, "kyc-events", event)
}

// InvokeKYCService invokes another KYC-related service via Dapr.
func (c *DaprClient) InvokeKYCService(ctx context.Context, service, method string, payload interface{}) ([]byte, error) {
	return c.InvokeService(ctx, service, method, payload)
}

// SavePolicyState stores policy state in Dapr.
func (c *DaprClient) SavePolicyState(ctx context.Context, policyID string, state interface{}) error {
	return c.SaveState(ctx, DaprStateStore, "policy:"+policyID, state, "")
}

// SaveClaimState stores claim state in Dapr.
func (c *DaprClient) SaveClaimState(ctx context.Context, claimID string, state interface{}) error {
	return c.SaveState(ctx, DaprStateStore, "claim:"+claimID, state, "")
}
