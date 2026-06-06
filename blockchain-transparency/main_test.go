package main

import (
	"github.com/go-chi/chi/v5"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testRouter() *chi.Mux {
	r := chi.NewRouter()
	r.Post("/api/v1/record", recordOnChain)
	r.Get("/api/v1/verify/{hash}", verifyRecord)
	r.Get("/api/v1/contracts", listContracts)
	return r
}

func Test_Record(t *testing.T) {
	body := strings.NewReader(`{"type":"policy","data":"test"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/record", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	recordOnChain(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
func Test_Contracts(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/contracts", nil)
	w := httptest.NewRecorder()
	listContracts(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
