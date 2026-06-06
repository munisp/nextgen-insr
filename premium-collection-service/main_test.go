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
func Test_Collect(t *testing.T) {
	body := strings.NewReader(`{"policy_id":"P001","amount":25000,"method":"bank_transfer"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/collect", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleCollect(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
func Test_Reconcile(t *testing.T) {
	body := strings.NewReader(`{"date":"2026-01-15"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/reconcile", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleReconcile(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
