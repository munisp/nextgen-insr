package auth

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

type PermifyClient struct {
	baseURL string
	client  *http.Client
}

func NewPermifyClient() *PermifyClient {
	addr := os.Getenv("PERMIFY_ADDR")
	if addr == "" {
		addr = "localhost:3476"
	}
	return &PermifyClient{
		baseURL: fmt.Sprintf("http://%s", addr),
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

type PermissionCheckRequest struct {
	TenantID   string            `json:"tenant_id"`
	Entity     PermifyEntity     `json:"entity"`
	Subject    PermifySubject    `json:"subject"`
	Permission string            `json:"permission"`
	Metadata   map[string]string `json:"metadata,omitempty"`
}

type PermifyEntity struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type PermifySubject struct {
	Type     string `json:"type"`
	ID       string `json:"id"`
	Relation string `json:"relation,omitempty"`
}

type PermissionCheckResponse struct {
	Can       string                 `json:"can"`
	Decisions map[string]interface{} `json:"decisions,omitempty"`
}

func (p *PermifyClient) Check(ctx context.Context, req PermissionCheckRequest) (bool, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return false, err
	}
	url := fmt.Sprintf("%s/v1/tenants/%s/permissions/check", p.baseURL, req.TenantID)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return false, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return false, fmt.Errorf("permify check: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, _ := io.ReadAll(resp.Body)
	var result PermissionCheckResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return false, err
	}
	return result.Can == "RESULT_ALLOWED", nil
}

func (p *PermifyClient) WriteRelationship(ctx context.Context, tenantID string, entityType, entityID, relation, subjectType, subjectID string) error {
	payload := map[string]interface{}{
		"metadata": map[string]string{"schema_version": ""},
		"tuples": []map[string]interface{}{
			{
				"entity":   map[string]string{"type": entityType, "id": entityID},
				"relation": relation,
				"subject":  map[string]string{"type": subjectType, "id": subjectID},
			},
		},
	}
	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/v1/tenants/%s/relationships/write", p.baseURL, tenantID)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	return nil
}
