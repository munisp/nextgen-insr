package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func Test_Premium(t *testing.T) {
	body := strings.NewReader(`{"test": true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/group-life/premium", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	svc := NewGroupLifeService()
	svc.HandleCalculatePremium(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func Test_RenewalQuote(t *testing.T) {
	body := strings.NewReader(`{"test": true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/group-life/renewal-quote", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	svc := NewGroupLifeService()
	svc.HandleRenewalQuote(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func Test_Health(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	svc := NewGroupLifeService()
	svc.HandleHealth(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
