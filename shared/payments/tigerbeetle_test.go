package payments

// P-wave perf/correctness (2026-09-19): CreateAccounts/CreateTransfers
// previously discarded the HTTP status and body, silently dropping partial
// TigerBeetle batch errors. These tests pin the fail-closed parsing.

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newTestClient(baseURL string) *TigerBeetleClient {
	c := NewTigerBeetleClient()
	c.baseURL = baseURL
	return c
}

func TestCreateTransfersEmptyErrorArrayIsSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`[]`))
	}))
	defer srv.Close()
	if err := newTestClient(srv.URL).CreateTransfers(context.Background(), []Transfer{{ID: 1}}); err != nil {
		t.Fatalf("expected nil error for empty error array, got %v", err)
	}
}

func TestCreateTransfersEmptyBodyIsSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	if err := newTestClient(srv.URL).CreateTransfers(context.Background(), []Transfer{{ID: 1}}); err != nil {
		t.Fatalf("expected nil error for empty body, got %v", err)
	}
}

func TestCreateTransfersPerItemErrorsSurfaced(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`[{"index":0,"result":"exists"},{"index":2,"result":"exceeds_credits"}]`))
	}))
	defer srv.Close()
	err := newTestClient(srv.URL).CreateTransfers(context.Background(), []Transfer{{ID: 1}, {ID: 2}, {ID: 3}})
	if err == nil {
		t.Fatal("expected per-item errors to be surfaced, got nil")
	}
	msg := err.Error()
	if !strings.Contains(msg, "index 0") || !strings.Contains(msg, "exists") ||
		!strings.Contains(msg, "index 2") || !strings.Contains(msg, "exceeds_credits") {
		t.Fatalf("error must list failing indices and results, got: %s", msg)
	}
	if !strings.Contains(msg, "2 of 3") {
		t.Fatalf("error must report rejected/submitted counts, got: %s", msg)
	}
}

func TestCreateTransfersNumericResultCodes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[{"index":1,"result":37}]`))
	}))
	defer srv.Close()
	err := newTestClient(srv.URL).CreateTransfers(context.Background(), []Transfer{{ID: 1}, {ID: 2}})
	if err == nil || !strings.Contains(err.Error(), "index 1") {
		t.Fatalf("expected numeric result code surfaced, got %v", err)
	}
}

func TestCreateAccountsHTTPErrorSurfaced(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`upstream unavailable`))
	}))
	defer srv.Close()
	err := newTestClient(srv.URL).CreateAccounts(context.Background(), []Account{{ID: 1}})
	if err == nil || !strings.Contains(err.Error(), "HTTP 502") {
		t.Fatalf("expected HTTP status surfaced, got %v", err)
	}
}

func TestCreateAccountsUnparseableBodyFailsLoud(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`<html>proxy error</html>`))
	}))
	defer srv.Close()
	err := newTestClient(srv.URL).CreateAccounts(context.Background(), []Account{{ID: 1}})
	if err == nil || !strings.Contains(err.Error(), "unparseable") {
		t.Fatalf("expected loud failure on unparseable body, got %v", err)
	}
}

func TestCreateTransfersTransportError(t *testing.T) {
	c := newTestClient("http://127.0.0.1:1") // nothing listening
	err := c.CreateTransfers(context.Background(), []Transfer{{ID: 1}})
	if err == nil || !strings.Contains(err.Error(), "tigerbeetle create transfers") {
		t.Fatalf("expected wrapped transport error, got %v", err)
	}
}

func TestParseBatchResponseSuccessResultTreatedOK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `[{"index":0,"result":"ok"}]`)
	}))
	defer srv.Close()
	if err := newTestClient(srv.URL).CreateTransfers(context.Background(), []Transfer{{ID: 1}}); err != nil {
		t.Fatalf("ok result must not fail the batch, got %v", err)
	}
}
