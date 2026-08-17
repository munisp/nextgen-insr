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

type FluvioClient struct {
	baseURL string
	client  *http.Client
}

func NewFluvioClient() *FluvioClient {
	addr := os.Getenv("FLUVIO_ADDR")
	if addr == "" {
		addr = "localhost:9003"
	}
	return &FluvioClient{
		baseURL: fmt.Sprintf("http://%s", addr),
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

func (f *FluvioClient) Produce(ctx context.Context, topic string, key string, value interface{}) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	payload := map[string]interface{}{
		"topic": topic,
		"key":   key,
		"value": string(data),
	}
	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/api/v1/produce", f.baseURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := f.client.Do(req)
	if err != nil {
		return fmt.Errorf("fluvio produce: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("fluvio error (%d): %s", resp.StatusCode, string(b))
	}
	return nil
}
