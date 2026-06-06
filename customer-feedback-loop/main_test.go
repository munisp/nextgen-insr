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
	r.Post("/api/v1/feedback", submitFeedback)
	r.Get("/api/v1/feedback/summary", feedbackSummary)
	r.Get("/api/v1/nps", npsScore)
	return r
}

func Test_Feedback(t *testing.T) {
	body := strings.NewReader(`{"customer_id":"C001","rating":4,"comment":"Good service"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/feedback", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	submitFeedback(w, req)
	if w.Code != http.StatusOK && w.Code != http.StatusCreated {
		t.Errorf("Expected 200 or 201, got %d", w.Code)
	}
}
func Test_FeedbackSummary(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/feedback/summary", nil)
	w := httptest.NewRecorder()
	feedbackSummary(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
func Test_Nps(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/nps", nil)
	w := httptest.NewRecorder()
	npsScore(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
