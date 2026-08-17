package observability

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

type OpenSearchClient struct {
	baseURL  string
	client   *http.Client
	user     string
	password string
}

func NewOpenSearchClient() *OpenSearchClient {
	addr := os.Getenv("OPENSEARCH_URL")
	if addr == "" {
		addr = "http://localhost:9200"
	}
	return &OpenSearchClient{
		baseURL:  addr,
		client:   &http.Client{Timeout: 10 * time.Second},
		user:     os.Getenv("OPENSEARCH_USER"),
		password: os.Getenv("OPENSEARCH_PASSWORD"),
	}
}

type LogEntry struct {
	Timestamp  time.Time              `json:"@timestamp"`
	Level      string                 `json:"level"`
	Service    string                 `json:"service"`
	Message    string                 `json:"message"`
	RequestID  string                 `json:"request_id,omitempty"`
	UserID     string                 `json:"user_id,omitempty"`
	TenantID   string                 `json:"tenant_id,omitempty"`
	DurationMs float64                `json:"duration_ms,omitempty"`
	StatusCode int                    `json:"status_code,omitempty"`
	Fields     map[string]interface{} `json:"fields,omitempty"`
}

func (o *OpenSearchClient) IndexLog(ctx context.Context, index string, entry LogEntry) error {
	if entry.Timestamp.IsZero() {
		entry.Timestamp = time.Now()
	}
	body, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	url := fmt.Sprintf("%s/%s/_doc", o.baseURL, index)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if o.user != "" {
		req.SetBasicAuth(o.user, o.password)
	}
	resp, err := o.client.Do(req)
	if err != nil {
		return fmt.Errorf("opensearch index: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.ReadAll(resp.Body)
	return nil
}

func (o *OpenSearchClient) Search(ctx context.Context, index string, query map[string]interface{}) ([]json.RawMessage, error) {
	body, _ := json.Marshal(map[string]interface{}{"query": query})
	url := fmt.Sprintf("%s/%s/_search", o.baseURL, index)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if o.user != "" {
		req.SetBasicAuth(o.user, o.password)
	}
	resp, err := o.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, _ := io.ReadAll(resp.Body)

	var result struct {
		Hits struct {
			Hits []struct {
				Source json.RawMessage `json:"_source"`
			} `json:"hits"`
		} `json:"hits"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, err
	}
	var docs []json.RawMessage
	for _, hit := range result.Hits.Hits {
		docs = append(docs, hit.Source)
	}
	return docs, nil
}
