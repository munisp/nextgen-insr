package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func Test_Verify(t *testing.T) {
	body := strings.NewReader(`{"test": true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/nmid/verify", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	svc := NewNMIDService()
	svc.HandleVerify(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func Test_Register(t *testing.T) {
	body := strings.NewReader(`{"test": true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/nmid/register", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	svc := NewNMIDService()
	svc.HandleRegister(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func Test_Health(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	svc := NewNMIDService()
	svc.HandleHealth(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
