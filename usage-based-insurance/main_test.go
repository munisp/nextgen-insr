package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIngestTelemetry(t *testing.T) {
	body := strings.NewReader(`{"vehicle_id":"V001","speed":85,"harsh_braking":2,"distance_km":50}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/telemetry", body)
	w := httptest.NewRecorder()
	ingestTelemetry(w, req)
	if w.Code != http.StatusOK && w.Code != http.StatusCreated {
		t.Errorf("Expected success, got %d", w.Code)
	}
}

func TestGetDrivingScore(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/score/V001", nil)
	w := httptest.NewRecorder()
	getDrivingScore(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["driving_score"] == nil {
		t.Error("Expected score in response")
	}
}

func TestCalculateUBIPremium(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/premium/V001", nil)
	w := httptest.NewRecorder()
	calculatePremium(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
