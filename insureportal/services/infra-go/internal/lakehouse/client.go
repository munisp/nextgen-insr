// Package lakehouse provides a Go client for the lakehouse service.
package lakehouse

import (
"context"
"encoding/json"
"fmt"
"net/http"
"os"

	"go.uber.org/zap"
)

// Client is the lakehouse HTTP client
type Client struct {
logger  *zap.Logger
endpoint string
httpClient *http.Client
}

// NewClient creates a new lakehouse client
func NewClient(logger *zap.Logger) *Client {
endpoint := getEnv("LAKEHOUSE_ENDPOINT", "http://lakehouse:8080")
return &Client{
logger:     logger,
endpoint:   endpoint,
httpClient: &http.Client{},
}
}

// Ping checks lakehouse availability
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

func (c *Client) CreateSnapshotHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusCreated, map[string]string{"status": "snapshot_created"})
}
func (c *Client) ListSnapshotsHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusOK, map[string]interface{}{"snapshots": []interface{}{}})
}
func (c *Client) GetSnapshotHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusOK, map[string]string{"key": r.PathValue("key")})
}
func (c *Client) ExportPoliciesHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusAccepted, map[string]string{"status": "export_queued", "type": "policies"})
}
func (c *Client) ExportClaimsHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusAccepted, map[string]string{"status": "export_queued", "type": "claims"})
}
func (c *Client) ExportPremiumsHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusAccepted, map[string]string{"status": "export_queued", "type": "premiums"})
}
func (c *Client) ExportActuarialHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusAccepted, map[string]string{"status": "export_queued", "type": "actuarial"})
}
func (c *Client) ListBucketsHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusOK, map[string]interface{}{"buckets": []string{"insureportal-policies", "insureportal-claims", "insureportal-actuarial", "insureportal-compliance"}})
}
func (c *Client) CreateBucketHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}
func (c *Client) HealthHandler(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusOK, map[string]string{"status": c.Ping(r.Context())})
}

