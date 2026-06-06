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
	r.Post("/api/v1/verify", verifyIdentity)
	r.Get("/api/v1/countries", supportedCountries)
	return r
}

func Test_Countries(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/countries", nil)
	w := httptest.NewRecorder()
	supportedCountries(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
func Test_Verify(t *testing.T) {
	body := strings.NewReader(`{"country":"NG","id_type":"bvn","id_number":"12345678901"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/verify", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	verifyIdentity(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
