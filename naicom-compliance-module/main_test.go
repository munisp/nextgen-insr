package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestQuarterlyReturns(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/quarterly-returns", nil)
	w := httptest.NewRecorder()
	quarterlyReturns(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestSolvencyStatus(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/solvency", nil)
	w := httptest.NewRecorder()
	solvencyStatus(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if _, ok := resp["solvency_ratio"]; !ok {
		t.Error("Expected solvency_ratio in response")
	}
}

func TestCapitalAdequacy(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/capital-adequacy", nil)
	w := httptest.NewRecorder()
	capitalAdequacy(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
