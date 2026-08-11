package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func newTestEngine() *Engine {
	e := &Engine{startTime: time.Now()}
	e.healthy.Store(true)
	return e
}

func TestHealthEndpoint(t *testing.T) {
	e := newTestEngine()
	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	handleHealth(e)(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("health returned %d, want 200", w.Code)
	}
	body := w.Body.String()
	if body == "" {
		t.Error("health returned empty body")
	}
}

func TestHealthContentType(t *testing.T) {
	e := newTestEngine()
	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	handleHealth(e)(w, req)
	ct := w.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("unexpected content-type: %s", ct)
	}
}

func TestReadyEndpointWithoutDB(t *testing.T) {
	e := newTestEngine() // no database attached
	req := httptest.NewRequest("GET", "/ready", nil)
	w := httptest.NewRecorder()
	handleReady(e)(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("ready without DB returned %d, want 503", w.Code)
	}
}

func TestLiveEndpoint(t *testing.T) {
	req := httptest.NewRequest("GET", "/live", nil)
	w := httptest.NewRecorder()
	handleLive(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("live returned %d, want 200", w.Code)
	}
}
