package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRecordEvent(t *testing.T) {
	body := strings.NewReader(`{"action":"policy.created","user_id":"U001","resource":"POL-001"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", body)
	w := httptest.NewRecorder()
	recordEvent(w, req)
	if w.Code != http.StatusCreated && w.Code != http.StatusOK {
		t.Errorf("Expected 200 or 201, got %d", w.Code)
	}
}

func TestQueryAudit(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit?user_id=U001", nil)
	w := httptest.NewRecorder()
	queryAudit(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestVerifyChain(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/verify", nil)
	w := httptest.NewRecorder()
	verifyChain(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if _, ok := resp["chain_valid"]; !ok {
		t.Error("Expected chain_valid field in response")
	}
}
