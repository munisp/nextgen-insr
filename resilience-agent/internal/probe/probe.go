// Package probe measures connectivity latency to a configured URL.
package probe

import (
	"net/http"
	"time"
)

// Result describes the outcome of a single connectivity probe.
type Result struct {
	URL        string `json:"url"`
	OK         bool   `json:"ok"`
	StatusCode int    `json:"status_code,omitempty"`
	LatencyMs  int64  `json:"latency_ms"`
	Error      string `json:"error,omitempty"`
	Timestamp  string `json:"timestamp"`
}

// Probe performs an HTTP GET against url with a 10s timeout and reports the
// round-trip latency. Any 2xx/3xx response counts as reachable.
func Probe(url string) Result {
	res := Result{URL: url, Timestamp: time.Now().UTC().Format(time.RFC3339)}

	client := &http.Client{Timeout: 10 * time.Second}
	start := time.Now()
	resp, err := client.Get(url)
	res.LatencyMs = time.Since(start).Milliseconds()
	if err != nil {
		res.Error = err.Error()
		return res
	}
	defer resp.Body.Close()

	res.StatusCode = resp.StatusCode
	res.OK = resp.StatusCode < http.StatusBadRequest
	return res
}
