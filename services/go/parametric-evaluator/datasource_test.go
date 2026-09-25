// datasource_test.go — Q5 (2026-09-25). Fail-closed datasource semantics,
// circuit breaker, staleness, dual control, threshold, event-key parity with
// the TS engine. Real HTTP via httptest (no fabricated transport behaviour).
package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func freshReading(metric string, value float64, observed time.Time) string {
	return fmt.Sprintf(`{"metric":%q,"value":%v,"observedAt":%q}`,
		metric, value, observed.UTC().Format(time.RFC3339))
}

func httpCfg(url string) DatasourceConfig {
	return DatasourceConfig{Type: "http", URL: url, TimeoutMs: 5000}
}

func TestFetchSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") != "application/json" {
			t.Errorf("missing Accept header")
		}
		fmt.Fprint(w, freshReading("rainfall_mm", 42.5, time.Now()))
	}))
	defer srv.Close()
	ds := NewHTTPDatasource(srv.Client())
	rd, hash, raw, err := ds.Fetch(context.Background(), httpCfg(srv.URL), "rainfall_mm", 3600)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rd.Value != 42.5 || rd.Metric != "rainfall_mm" {
		t.Fatalf("bad reading: %+v", rd)
	}
	if len(hash) != 64 {
		t.Fatalf("payload hash not sha256 hex: %q", hash)
	}
	if len(raw) == 0 {
		t.Fatal("raw payload empty")
	}
}

func TestFetchHTTPErrorFailsClosed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()
	ds := NewHTTPDatasource(srv.Client())
	_, _, _, err := ds.Fetch(context.Background(), httpCfg(srv.URL), "m", 60)
	var du *DatasourceUnavailableError
	if !As(err, &du) || du.Reason != ReasonHTTPError {
		t.Fatalf("want http_error, got %v", err)
	}
}

func TestFetchUnparseableFailsClosed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "not json")
	}))
	defer srv.Close()
	ds := NewHTTPDatasource(srv.Client())
	_, _, _, err := ds.Fetch(context.Background(), httpCfg(srv.URL), "m", 60)
	var du *DatasourceUnavailableError
	if !As(err, &du) || du.Reason != ReasonUnparseable {
		t.Fatalf("want unparseable, got %v", err)
	}
}

func TestFetchSchemaInvalidWrongMetric(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, freshReading("wind_kph", 10, time.Now()))
	}))
	defer srv.Close()
	ds := NewHTTPDatasource(srv.Client())
	_, _, _, err := ds.Fetch(context.Background(), httpCfg(srv.URL), "rainfall_mm", 60)
	var du *DatasourceUnavailableError
	if !As(err, &du) || du.Reason != ReasonSchemaInvalid {
		t.Fatalf("want schema_invalid, got %v", err)
	}
}

func TestFetchStaleFailsClosed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, freshReading("rainfall_mm", 5, time.Now().Add(-2*time.Hour)))
	}))
	defer srv.Close()
	ds := NewHTTPDatasource(srv.Client())
	_, _, _, err := ds.Fetch(context.Background(), httpCfg(srv.URL), "rainfall_mm", 3600)
	var du *DatasourceUnavailableError
	if !As(err, &du) || du.Reason != ReasonStale {
		t.Fatalf("want stale, got %v", err)
	}
}

func TestFetchUnreachableFailsClosed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := srv.URL
	srv.Close() // nothing listening now
	ds := NewHTTPDatasource(&http.Client{Timeout: time.Second})
	_, _, _, err := ds.Fetch(context.Background(), httpCfg(url), "m", 60)
	var du *DatasourceUnavailableError
	if !As(err, &du) || du.Reason != ReasonUnreachable {
		t.Fatalf("want unreachable, got %v", err)
	}
}

func TestCircuitBreakerOpensAfterThreeFailures(t *testing.T) {
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	ds := NewHTTPDatasource(srv.Client())
	cfg := httpCfg(srv.URL)
	for i := 0; i < 3; i++ {
		_, _, _, _ = ds.Fetch(context.Background(), cfg, "m", 60)
	}
	if calls != 3 {
		t.Fatalf("expected 3 calls, got %d", calls)
	}
	// 4th call must be refused by the open breaker WITHOUT hitting the server.
	_, _, _, err := ds.Fetch(context.Background(), cfg, "m", 60)
	var du *DatasourceUnavailableError
	if !As(err, &du) || du.Reason != ReasonCircuitOpen {
		t.Fatalf("want circuit_open, got %v", err)
	}
	if calls != 3 {
		t.Fatalf("breaker did not short-circuit; calls=%d", calls)
	}
}

func TestCircuitBreakerHalfOpenRecovery(t *testing.T) {
	fail := true
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		fmt.Fprint(w, freshReading("m", 1, time.Now()))
	}))
	defer srv.Close()
	ds := NewHTTPDatasource(srv.Client())
	base := time.Now()
	ds.breakers.now = func() time.Time { return base }
	cfg := httpCfg(srv.URL)
	for i := 0; i < 3; i++ {
		_, _, _, _ = ds.Fetch(context.Background(), cfg, "m", 60)
	}
	// Advance past reset window; one half-open probe should succeed and close.
	fail = false
	ds.breakers.now = func() time.Time { return base.Add(31 * time.Second) }
	// ds.now (staleness clock) is real time; reading observedAt=now is fresh.
	_, _, _, err := ds.Fetch(context.Background(), cfg, "m", 3600)
	if err != nil {
		t.Fatalf("half-open probe should succeed: %v", err)
	}
}

func TestMissingAuthTokenEnvFailsClosed(t *testing.T) {
	ds := NewHTTPDatasource(&http.Client{})
	ds.getenv = func(string) string { return "" }
	cfg := DatasourceConfig{Type: "http", URL: "http://example.invalid/x", AuthTokenEnv: "MISSING_TOKEN", TimeoutMs: 1000}
	_, _, _, err := ds.Fetch(context.Background(), cfg, "m", 60)
	var du *DatasourceUnavailableError
	if !As(err, &du) || du.Reason != ReasonMisconfigured {
		t.Fatalf("want misconfigured, got %v", err)
	}
}

func TestParseDatasourceConfigRejectsUnknownType(t *testing.T) {
	_, err := parseDatasourceConfig([]byte(`{"type":"carrier-pigeon"}`))
	var du *DatasourceUnavailableError
	if !As(err, &du) || du.Reason != ReasonMisconfigured {
		t.Fatalf("want misconfigured, got %v", err)
	}
}

func TestValidateManualReadingDualControl(t *testing.T) {
	now := time.Now()
	ok := Reading{Metric: "rainfall_mm", Value: 12, ObservedAt: now.Add(-time.Minute)}
	if err := ValidateManualReading(ok, "rainfall_mm", 3600, 7, 9, now); err != nil {
		t.Fatalf("confirmed reading should validate: %v", err)
	}
	// attester == confirmer ⇒ fail-closed.
	var du *DatasourceUnavailableError
	if err := ValidateManualReading(ok, "rainfall_mm", 3600, 7, 7, now); !As(err, &du) || du.Reason != ReasonUnconfirmed {
		t.Fatalf("want unconfirmed, got %v", err)
	}
	// no confirmer ⇒ fail-closed.
	if err := ValidateManualReading(ok, "rainfall_mm", 3600, 7, 0, now); !As(err, &du) || du.Reason != ReasonUnconfirmed {
		t.Fatalf("want unconfirmed, got %v", err)
	}
	// stale ⇒ fail-closed.
	stale := Reading{Metric: "rainfall_mm", Value: 12, ObservedAt: now.Add(-2 * time.Hour)}
	if err := ValidateManualReading(stale, "rainfall_mm", 3600, 7, 9, now); !As(err, &du) || du.Reason != ReasonStale {
		t.Fatalf("want stale, got %v", err)
	}
}

func TestThresholdBreachedParity(t *testing.T) {
	cases := []struct {
		op       string
		measured float64
		thresh   float64
		want     bool
	}{
		{"gt", 11, 10, true}, {"gt", 10, 10, false},
		{"gte", 10, 10, true}, {"lt", 9, 10, true}, {"lt", 10, 10, false},
		{"lte", 10, 10, true}, {"eq", 10, 10, true}, {"eq", 10.1, 10, false},
		{"bogus", 100, 10, false}, // unknown operator never fires (fail-closed)
	}
	for _, c := range cases {
		if got := ThresholdBreached(c.op, c.measured, c.thresh); got != c.want {
			t.Errorf("ThresholdBreached(%s,%v,%v)=%v want %v", c.op, c.measured, c.thresh, got, c.want)
		}
	}
}

// TestEventKeyParityWithTSEngine pins the exact key format produced by
// server/lib/parametricEngine.ts evaluationWindowKey:
// `trigger-<id>:window-<floor(nowMs/(windowSeconds*1000))*windowSeconds>`.
func TestEventKeyParityWithTSEngine(t *testing.T) {
	// 2026-09-25T12:00:00Z = 1782312000000 ms; window 3600s ⇒
	// floor(1782312000/3600)*3600 = 495086*3600 = 1782309600.
	now := time.UnixMilli(1782312000000)
	got := EvaluationWindowKey(42, 3600, now)
	want := "trigger-42:window-1782309600"
	if got != want {
		t.Fatalf("event key parity broken: got %q want %q", got, want)
	}
}
