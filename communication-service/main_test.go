package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCommHealthEndpoint(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	handleHealth(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestSendNotification(t *testing.T) {
	body := strings.NewReader(`{"channel":"sms","to":"08012345678","message":"Your policy is active"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/send", body)
	w := httptest.NewRecorder()
	handleSend(w, req)
	if w.Code != http.StatusOK && w.Code != http.StatusCreated {
		t.Errorf("Expected success, got %d", w.Code)
	}
}

func TestListTemplates(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/templates", nil)
	w := httptest.NewRecorder()
	handleTemplates(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	// Templates returns an array directly
	if w.Body.Len() == 0 {
		t.Error("Expected non-empty templates response")
	}
}
