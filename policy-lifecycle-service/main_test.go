package main

import (
	"net/http"
	"net/http/httptest"
	"encoding/json"
	"testing"
)

func TestHealthEndpoint(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	handleHealth(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["service"] != "policy-lifecycle-service" {
		t.Errorf("Expected policy-lifecycle-service, got %s", resp["service"])
	}
}
