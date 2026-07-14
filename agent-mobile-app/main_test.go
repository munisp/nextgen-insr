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
	r.Get("/api/v1/agent/{id}/dashboard", agentDashboard)
	r.Post("/api/v1/agent/{id}/checkin", agentCheckin)
	r.Get("/api/v1/agent/{id}/commission", agentCommission)
	return r
}

func Test_AgentA001Dashboard(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/agent/A001/dashboard", nil)
	w := httptest.NewRecorder()
	testRouter().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
func Test_AgentA001Checkin(t *testing.T) {
	body := strings.NewReader(`{"lat":6.45,"lng":3.40}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agent/A001/checkin", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	testRouter().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
func Test_AgentA001Commission(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/agent/A001/commission", nil)
	w := httptest.NewRecorder()
	testRouter().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
