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
	r.Get("/api/v1/renewals/upcoming", upcomingRenewals)
	r.Post("/api/v1/renewals/calculate", calculateRenewalPremium)
	r.Post("/api/v1/renewals/process", processRenewal)
	return r
}

func Test_RenewalsUpcoming(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/renewals/upcoming", nil)
	w := httptest.NewRecorder()
	upcomingRenewals(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
func Test_RenewalsCalculate(t *testing.T) {
	body := strings.NewReader(`{"policy_id":"P001","adjustment":0.05}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/renewals/calculate", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	calculateRenewalPremium(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
