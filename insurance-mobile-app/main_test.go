package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func Test_Health(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	newRouter().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func Test_AppConfig(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/app/config", nil)
	w := httptest.NewRecorder()
	newRouter().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func Test_Sync(t *testing.T) {
	body := strings.NewReader(`{"test": true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	newRouter().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
