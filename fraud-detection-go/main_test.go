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
	r.Post("/api/v1/score", scoreTransaction)
	r.Get("/api/v1/rules", getRules)
	r.Get("/api/v1/stats", getStats)
	return r
}

func Test_Score(t *testing.T) {
	body := strings.NewReader(`{"amount":50000,"merchant":"store","device_id":"D001"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/score", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	scoreTransaction(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
func Test_Rules(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/rules", nil)
	w := httptest.NewRecorder()
	getRules(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
func Test_Stats(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/stats", nil)
	w := httptest.NewRecorder()
	getStats(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
