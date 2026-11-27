package shadow

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// TestEmitAsyncPostsEvent: the shadow event reaches the sidecar endpoint
// with the accept payload; the caller is never blocked on delivery.
func TestEmitAsyncPostsEvent(t *testing.T) {
	received := make(chan Event, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var ev Event
		if err := json.NewDecoder(r.Body).Decode(&ev); err != nil {
			t.Errorf("event body malformed: %v", err)
		}
		received <- ev
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	c := NewClient(srv.URL)
	if !c.Enabled() {
		t.Fatal("client with endpoint must be enabled")
	}
	c.EmitAsync(Event{QuoteRef: "q_1", ProductLine: "motor", TotalPremiumKobo: 20908107, EmittedAt: "2026-11-28T00:00:00Z"})

	select {
	case ev := <-received:
		if ev.QuoteRef != "q_1" || ev.TotalPremiumKobo != 20908107 {
			t.Errorf("event = %+v", ev)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shadow event never delivered")
	}
}

// TestDisabledClient: a nil endpoint disables emission silently (dev mode).
func TestDisabledClient(t *testing.T) {
	c := NewClient("")
	if c.Enabled() {
		t.Error("empty endpoint must disable")
	}
	c.EmitAsync(Event{QuoteRef: "q_1"}) // must not panic
}

// TestSlowEndpointDoesNotPanic: a dead endpoint logs and moves on — the
// quote path is unaffected (best-effort contract).
func TestDeadEndpoint(t *testing.T) {
	c := NewClient("http://127.0.0.1:63999/")
	c.EmitAsync(Event{QuoteRef: "q_2"})
	time.Sleep(100 * time.Millisecond) // allow the goroutine to fail quietly
}
