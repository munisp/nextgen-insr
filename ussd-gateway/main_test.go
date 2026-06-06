package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleUSSD_ValidSession(t *testing.T) {
	body := strings.NewReader(`{"session_id":"S001","phone":"08012345678","input":"1"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ussd", body)
	w := httptest.NewRecorder()
	handleUSSD(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestGetMenu(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/menu", nil)
	w := httptest.NewRecorder()
	getMenu(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["menu_tree"] == nil {
		t.Error("Expected menu in response")
	}
}

func TestUssdStats(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/stats", nil)
	w := httptest.NewRecorder()
	ussdStats(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
