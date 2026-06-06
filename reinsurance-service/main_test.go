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
func Test_Treaties(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/treaties", nil)
	w := httptest.NewRecorder()
	handleTreaties(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
func Test_Cede(t *testing.T) {
	body := strings.NewReader(`{"policy_id":"P001","amount":1000000}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/cede", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleCede(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
