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
	r.Post("/api/v1/workflow/transition", transitionPolicy)
	r.Get("/api/v1/workflow/valid-transitions/{state}", getValidTransitions)
	return r
}

func Test_WorkflowTransition(t *testing.T) {
	body := strings.NewReader(`{"policy_id":"P001","current_state":"draft","new_state":"active","actor":"admin"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workflow/transition", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	transitionPolicy(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
func Test_WorkflowValidTransitionsDraft(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workflow/valid-transitions/draft", nil)
	w := httptest.NewRecorder()
	testRouter().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
