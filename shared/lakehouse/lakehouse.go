package lakehouse

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

type LakehouseClient struct {
	baseURL string
	client  *http.Client
}

func NewLakehouseClient() *LakehouseClient {
	addr := os.Getenv("LAKEHOUSE_URL")
	if addr == "" {
		addr = "http://localhost:8181"
	}
	return &LakehouseClient{
		baseURL: addr,
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

type IngestRequest struct {
	Table     string                   `json:"table"`
	Partition string                   `json:"partition,omitempty"`
	Records   []map[string]interface{} `json:"records"`
}

func (l *LakehouseClient) Ingest(ctx context.Context, req IngestRequest) error {
	body, _ := json.Marshal(req)
	url := fmt.Sprintf("%s/api/v1/ingest", l.baseURL)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := l.client.Do(httpReq)
	if err != nil {
		return fmt.Errorf("lakehouse ingest: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.ReadAll(resp.Body)
	return nil
}

type QueryRequest struct {
	SQL    string                 `json:"sql"`
	Params map[string]interface{} `json:"params,omitempty"`
}

func (l *LakehouseClient) Query(ctx context.Context, sql string, params map[string]interface{}) ([]map[string]interface{}, error) {
	req := QueryRequest{SQL: sql, Params: params}
	body, _ := json.Marshal(req)
	url := fmt.Sprintf("%s/api/v1/query", l.baseURL)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := l.client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, _ := io.ReadAll(resp.Body)
	var result struct {
		Rows []map[string]interface{} `json:"rows"`
	}
	_ = json.Unmarshal(respBody, &result)
	return result.Rows, nil
}

func (l *LakehouseClient) PublishMetric(ctx context.Context, table string, metric map[string]interface{}) error {
	metric["@timestamp"] = time.Now().UTC().Format(time.RFC3339)
	return l.Ingest(ctx, IngestRequest{
		Table:   table,
		Records: []map[string]interface{}{metric},
	})
}
