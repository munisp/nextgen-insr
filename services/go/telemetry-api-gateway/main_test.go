package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthDegradedWithoutBackends(t *testing.T) {
	oldOS, oldDapr := opensearchURL, daprHTTPPort
	opensearchURL = "http://127.0.0.1:1"
	daprHTTPPort = "1"
	defer func() { opensearchURL, daprHTTPPort = oldOS, oldDapr }()
	rec := httptest.NewRecorder()
	handleHealth(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 degraded, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestSearchRequiresBody(t *testing.T) {
	rec := httptest.NewRecorder()
	handleSearch(rec, httptest.NewRequest(http.MethodPost, "/telemetry/search", strings.NewReader("")))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestIngestRequiresEventType(t *testing.T) {
	rec := httptest.NewRecorder()
	handleIngest(rec, httptest.NewRequest(http.MethodPost, "/telemetry/ingest",
		strings.NewReader(`{"foo": 1}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestIngestFailsLoudWithoutOpenSearch(t *testing.T) {
	old := opensearchURL
	opensearchURL = "http://127.0.0.1:1"
	defer func() { opensearchURL = old }()
	rec := httptest.NewRecorder()
	handleIngest(rec, httptest.NewRequest(http.MethodPost, "/telemetry/ingest",
		strings.NewReader(`{"event_type": "test"}`)))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 fail-loud, got %d (%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "opensearch") {
		t.Fatalf("error should name opensearch: %s", rec.Body.String())
	}
}
