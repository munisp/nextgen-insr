package main

import (
	"github.com/go-chi/chi/v5"
	"net/http"
	"net/http/httptest"
	"testing"
)

func testRouter() *chi.Mux {
	r := chi.NewRouter()
	r.Route("/api/v1/brokers", func(r chi.Router) {
		r.Get("/", listBrokers)
		r.Post("/", registerBroker)
		r.Get("/{id}/commission", calculateCommission)
		r.Post("/{id}/validate-license", validateLicense)
	})
	return r
}

func Test_ListBrokers(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/brokers/", nil)
	w := httptest.NewRecorder()
	testRouter().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func Test_CalculateCommission(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/brokers/B001/commission", nil)
	w := httptest.NewRecorder()
	testRouter().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
