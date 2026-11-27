// Package shadow is the asynchronous TigerBeetle reserve-account shadow
// transfer emitter (design §7.5): quote-time TB writes are strictly
// off-hot-path, emitted as events with the tbClient-precedent 2 s timeout.
// Delivery is best-effort — failures are logged, never surfaced to the
// quote response (ledger availability must not couple to quote latency).
package shadow

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

// Event is the reserve-shadow payload emitted after an accepted quote.
type Event struct {
	QuoteRef         string `json:"quoteRef"`
	ProductLine      string `json:"productLine"`
	TotalPremiumKobo int64  `json:"totalPremiumKobo"`
	EmittedAt        string `json:"emittedAt"`
}

// Client posts events to the tb-sidecar. A nil/empty endpoint disables
// emission (dev mode); the quote path is unaffected either way.
type Client struct {
	endpoint string
	http     *http.Client
}

// NewClient builds a Client for endpoint ("" disables).
func NewClient(endpoint string) *Client {
	return &Client{
		endpoint: endpoint,
		http:     &http.Client{Timeout: 2 * time.Second}, // tbClient precedent
	}
}

// Enabled reports whether emission is configured.
func (c *Client) Enabled() bool { return c != nil && c.endpoint != "" }

// EmitAsync fires the event on a detached goroutine with its own 2 s
// timeout; the caller's context is deliberately not propagated so a slow
// client disconnect cannot cancel the shadow write.
func (c *Client) EmitAsync(ev Event) {
	if !c.Enabled() {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		body, err := json.Marshal(ev)
		if err != nil {
			log.Printf("shadow: marshal failed: %v", err)
			return
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
		if err != nil {
			log.Printf("shadow: request build failed: %v", err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := c.http.Do(req)
		if err != nil {
			log.Printf("shadow: emit failed (quote unaffected): %v", err)
			return
		}
		defer func() { _ = resp.Body.Close() }()
		if resp.StatusCode >= 400 {
			log.Printf("shadow: endpoint %s returned %d (quote unaffected)", c.endpoint, resp.StatusCode)
		}
	}()
}
