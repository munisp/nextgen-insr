package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func Test_AnnuityQuote(t *testing.T) {
	body := strings.NewReader(`{"test": true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/pfa/annuity-quote", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	svc := NewPFAService()
	svc.HandleAnnuityQuote(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func Test_ValidateRsa(t *testing.T) {
	body := strings.NewReader(`{"test": true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/pfa/validate-rsa", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	svc := NewPFAService()
	svc.HandleValidateRSA(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func Test_GroupLifePremium(t *testing.T) {
	body := strings.NewReader(`{"test": true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/pfa/group-life-premium", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	svc := NewPFAService()
	svc.HandleGroupLifePremium(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func Test_Health(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	svc := NewPFAService()
	svc.HandleHealth(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
