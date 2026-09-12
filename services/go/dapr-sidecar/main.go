// dapr-sidecar — typed Go proxy over the Dapr HTTP API.
//
// The TS platform talks to Dapr directly (server/middleware/middlewareConnectors.ts,
// DAPR_HTTP_PORT, default :3500). This service gives Go workloads the same
// building blocks with real semantics and no fabricated success:
//
//   DaprSidecar.InvokeService  → POST /v1.0/invoke/{app-id}/method/{method}
//   DaprSidecar.PublishEvent   → POST /v1.0/publish/{pubsub}/{topic}
//   DaprSidecar.AcquireLock    → POST /v1.0-alpha1/lock/{store}   (DistributedLock)
//   DistributedLock.Unlock     → POST /v1.0-alpha1/unlock/{store}
//   DaprSidecar.GetState/SaveState → /v1.0/state/{store}[/{key}]
//
// Fail-loud by construction: every method returns the Dapr error verbatim
// (transport, non-2xx status with body). The only silent-by-design path is
// none — callers always get (result, error). The exposed HTTP wrapper
// (/health) reports 503 when the Dapr sidecar is unreachable, never "healthy".
//
// Component manifests this proxy is built against live in ./components
// (statestore=state.redis, pubsub=pubsub.kafka, lockstore=lock.redis — the
// same component names/types as the W4 k8s/charts/dapr chart and
// k8s/middleware/dapr.yaml).
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

// ── DaprSidecar client ──────────────────────────────────────────────────────

type DaprSidecar struct {
	baseURL    string
	httpClient *http.Client
	// LockStore is the Dapr lock component name (components/lock.yaml).
	LockStore string
}

func NewDaprSidecar() *DaprSidecar {
	port := os.Getenv("DAPR_HTTP_PORT")
	if port == "" {
		port = "3500"
	}
	host := os.Getenv("DAPR_HOST")
	if host == "" {
		host = "localhost"
	}
	lockStore := os.Getenv("DAPR_LOCK_STORE")
	if lockStore == "" {
		lockStore = "lockstore"
	}
	return &DaprSidecar{
		baseURL: fmt.Sprintf("http://%s:%s", host, port),
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		LockStore: lockStore,
	}
}

// daprError carries the real status code and body back to the caller.
type daprError struct {
	op     string
	status int
	body   string
}

func (e *daprError) Error() string {
	if e.status > 0 {
		return fmt.Sprintf("dapr %s failed: status %d: %s", e.op, e.status, e.body)
	}
	return fmt.Sprintf("dapr %s failed: %s", e.op, e.body)
}

func (d *DaprSidecar) do(ctx context.Context, op, method, path string, body []byte) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, d.baseURL+path, reader)
	if err != nil {
		return nil, &daprError{op: op, body: err.Error()}
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token := os.Getenv("DAPR_API_TOKEN"); token != "" {
		req.Header.Set("dapr-api-token", token)
	}
	resp, err := d.httpClient.Do(req)
	if err != nil {
		return nil, &daprError{op: op, body: err.Error()}
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return nil, &daprError{op: op, status: resp.StatusCode, body: string(data)}
	}
	return data, nil
}

// Healthy probes the real Dapr health endpoint.
func (d *DaprSidecar) Healthy(ctx context.Context) error {
	_, err := d.do(ctx, "healthz", http.MethodGet, "/v1.0/healthz", nil)
	return err
}

// InvokeService calls another app's method through Dapr service invocation.
func (d *DaprSidecar) InvokeService(ctx context.Context, appID, method string, payload []byte) ([]byte, error) {
	return d.do(ctx, "invoke", http.MethodPost,
		fmt.Sprintf("/v1.0/invoke/%s/method/%s", appID, method), payload)
}

// PublishEvent publishes a CloudEvent payload to a pubsub topic.
func (d *DaprSidecar) PublishEvent(ctx context.Context, pubsub, topic string, payload []byte) error {
	_, err := d.do(ctx, "publish", http.MethodPost,
		fmt.Sprintf("/v1.0/publish/%s/%s", pubsub, topic), payload)
	return err
}

// GetState reads one key from a state store. A 204/empty body is a genuine
// miss and returns (nil, nil) — distinguishable from an error.
func (d *DaprSidecar) GetState(ctx context.Context, store, key string) ([]byte, error) {
	data, err := d.do(ctx, "state-get", http.MethodGet,
		fmt.Sprintf("/v1.0/state/%s/%s", store, key), nil)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, nil
	}
	return data, nil
}

// SaveState writes one key/value pair to a state store.
func (d *DaprSidecar) SaveState(ctx context.Context, store, key string, value json.RawMessage) error {
	entry, err := json.Marshal([]map[string]interface{}{
		{"key": key, "value": value},
	})
	if err != nil {
		return err
	}
	_, err = d.do(ctx, "state-save", http.MethodPost,
		fmt.Sprintf("/v1.0/state/%s", store), entry)
	return err
}

// ── DistributedLock ─────────────────────────────────────────────────────────

// DistributedLock is a held Dapr distributed lock. Always created by
// AcquireLock; call Unlock exactly once (context expiry releases it too —
// Dapr's own lease semantics, not something we fake).
type DistributedLock struct {
	sidecar    *DaprSidecar
	store      string
	resourceID string
	owner      string
}

// AcquireLock takes a distributed lock. lockOwner identifies this process;
// expirySeconds bounds the lease. A held-by-someone-else lock is a real
// error, not a silent retry.
func (d *DaprSidecar) AcquireLock(ctx context.Context, store, resourceID, lockOwner string, expirySeconds int) (*DistributedLock, error) {
	if store == "" {
		store = d.LockStore
	}
	if resourceID == "" || lockOwner == "" {
		return nil, fmt.Errorf("dapr lock: resourceID and lockOwner are required")
	}
	if expirySeconds <= 0 {
		expirySeconds = 30
	}
	body, err := json.Marshal(map[string]interface{}{
		"resourceId":      resourceID,
		"lockOwner":       lockOwner,
		"expiryInSeconds": expirySeconds,
	})
	if err != nil {
		return nil, err
	}
	resp, err := d.do(ctx, "lock", http.MethodPost,
		fmt.Sprintf("/v1.0-alpha1/lock/%s", store), body)
	if err != nil {
		return nil, err
	}
	var result struct {
		Success bool `json:"success"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("dapr lock: invalid response: %w", err)
	}
	if !result.Success {
		return nil, fmt.Errorf("dapr lock: resource %s already locked by another owner", resourceID)
	}
	return &DistributedLock{sidecar: d, store: store, resourceID: resourceID, owner: lockOwner}, nil
}

// Unlock releases the lock; a false from Dapr (lock not held / expired) is
// surfaced as an error rather than swallowed.
func (l *DistributedLock) Unlock(ctx context.Context) error {
	body, err := json.Marshal(map[string]interface{}{
		"resourceId": l.resourceID,
		"lockOwner":  l.owner,
	})
	if err != nil {
		return err
	}
	resp, err := l.sidecar.do(ctx, "unlock", http.MethodPost,
		fmt.Sprintf("/v1.0-alpha1/unlock/%s", l.store), body)
	if err != nil {
		return err
	}
	var result struct {
		Status int `json:"status"` // 0 = success per Dapr API
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return fmt.Errorf("dapr unlock: invalid response: %w", err)
	}
	if result.Status != 0 {
		return fmt.Errorf("dapr unlock: resource %s not released (status %d — lock not held or expired)", l.resourceID, result.Status)
	}
	return nil
}

// ── HTTP wrapper (other Go services call this over localhost) ───────────────

type api struct {
	sidecar *DaprSidecar
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func (a *api) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := a.sidecar.Healthy(ctx); err != nil {
		// Fail loud: Dapr unreachable means this proxy is not healthy.
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"status": "unhealthy",
			"reason": err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "healthy", "service": "dapr-sidecar"})
}

func (a *api) invoke(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AppID   string          `json:"app_id"`
		Method  string          `json:"method"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.AppID == "" || req.Method == "" {
		fail(w, http.StatusBadRequest, fmt.Errorf("app_id and method are required"))
		return
	}
	resp, err := a.sidecar.InvokeService(r.Context(), req.AppID, req.Method, req.Payload)
	if err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(resp)
}

func (a *api) publish(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Pubsub  string          `json:"pubsub"`
		Topic   string          `json:"topic"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Pubsub == "" || req.Topic == "" {
		fail(w, http.StatusBadRequest, fmt.Errorf("pubsub and topic are required"))
		return
	}
	if err := a.sidecar.PublishEvent(r.Context(), req.Pubsub, req.Topic, req.Payload); err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "published", "topic": req.Topic})
}

func (a *api) lock(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Store         string `json:"store"`
		ResourceID    string `json:"resource_id"`
		Owner         string `json:"owner"`
		ExpirySeconds int    `json:"expiry_seconds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, fmt.Errorf("invalid lock request: %v", err))
		return
	}
	l, err := a.sidecar.AcquireLock(r.Context(), req.Store, req.ResourceID, req.Owner, req.ExpirySeconds)
	if err != nil {
		fail(w, http.StatusConflict, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":      "locked",
		"store":       l.store,
		"resource_id": l.resourceID,
		"owner":       l.owner,
	})
}

func (a *api) unlock(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Store      string `json:"store"`
		ResourceID string `json:"resource_id"`
		Owner      string `json:"owner"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ResourceID == "" || req.Owner == "" {
		fail(w, http.StatusBadRequest, fmt.Errorf("resource_id and owner are required"))
		return
	}
	l := &DistributedLock{sidecar: a.sidecar, store: req.Store, resourceID: req.ResourceID, owner: req.Owner}
	if l.store == "" {
		l.store = a.sidecar.LockStore
	}
	if err := l.Unlock(r.Context()); err != nil {
		fail(w, http.StatusConflict, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "unlocked", "resource_id": req.ResourceID})
}

func main() {
	port := os.Getenv("DAPR_PROXY_PORT")
	if port == "" {
		port = "3501"
	}
	a := &api{sidecar: NewDaprSidecar()}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", a.health)
	mux.HandleFunc("/invoke", a.invoke)
	mux.HandleFunc("/publish", a.publish)
	mux.HandleFunc("/lock", a.lock)
	mux.HandleFunc("/unlock", a.unlock)

	log.Printf("dapr-sidecar proxy listening on :%s (dapr at %s)", port, a.sidecar.baseURL)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("dapr-sidecar failed: %v", err)
	}
}
