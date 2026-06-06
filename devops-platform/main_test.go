package main

import (
	"github.com/go-chi/chi/v5"
	"net/http"
	"net/http/httptest"
	"testing"
)

func testRouter() *chi.Mux {
	r := chi.NewRouter()
	r.Get("/api/v1/deployments", listDeployments)
	r.Post("/api/v1/deploy", triggerDeploy)
	r.Get("/api/v1/infrastructure", infraStatus)
	return r
}

func Test_Deployments(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/deployments", nil)
	w := httptest.NewRecorder()
	listDeployments(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
func Test_Infrastructure(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/infrastructure", nil)
	w := httptest.NewRecorder()
	infraStatus(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
