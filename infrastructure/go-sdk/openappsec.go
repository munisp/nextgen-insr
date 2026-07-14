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

type OpenAppSecClient struct {
	baseURL    string
	httpClient *http.Client
	logger     *zap.Logger
}

type WAFPolicy struct {
	Name           string   `json:"name"`
	Mode           string   `json:"mode"`
	SecurityLevel  string   `json:"security_level"`
	TrustedSources []string `json:"trusted_sources,omitempty"`
	CustomRules    []WAFRule `json:"custom_rules,omitempty"`
}

type WAFRule struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Pattern  string `json:"pattern"`
	Action   string `json:"action"`
	Severity string `json:"severity"`
}

func NewOpenAppSecClient(logger *zap.Logger, baseURL string) *OpenAppSecClient {
	return &OpenAppSecClient{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		logger:     logger,
	}
}

func (c *OpenAppSecClient) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("openappsec ping: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

// PlatformWAFPolicy returns the default WAF policy for the insurance platform.
func PlatformWAFPolicy() WAFPolicy {
	return WAFPolicy{
		Name:          "ngapp-insurance-waf",
		Mode:          "prevent",
		SecurityLevel: "high",
		TrustedSources: []string{
			"10.0.0.0/8",
			"172.16.0.0/12",
			"192.168.0.0/16",
		},
		CustomRules: []WAFRule{
			{Name: "block-sql-injection", Type: "sqli", Pattern: "union select|drop table|insert into", Action: "block", Severity: "critical"},
			{Name: "block-xss", Type: "xss", Pattern: "script|onerror|onload", Action: "block", Severity: "critical"},
			{Name: "block-path-traversal", Type: "path_traversal", Pattern: "../", Action: "block", Severity: "high"},
			{Name: "block-command-injection", Type: "command_injection", Pattern: "cmd|exec|system", Action: "block", Severity: "critical"},
			{Name: "rate-limit-auth", Type: "rate_limit", Pattern: "/api/v1/auth/*", Action: "throttle", Severity: "medium"},
			{Name: "block-large-payload", Type: "size_limit", Pattern: "body_size>10485760", Action: "block", Severity: "medium"},
			{Name: "protect-kyc-endpoints", Type: "custom", Pattern: "/api/v1/kyc/(document|selfie)", Action: "inspect", Severity: "high"},
			{Name: "protect-payment-endpoints", Type: "custom", Pattern: "/api/v1/payments/", Action: "inspect", Severity: "critical"},
			{Name: "bot-detection", Type: "bot", Pattern: "automated_request", Action: "challenge", Severity: "medium"},
			{Name: "geo-restriction", Type: "geo", Pattern: "blocked_countries", Action: "block", Severity: "low"},
		},
	}
}

func (c *OpenAppSecClient) ApplyPolicy(ctx context.Context, policy WAFPolicy) error {
	data, err := json.Marshal(policy)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "PUT", c.baseURL+"/api/v1/policies/"+policy.Name, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("apply WAF policy: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("WAF policy failed (%d): %s", resp.StatusCode, string(body))
	}
	return nil
}

func (c *OpenAppSecClient) GetThreatLog(ctx context.Context, limit int) ([]map[string]interface{}, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/api/v1/threats?limit=%d", c.baseURL, limit), nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("threat log: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var threats []map[string]interface{}
	if err := json.Unmarshal(body, &threats); err != nil {
		return nil, err
	}
	return threats, nil
}

// GetSecurityDashboard returns aggregated security metrics.
func (c *OpenAppSecClient) GetSecurityDashboard(ctx context.Context) (map[string]interface{}, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/api/v1/dashboard", nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("security dashboard: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var dashboard map[string]interface{}
	json.Unmarshal(body, &dashboard)
	return dashboard, nil
}
