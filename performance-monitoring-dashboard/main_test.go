package main

import (
	"github.com/go-chi/chi/v5"
	"net/http"
	"net/http/httptest"
	"testing"
)

func testRouter() *chi.Mux {
	r := chi.NewRouter()
	r.Get("/api/v1/metrics/system", systemMetrics)
	r.Get("/api/v1/metrics/business", businessMetrics)
	r.Get("/api/v1/metrics/sla", slaStatus)
	return r
}

func Test_MetricsSystem(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/metrics/system", nil)
	w := httptest.NewRecorder()
	systemMetrics(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
func Test_MetricsBusiness(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/metrics/business", nil)
	w := httptest.NewRecorder()
	businessMetrics(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
func Test_MetricsSla(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/metrics/sla", nil)
	w := httptest.NewRecorder()
	slaStatus(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
