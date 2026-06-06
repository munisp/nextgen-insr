package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBatchHealthEndpoint(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	handleHealth(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestCreateBatch(t *testing.T) {
	body := strings.NewReader(`{"type":"premium_collection","items":10}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/batches", body)
	w := httptest.NewRecorder()
	handleCreateBatch(w, req)
	if w.Code != http.StatusCreated && w.Code != http.StatusOK {
		t.Errorf("Expected 200 or 201, got %d", w.Code)
	}
}
