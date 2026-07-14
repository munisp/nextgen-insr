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

func Test_Scripts(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/scripts", nil)
	w := httptest.NewRecorder()
	newRouter().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func Test_ScriptsRun(t *testing.T) {
	body := strings.NewReader(`{"script":"health-check"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/scripts/run", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	newRouter().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
