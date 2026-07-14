// Package openappsec provides a Go client for the openappsec service.
package openappsec

import (
"context"
"encoding/json"
"fmt"
"net/http"
"os"

	"go.uber.org/zap"
)

// Client is the openappsec HTTP client
type Client struct {
logger  *zap.Logger
endpoint string
httpClient *http.Client
}

// NewClient creates a new openappsec client
func NewClient(logger *zap.Logger) *Client {
endpoint := getEnv("OPENAPPSEC_ENDPOINT", "http://openappsec:8080")
return &Client{
logger:     logger,
endpoint:   endpoint,
httpClient: &http.Client{},
}
}

// Ping checks openappsec availability
func (c *Client) Ping(ctx context.Context) string {
req, err := http.NewRequestWithContext(ctx, "GET", c.endpoint+"/health", nil)
if err != nil { return "error" }
resp, err := c.httpClient.Do(req)
if err != nil { return "unreachable" }
defer resp.Body.Close()
if resp.StatusCode == http.StatusOK { return "ok" }
return fmt.Sprintf("http_%d", resp.StatusCode)
}

func getEnv(key, fallback string) string {
if v := os.Getenv(key); v != "" { return v }
return fallback
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
w.Header().Set("Content-Type", "application/json")
w.WriteHeader(status)
if v != nil { json.NewEncoder(w).Encode(v) }
}

func writeError(w http.ResponseWriter, status int, msg string) {
writeJSON(w, status, map[string]string{"error": msg})
}

func (c *Client) GetPolicyHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusOK, map[string]string{"policy": "default-insurance-waf-policy"})
}
func (c *Client) UpdatePolicyHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}
func (c *Client) GetThreatsHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusOK, map[string]interface{}{"threats": []interface{}{}})
}
func (c *Client) ReportThreatHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusCreated, map[string]string{"status": "reported"})
}
func (c *Client) HealthHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusOK, map[string]string{"status": c.Ping(r.Context())})
}

