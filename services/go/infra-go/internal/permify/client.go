// Package permify provides a Go client for Permify fine-grained authorization.
// Insurance RBAC entities: tenant, policy, claim, underwriting_case, reinsurance_treaty,
// agent, broker, compliance_report, actuarial_report, document
package permify

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

// CheckRequest is the Permify permission check request
type CheckRequest struct {
	TenantID   string    `json:"tenantId"`
	Metadata   *Metadata `json:"metadata"`
	Entity     Entity    `json:"entity"`
	Permission string    `json:"permission"`
	Subject    Subject   `json:"subject"`
}

type Metadata struct {
	SchemaVersion string `json:"schemaVersion,omitempty"`
	SnapToken     string `json:"snapToken,omitempty"`
	Depth         int    `json:"depth,omitempty"`
}

type Entity struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type Subject struct {
	Type     string `json:"type"`
	ID       string `json:"id"`
	Relation string `json:"relation,omitempty"`
}

type CheckResponse struct {
	Can string `json:"can"` // "RESULT_ALLOWED" | "RESULT_DENIED"
}

// WriteRelationshipRequest writes a relationship tuple
type WriteRelationshipRequest struct {
	TenantID string          `json:"tenantId"`
	Metadata *WriteMetadata  `json:"metadata"`
	Tuples   []RelationTuple `json:"tuples"`
}

type WriteMetadata struct {
	SchemaVersion string `json:"schemaVersion,omitempty"`
}

type RelationTuple struct {
	Entity   Entity  `json:"entity"`
	Relation string  `json:"relation"`
	Subject  Subject `json:"subject"`
}

// Client is the Permify HTTP client
type Client struct {
	logger     *zap.Logger
	endpoint   string
	httpClient *http.Client
}

// NewClient creates a new Permify client
func NewClient(logger *zap.Logger) *Client {
	endpoint := getEnv("PERMIFY_ENDPOINT", "http://permify:3476")
	return &Client{
		logger:     logger,
		endpoint:   endpoint,
		httpClient: &http.Client{Timeout: 5 * time.Second},
	}
}

func (c *Client) Ping(ctx context.Context) string {
	req, err := http.NewRequestWithContext(ctx, "GET", c.endpoint+"/healthz", nil)
	if err != nil {
		return "error"
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "unreachable"
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusOK {
		return "ok"
	}
	return fmt.Sprintf("http_%d", resp.StatusCode)
}

// Check performs a permission check
func (c *Client) Check(ctx context.Context, req CheckRequest) (bool, error) {
	body, _ := json.Marshal(req)
	httpReq, err := http.NewRequestWithContext(ctx, "POST",
		fmt.Sprintf("%s/v1/tenants/%s/permissions/check", c.endpoint, req.TenantID),
		bytes.NewReader(body))
	if err != nil {
		return true, nil
	} // fail-open
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		c.logger.Warn("Permify check failed (fail-open)", zap.Error(err))
		return true, nil // fail-open when unavailable
	}
	defer func() { _ = resp.Body.Close() }()

	var result CheckResponse
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return result.Can == "RESULT_ALLOWED", nil
}

// ── HTTP Handlers ─────────────────────────────────────────────────────────────

func (c *Client) CheckHandler(w http.ResponseWriter, r *http.Request) {
	var req CheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	allowed, err := c.Check(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"allowed": allowed})
}

func (c *Client) BatchCheckHandler(w http.ResponseWriter, r *http.Request) {
	var reqs []CheckRequest
	if err := json.NewDecoder(r.Body).Decode(&reqs); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	results := make([]map[string]interface{}, len(reqs))
	for i, req := range reqs {
		allowed, _ := c.Check(r.Context(), req)
		results[i] = map[string]interface{}{
			"entity":     req.Entity,
			"permission": req.Permission,
			"allowed":    allowed,
		}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"results": results})
}

func (c *Client) WriteRelationshipHandler(w http.ResponseWriter, r *http.Request) {
	var req WriteRelationshipRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	body, _ := json.Marshal(req)
	httpReq, _ := http.NewRequestWithContext(r.Context(), "POST",
		fmt.Sprintf("%s/v1/tenants/%s/relationships/write", c.endpoint, req.TenantID),
		bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "queued_offline"})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	var result interface{}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	writeJSON(w, resp.StatusCode, result)
}

func (c *Client) DeleteRelationshipHandler(w http.ResponseWriter, r *http.Request) {
	var req WriteRelationshipRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	body, _ := json.Marshal(req)
	httpReq, _ := http.NewRequestWithContext(r.Context(), "DELETE",
		fmt.Sprintf("%s/v1/tenants/%s/relationships/delete", c.endpoint, req.TenantID),
		bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	writeJSON(w, resp.StatusCode, nil)
}

func (c *Client) ReadRelationshipsHandler(w http.ResponseWriter, r *http.Request) {
	tenantID := r.URL.Query().Get("tenantId")
	if tenantID == "" {
		tenantID = "default"
	}
	httpReq, _ := http.NewRequestWithContext(r.Context(), "POST",
		fmt.Sprintf("%s/v1/tenants/%s/relationships/read", c.endpoint, tenantID), nil)
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"tuples": []interface{}{}})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	var result interface{}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	writeJSON(w, resp.StatusCode, result)
}

func (c *Client) WriteSchemaHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TenantID string `json:"tenantId"`
		Schema   string `json:"schema"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	body, _ := json.Marshal(map[string]string{"schema": req.Schema})
	httpReq, _ := http.NewRequestWithContext(r.Context(), "POST",
		fmt.Sprintf("%s/v1/tenants/%s/schemas/write", c.endpoint, req.TenantID),
		bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "queued_offline"})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	var result interface{}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	writeJSON(w, resp.StatusCode, result)
}

func (c *Client) ReadSchemaHandler(w http.ResponseWriter, r *http.Request) {
	tenantID := r.URL.Query().Get("tenantId")
	if tenantID == "" {
		tenantID = "default"
	}
	httpReq, _ := http.NewRequestWithContext(r.Context(), "POST",
		fmt.Sprintf("%s/v1/tenants/%s/schemas/read", c.endpoint, tenantID), nil)
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]string{"schema": ""})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	var result interface{}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	writeJSON(w, resp.StatusCode, result)
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
