package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCollectPremium(t *testing.T) {
	body := strings.NewReader(`{"phone":"08012345678","amount":5000,"operator":"mtn","policy_id":"POL-001"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/collect", body)
	w := httptest.NewRecorder()
	collectPremium(w, req)
	if w.Code != http.StatusOK && w.Code != http.StatusCreated {
		t.Errorf("Expected success, got %d", w.Code)
	}
}

func TestListOperators(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/operators", nil)
	w := httptest.NewRecorder()
	listOperators(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["operators"] == nil {
		t.Error("Expected operators list")
	}
}

func TestWalletBalance(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/wallet/08012345678", nil)
	w := httptest.NewRecorder()
	walletBalance(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
