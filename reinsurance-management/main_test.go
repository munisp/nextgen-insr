package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func Test_Cession(t *testing.T) {
	body := strings.NewReader(`{"test": true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/reinsurance/cession", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	svc := NewReinsuranceService()
	svc.HandleCalculateCession(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func Test_Recovery(t *testing.T) {
	body := strings.NewReader(`{"test": true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/reinsurance/recovery", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	svc := NewReinsuranceService()
	svc.HandleCalculateRecovery(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func Test_Health(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	svc := NewReinsuranceService()
	svc.HandleHealth(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
