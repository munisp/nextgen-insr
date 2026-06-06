package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPayoutStatus(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/payout/PAY-001", nil)
	w := httptest.NewRecorder()
	payoutStatus(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestFloatStatus(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/float", nil)
	w := httptest.NewRecorder()
	floatStatus(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if _, ok := resp["available"]; !ok {
		t.Error("Expected available field in response")
	}
}
