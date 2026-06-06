package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestApiCatalog(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/catalog", nil)
	w := httptest.NewRecorder()
	apiCatalog(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["apis"] == nil {
		t.Error("Expected apis in response")
	}
}

func TestSubscribe(t *testing.T) {
	body := strings.NewReader(`{"api_id":"API-001","plan":"basic"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/subscribe", body)
	w := httptest.NewRecorder()
	subscribe(w, req)
	if w.Code != http.StatusOK && w.Code != http.StatusCreated {
		t.Errorf("Expected success, got %d", w.Code)
	}
}

func TestGetUsage(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/usage/API-001", nil)
	w := httptest.NewRecorder()
	getUsage(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
