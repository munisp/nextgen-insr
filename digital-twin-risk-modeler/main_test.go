package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthEndpoint(t *testing.T) {
	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	handleHealth(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp["service"] != "digital-twin-risk-modeler" {
		t.Errorf("expected service=digital-twin-risk-modeler, got %v", resp["service"])
	}
}

func TestReadyEndpoint(t *testing.T) {
	req := httptest.NewRequest("GET", "/ready", nil)
	w := httptest.NewRecorder()
	handleReady(w, req)
	if w.Code != http.StatusOK && w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 200 or 503, got %d", w.Code)
	}
}

func TestLiveEndpoint(t *testing.T) {
	req := httptest.NewRequest("GET", "/live", nil)
	w := httptest.NewRecorder()
	handleLive(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var resp map[string]string
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp["status"] != "alive" {
		t.Errorf("expected status=alive, got %s", resp["status"])
	}
}
