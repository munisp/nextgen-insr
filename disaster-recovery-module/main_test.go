package main

import (
	"github.com/go-chi/chi/v5"
	"net/http"
	"net/http/httptest"
	"testing"
)

func testRouter() *chi.Mux {
	r := chi.NewRouter()
	r.Get("/api/v1/status", drStatus)
	r.Post("/api/v1/failover", triggerFailover)
	r.Get("/api/v1/drills", drillHistory)
	r.Get("/api/v1/rto-rpo", rtoRpoStatus)
	return r
}

func Test_Status(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/status", nil)
	w := httptest.NewRecorder()
	drStatus(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
func Test_Drills(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/drills", nil)
	w := httptest.NewRecorder()
	drillHistory(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
func Test_RtoRpo(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/rto-rpo", nil)
	w := httptest.NewRecorder()
	rtoRpoStatus(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
