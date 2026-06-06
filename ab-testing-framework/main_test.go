package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthHandler(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	healthHandler(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["status"] != "healthy" {
		t.Errorf("Expected healthy, got %v", resp["status"])
	}
}

func TestListExperiments(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/experiments", nil)
	w := httptest.NewRecorder()
	listExperiments(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestCreateExperiment(t *testing.T) {
	body := strings.NewReader(`{"name":"checkout_flow","feature":"checkout_button","traffic_pct":50}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/experiments", body)
	w := httptest.NewRecorder()
	createExperiment(w, req)
	if w.Code != http.StatusCreated && w.Code != http.StatusOK {
		t.Errorf("Expected 200 or 201, got %d", w.Code)
	}
}
