package messaging

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

type DaprClient struct {
	baseURL string
	client  *http.Client
}

func NewDaprClient() *DaprClient {
	port := os.Getenv("DAPR_HTTP_PORT")
	if port == "" {
		port = "3500"
	}
	return &DaprClient{
		baseURL: fmt.Sprintf("http://localhost:%s", port),
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

func (d *DaprClient) PublishEvent(ctx context.Context, pubsubName, topic string, data interface{}) error {
	body, err := json.Marshal(data)
	if err != nil {
		return err
	}
	url := fmt.Sprintf("%s/v1.0/publish/%s/%s", d.baseURL, pubsubName, topic)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := d.client.Do(req)
	if err != nil {
		return fmt.Errorf("dapr publish: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("dapr publish failed (%d): %s", resp.StatusCode, string(b))
	}
	return nil
}

func (d *DaprClient) InvokeService(ctx context.Context, appID, method string, data interface{}) ([]byte, error) {
	body, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	url := fmt.Sprintf("%s/v1.0/invoke/%s/method/%s", d.baseURL, appID, method)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := d.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("dapr invoke: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	return io.ReadAll(resp.Body)
}

func (d *DaprClient) SaveState(ctx context.Context, storeName, key string, value interface{}) error {
	data, _ := json.Marshal(value)
	payload := []map[string]interface{}{
		{"key": key, "value": json.RawMessage(data)},
	}
	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/v1.0/state/%s", d.baseURL, storeName)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	return nil
}

func (d *DaprClient) GetState(ctx context.Context, storeName, key string) ([]byte, error) {
	url := fmt.Sprintf("%s/v1.0/state/%s/%s", d.baseURL, storeName, key)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	return io.ReadAll(resp.Body)
}
