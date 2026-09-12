// telemetry-api-gateway (port 8323) — API gateway for platform telemetry:
// proxies real queries to OpenSearch and publishes/exposes events through
// the Dapr sidecar (pub/sub + service invocation).
//
// Honesty policy: queries are REAL HTTP calls to the configured backends.
// When OpenSearch or the Dapr sidecar is unreachable the endpoint returns
// 502/503 naming the backend — telemetry is never fabricated.
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
	"strings"
	"time"
)

var (
	port          = envOr("PORT", "8323")
	opensearchURL = envOr("OPENSEARCH_URL", "http://localhost:9200")
	daprHTTPPort  = envOr("DAPR_HTTP_PORT", "3500")
	defaultIndex  = envOr("TELEMETRY_INDEX", "platform-telemetry")

	httpClient = &http.Client{Timeout: 10 * time.Second}
)

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// opensearchRequest performs a real HTTP call against OpenSearch and
// returns the verbatim response body.
func opensearchRequest(ctx context.Context, method, path string, body []byte) (int, []byte, error) {
	url := strings.TrimRight(opensearchURL, "/") + path
	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("opensearch unreachable at %s: %w", opensearchURL, err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	return resp.StatusCode, b, err
}

func daprReachable(ctx context.Context) bool {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("http://localhost:%s/v1.0/healthz", daprHTTPPort), nil)
	resp, err := httpClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode < 300
}

// ── Handlers ───────────────────────────────────────────────────────────────

var startTime = time.Now()

func handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	osCode, _, osErr := opensearchRequest(ctx, http.MethodGet, "/", nil)
	osOK := osErr == nil && osCode == http.StatusOK
	daprOK := daprReachable(ctx)
	status, code := "ok", http.StatusOK
	if !osOK && !daprOK {
		status, code = "degraded", http.StatusServiceUnavailable
	}
	writeJSON(w, code, map[string]any{
		"status":    status,
		"service":   "telemetry-api-gateway",
		"uptime_s":  int(time.Since(startTime).Seconds()),
		"backends": map[string]any{
			"opensearch":     map[string]any{"url": opensearchURL, "reachable": osOK},
			"dapr_sidecar":   map[string]any{"http_port": daprHTTPPort, "reachable": daprOK},
			"telemetry_index": defaultIndex,
		},
	})
}

// handleSearch proxies a real OpenSearch _search query for telemetry docs.
func handleSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil || len(body) == 0 {
		writeError(w, http.StatusBadRequest, "a real OpenSearch query DSL body is required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	code, respBody, err := opensearchRequest(ctx, http.MethodPost,
		"/"+defaultIndex+"/_search", body)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = w.Write(respBody)
}

// handleIngest indexes a real telemetry document into OpenSearch.
func handleIngest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	var doc map[string]any
	if err := json.NewDecoder(r.Body).Decode(&doc); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if _, ok := doc["event_type"]; !ok {
		writeError(w, http.StatusBadRequest, "event_type is required")
		return
	}
	doc["ingested_at"] = time.Now().UTC().Format(time.RFC3339)
	body, _ := json.Marshal(doc)
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	code, respBody, err := opensearchRequest(ctx, http.MethodPost,
		"/"+defaultIndex+"/_doc", body)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if code >= 300 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_, _ = w.Write(respBody)
		return
	}
	// Also publish through the Dapr pub/sub building block when the sidecar
	// is up; failure is reported, not hidden.
	daprNote := "dapr sidecar unreachable; event indexed but not published"
	if daprReachable(ctx) {
		pubReq, _ := http.NewRequestWithContext(ctx, http.MethodPost,
			fmt.Sprintf("http://localhost:%s/v1.0/publish/pubsub.kafka/telemetry.ingested", daprHTTPPort),
			bytes.NewReader(body))
		pubReq.Header.Set("Content-Type", "application/json")
		if pubResp, err := httpClient.Do(pubReq); err == nil && pubResp.StatusCode < 300 {
			daprNote = "published via dapr pubsub"
			pubResp.Body.Close()
		} else if err == nil {
			daprNote = fmt.Sprintf("dapr publish returned %d", pubResp.StatusCode)
			pubResp.Body.Close()
		} else {
			daprNote = "dapr publish error: " + err.Error()
		}
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"indexed":       true,
		"index":         defaultIndex,
		"opensearch":    json.RawMessage(respBody),
		"dapr_pubsub":   daprNote,
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]any{"error": msg})
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/telemetry/search", handleSearch)
	mux.HandleFunc("/telemetry/ingest", handleIngest)
	log.Printf("telemetry-api-gateway listening on :%s (opensearch=%s dapr=%s index=%s)",
		port, opensearchURL, daprHTTPPort, defaultIndex)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
