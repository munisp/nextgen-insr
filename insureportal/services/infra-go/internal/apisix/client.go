// Package apisix provides a Go client for the apisix service.
package apisix

import (
"context"
"encoding/json"
"fmt"
"net/http"
"os"

	"go.uber.org/zap"
)

// Client is the apisix HTTP client
type Client struct {
logger  *zap.Logger
endpoint string
httpClient *http.Client
}

// NewClient creates a new apisix client
func NewClient(logger *zap.Logger) *Client {
endpoint := getEnv("APISIX_ENDPOINT", "http://apisix:8080")
return &Client{
logger:     logger,
endpoint:   endpoint,
httpClient: &http.Client{},
}
}

// Ping checks apisix availability
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

func (c *Client) ListRoutesHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusOK, map[string]interface{}{"routes": []interface{}{}})
}
func (c *Client) CreateRouteHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}
func (c *Client) UpdateRouteHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}
func (c *Client) DeleteRouteHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusNoContent, nil)
}
func (c *Client) ListUpstreamsHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusOK, map[string]interface{}{"upstreams": []interface{}{}})
}
func (c *Client) CreateUpstreamHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}
func (c *Client) ListPluginsHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusOK, map[string]interface{}{"plugins": []string{"openappsec", "jwt-auth", "rate-limiting", "cors", "prometheus"}})
}
func (c *Client) HealthHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusOK, map[string]string{"status": c.Ping(r.Context())})
}

