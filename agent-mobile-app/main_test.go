package main

import (
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func testRouter() *chi.Mux {
	r := chi.NewRouter()
	r.Get("/api/v1/agent/{id}/dashboard", agentDashboard)
	r.Post("/api/v1/agent/{id}/checkin", agentCheckin)
	r.Get("/api/v1/agent/{id}/commission", agentCommission)
	return r
}

// Without a database the dashboard must fail closed (503), never fabricate KPIs.
func Test_AgentA001Dashboard(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/agent/A001/dashboard", nil)
	w := httptest.NewRecorder()
	testRouter().ServeHTTP(w, req)
	if db == nil && w.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected 503 without database, got %d", w.Code)
	}
}

// Without a database the geofence must fail closed (503), never default to within_geofence:true.
func Test_AgentA001Checkin(t *testing.T) {
	body := strings.NewReader(`{"lat":6.45,"lng":3.40}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agent/A001/checkin", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	testRouter().ServeHTTP(w, req)
	if db == nil && w.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected 503 without database, got %d", w.Code)
	}
}

// Invalid coordinates must be rejected before any geofence evaluation.
func Test_AgentA001CheckinInvalidCoords(t *testing.T) {
	body := strings.NewReader(`{"lat":123.0,"lng":3.40}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agent/A001/checkin", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	testRouter().ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 for invalid coordinates, got %d", w.Code)
	}
}

// Without a database the commission endpoint must fail closed (503).
func Test_AgentA001Commission(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/agent/A001/commission", nil)
	w := httptest.NewRecorder()
	testRouter().ServeHTTP(w, req)
	if db == nil && w.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected 503 without database, got %d", w.Code)
	}
}

func Test_HaversineKm(t *testing.T) {
	// Lagos (6.5244, 3.3792) to Abuja (9.0765, 7.3986) ≈ 536 km
	d := haversineKm(6.5244, 3.3792, 9.0765, 7.3986)
	if d < 500 || d > 570 {
		t.Errorf("haversine Lagos-Abuja = %.1f km, expected ~536 km", d)
	}
	// Zero distance
	if d := haversineKm(6.45, 3.40, 6.45, 3.40); math.Abs(d) > 1e-9 {
		t.Errorf("haversine identical points = %v, expected 0", d)
	}
}
