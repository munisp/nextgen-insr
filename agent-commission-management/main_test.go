package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func Test_Health(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	handleHealth(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["status"] == nil {
		t.Errorf("Expected status in response")
	}
}
func Test_Calculate(t *testing.T) {
	body := strings.NewReader(`{"agent_id":"A001","policy_type":"motor","premium":50000}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/calculate", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleCalculate(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["commission"] == nil {
		t.Errorf("Expected commission in response")
	}
}
func Test_PayoutSummary(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/payout-summary", nil)
	w := httptest.NewRecorder()
	handlePayoutSummary(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
