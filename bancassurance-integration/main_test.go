package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func Test_Offer(t *testing.T) {
	body := strings.NewReader(`{"test": true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/bancassurance/offer", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	svc := NewBancassuranceService()
	svc.HandleGenerateOffer(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func Test_LoanProtection(t *testing.T) {
	body := strings.NewReader(`{"test": true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/bancassurance/loan-protection", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	svc := NewBancassuranceService()
	svc.HandleCreateLoanProtection(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func Test_Health(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	svc := NewBancassuranceService()
	svc.HandleHealth(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
