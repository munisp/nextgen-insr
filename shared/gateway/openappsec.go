package gateway

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

type OpenAppSecClient struct {
	baseURL string
	client  *http.Client
}

func NewOpenAppSecClient() *OpenAppSecClient {
	addr := os.Getenv("OPENAPPSEC_URL")
	if addr == "" {
		addr = "http://localhost:7777"
	}
	return &OpenAppSecClient{
		baseURL: addr,
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

type WAFPolicy struct {
	Name  string    `json:"name"`
	Mode  string    `json:"mode"` // detect, prevent
	Rules []WAFRule `json:"rules"`
}

type WAFRule struct {
	Type     string `json:"type"`   // sql-injection, xss, command-injection
	Action   string `json:"action"` // block, log, allow
	Severity string `json:"severity"`
}

func (o *OpenAppSecClient) ApplyPolicy(ctx context.Context, policy WAFPolicy) error {
	body, _ := json.Marshal(policy)
	url := fmt.Sprintf("%s/api/v1/policies", o.baseURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := o.client.Do(req)
	if err != nil {
		return fmt.Errorf("openappsec apply: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.ReadAll(resp.Body)
	return nil
}

func DefaultWAFPolicy() WAFPolicy {
	return WAFPolicy{
		Name: "ngapp-default",
		Mode: "prevent",
		Rules: []WAFRule{
			{Type: "sql-injection", Action: "block", Severity: "critical"},
			{Type: "xss", Action: "block", Severity: "high"},
			{Type: "command-injection", Action: "block", Severity: "critical"},
			{Type: "path-traversal", Action: "block", Severity: "high"},
			{Type: "request-smuggling", Action: "block", Severity: "critical"},
		},
	}
}
