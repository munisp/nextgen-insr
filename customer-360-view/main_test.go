package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetCustomer360(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/customer/C001", nil)
	w := httptest.NewRecorder()
	getCustomer360(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestGetCrossSell(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/cross-sell/C001", nil)
	w := httptest.NewRecorder()
	getCrossSell(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["recommendations"] == nil {
		t.Error("Expected recommendations in response")
	}
}

func TestGetSegments(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/segments", nil)
	w := httptest.NewRecorder()
	getSegments(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
